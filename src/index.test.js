import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import Hosts, { noop } from './index.js';

describe('hosts', () => {

  const hosts = new Hosts({ EOL: '\n', noWrites: true });

  describe('init / config', () => {

    it('throws on invalid arguments', () => {
      // specific keys
      assert.throws(() => new Hosts({ header: {} }), /key `header`/);
      // type mismatch
      assert.throws(() => new Hosts({ debounceTime: '500' }), /key `debounceTime`/);
    });

  });

  describe('modify', () => {

    beforeEach(() => {
      hosts.clearQueue();
    });

    describe('insertion / removal', () => {

      it('adds a new ip and host', () => {
        const orig = '127.0.0.1 localhost';
        const desired = '127.0.0.1 localhost\n127.0.0.2 localhost2';
        hosts.add('127.0.0.2', 'localhost2');
        assert.equal(hosts.modify(orig), desired);
      });

      it('add() can be run twice (branch check)', () => {
        const orig = '127.0.0.1 localhost';
        const desired = '127.0.0.1 localhost localhost2 localhost3';
        hosts.add('127.0.0.1', 'localhost2');
        hosts.add('127.0.0.1', 'localhost3');
        assert.equal(hosts.modify(orig), desired);
      });

      it('add() accepts an array of hosts as a 2nd arg', () => {
        const orig = '127.0.0.1 localhost';
        const desired = '127.0.0.1 localhost localhost2 localhost3';
        hosts.add('127.0.0.1', ['localhost2', 'localhost3']);
        assert.equal(hosts.modify(orig), desired);
      });

      it('add() throws on invalid ip arg', () => {
        assert.throws(() => {
          hosts.add({});
        }, /expects `ip`/);
      });

      it('add() throws on invalid host arg', () => {
        assert.throws(() => {
          hosts.add('127.0.0.1', {});
        }, /expects `host`/);
      });

      it('adds a new hostname to existing IP', () => {
        const orig = '127.0.0.1 localhost';
        const desired = '127.0.0.1 localhost localhost2';
        hosts.add('127.0.0.1', 'localhost2');
        assert.equal(hosts.modify(orig), desired);
      });

      it('adding a duplicate host does not add it twice', () => {
        const orig = '127.0.0.1 localhost';
        hosts.add('127.0.0.1', 'localhost');
        assert.equal(hosts.modify(orig), orig);
      });

      it('correctly adds to a blank hosts file', () => {
        const orig = '';
        const desired = '127.0.0.1 localhost';
        hosts.add('127.0.0.1', 'localhost');
        assert.equal(hosts.modify(orig), desired);
      });

      it('removes a single hostname from an existing IP', () => {
        const orig = '127.0.0.1 localhost localhost2';
        const desired = '127.0.0.1 localhost';
        hosts.remove('127.0.0.1', 'localhost2');
        assert.equal(hosts.modify(orig), desired);
      });

      it('removes line for IP with no hosts', () => {
        const orig = '127.0.0.1 localhost';
        const desired = '';
        hosts.remove('127.0.0.1', 'localhost');
        assert.equal(hosts.modify(orig), desired);
      });

      it('removes a single hostname from any IP via removeHost', () => {
        const orig = '127.0.0.1 localhost admin';
        const desired = '127.0.0.1 localhost';
        hosts.removeHost('admin');
        assert.equal(hosts.modify(orig), desired);
      });

      it('removes a single hostname from all matching IP via removeHost', () => {
        // this isn't a valid hostsfile but we should be able to fix it.
        const orig = '127.0.0.1 localhost admin\n127.0.0.2 localhost2 admin';
        const desired = '127.0.0.1 localhost\n127.0.0.2 localhost2';
        hosts.removeHost('admin');
        assert.equal(hosts.modify(orig), desired);
      });

      it('removeHost(host) throws on invalid host arg', () => {
        assert.throws(() => {
          hosts.removeHost({});
        }, /expects `host`/);
      });

      it('removes a single hostname from any IP via remove("*", hostname)', () => {
        const orig = '127.0.0.1 localhost admin';
        const desired = '127.0.0.1 localhost';
        hosts.remove('*', 'admin');
        assert.equal(hosts.modify(orig), desired);
      });

      it('removes an array of hostnames from any IP via remove("*", hostname)', () => {
        const orig = '127.0.0.1 localhost admin admin2';
        const desired = '127.0.0.1 localhost';
        hosts.remove('*', ['admin', 'admin2']);
        assert.equal(hosts.modify(orig), desired);
      });

      it('can remove all hosts / an entire line', () => {
        const orig = '127.0.0.1 localhost\n127.0.0.2 localhost2 localhost3';
        const desired = '127.0.0.1 localhost';
        hosts.remove('127.0.0.2', '*');
        assert.equal(hosts.modify(orig), desired);
      });

      it('can remove all hosts should remove the line too', () => {
        const orig = '127.0.0.1 localhost\n127.0.0.2 localhost2\n\n# end';
        const desired = '127.0.0.1 localhost\n\n# end';
        hosts.remove('127.0.0.2', '*');
        assert.equal(hosts.modify(orig), desired);
      });

      it('can remove an array of hosts', () => {
        const orig = '127.0.0.1 localhost localhost2 localhost3 localhost4';
        const desired = '127.0.0.1 localhost localhost4';
        hosts.remove('127.0.0.1', ['localhost2', 'localhost3']);
        assert.equal(hosts.modify(orig), desired);
      });

      it('remove() throws on invalid ip arg', () => {
        assert.throws(() => {
          hosts.remove({});
        }, /expects `ip`/);
      });

      it('remove() throws on invalid host arg', () => {
        assert.throws(() => {
          hosts.remove('127.0.0.1', {});
        }, /expects `host`/);
      });

      it('remove("*", host) throws on invalid host arg', () => {
        assert.throws(() => {
          hosts.remove('*', {});
        }, /expects `host`/);
      });

      it('remove("*", "*") throws', () => {
        assert.throws(() => {
          hosts.remove('*', '*');
        }, /hosts\.remove\('\*', '\*'\) not allowed/);
      });

      it('remove a host after * works as expected', () => {
        const orig = '127.0.0.1 localhost\n127.0.0.2 localhost2 localhost3';
        const desired = '127.0.0.1 localhost';
        hosts.remove('127.0.0.2', '*');
        hosts.remove('127.0.0.2', 'localhost3');
        assert.equal(hosts.modify(orig), desired);
      });

      it('does not break on broken hosts file', () => {
        const orig = '127.0.0.1';
        const desired = '127.0.0.1 localhost';
        hosts.add('127.0.0.1', 'localhost');
        assert.equal(hosts.modify(orig), desired);
      });

    });

    describe('preserves formatting', () => {

      it('leaves comments and newlines intact', () => {
        const orig = '# hosts\n\n127.0.0.1 localhost';
        const desired = '# hosts\n\n127.0.0.1 localhost localhost2';
        hosts.add('127.0.0.1', 'localhost2');
        assert.equal(hosts.modify(orig), desired);
      });

      it('inserts comments before a final comment block', () => {
        const orig = '# start hosts\n\n127.0.0.1 localhost\n\n# end hosts';
        const desired = '# start hosts\n\n127.0.0.1 localhost\n127.0.0.2 localhost2\n\n# end hosts';
        hosts.add('127.0.0.2', 'localhost2');
        assert.equal(hosts.modify(orig), desired);
      });

      it('preserves existing spaces & tabs', () => {
        const orig = '127.0.0.1\t\tlocalhost   localhost2';
        const desired = '127.0.0.1\t\tlocalhost   localhost2 localhost3';
        hosts.add('127.0.0.1', 'localhost3');
        assert.equal(hosts.modify(orig), desired);
      });

    });

    describe('header section', () => {

      it('place new entries below a header section (with no entries)', () => {
        const   hosts = new Hosts({ EOL: '\n', noWrites: true, header: 'test' });
        const    orig = '127.0.0.1 localhost\n\n# test\n\n192.168.0.1 other';
        const desired = '127.0.0.1 localhost\n\n# test\n127.0.0.2 localhost2\n\n192.168.0.1 other';
        hosts.add('127.0.0.2', 'localhost2');
        assert.equal(hosts.modify(orig), desired);
      });

      it('place new entries at the bottom of a header section', () => {
        const   hosts = new Hosts({ EOL: '\n', noWrites: true, header: 'test' });
        const    orig = '127.0.0.1 localhost\n\n# test\n127.0.0.2 localhost2\n\n192.168.0.1 other';
        const desired = '127.0.0.1 localhost\n\n# test\n127.0.0.2 localhost2\n127.0.0.3 localhost3\n\n192.168.0.1 other';
        hosts.add('127.0.0.3', 'localhost3');
        assert.equal(hosts.modify(orig), desired);
      });

      it('create a new header section if it does not exist', () => {
        const   hosts = new Hosts({ EOL: '\n', noWrites: true, header: 'test' });
        const    orig = '127.0.0.1 localhost';
        const desired = '127.0.0.1 localhost\n\n# test\n127.0.0.2 localhost2';
        hosts.add('127.0.0.2', 'localhost2');
        assert.equal(hosts.modify(orig), desired);
      });

    });

    describe('fixtures', () => {

      it('adds two hosts in a header section to archlinux hosts file', async () => {
        const hosts = new Hosts({ EOL: '\n', noWrites: true, header: 'header' });
        const orig = (await fs.readFile(path.join('tests', 'fixtures', 'hosts_archlinux'))).toString();
        const desired = (await fs.readFile(path.join('tests', 'fixtures', 'hosts_archlinux_out'))).toString();
        hosts.add('192.168.0.1', 'host1');
        hosts.add('192.168.0.2', 'host2');
        assert.equal(hosts.modify(orig), desired);
      });

    });

  });

  describe('config options', () => {

    it('invalid options throw', () => {
      assert.throws(() => new Hosts({ noSuchOption: true }));
    });

    it('noWrites: true', () => {
      const hosts = new Hosts({ EOL: '\n', noWrites: true });
      assert.equal(hosts._queueUpdate, noop);
    });

  });


});
