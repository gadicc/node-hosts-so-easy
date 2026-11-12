import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Hosts, { noop } from './index.js';

const directories = [];
afterEach(async () => {
  mock.restoreAll();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture(contents = '127.0.0.1 localhost') {
  const dir = await mkdtemp(path.join(tmpdir(), 'hosts-so-easy-'));
  directories.push(dir);
  const filename = path.join(dir, 'hosts');
  await writeFile(filename, contents, { mode: 0o640 });
  return filename;
}

const update = hosts => new Promise((resolve, reject) => {
  hosts._update(err => err ? reject(err) : resolve());
});

describe('file operations', () => {
  for (const atomicWrites of [false, true]) {
    it(`writes, emits events, and preserves consecutive changes (atomicWrites=${atomicWrites})`, async () => {
      const filename = await fixture();
      const hosts = new Hosts({ hostsFile: filename, debounceTime: 0, atomicWrites });
      const events = [];
      hosts.on('updateStart', () => events.push('start'));
      hosts.on('updateFinish', err => { assert.ifError(err); events.push('finish'); });
      hosts.add('127.0.0.1', 'first');
      hosts.add('127.0.0.1', 'second');
      await hosts.updateFinish();
      hosts.add('127.0.0.1', 'third');
      await hosts.updateFinish();
      assert.equal(await readFile(filename, 'utf8'), '127.0.0.1 localhost first second third');
      assert.deepEqual(events, ['start', 'finish', 'start', 'finish']);
      if (process.platform !== 'win32') assert.equal((await stat(filename)).mode & 0o777, 0o640);
    });
  }

  it('rereads externally modified contents on every update', async () => {
    const filename = await fixture();
    const hosts = new Hosts({ hostsFile: filename, debounceTime: 0 });
    hosts.add('127.0.0.1', 'first');
    await hosts.updateFinish();
    await writeFile(filename, '127.0.0.1 external');
    hosts.add('127.0.0.1', 'second');
    await hosts.updateFinish();
    assert.equal(await readFile(filename, 'utf8'), '127.0.0.1 external second');
  });

  it('supports callbacks and promise subscribers for the same update', async () => {
    const filename = await fixture();
    const hosts = new Hosts({ hostsFile: filename, debounceTime: 0 });
    hosts.add('127.0.0.1', 'added');
    let called = 0;
    const callback = new Promise((resolve, reject) => hosts.updateFinish(err => {
      called++;
      err ? reject(err) : resolve();
    }));
    await Promise.all([callback, hosts.updateFinish(), hosts.updateFinish()]);
    assert.equal(called, 1);
    assert.equal(hosts.updateFinishCallbacks.length, 0);
  });

  it('rejects invalid callbacks', () => {
    const hosts = new Hosts({ noWrites: true });
    for (const value of [{}, false, 0, null, 'callback']) {
      assert.throws(() => hosts.updateFinish(value), /expects `callback`/);
    }
  });

  it('keeps callbacks registered during notification for the next update', async () => {
    const hosts = new Hosts({ noWrites: true });
    let next;
    hosts.updateFinish(() => { next = hosts.updateFinish(); });
    hosts._runUpdateFinishCallbacks();
    assert.equal(hosts.updateFinishCallbacks.length, 1);
    hosts._runUpdateFinishCallbacks();
    await next;
  });

  it('rejects promises on failure', async () => {
    const hosts = new Hosts({ noWrites: true });
    const result = assert.rejects(hosts.updateFinish(), /failure/);
    hosts._runUpdateFinishCallbacks(new Error('failure'));
    await result;
  });

  it('recovers after a missing-file error and retains the pending changes', async () => {
    const filename = await fixture();
    await rm(filename);
    const hosts = new Hosts({ hostsFile: filename, debounceTime: 0 });
    hosts.add('127.0.0.1', 'retry');
    await assert.rejects(hosts.updateFinish(), { code: 'ENOENT' });
    assert.equal(hosts.writeInProgress, false);
    await writeFile(filename, '127.0.0.1 localhost');
    hosts.add('127.0.0.1', 'next');
    await hosts.updateFinish();
    assert.equal(await readFile(filename, 'utf8'), '127.0.0.1 localhost retry next');
  });

  it('reports read permission errors and resets the busy flag', async () => {
    const hosts = new Hosts({ noWrites: true });
    const error = Object.assign(new Error('denied'), { code: 'EACCES' });
    mock.method(fs, 'readFile', (filename, encoding, callback) => callback(error));
    await assert.rejects(update(hosts), { code: 'EACCES' });
    assert.equal(hosts.writeInProgress, false);
  });

  it('honors error subscribers registered after an update starts', async () => {
    const filename = await fixture();
    await rm(filename);
    const hosts = new Hosts({ hostsFile: filename, debounceTime: 0 });
    let result;
    const started = new Promise(resolve => hosts.once('updateStart', () => {
      result = assert.rejects(hosts.updateFinish(), { code: 'ENOENT' });
      resolve();
    }));
    hosts.add('127.0.0.1', 'pending');
    await started;
    await result;
    assert.equal(hosts.writeInProgress, false);
  });

  it('reports a failed write to event subscribers without leaving the instance busy', async () => {
    const filename = await fixture();
    const hosts = new Hosts({ hostsFile: filename, debounceTime: 0 });
    hosts._writeFile = (filename, contents, callback) => callback(new Error('failed'));
    const result = new Promise(resolve => hosts.once('updateFinish', err => {
      assert.match(err.message, /failed/);
      resolve();
    }));
    hosts.add('127.0.0.1', 'pending');
    await result;
    assert.equal(hosts.writeInProgress, false);
  });

  it('restores queued additions and removals after a failed write', async () => {
    const filename = await fixture('127.0.0.1 localhost old\n127.0.0.2 remove\n127.0.0.3 everywhere');
    const hosts = new Hosts({ hostsFile: filename, noWrites: true });
    const write = hosts._writeFile;
    hosts.add('127.0.0.1', 'retry');
    hosts.remove('127.0.0.1', 'old');
    hosts.remove('127.0.0.2', '*');
    hosts.removeHost('everywhere');
    hosts._writeFile = (filename, contents, callback) => {
      hosts.add('127.0.0.1', 'next');
      hosts.remove('127.0.0.1', 'localhost');
      callback(new Error('write failed'));
    };
    const failure = assert.rejects(hosts.updateFinish(), /write failed/);
    await assert.rejects(update(hosts), /write failed/);
    await failure;
    assert.equal(hosts.writeInProgress, false);
    hosts._writeFile = write;
    await update(hosts);
    assert.equal(await readFile(filename, 'utf8'), '127.0.0.1 retry next');
  });

  it('handles atomic rename failures without changing the original file', async () => {
    const filename = await fixture();
    const hosts = new Hosts({ hostsFile: filename, noWrites: true });
    mock.method(fs, 'rename', (from, to, callback) => callback(new Error('rename denied')));
    hosts.add('127.0.0.1', 'retry');
    await assert.rejects(update(hosts), /rename denied/);
    assert.equal(hosts.writeInProgress, false);
    assert.equal(await readFile(filename, 'utf8'), '127.0.0.1 localhost');
    mock.restoreAll();
    await update(hosts);
    assert.equal(await readFile(filename, 'utf8'), '127.0.0.1 localhost retry');
  });

  it('does not overlap writes, including changes queued during a write', async () => {
    const filename = await fixture();
    const hosts = new Hosts({ hostsFile: filename, noWrites: true });
    const write = hosts._writeFile;
    let finish;
    let writing;
    const started = new Promise(resolve => { writing = resolve; });
    hosts._writeFile = (filename, contents, callback) => {
      finish = () => write(filename, contents, callback);
      writing();
    };
    hosts.add('127.0.0.1', 'first');
    const first = update(hosts);
    await started;
    const queued = mock.method(hosts, '_queueUpdate', noop);
    hosts.add('127.0.0.1', 'second');
    hosts._update(noop);
    assert.equal(queued.mock.callCount(), 2);
    finish();
    await first;
    hosts._writeFile = write;
    await update(hosts);
    assert.equal(await readFile(filename, 'utf8'), '127.0.0.1 localhost first second');
  });

  it('uses the same class for ESM, CommonJS, and legacy .default', () => {
    const require = createRequire(import.meta.url);
    const CjsHosts = require('hosts-so-easy');
    assert.equal(CjsHosts, Hosts);
    assert.equal(CjsHosts.default, Hosts);
    assert.equal(CjsHosts.noop, noop);
  });
});
