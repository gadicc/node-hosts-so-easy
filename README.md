# hosts-so-easy

*Edit /etc/hosts safely, preserving its formatting*

[![npm](https://img.shields.io/npm/v/hosts-so-easy.svg?maxAge=2592000)](https://www.npmjs.com/package/hosts-so-easy)
[![Tests](https://github.com/gadicc/node-hosts-so-easy/actions/workflows/tests.yml/badge.svg)](https://github.com/gadicc/node-hosts-so-easy/actions/workflows/tests.yml)
[![Release](https://github.com/gadicc/node-hosts-so-easy/actions/workflows/release.yml/badge.svg)](https://github.com/gadicc/node-hosts-so-easy/actions/workflows/release.yml)
![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg?style=plastic)](https://github.com/semantic-release/semantic-release)

Copyright (c) 2017 by Gadi Cohen.  Released under the MIT license.

Requires Node.js 22 or later. No dependencies. Works from ESM and CommonJS,
with TypeScript types included.

## Features

  * Loads the whole file, comments, blank lines, whitespace and line endings
    included. A file you don't change is written back byte for byte.
  * Changes apply in the order you make them, to a document in memory.
  * Addresses and hostnames are validated, so nothing you pass in can add or
    hide a line.
  * Matches like a resolver does: hostnames ignore case, and `::1` is the same
    address as `0:0:0:0:0:0:0:1`.
  * Writes atomically, keeps the file's mode and owner, and refuses to
    overwrite changes someone else made in the meantime.
  * Optionally keeps your entries in their own block under a header comment.

## Usage

```js
import { HostsDocument } from 'hosts-so-easy';

await HostsDocument.edit(doc => {
  doc.add('192.168.0.1', 'www');
  doc.add('192.168.1.1', ['mongo', 'db']);

  doc.remove('192.168.3.1', 'vhost20');        // one host of an address
  doc.remove('192.168.4.1', ['mongo', 'db']);  // several
  doc.removeIp('192.168.2.1');                 // the address and all its hosts
  doc.removeHost('unwanted');                  // a host, whatever its address
});
```

`edit()` loads the hosts file, runs your function, and writes the result if
anything changed. If another process changes the file in between, it starts
over with the new contents, so your function may run more than once.

For more control, do the steps yourself:

```js
const doc = await HostsDocument.load();   // or load('/some/other/hosts')
doc.add('10.0.0.5', 'web').removeHost('old');
console.log(doc.entries());               // [{ ip: '127.0.0.1', hosts: ['localhost'] }, ...]
await doc.write();
```

Or work on a string, with no file access at all:

```js
const text = HostsDocument.parse('127.0.0.1 localhost\n').add('::1', 'localhost').toString();
```

CommonJS:

```js
const { HostsDocument } = require('hosts-so-easy');
```

## API

### Creating a document

* `HostsDocument.edit(fn, [options])` → `Promise<boolean>`

  Load, call `fn(doc)` (which may be async), and write. Resolves `true` if the
  file was written, `false` if there was nothing to change. Options:

  * `file` - default `/etc/hosts`, or `%SystemRoot%\System32\drivers\etc\hosts`
    on Windows.
  * `retries` - how often to start over if the file changes meanwhile. Default 3;
    after that the `HostsConflictError` is thrown.
  * `eol`, `atomic` - see `parse` and `write` below.

* `HostsDocument.load([file], [options])` → `Promise<HostsDocument>`

* `HostsDocument.parse(text, [options])` → `HostsDocument`

  `options.eol` is the line ending for *new* lines, `'\n'` or `'\r\n'`. By
  default it is the first line ending found in the file, or the platform's if
  the file has none. Existing lines always keep their own.

### Changing it

All of these apply immediately, return the document, and throw a `TypeError`
without changing anything if an argument is invalid.

* `doc.add(ip, hosts, [{ header }])`

  Add a hostname or an array of them to an address. Hosts the address already
  has are skipped. The rest go on the first line for that address, or on a new
  line after the last entry in the file.

  With `header: 'Docker hosts'`, new lines go in a block that begins with the
  comment `# Docker hosts` and runs to the next blank or comment line. The
  block is created after the last entry if it doesn't exist yet. Lines outside
  the block are left alone, even ones for the same address.

* `doc.remove(ip, hosts)` - remove hostnames from an address.
* `doc.removeIp(ip)` - remove an address and all its hostnames.
* `doc.removeHost(hosts)` - remove hostnames from every address.

  A line that loses its last hostname is removed. If it had a comment, the
  comment stays.

Addresses must be valid IPv4 or IPv6 (a zone such as `fe80::1%eth0` is fine).
Hostnames must be printable ASCII without whitespace or `#`; write
international names in punycode.

Every change looks through the document, so on very large files (blocklists
with 100,000 lines) pass hostnames as one array rather than one call each.

### Reading and writing it

* `doc.entries()` → `[{ ip, hosts }, ...]` - the address lines, in file order.
* `doc.toString()` - the file contents.
* `doc.file`, `doc.eol` - where it was loaded from, and its line ending for
  new lines.
* `doc.write([{ atomic }])` → `Promise<boolean>`

  Write a loaded document back. Resolves `false`, without touching the file,
  if the document has no changes or the file already has these contents. Rejects with a `HostsConflictError`
  (`err.code === 'ERR_HOSTS_CONFLICT'`) if the file is no longer what was
  loaded; load it again, or use `edit()`, which does that for you.

### How files are written

By default the new contents go to a temporary file in the same directory,
which is then renamed over the hosts file, so no reader ever sees half a file.
The mode and owner are carried over, and symbolic links are followed.

Where the file can't be replaced, it is overwritten in place instead. That is
the case for a hosts file bind-mounted into a container, a directory you can't
write to, or a file another program has open on Windows. Pass `atomic: false`
to always write in place, which also keeps hard links, ACLs and SELinux labels
that a rename would drop. If an in-place write fails part way, the previous
contents are put back.

A file that starts with a byte order mark keeps it. As resolvers do, the
library then does not see the first line as an entry.

The conflict check narrows the window for losing someone else's change, but it
is not a lock: two processes that write within the same instant can still
overwrite each other.

## Sample output (formatting preserved)

```js
doc.add('172.20.0.2', 'host2', { header: 'Docker hosts' });
doc.add('172.20.0.3', 'host3', { header: 'Docker hosts' });
```

```
#
# /etc/hosts: static lookup table for host names
#

#<ip-address>   <hostname.domain.org>   <hostname>
127.0.0.1       localhost.localdomain   localhost
::1             localhost.localdomain   localhost

# Docker hosts
172.20.0.2 host2
172.20.0.3 host3

# End of file
```

## The queued API from 1.x (deprecated)

`new Hosts()` still works in 2.x and will be removed in 3.0. It queues changes
and writes them once, after a pause.

```js
import Hosts from 'hosts-so-easy';   // or: const Hosts = require('hosts-so-easy');
const hosts = new Hosts({ header: 'Docker hosts' });

hosts.add('192.168.0.1', 'www');
hosts.remove('192.168.2.1', '*');     // every host of an address
hosts.remove('*', 'unwanted');        // a host from every address
hosts.removeHost('unwanted');         // the same

await hosts.updateFinish();           // or updateFinish(callback)
hosts.on('updateFinish', err => { ... });
```

Options: `hostsFile`, `header` (default `false`), `atomicWrites` (default
`true`), `debounceTime` (default 500 ms), `maxWait` (the longest a change waits
while others keep arriving; default 2000 ms), `noWrites`, and `EOL`.
`hosts.modify(text)` applies and clears the queue against a string, and
`hosts.clearQueue()` drops it (a write already under way still finishes, but
is not tried again if it fails). Events: `updateStart` and `updateFinish(err)`.

It is now a thin layer over `HostsDocument`, which changes some behaviour:

* **Changes apply in call order.** `remove(ip, '*')` followed by `add(ip, host)`
  now leaves the host in place; 1.x removed the line and lost the add.
* **Arguments are validated** when you call `add`/`remove`, as described above.
  `header: true` is no longer accepted.
* **`updateFinish()` waits for the write that contains your latest change**,
  and settles at once if there is nothing to write. In 1.x it could settle
  early, or never.
* **A failed write no longer crashes the process.** The error goes to
  `updateFinish` promises, callbacks and listeners. If there are none, a
  warning is printed. The changes stay queued and are tried again with the
  next change, or when you call `updateFinish()`.
* **The file's own line endings are kept.** `EOL` only sets the line ending of
  new lines, and defaults to the one the file uses.
* **An unchanged file is not rewritten.**
* **With `header`, entries are added only inside the block**, never to a line
  for the same address elsewhere in the file, and the block is only created
  when there is an entry to put in it.
* **New lines go after the last entry**, and an empty file gets a trailing
  newline.
* `require('hosts-so-easy/lib/...')`, the `noop` export and underscored
  properties such as `hosts.queue` are gone.

To migrate, replace the instance with `HostsDocument.edit()` around each group
of changes.

## Development

```sh
npm ci
npm test
npm run lint
npm run coverage
npm run test:types
npm run test:package
```

Tests use Node's built-in test runner and temporary files; they never touch
`/etc/hosts`. The property tests generate hosts files from a seed; a failure
names it, and `HOSTS_SEED=<seed> npm test` reproduces it. Coverage uses c8,
with minimums of 95% lines and functions and 90% branches. `test:types`
compiles the type declarations against sample ESM and CommonJS consumers, and
`test:package` packs the tarball, installs it and imports it both ways.

## Releases

Pushes to `main` run the test matrix (Node 22, 24 and 26 on Linux, macOS and
Windows) and then semantic-release, which publishes to npm and creates a
GitHub release. Conventional commits set the version: `fix:` is a patch,
`feat:` a minor, and `feat!:` or a `BREAKING CHANGE:` footer a major. Other
commits, such as `chore:`, do not publish.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
(OIDC), so there is no `NPM_TOKEN`. The package's trusted publisher on npm must
be set to GitHub owner **gadicc**, repository **node-hosts-so-easy**, workflow
**release.yml**.

Release notes are on GitHub; `CHANGELOG.md` covers the releases before 2.0.0.
`conventional-changelog-conventionalcommits` stays on version 9 until the
release-notes generator supports version 10's writer
([issue](https://github.com/semantic-release/release-notes-generator/issues/992));
`npm run test:release` checks that notes are still generated.
