import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import Hosts, { Hosts as NamedHosts, HostsDocument, HostsConflictError } from 'hosts-so-easy';

const directories = [];
afterEach(async () => {
  mock.restoreAll();
  mock.timers.reset();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture(contents = '127.0.0.1 localhost') {
  const dir = await mkdtemp(path.join(tmpdir(), 'hosts-so-easy-'));
  directories.push(dir);
  const file = path.join(dir, 'hosts');
  await writeFile(file, contents);
  return file;
}

const offline = options => new Hosts({ noWrites: true, EOL: '\n', ...options });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fails = code => () => Promise.reject(Object.assign(new Error(code), { code }));

// Hold back fs.promises.rename, and with it the end of a write, until released.
function holdRename() {
  const real = fs.promises.rename;
  let release;
  const held = new Promise(resolve => {
    mock.method(fs.promises, 'rename', (...args) => new Promise((done, failed) => {
      release = () => real(...args).then(done, failed);
      resolve();
    }), { times: 1 });
  });
  return { held, release: () => release() };
}

// Let fs.promises.rename hang until told to fail.
function failRename() {
  let fail;
  const held = new Promise(resolve => {
    mock.method(fs.promises, 'rename', () => new Promise((done, failed) => {
      fail = () => failed(Object.assign(new Error('EIO'), { code: 'EIO' }));
      resolve();
    }), { times: 1 });
  });
  return { held, fail: () => fail() };
}

// Run a script in its own process, to observe warnings and the exit code.
async function child(script, env = {}) {
  const index = JSON.stringify(createRequire(import.meta.url).resolve('hosts-so-easy'));
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['-e', `const Hosts = require(${index});\n${script}`], { env: { ...process.env, NODE_OPTIONS: '', ...env } });
  return { stdout, stderr };
}

describe('queued Hosts API (deprecated)', () => {

  describe('exports', () => {
    it('is the default export of both module systems, beside the document API', () => {
      const cjs = createRequire(import.meta.url)('hosts-so-easy');
      assert.equal(cjs, Hosts);
      assert.equal(cjs.default, Hosts);
      assert.equal(cjs.Hosts, Hosts);
      assert.equal(NamedHosts, Hosts);
      assert.equal(cjs.HostsDocument, HostsDocument);
      assert.equal(cjs.HostsConflictError, HostsConflictError);
    });

    it('warns once per process that it is deprecated', async () => {
      const { stderr } = await child('new Hosts({ noWrites: true }); new Hosts({ noWrites: true });');
      assert.equal(stderr.match(/DeprecationWarning/g).length, 1);
      assert.match(stderr, /HOSTS_SO_EASY_DEP001.*HostsDocument/);
    });
  });

  describe('options', () => {
    it('rejects unknown options and wrong types', () => {
      assert.throws(() => new Hosts({ noSuchOption: true }), /No such config option: noSuchOption/);
      assert.throws(() => new Hosts({ toString: 'invalid' }), /No such config option/);
      assert.throws(() => new Hosts({ debounceTime: '500' }), /key `debounceTime` expects a number/);
      assert.throws(() => new Hosts({ maxWait: null }), /key `maxWait`/);
      for (const debounceTime of [-1, NaN, Infinity, 2 ** 31])
        assert.throws(() => new Hosts({ debounceTime }), /key `debounceTime` expects a number of milliseconds/);
      assert.throws(() => new Hosts({ atomicWrites: 1 }), /key `atomicWrites`/);
      assert.throws(() => new Hosts({ hostsFile: undefined }), /key `hostsFile`/);
      assert.throws(() => new Hosts({ noWrites: 'yes' }), /key `noWrites`/);
      for (const header of [true, {}, '', 'a\nb']) assert.throws(() => new Hosts({ header }), /`header`/);
      assert.throws(() => new Hosts({ EOL: '\r' }), /`eol`/);
      new Hosts();
      new Hosts(null);
      new Hosts({ header: false, EOL: '\r\n', maxWait: 10, noWrites: true });
    });
  });

  describe('modify', () => {
    it('applies the queued changes in call order and clears the queue', () => {
      const hosts = offline();
      hosts.add('127.0.0.1', 'a');
      hosts.add('127.0.0.1', ['b', 'c']);
      hosts.remove('127.0.0.1', 'localhost');
      hosts.remove('10.0.0.5', '*');
      hosts.add('10.0.0.5', 'web');
      assert.equal(hosts.modify('127.0.0.1 localhost\n10.0.0.5 old\n'), '127.0.0.1 a b c\n10.0.0.5 web\n');
      assert.equal(hosts.modify('127.0.0.1 localhost\n'), '127.0.0.1 localhost\n');
    });

    it('removes hosts from every address with removeHost() or remove("*", host)', () => {
      const hosts = offline();
      hosts.removeHost('admin');
      hosts.remove('*', ['x', 'y']);
      hosts.remove('*', 'z');
      assert.equal(hosts.modify('1.1.1.1 a admin x\n::1 b y z admin'), '1.1.1.1 a\n::1 b');
    });

    it('forgets the queue on clearQueue()', () => {
      const hosts = offline();
      hosts.add('127.0.0.1', 'a');
      hosts.clearQueue();
      assert.equal(hosts.modify('127.0.0.1 localhost'), '127.0.0.1 localhost');
    });

    it('keeps new entries in the header block', () => {
      const hosts = offline({ header: 'test' });
      hosts.add('127.0.0.2', 'x');
      hosts.removeHost('absent');
      assert.equal(hosts.modify('127.0.0.1 localhost'), '127.0.0.1 localhost\n\n# test\n127.0.0.2 x');
      hosts.removeHost('absent');
      assert.equal(hosts.modify('127.0.0.1 localhost'), '127.0.0.1 localhost');
    });

    it('uses the line ending of the contents unless EOL is given', () => {
      const hosts = new Hosts({ noWrites: true });
      hosts.add('::1', 'x');
      assert.equal(hosts.modify('127.0.0.1 localhost\r\n'), '127.0.0.1 localhost\r\n::1 x\r\n');
      const lf = offline();
      lf.add('::1', 'x');
      assert.equal(lf.modify('127.0.0.1 localhost\r\n'), '127.0.0.1 localhost\r\n::1 x\n');
    });

    it('validates arguments when a change is queued', () => {
      const hosts = offline();
      for (const ip of [{}, undefined, '', 'localhost', '1.2.3.4\n']) {
        assert.throws(() => hosts.add(ip, 'x'), /`ip`/);
        assert.throws(() => hosts.remove(ip, 'x'), /`ip`/);
        assert.throws(() => hosts.remove(ip, '*'), /`ip`/);
      }
      assert.throws(() => hosts.add('*', 'x'), /`ip`/);
      for (const host of [{}, undefined, '', 'a b', 'x\n6.6.6.6 bank.com', [null]]) {
        assert.throws(() => hosts.add('127.0.0.1', host), /`hosts`/);
        assert.throws(() => hosts.remove('127.0.0.1', host), /`hosts`/);
        assert.throws(() => hosts.remove('*', host), /`hosts`/);
        assert.throws(() => hosts.removeHost(host), /`hosts`/);
      }
      assert.throws(() => hosts.remove('*', '*'), /hosts\.remove\('\*', '\*'\) not allowed/);
      assert.throws(() => hosts.modify(null), /`text`/);
      assert.equal(hosts.modify('127.0.0.1 localhost'), '127.0.0.1 localhost');
    });

    it('is not affected by later changes to an array it was given', () => {
      const hosts = offline();
      const list = ['a'];
      hosts.add('127.0.0.1', list);
      list.push('b\n6.6.6.6 bank.com');
      assert.equal(hosts.modify(''), '127.0.0.1 a\n');
    });
  });

  describe('updates', () => {
    for (const atomicWrites of [false, true]) {
      it(`batches changes into one write and emits events (atomicWrites=${atomicWrites})`, async () => {
        const file = await fixture();
        const hosts = new Hosts({ hostsFile: file, debounceTime: 0, atomicWrites });
        const events = [];
        hosts.on('updateStart', () => events.push('start'));
        hosts.on('updateFinish', err => events.push(err ?? 'finish'));
        hosts.add('127.0.0.1', 'first');
        hosts.add('127.0.0.1', 'second');
        await hosts.updateFinish();
        hosts.add('127.0.0.1', 'third');
        await hosts.updateFinish();
        assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost first second third');
        assert.deepEqual(events, ['start', 'finish', 'start', 'finish']);
      });
    }

    it('reads the file afresh for every update', async () => {
      const file = await fixture();
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      hosts.add('127.0.0.1', 'first');
      await hosts.updateFinish();
      await writeFile(file, '127.0.0.1 external');
      hosts.add('127.0.0.1', 'second');
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 external second');
    });

    it('applies its changes again when the file changes during an update', async () => {
      const file = await fixture();
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      const real = fs.promises.realpath;
      mock.method(fs.promises, 'realpath', async (...args) => {
        await writeFile(file, '127.0.0.1 external');
        return real(...args);
      }, { times: 1 });
      hosts.add('127.0.0.1', 'mine');
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 external mine');
    });

    it('does not write, but still reports, an update that changes nothing', async () => {
      const file = await fixture();
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      const rename = mock.method(fs.promises, 'rename');
      let finished = 0;
      hosts.on('updateFinish', () => finished++);
      hosts.add('127.0.0.1', 'localhost');
      await hosts.updateFinish();
      assert.equal(finished, 1);
      assert.equal(rename.mock.callCount(), 0);
    });

    it('never writes with noWrites, and never keeps anyone waiting', async () => {
      const file = await fixture();
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0, noWrites: true });
      hosts.add('127.0.0.1', 'x');
      await hosts.updateFinish();
      await sleep(20);
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost');
    });

    it('does not write changes dropped by clearQueue(), and releases their waiters', async () => {
      const file = await fixture();
      const hosts = new Hosts({ hostsFile: file, debounceTime: 5 });
      hosts.add('127.0.0.1', 'x');
      const finished = hosts.updateFinish();
      hosts.clearQueue();
      await finished;
      await sleep(20);
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost');
    });
  });

  describe('updateFinish', () => {
    it('settles at once when there is nothing to wait for', async () => {
      const hosts = new Hosts({ hostsFile: await fixture() });
      await hosts.updateFinish();
      await new Promise(resolve => hosts.updateFinish(resolve));
    });

    it('calls callbacks and resolves promises for the same update', async () => {
      const hosts = new Hosts({ hostsFile: await fixture(), debounceTime: 0 });
      hosts.add('127.0.0.1', 'added');
      let called = 0;
      const callback = new Promise(resolve => hosts.updateFinish(err => {
        called++;
        resolve(err);
      }));
      assert.deepEqual(await Promise.all([callback, hosts.updateFinish(), hosts.updateFinish()]), [undefined, undefined, undefined]);
      assert.equal(called, 1);
    });

    it('calls callbacks on a later tick', async () => {
      const hosts = new Hosts({ hostsFile: await fixture(), debounceTime: 0 });
      let called = 0;
      hosts.updateFinish(() => called++);
      assert.equal(called, 0);
      hosts.add('127.0.0.1', 'x');
      hosts.on('updateFinish', () => assert.equal(called, 1));
      await new Promise(resolve => hosts.updateFinish(() => { called++; resolve(); }));
      assert.equal(called, 2);
    });

    it('rejects anything but a function', () => {
      const hosts = offline();
      for (const value of [{}, false, 0, null, 'callback'])
        assert.throws(() => hosts.updateFinish(value), /expects `callback`/);
    });

    it('waits for the write that contains the change, not one already under way', async () => {
      const file = await fixture();
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      const { held, release } = holdRename();
      let starts = 0;
      hosts.on('updateStart', () => starts++);

      hosts.add('127.0.0.1', 'early');
      const early = hosts.updateFinish();
      await held;
      hosts.add('127.0.0.1', 'late');
      const late = hosts.updateFinish().then(() => readFile(file, 'utf8'));
      await sleep(20);
      assert.equal(starts, 1, 'updates must not overlap');
      release();
      await early;
      assert.equal(await late, '127.0.0.1 localhost early late');
      assert.equal(starts, 2);
    });

    it('waits for the write under way when nothing newer is queued', async () => {
      const file = await fixture();
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      const { held, release } = holdRename();
      hosts.add('127.0.0.1', 'x');
      await held;
      const finished = hosts.updateFinish().then(() => readFile(file, 'utf8'));
      release();
      assert.equal(await finished, '127.0.0.1 localhost x');
    });
  });

  describe('timing', () => {
    it('waits for a pause in changes, but no longer than maxWait', async () => {
      const file = await fixture();
      mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const hosts = new Hosts({ hostsFile: file, debounceTime: 500, maxWait: 2000 });
      let starts = 0;
      hosts.on('updateStart', () => starts++);
      for (let i = 0; i < 4; i++) {
        hosts.add('127.0.0.1', 'host' + i);
        mock.timers.tick(499);
      }
      hosts.add('127.0.0.1', 'host4');
      mock.timers.tick(3);
      assert.equal(starts, 0);
      mock.timers.tick(1);
      assert.equal(starts, 1, 'maxWait reached');
      await hosts.updateFinish();

      hosts.add('127.0.0.1', 'later');
      mock.timers.tick(499);
      assert.equal(starts, 1);
      mock.timers.tick(1);
      assert.equal(starts, 2, 'debounceTime reached');
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost host0 host1 host2 host3 host4 later');
    });

    it('defaults maxWait to two seconds, or debounceTime if that is longer', async () => {
      const file = await fixture();
      mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      for (const [debounceTime, expected] of [[100, 2000], [3000, 3000]]) {
        const hosts = new Hosts({ hostsFile: file, debounceTime });
        let started = false;
        hosts.on('updateStart', () => { started = true; });
        const step = debounceTime - 1;
        let elapsed = 0;
        for (; elapsed + step < expected; elapsed += step) {
          hosts.add('127.0.0.1', 'x');
          mock.timers.tick(step);
        }
        hosts.add('127.0.0.1', 'x');
        mock.timers.tick(expected - elapsed - 1);
        assert.equal(started, false);
        mock.timers.tick(1);
        assert.equal(started, true);
        await hosts.updateFinish();
      }
    });
  });

  describe('failures', () => {
    it('reports the error and keeps the changes for the next update', async () => {
      const file = await fixture();
      await rm(file);
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0, EOL: '\n' });
      hosts.remove('127.0.0.1', '*');
      hosts.add('127.0.0.1', 'retry');
      const event = new Promise(resolve => hosts.once('updateFinish', resolve));
      const callback = new Promise(resolve => hosts.updateFinish(resolve));
      await assert.rejects(hosts.updateFinish(), { code: 'ENOENT' });
      assert.equal((await event).code, 'ENOENT');
      assert.equal((await callback).code, 'ENOENT');

      await writeFile(file, '127.0.0.1 localhost');
      hosts.add('127.0.0.1', 'next');
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 retry next\n');
    });

    it('tries again when asked how the kept changes are doing', async () => {
      const file = await fixture();
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      mock.method(fs.promises, 'rename', fails('EIO'), { times: 1 });
      hosts.add('127.0.0.1', 'x');
      await assert.rejects(hosts.updateFinish(), { code: 'EIO' });
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost');
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost x');
      await hosts.updateFinish();
    });

    it('keeps failed changes ahead of ones queued after them', async () => {
      const file = await fixture('10.0.0.5 old');
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0, EOL: '\n' });
      mock.method(fs.promises, 'rename', fails('EIO'), { times: 1 });
      hosts.add('10.0.0.5', 'web');
      await assert.rejects(hosts.updateFinish(), { code: 'EIO' });
      hosts.remove('10.0.0.5', 'web');
      hosts.remove('10.0.0.5', 'old');
      hosts.add('10.0.0.5', 'new');
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '10.0.0.5 new\n');
    });

    it('keeps failed changes ahead of ones queued during the failed write', async () => {
      const file = await fixture('10.0.0.5 old');
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      const { held, fail } = failRename();
      hosts.add('10.0.0.5', 'web');
      const first = assert.rejects(hosts.updateFinish(), { code: 'EIO' });
      await held;
      hosts.remove('10.0.0.5', 'web');
      fail();
      await first;
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '10.0.0.5 old');
    });

    it('does not retry a failed write that clearQueue() was called during', async () => {
      const file = await fixture('127.0.0.1 localhost\n');
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      const { held, fail } = failRename();
      hosts.add('10.0.0.1', 'cancelled');
      const first = assert.rejects(hosts.updateFinish(), { code: 'EIO' });
      await held;
      hosts.clearQueue();
      fail();
      await first;
      hosts.add('10.0.0.2', 'unrelated');
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n10.0.0.2 unrelated\n');
    });

    it('survives the failure of a very large batch', async () => {
      const file = await fixture('127.0.0.1 localhost a149999\n');
      await rm(file);
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      for (let i = 0; i < 150_000; i++) hosts.removeHost('a' + i);
      await assert.rejects(hosts.updateFinish(), { code: 'ENOENT' });
      await writeFile(file, '127.0.0.1 localhost a149999\n');
      await hosts.updateFinish();
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n');
    });

    it('gives the error to subscribers that join after the update started', async () => {
      const file = await fixture();
      await rm(file);
      const hosts = new Hosts({ hostsFile: file, debounceTime: 0 });
      let result;
      const started = new Promise(resolve => hosts.once('updateStart', () => {
        result = assert.rejects(hosts.updateFinish(), { code: 'ENOENT' });
        resolve();
      }));
      hosts.add('127.0.0.1', 'pending');
      await started;
      await result;
    });

    it('treats a throwing updateStart listener as a failed update', async () => {
      const hosts = new Hosts({ hostsFile: await fixture(), debounceTime: 0 });
      hosts.once('updateStart', () => { throw new Error('listener'); });
      hosts.add('127.0.0.1', 'x');
      await assert.rejects(hosts.updateFinish(), /listener/);
    });

    it('warns instead of crashing when nobody observes a failure', async () => {
      const { stdout, stderr } = await child(`
        const hosts = new Hosts({ hostsFile: __filename + '.missing', debounceTime: 0 });
        hosts.add('127.0.0.1', 'x');
        setTimeout(() => console.log('still running'), 100);
      `, { NODE_NO_WARNINGS: '' });
      assert.match(stdout, /still running/);
      assert.match(stderr, /HOSTS_SO_EASY_UPDATE_FAILED.*failed to update.*ENOENT/);
    });

    it('does not warn when a listener sees the failure', async () => {
      const { stdout, stderr } = await child(`
        const hosts = new Hosts({ hostsFile: __filename + '.missing', debounceTime: 0 });
        hosts.on('updateFinish', err => console.log('seen', err.code));
        hosts.add('127.0.0.1', 'x');
      `);
      assert.match(stdout, /seen ENOENT/);
      assert.doesNotMatch(stderr, /HOSTS_SO_EASY_UPDATE_FAILED/);
    });
  });
});
