import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import fs from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, writeFile, rm, stat, symlink, lstat, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HostsDocument, HostsConflictError } from 'hosts-so-easy';
import { SEED, random } from './support/gen.js';

const posix = process.platform !== 'win32';
const root = posix && process.getuid() === 0;
const directories = [];

afterEach(async () => {
  mock.restoreAll();
  for (const dir of directories.splice(0)) {
    await chmod(dir, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

// The default mode is one that no umask would produce by itself.
async function fixture(contents = '127.0.0.1 localhost\n', mode = 0o606) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hosts-so-easy-'));
  directories.push(dir);
  const file = path.join(dir, 'hosts');
  await writeFile(file, contents);
  await chmod(file, mode);
  return file;
}

// Make in-place writes go through `write(real, ...args)` instead of handle.write.
function interceptInPlaceWrites(write) {
  const open = fs.promises.open;
  mock.method(fs.promises, 'open', async (file, flags, ...rest) => {
    const handle = await open(file, flags, ...rest);
    if (typeof flags === 'number') {
      const real = handle.write.bind(handle);
      handle.write = (...args) => write(real, ...args);
    }
    return handle;
  });
}

const fails = code => () => Promise.reject(Object.assign(new Error(code), { code }));

describe('HostsDocument files', () => {
  it('loads, changes and writes a file, keeping its mode', async () => {
    const file = await fixture();
    const doc = await HostsDocument.load(file);
    assert.equal(doc.file, file);
    assert.equal(await doc.add('127.0.0.1', 'added').write(), true);
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost added\n');
    if (posix) assert.equal((await stat(file)).mode & 0o777, 0o606);
    assert.deepEqual(await readdir(path.dirname(file)), ['hosts']);
  });

  it('replaces the file atomically, or in place when asked', async t => {
    if (!posix) return t.skip('inode numbers are not comparable on Windows');
    const file = await fixture();
    const inode = async () => (await stat(file)).ino;
    const before = await inode();
    const doc = await HostsDocument.load(file);
    await doc.add('::1', 'a').write({ atomic: false });
    assert.equal(await inode(), before);
    await doc.add('::1', 'b').write();
    assert.notEqual(await inode(), before);
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n::1 a b\n');
  });

  it('writes nothing when nothing changed', async () => {
    const file = await fixture();
    const read = mock.method(fs.promises, 'readFile');
    const doc = await HostsDocument.load(file);
    assert.equal(await doc.write(), false);
    assert.equal(await doc.add('127.0.0.1', 'localhost').remove('127.0.0.1', 'absent').write(), false);
    assert.equal(await doc.add('::1', 'x').removeIp('::1').write(), false);
    assert.equal(read.mock.callCount(), 1);
  });

  it('writes nothing when the file already has the same contents', async () => {
    const file = await fixture();
    const doc = await HostsDocument.load(file);
    await writeFile(file, '127.0.0.1 localhost x\n');
    const rename = mock.method(fs.promises, 'rename');
    assert.equal(await doc.add('127.0.0.1', 'x').write(), false);
    assert.equal(rename.mock.callCount(), 0);
    assert.equal(await doc.add('127.0.0.1', 'y').write(), true);
  });

  it('refuses to overwrite a file that changed since it was loaded', async () => {
    const file = await fixture();
    const doc = await HostsDocument.load(file);
    await writeFile(file, '127.0.0.1 localhost external\n');
    await assert.rejects(doc.add('::1', 'x').write(), err => {
      assert.ok(err instanceof HostsConflictError);
      assert.deepEqual([err.name, err.code, err.file], ['HostsConflictError', 'ERR_HOSTS_CONFLICT', file]);
      return true;
    });
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost external\n');
  });

  it('writes repeatedly from one document, in order', async () => {
    const file = await fixture();
    const doc = await HostsDocument.load(file);
    const first = doc.add('::1', 'a').write();
    const second = doc.add('::1', 'b').write();
    // The first write already holds both changes, leaving the second nothing to do.
    assert.deepEqual(await Promise.all([first, second]), [true, false]);
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n::1 a b\n');
  });

  it('keeps working after a failed write', async () => {
    const file = await fixture();
    const doc = await HostsDocument.load(file);
    mock.method(fs.promises, 'rename', fails('EIO'));
    await assert.rejects(doc.add('::1', 'a').write(), { code: 'EIO' });
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n');
    assert.deepEqual(await readdir(path.dirname(file)), ['hosts']);
    mock.restoreAll();
    assert.equal(await doc.write(), true);
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n::1 a\n');
  });

  for (const code of ['EBUSY', 'EPERM', 'EXDEV', 'EACCES', 'EROFS']) {
    it(`falls back to writing in place when the file cannot be replaced (${code})`, async () => {
      const file = await fixture('127.0.0.1 localhost with a long line that gets shorter\n');
      const doc = await HostsDocument.load(file);
      mock.method(fs.promises, code === 'EROFS' ? 'open' : 'rename', fails(code), { times: 1 });
      assert.equal(await doc.removeIp('127.0.0.1').add('::1', 'x').write(), true);
      assert.equal(await readFile(file, 'utf8'), '::1 x\n');
      assert.deepEqual(await readdir(path.dirname(file)), ['hosts']);
    });
  }

  it('falls back to writing in place rather than change the owner', async t => {
    if (!posix || root) return t.skip('needs an unprivileged POSIX user');
    const file = await fixture();
    const doc = await HostsDocument.load(file);
    // Pretend the file belongs to root, which the temporary file cannot be given to.
    const real = fs.promises.stat;
    mock.method(fs.promises, 'stat', async (...args) => Object.assign(await real(...args), { uid: 0 }));
    const rename = mock.method(fs.promises, 'rename');
    assert.equal(await doc.add('::1', 'x').write(), true);
    assert.equal(rename.mock.callCount(), 0);
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n::1 x\n');
    assert.deepEqual(await readdir(path.dirname(file)), ['hosts']);
  });

  it('keeps the group of the file, not that of its directory', async t => {
    if (!posix) return t.skip('no file ownership on Windows');
    const other = process.getgroups().find(gid => gid !== process.getgid());
    if (root || other === undefined) return t.skip('needs an unprivileged user with a second group');
    const file = await fixture();
    await fs.promises.chown(file, -1, other);
    const doc = await HostsDocument.load(file);
    assert.equal(await doc.add('::1', 'x').write(), true);
    assert.equal((await stat(file)).gid, other);
    assert.equal((await stat(file)).mode & 0o777, 0o606);
  });

  it('writes everything in place even when the system writes a little at a time', async () => {
    const file = await fixture();
    const doc = await HostsDocument.load(file);
    interceptInPlaceWrites((real, buffer, offset, length, position) => real(buffer, offset, Math.min(length, 7), position));
    assert.equal(await doc.add('::1', ['a', 'b', 'c']).write({ atomic: false }), true);
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n::1 a b c\n');
    assert.equal(await doc.removeIp('::1').removeIp('127.0.0.1').write({ atomic: false }), true);
    assert.equal(await readFile(file, 'utf8'), '');
  });

  for (const [name, second] of [
    ['fails', fails('ENOSPC')],
    ['writes nothing more', () => Promise.resolve({ bytesWritten: 0 })],
  ]) {
    it(`puts the previous contents back when an in-place write ${name} part way`, async () => {
      const original = '127.0.0.1 localhost\n10.0.0.1 important.internal\n';
      const file = await fixture(original);
      const doc = await HostsDocument.load(file);
      let calls = 0;
      interceptInPlaceWrites((real, buffer, offset, length, position) => {
        if (++calls === 1) return real(buffer, offset, 5, position);
        return calls === 2 ? second() : real(buffer, offset, length, position);
      });
      await assert.rejects(doc.removeIp('127.0.0.1').add('::1', 'x').write({ atomic: false }), { code: 'ENOSPC' });
      assert.equal(await readFile(file, 'utf8'), original);
      mock.restoreAll();
      assert.equal(await doc.write({ atomic: false }), true);
      assert.equal(await readFile(file, 'utf8'), '10.0.0.1 important.internal\n::1 x\n');
    });
  }

  it('does not write through a link that replaces the file at the last moment', async t => {
    if (!posix) return t.skip('links need privileges on Windows');
    const file = await fixture();
    const victim = path.join(path.dirname(file), 'victim');
    await writeFile(victim, 'secret\n');
    const doc = await HostsDocument.load(file);
    const real = fs.promises.readFile;
    mock.method(fs.promises, 'readFile', async (...args) => {
      const bytes = await real(...args);
      await rm(file);
      await symlink(victim, file);
      return bytes;
    }, { times: 1 });
    await assert.rejects(doc.add('::1', 'x').write({ atomic: false }), { code: 'ELOOP' });
    assert.equal(await readFile(victim, 'utf8'), 'secret\n');
  });

  it('writes a file in a directory it may not write to', async t => {
    if (!posix || root) return t.skip('needs an unprivileged POSIX user');
    const file = await fixture();
    await chmod(path.dirname(file), 0o555);
    const doc = await HostsDocument.load(file);
    assert.equal(await doc.add('::1', 'x').write(), true);
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n::1 x\n');
  });

  it('reports the error when the file cannot be written either way', async t => {
    if (!posix || root) return t.skip('needs an unprivileged POSIX user');
    const file = await fixture('127.0.0.1 localhost\n', 0o440);
    await chmod(path.dirname(file), 0o555);
    const doc = await HostsDocument.load(file);
    await assert.rejects(doc.add('::1', 'x').write(), { code: 'EACCES' });
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n');
  });

  it('writes through a symbolic link and keeps hard links when in place', async t => {
    if (!posix) return t.skip('links need privileges on Windows');
    const file = await fixture();
    const soft = path.join(path.dirname(file), 'soft');
    const hard = path.join(path.dirname(file), 'hard');
    await symlink(file, soft);
    await link(file, hard);
    const doc = await HostsDocument.load(soft);
    await doc.add('::1', 'x').write({ atomic: false });
    assert.ok((await lstat(soft)).isSymbolicLink());
    assert.equal(await readFile(hard, 'utf8'), '127.0.0.1 localhost\n::1 x\n');
    await doc.add('::1', 'y').write();
    assert.ok((await lstat(soft)).isSymbolicLink());
    assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n::1 x y\n');
  });

  it('reports a missing file and never creates one', async () => {
    const file = await fixture();
    const doc = await HostsDocument.load(file);
    await rm(file);
    await assert.rejects(HostsDocument.load(file), { code: 'ENOENT' });
    await assert.rejects(doc.add('::1', 'x').write(), { code: 'ENOENT' });
    await assert.rejects(doc.write({ atomic: false }), { code: 'ENOENT' });
    assert.deepEqual(await readdir(path.dirname(file)), []);
  });

  it('cannot write a document that was not loaded from a file', async () => {
    await assert.rejects(HostsDocument.parse('').add('::1', 'x').write(), /requires a document from HostsDocument.load/);
  });

  it('keeps every byte of files in any encoding', async () => {
    const r = random(SEED);
    for (let i = 0; i < 40; i++) {
      const noise = Buffer.from(Array.from({ length: r.int(200) }, () => r.pick([r.int(256), 10, 13, 32, 35, 9])));
      const bytes = Buffer.concat([
        r.chance(0.3) ? Buffer.from([0xEF, 0xBB, 0xBF]) : Buffer.alloc(0), noise,
        Buffer.from('\n127.0.0.1 localhost # caf\xe9\n', r.chance(0.5) ? 'latin1' : 'utf8'),
      ]);
      const file = await fixture(bytes);
      const doc = await HostsDocument.load(file);
      assert.equal(await doc.add('192.0.2.1', 'x').removeIp('192.0.2.1').write(), false);
      await doc.add('192.0.2.1', 'x').write();
      const written = await readFile(file);
      const at = written.lastIndexOf('192.0.2.1 x');
      assert.ok(at > 0);
      const eol = written.subarray(at + 11).length;
      assert.deepEqual(Buffer.concat([written.subarray(0, at), written.subarray(at + 11 + eol)]), bytes);
    }
  });

  describe('edit', () => {
    it('loads, applies the function and writes', async () => {
      const file = await fixture();
      assert.equal(await HostsDocument.edit(doc => { doc.add('::1', 'x'); }, { file }), true);
      assert.equal(await HostsDocument.edit(async doc => { doc.add('::1', 'x'); }, { file, atomic: false, eol: '\r\n' }), false);
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost\n::1 x\n');
    });

    it('starts again from the new contents when the file changes meanwhile', async () => {
      const file = await fixture();
      let attempts = 0;
      await HostsDocument.edit(async doc => {
        if (++attempts < 3) await writeFile(file, `127.0.0.1 localhost external${attempts}\n`);
        doc.add('::1', 'x');
      }, { file });
      assert.equal(attempts, 3);
      assert.equal(await readFile(file, 'utf8'), '127.0.0.1 localhost external2\n::1 x\n');
    });

    it('gives up after the given number of retries, and on other errors at once', async () => {
      const file = await fixture();
      let attempts = 0;
      const meddle = async doc => {
        await writeFile(file, `127.0.0.1 localhost external${++attempts}\n`);
        doc.add('::1', 'x');
      };
      await assert.rejects(HostsDocument.edit(meddle, { file, retries: 1 }), HostsConflictError);
      assert.equal(attempts, 2);
      await assert.rejects(HostsDocument.edit(() => { throw new Error('mine'); }, { file }), /mine/);
      await assert.rejects(HostsDocument.edit(() => {}, { file: file + '.missing' }), { code: 'ENOENT' });
      for (const retries of [-1, 1.5, NaN, Infinity, '3', null])
        await assert.rejects(HostsDocument.edit(meddle, { file, retries }), /`retries`/);
      assert.equal(attempts, 2);
    });
  });
});
