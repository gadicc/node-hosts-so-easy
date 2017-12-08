# hosts-so-easy

*Safe, parallel API for manipulating /etc/hosts*

[![npm](https://img.shields.io/npm/v/hosts-so-easy.svg?maxAge=2592000)](https://www.npmjs.com/package/hosts-so-easy) [![Circle CI](https://circleci.com/gh/gadicc/hosts-so-easy.svg?style=shield)](https://circleci.com/gh/gadicc/hosts-so-easy) [![Coverage Status](https://coveralls.io/repos/github/gadicc/hosts-so-easy/badge.svg?branch=master)](https://coveralls.io/github/gadicc/hosts-so-easy?branch=master) ![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

Copyright (c) 2017 by Gadi Cohen.  Released under the MIT license.

Note: we support and run tests against Node.js 6.0.0 (2016-04-26).

## Features

  * [X] Preserves formatting (comments & whitespace choices)
  * [X] Add/remove funcs are "use and forget" - no callbacks required.
  * [X] Built for safe and concurrent / parallel use.
  * [X] Changes are batched, atomic write is debounced 500ms (by default).
  * [X] Optionally keeps new entries in a separate "header" block.

## Usage

```js
import Hosts from 'hosts-so-easy';
const hosts = new Hosts();

// hosts file is written once at the end
for (let i = 2; i < 10; i++)
  hosts.add('192.168.0.'+i, 'host'+i);

hosts.remove('192.168.0.2', 'host2');
hosts.removeHost('host1');

// callback/promise after all changes synced in single write
await hosts.postWrite();
hosts.postWrite(callback);
hosts.on('writeSuccess', callback);
hosts.once('writeSuccess', callback);
```

## Options

```js
const hosts = new Hosts({

  // Write the new contents to a temporary file first and rename afterwards
  // instantly to avoid conflicts with other writers.  You'll know if you
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

});
```

## API

## Sample output (formatting preserved)

```js
const hosts = new Hosts({ header: 'hosts-so-easy' });
```

```
#
# /etc/hosts: static lookup table for host names
#

#<ip-address>   <hostname.domain.org>   <hostname>
127.0.0.1       localhost.localdomain   localhost
::1             localhost.localdomain   localhost

# hosts-so-easy
172.20.0.2 host2
172.20.0.3 host3

192.168.0.2     server2
```

## TODO

  * [X] Ability to turn off atomic writes
  * [X] Maintain a header block (put hosts in same section)
  * [X] EventEmitter for writes
  * [ ] Validate arguments, throw on invalid

## Wishlist

  * [ ] Callback / promise when particular host entry added.  Can't think of
        any use-case where the 'write' event would not be sufficient, but I'll
        add this if you give me a good reason.

  * [ ] Mimic preceding whitespace pattern for new entry insertion.

  * [X] Better caching for those doing A LOT of work on the file.
