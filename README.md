# hosts-so-easy

*Safe, parallel API for manipulating /etc/hosts*

[![npm](https://img.shields.io/npm/v/hosts-so-easy.svg?maxAge=2592000)](https://www.npmjs.com/package/hosts-so-easy)
[![Tests](https://github.com/gadicc/node-hosts-so-easy/actions/workflows/tests.yml/badge.svg)](https://github.com/gadicc/node-hosts-so-easy/actions/workflows/tests.yml)
[![Release](https://github.com/gadicc/node-hosts-so-easy/actions/workflows/release.yml/badge.svg)](https://github.com/gadicc/node-hosts-so-easy/actions/workflows/release.yml)
![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg?style=plastic)](https://github.com/semantic-release/semantic-release)

Copyright (c) 2017 by Gadi Cohen.  Released under the MIT license.

Requires Node.js 22.22.2+, 24.15.0+, or 26+. CI tests Node 22, 24, and 26
on Linux, macOS, and Windows.

This modernization is intended for the next **major release**: Node 10 and other
unsupported runtimes are no longer supported. Use the package root rather than
internal `lib/` paths. Native ESM, CommonJS, and legacy `require(...).default`
are supported without a build step.

## Features

  * [X] Batches changes and prevents overlapping writes within one instance.
  * [X] Add/remove funcs are (optionally) "use and forget" - no callbacks required.
  * [X] Preserves formatting (comments & whitespace choices) - see sample below.
  * [X] Changes are batched, atomic write is debounced 500ms (by default).
  * [X] Optionally keeps new entries in a separate "header" block.

## Usage

```js
import Hosts from 'hosts-so-easy';
const hosts = new Hosts();

// hosts file is written once at the end
hosts.add('192.168.0.1', 'www');
hosts.add('192.168.1.1', [ 'mongo', 'db' ]);

// this is completely safe, only one write occurs at the end.
for (let i = 2; i < 10; i++)
  hosts.add('192.168.0.'+i, 'host'+i);

// can remove individual hosts, all hosts for an IP, or a host from any IP
hosts.remove('192.168.2.1', '*');
hosts.remove('192.168.3.1', 'vhost20');
hosts.remove('192.168.4.1', [ 'mongo', 'db' ]);
hosts.remove('*', 'unwantedHost');
hosts.remove('*', [ 'unwantedHost1', 'unwantedHost2' ]);

// callback/promise after all changes synced in a single write
await hosts.updateFinish();
hosts.updateFinish().then(function() { ... }).catch(function(err) { ... });
hosts.updateFinish(callback);
hosts.on('updateFinish', callback);
hosts.once('updateFinish', callback);
```

CommonJS works too:

```js
const Hosts = require('hosts-so-easy');
const hosts = new Hosts();
```

Call `updateFinish()` after queueing changes to observe write failures. A failed
update rejects its promises and calls its callbacks with the error; pending
changes remain queued for the next update. Errors from fire-and-forget updates
with no completion subscribers are thrown, as in previous releases.

Each update reads the current file before applying queued changes. Atomic writes
preserve the existing file's permissions and ownership. Atomic replacement avoids
partially written files, but does not lock the entire read/modify/write sequence
across separate instances or processes. Use a single instance for coordinated
updates.

## Options

```js
const hosts = new Hosts({

  // Write the new contents to a temporary file first and rename afterwards
  // instantly to avoid exposing a partially written file. You'll know if you
  // need to turn this off (special filesystems, etc).  Either way, we always
  // check to avoid concurrent writes within the library.
  atomicWrites: false, // default: true

  // How long to wait after *last* add/remove before writing the file,
  // to write the file once even after performing many operations.
  // Even with a small value, we'll check to avoid concurrent writes.
  debounceTime: 500, // in ms, default: 500ms

  // Maintain a header block and insert new entries there.  See sample output
  // further down the README for an example.
  header: 'Docker hosts', // default: false

  // Linux/Mac default:  /etc/hosts
  // Windows default:    C:/Windows/System32/drivers/etc/hosts
  hostsFile: '/some/weird/location/hosts',

  // Disable scheduled writes, e.g. when calling modify(contents) yourself.
  noWrites: false,

  // Output line ending. Defaults to CRLF on Windows and LF elsewhere.
  EOL: '\n',

});
```

## API

### Methods

* `hosts.add(ip, host || [host1,host2])`

  For the given IP, add a single host or an array of hosts.

* `hosts.clearQueue()`

  If you had a change of heart, and call this in time, nothing will happen :)

* `hosts.modify(contents)`

  Apply and clear the current queue against a string and return the updated
  contents. With `noWrites: true`, this performs no filesystem operations.

* `hosts.on(event, callback)`

  `hosts.once(event, callback)`

  Run the given callback on every event occurrence, or just once when the event
  next occurs.  See EVENTS, below.

* `hosts.remove(ip || '*', host || [host1,host2] || '*')`

  For the given IP, remove the given host or all the hosts in the array.
  Alternatively, give a "host" of `*` to remove the entire line, or an
  "ip" of `*` to remove the given host(s) from any IP.

* `hosts.removeHost(host)`

  Remove all references of `host`, regardless of which IP it resolves to.
  This has the same effect as `hosts.remove('*', host)`.

* `hosts.updateFinish([callback])`

  If a callback is given, it's called at the end of the update sequence (see
  events, below).  If an error occurred, it's provided as the first argument.

  If no callback is given, a `Promise` is returned.  It resolves after a
  successful write, or rejects on failure.

### Events

* `updateStart` - fires at the beginning of update sequence.  Hosts file will
  be read and rewritten.

* `updateFinish` - fires at the end of the above sequence.  On failure, the
  error will be provided as the first argument (file not found, permission
  denied, etc).

## Sample output (formatting preserved)

```js
const hosts = new Hosts({ header: 'optional header' });
```

```
#
# /etc/hosts: static lookup table for host names
#

#<ip-address>   <hostname.domain.org>   <hostname>
127.0.0.1       localhost.localdomain   localhost
::1             localhost.localdomain   localhost

# optional header
172.20.0.2 host2
172.20.0.3 host3

192.168.0.2     server2
```

## TODO

  * [X] Ability to turn off atomic writes
  * [X] Maintain a header block (put hosts in same section)
  * [X] EventEmitter for writes
  * [X] Validate arguments, throw on invalid

## Wishlist

  * [ ] Callback / promise when particular host entry added.  Can't think of
        any use-case where the 'write' event would not be sufficient, but I'll
        add this if you give me a good reason.

  * [ ] Mimic preceding whitespace pattern for new entry insertion.

  * [ ] Load a formatting-preserving document into memory, edit it explicitly,
        and write the completed document on demand. This is a separate future
        API change; the current queue-and-write API is retained.

## Development

```sh
npm ci
npm test
npm run lint
npm run coverage
npm run test:package
```

Tests use Node's built-in test runner and temporary files; they never write to
`/etc/hosts`. Coverage uses V8 through c8, with minimums of 95% lines/functions
and 90% branches. HTML reports are written to `coverage/index.html` and LCOV to
`coverage/lcov.info`. The package test packs and installs the tarball offline
using npm's download cache, then checks both ESM and CommonJS consumers.

The old Babel, Jest, CircleCI, and Yarn Classic setup has been replaced with
native modules, Node tests, GitHub Actions, and `package-lock.json`.

## Releases

Pushes to `main` run the complete test matrix before semantic-release publishes
to npm and creates a GitHub release. Pull requests and other pushed branches run
CI without publishing. A manually dispatched release also runs the test matrix
and can only publish from `main`.

Conventional commits determine the version: `fix:` is a patch, `feat:` is a
minor, and `feat!:` or a `BREAKING CHANGE:` footer is a major. Tooling-only commits
such as `chore:` do not publish. Commit the Node support change with a breaking
change marker so this modernization becomes a major release.

Publishing uses npm trusted publishing (OIDC), matching the approach in `loom`
and `yahoo-finance2`. Configure the `hosts-so-easy` package's trusted publisher
on npm with GitHub owner **gadicc**, repository **node-hosts-so-easy**, workflow
**release.yml**, and the **publish** action allowed. No `NPM_TOKEN` is required.
See [npm's trusted publishing setup](https://docs.npmjs.com/trusted-publishers/).
The workflow uses the default `GITHUB_TOKEN` for GitHub releases and tags.

Release notes are generated on GitHub. `CHANGELOG.md` retains the historical
releases; release automation does not commit version or changelog updates back
to the branch. The conventional-commits preset stays on 9.3.1 because version 10
uses a writer interface incompatible with the current release-notes generator,
as documented in the reference projects. Release tests check that notes include
the changes and breaking-change details.
