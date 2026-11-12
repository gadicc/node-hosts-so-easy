'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// Errors that mean "cannot replace the file", not "cannot write to it": a
// bind-mounted /etc/hosts in a container, a read-only or foreign directory,
// a file another process holds open on Windows, or an owner we cannot keep.
const FALLBACK = new Set(['EACCES', 'EPERM', 'EBUSY', 'EXDEV', 'EROFS']);

// Write a temporary file beside the target and rename it over the target, so
// readers never see a partial file. Mode and ownership are carried over, by
// file handle so that nobody can swap the temporary file for a link meanwhile.
async function writeAtomic(file, data) {
  const fsp = fs.promises;
  const target = await fsp.stat(file);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fsp.open(temp, 'wx', target.mode & 0o777);
  try {
    try {
      await handle.writeFile(data);
      const created = await handle.stat();
      if (created.uid !== target.uid || created.gid !== target.gid)
        await handle.chown(target.uid, target.gid);
      await handle.chmod(target.mode & 0o7777);  // after chown, which can clear setuid/setgid
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temp, file);
  } catch (err) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

async function overwrite(handle, data) {
  // A short write (disk full, file size limit) is not an error by itself.
  for (let done = 0; done < data.length;) {
    const { bytesWritten } = await handle.write(data, done, data.length - done, done);
    if (!bytesWritten)
      throw Object.assign(new Error('ENOSPC: could not write the whole file'), { code: 'ENOSPC' });
    done += bytesWritten;
  }
  await handle.truncate(data.length);
  await handle.sync();
}

// Overwrite the existing file. Not atomic, but keeps the inode and with it
// the owner, mode, hard links and security labels. Never creates the file,
// and puts the previous contents back if the new ones cannot be written.
async function writeInPlace(file, data, previous) {
  // `file` is already resolved, so a link here was planted after the fact.
  const handle = await fs.promises.open(file, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    await overwrite(handle, data);
  } catch (err) {
    await overwrite(handle, previous).catch(() => {});
    throw err;
  } finally {
    await handle.close();
  }
}

// `previous` is what the file holds now.
async function writeHosts(file, data, previous, atomic = true) {
  if (atomic) {
    try {
      return await writeAtomic(file, data);
    } catch (err) {
      if (!FALLBACK.has(err.code)) throw err;
    }
  }
  return writeInPlace(file, data, previous);
}

module.exports = { writeHosts };
