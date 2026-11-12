import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Hosts from './index.js';

describe('formatting and queue regressions', () => {
  for (const [input, output] of [
    ['\n127.0.0.1 localhost\n# end', '\n127.0.0.1 localhost\n127.0.0.2 added\n# end'],
    ['  # comment\n127.0.0.1 localhost', '  # comment\n127.0.0.1 localhost\n127.0.0.2 added'],
  ]) {
    it(`preserves leading whitespace and comments in ${JSON.stringify(input)}`, () => {
      const hosts = new Hosts({ noWrites: true, EOL: '\n' });
      hosts.add('127.0.0.2', 'added');
      assert.equal(hosts.modify(input), output);
    });
  }

  it('inserts new hosts before inline comments and preserves indentation and trailing spaces', () => {
    const hosts = new Hosts({ noWrites: true });
    hosts.add('127.0.0.1', 'added');
    assert.equal(hosts.modify('  127.0.0.1\tlocalhost  # keep comment'), '  127.0.0.1\tlocalhost added  # keep comment');
    assert.equal(hosts.modify('  127.0.0.1\tlocalhost   '), '  127.0.0.1\tlocalhost   ');
  });

  it('does not treat inline comment words as hostnames', () => {
    const hosts = new Hosts({ noWrites: true });
    hosts.removeHost('comment');
    assert.equal(hosts.modify('127.0.0.1 localhost # comment'), '127.0.0.1 localhost # comment');
    hosts.remove('127.0.0.1', '*');
    assert.equal(hosts.modify('127.0.0.1 localhost # comment'), '# comment');
  });

  it('removes the same hostname from repeated IP entries', () => {
    const hosts = new Hosts({ noWrites: true, EOL: '\n' });
    hosts.remove('127.0.0.1', 'remove');
    assert.equal(hosts.modify('127.0.0.1 first remove\n127.0.0.1 second remove'), '127.0.0.1 first\n127.0.0.1 second');
  });

  it('deduplicates additions for both new and existing IP entries', () => {
    const hosts = new Hosts({ noWrites: true });
    hosts.add('127.0.0.1', ['localhost', 'localhost']);
    assert.equal(hosts.modify(''), '127.0.0.1 localhost');
    hosts.add('127.0.0.1', ['added', 'added']);
    assert.equal(hosts.modify('127.0.0.1 localhost'), '127.0.0.1 localhost added');
  });

  it('recognizes a header on the first line and at end of file', () => {
    const hosts = new Hosts({ noWrites: true, header: 'test', EOL: '\n' });
    hosts.add('127.0.0.1', 'localhost');
    assert.equal(hosts.modify('# test\n'), '# test\n127.0.0.1 localhost\n');
    hosts.add('127.0.0.2', 'added');
    assert.equal(hosts.modify('# test\n127.0.0.1 localhost'), '# test\n127.0.0.1 localhost\n127.0.0.2 added');
  });

  it('creates a header in an empty file', () => {
    const hosts = new Hosts({ noWrites: true, header: 'test', EOL: '\n' });
    hosts.add('127.0.0.1', 'localhost');
    assert.equal(hosts.modify(''), '# test\n127.0.0.1 localhost');
  });

  it('supports explicit CRLF output', () => {
    const hosts = new Hosts({ noWrites: true, EOL: '\r\n' });
    hosts.add('::1', 'localhost');
    assert.equal(hosts.modify('127.0.0.1 localhost\r\n'), '127.0.0.1 localhost\r\n::1 localhost\r\n');
  });

  it('does not confuse hostnames with Object prototype properties', () => {
    const hosts = new Hosts({ noWrites: true });
    assert.equal(hosts.modify('127.0.0.1 constructor toString __proto__'), '127.0.0.1 constructor toString __proto__');
    hosts.removeHost('__proto__');
    assert.equal(hosts.modify('127.0.0.1 constructor __proto__'), '127.0.0.1 constructor');
    assert.throws(() => new Hosts({ toString: 'invalid' }), /No such config option/);
  });
});
