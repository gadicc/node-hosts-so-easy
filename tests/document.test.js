import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { HostsDocument } from 'hosts-so-easy';

const parse = (text, eol = '\n') => HostsDocument.parse(text, { eol });
const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('HostsDocument', () => {

  describe('add', () => {
    for (const [name, input, ip, hosts, output] of [
      ['a new ip after the last entry', '127.0.0.1 localhost', '127.0.0.2', 'localhost2', '127.0.0.1 localhost\n127.0.0.2 localhost2'],
      ['a host to an existing ip', '127.0.0.1 localhost', '127.0.0.1', 'localhost2', '127.0.0.1 localhost localhost2'],
      ['an array of hosts', '127.0.0.1 localhost', '127.0.0.1', ['a', 'b'], '127.0.0.1 localhost a b'],
      ['nothing for a host that is already there', '127.0.0.1 localhost', '127.0.0.1', 'localhost', '127.0.0.1 localhost'],
      ['nothing for an empty array', '127.0.0.1 localhost', '127.0.0.1', [], '127.0.0.1 localhost'],
      ['each host once', '', '127.0.0.1', ['a', 'A', 'a'], '127.0.0.1 a\n'],
      ['to an empty file, ending it with a newline', '', '127.0.0.1', 'localhost', '127.0.0.1 localhost\n'],
      ['a host to an ip that has none', '127.0.0.1', '127.0.0.1', 'localhost', '127.0.0.1 localhost'],
      ['before a final comment block', '# start\n\n127.0.0.1 localhost\n\n# end', '127.0.0.2', 'x', '# start\n\n127.0.0.1 localhost\n127.0.0.2 x\n\n# end'],
      ['after leading blank lines and comments', '\n  # comment\n127.0.0.1 localhost\n# end', '127.0.0.2', 'x', '\n  # comment\n127.0.0.1 localhost\n127.0.0.2 x\n# end'],
      ['at the end of a file with only comments', '# a\n# b\n# c\n', '1.2.3.4', 'x', '# a\n# b\n# c\n1.2.3.4 x\n'],
      ['at the end of a file with only blank lines', '\n\n', '1.2.3.4', 'x', '\n\n1.2.3.4 x\n'],
      ['before an inline comment, keeping indentation', '  127.0.0.1\tlocalhost  # keep', '127.0.0.1', 'x', '  127.0.0.1\tlocalhost x  # keep'],
      ['before trailing whitespace', '127.0.0.1\t\tlocalhost   two   ', '127.0.0.1', 'x', '127.0.0.1\t\tlocalhost   two x   '],
      ['to the first of several lines for an ip', '1.1.1.1 a\n1.1.1.1 b', '1.1.1.1', 'c', '1.1.1.1 a c\n1.1.1.1 b'],
      ['nothing when a later line for the ip has the host', '1.1.1.1 a\n1.1.1.1 b', '1.1.1.1', 'b', '1.1.1.1 a\n1.1.1.1 b'],
      ['nothing for a host that differs only in case', '127.0.0.1 localhost', '127.0.0.1', 'LOCALHOST', '127.0.0.1 localhost'],
      ['to an ipv6 line written in another form', '0:0:0:0:0:0:0:1 a\nFE80::1 b', '::1', 'x', '0:0:0:0:0:0:0:1 a x\nFE80::1 b'],
      ['to an ipv6 line that differs in case', 'FE80::1 b', 'fe80::1', 'x', 'FE80::1 b x'],
      ['a new line for another ipv6 zone', 'fe80::1%eth0 a', 'fe80::1%eth1', 'x', 'fe80::1%eth0 a\nfe80::1%eth1 x'],
      ['to the line for the same ipv6 zone', 'fe80::1%eth0 a', 'FE80::1%eth0', 'x', 'fe80::1%eth0 a x'],
      ['a new line when only a commented-out entry matches', '#127.0.0.1 old\n', '127.0.0.1', 'x', '#127.0.0.1 old\n127.0.0.1 x\n'],
      ['a new line when the only match follows a byte order mark', '\ufeff127.0.0.1 localhost', '127.0.0.1', 'x', '\ufeff127.0.0.1 localhost\n127.0.0.1 x'],
      ['to a line split by vertical tabs and form feeds', '1.1.1.1\va\fb', '1.1.1.1', ['A', 'c'], '1.1.1.1\va\fb c'],
      ['a host that only looks the same after Unicode case folding', '1.1.1.1 ban\u212a.com', '1.1.1.1', 'bank.com', '1.1.1.1 ban\u212a.com bank.com'],
    ]) {
      it(`adds ${name}`, () => {
        assert.equal(parse(input).add(ip, hosts).toString(), output);
      });
    }

    it('adds a great many hosts in one call', () => {
      const hosts = Array.from({ length: 200_000 }, (_, i) => 'host' + i);
      const doc = parse('1.1.1.1 a\n').add('1.1.1.1', hosts).add('2.2.2.2', hosts);
      assert.deepEqual(doc.entries().map(entry => entry.hosts.length), [200_001, 200_000]);
    });

    it('is chainable and reports entries as written', () => {
      const doc = parse('# c\n127.0.0.1\tlocalhost # me\nnot an entry\n').add('::1', ['a', 'b']);
      assert.deepEqual(doc.entries(), [
        { ip: '127.0.0.1', hosts: ['localhost'] },
        { ip: '::1', hosts: ['a', 'b'] },
      ]);
      doc.entries()[0].hosts.push('ignored');
      assert.equal(doc.entries()[0].hosts.length, 1);
    });
  });

  describe('remove', () => {
    for (const [name, input, apply, output] of [
      ['one host', '127.0.0.1 localhost two', d => d.remove('127.0.0.1', 'two'), '127.0.0.1 localhost'],
      ['an array of hosts', '127.0.0.1 a b c d', d => d.remove('127.0.0.1', ['b', 'C']), '127.0.0.1 a d'],
      ['the line with its last host', '127.0.0.1 localhost', d => d.remove('127.0.0.1', 'localhost'), ''],
      ['a middle line', '1.1.1.1 a\n2.2.2.2 b\n\n# end', d => d.removeIp('2.2.2.2'), '1.1.1.1 a\n\n# end'],
      ['the final line, keeping the file without a trailing newline', '1.1.1.1 a\n2.2.2.2 b', d => d.removeIp('2.2.2.2'), '1.1.1.1 a'],
      ['the final line after a blank one', '1.1.1.1 a\n\n2.2.2.2 b', d => d.removeIp('2.2.2.2').add('3.3.3.3', 'c'), '1.1.1.1 a\n3.3.3.3 c\n'],
      ['a host from every line for the ip', '1.1.1.1 a x\n1.1.1.1 b x', d => d.remove('1.1.1.1', 'x'), '1.1.1.1 a\n1.1.1.1 b'],
      ['every line for an ip', '1.1.1.1 a\n2.2.2.2 b\n1.1.1.1 c\n', d => d.removeIp('1.1.1.1'), '2.2.2.2 b\n'],
      ['an ip that has no hosts', '1.1.1.1\n2.2.2.2 b\n', d => d.removeIp('1.1.1.1'), '2.2.2.2 b\n'],
      ['a host from any ip', '1.1.1.1 a admin\n::1 b ADMIN', d => d.removeHost('admin'), '1.1.1.1 a\n::1 b'],
      ['several hosts from any ip', '1.1.1.1 a x y', d => d.removeHost(['x', 'y']), '1.1.1.1 a'],
      ['nothing that only matches after Unicode case folding', '1.1.1.1 ban\u212a.com', d => d.removeHost('bank.com'), '1.1.1.1 ban\u212a.com'],
      ['nothing from a first line that follows a byte order mark', '\ufeff1.1.1.1 a\n1.1.1.1 a b', d => d.removeHost('a'), '\ufeff1.1.1.1 a\n1.1.1.1 b'],
      ['nothing that is only named in a comment', '1.1.1.1 a # x', d => d.removeHost('x'), '1.1.1.1 a # x'],
      ['a line but not its comment', '  1.1.1.1 a # why', d => d.removeIp('1.1.1.1'), '  # why'],
      ['nothing from an ip without hosts', '1.1.1.1\n', d => d.remove('1.1.1.1', 'a').removeHost('a'), '1.1.1.1\n'],
      ['a middle host with its own whitespace', '1.1.1.1\ta   b c', d => d.remove('1.1.1.1', 'b'), '1.1.1.1\ta c'],
      ['the first host, keeping the gap after the ip', '1.1.1.1\ta   b c', d => d.remove('1.1.1.1', 'a'), '1.1.1.1\tb c'],
      ['an ipv6 host written in another form', '0:0:0:0:0:0:0:1 a b', d => d.remove('::1', 'a'), '0:0:0:0:0:0:0:1 b'],
    ]) {
      it(`removes ${name}`, () => {
        assert.equal(apply(parse(input)).toString(), output);
      });
    }
  });

  describe('order', () => {
    it('applies changes in call order, so the last call wins', () => {
      assert.equal(parse('10.0.0.5 old').removeIp('10.0.0.5').add('10.0.0.5', 'web').toString(), '10.0.0.5 web\n');
      assert.equal(parse('10.0.0.5 web x').remove('10.0.0.5', 'web').add('10.0.0.5', 'web').toString(), '10.0.0.5 x web');
      assert.equal(parse('1.1.1.1 a').remove('10.0.0.5', 'web').add('10.0.0.5', 'web').toString(), '1.1.1.1 a\n10.0.0.5 web');
      assert.equal(parse('10.0.0.5 x').add('10.0.0.5', 'web').remove('10.0.0.5', 'web').toString(), '10.0.0.5 x');
    });

    it('moves a host to another ip', () => {
      assert.equal(parse('1.1.1.1 web\n2.2.2.2 db\n').removeHost('web').add('3.3.3.3', 'web').toString(),
        '2.2.2.2 db\n3.3.3.3 web\n');
    });
  });

  describe('header', () => {
    const add = (input, ip, host, header = 'test') => parse(input).add(ip, host, { header }).toString();

    it('creates the block after the last entry', () => {
      assert.equal(add('127.0.0.1 localhost', '127.0.0.2', 'x'), '127.0.0.1 localhost\n\n# test\n127.0.0.2 x');
      assert.equal(add('', '127.0.0.2', 'x'), '# test\n127.0.0.2 x\n');
      assert.equal(add('1.1.1.1 a\n\n', '127.0.0.2', 'x'), '1.1.1.1 a\n\n# test\n127.0.0.2 x\n\n');
      assert.equal(add('1.1.1.1 a\n# end\n', '127.0.0.2', 'x'), '1.1.1.1 a\n\n# test\n127.0.0.2 x\n\n# end\n');
    });

    it('adds below an empty block and at the bottom of a filled one', () => {
      assert.equal(add('127.0.0.1 localhost\n\n# test\n\n192.168.0.1 other', '127.0.0.2', 'x'),
        '127.0.0.1 localhost\n\n# test\n127.0.0.2 x\n\n192.168.0.1 other');
      assert.equal(add('# test\n127.0.0.2 a\n\n192.168.0.1 other', '127.0.0.3', 'x'),
        '# test\n127.0.0.2 a\n127.0.0.3 x\n\n192.168.0.1 other');
      assert.equal(add('# test\n', '127.0.0.1', 'x'), '# test\n127.0.0.1 x\n');
      assert.equal(add('# test\n127.0.0.1 a', '127.0.0.2', 'x'), '# test\n127.0.0.1 a\n127.0.0.2 x');
    });

    it('ends the block at a comment line as well as a blank one', () => {
      assert.equal(add('# test\n1.1.1.1 a\n# other\n2.2.2.2 b\n', '3.3.3.3', 'x'), '# test\n1.1.1.1 a\n3.3.3.3 x\n# other\n2.2.2.2 b\n');
      assert.equal(add('# test\n1.1.1.1 a\n# other\n2.2.2.2 b\n', '2.2.2.2', 'x'), '# test\n1.1.1.1 a\n2.2.2.2 x\n# other\n2.2.2.2 b\n');
      assert.equal(add('# test\nnot an entry\n1.1.1.1 a\n', '3.3.3.3', 'x'), '# test\nnot an entry\n1.1.1.1 a\n3.3.3.3 x\n');
    });

    it('recognizes the header whatever its whitespace', () => {
      assert.equal(add('  #test \n1.1.1.1 a', '2.2.2.2', 'x'), '  #test \n1.1.1.1 a\n2.2.2.2 x');
      assert.equal(add('# test\n', '2.2.2.2', 'x', '  test  '), '# test\n2.2.2.2 x\n');
    });

    it('adds to a line for the ip inside the block, not outside it', () => {
      assert.equal(add('1.1.1.1 a\n\n# test\n1.1.1.1 b\n', '1.1.1.1', 'x'), '1.1.1.1 a\n\n# test\n1.1.1.1 b x\n');
      assert.equal(add('1.1.1.1 a\n\n# test\n2.2.2.2 b\n', '1.1.1.1', 'x'), '1.1.1.1 a\n\n# test\n2.2.2.2 b\n1.1.1.1 x\n');
    });

    it('adds nothing, not even the header, for a host the ip already has', () => {
      assert.equal(add('1.1.1.1 a\n', '1.1.1.1', 'a'), '1.1.1.1 a\n');
    });

    it('keeps the block together when a line inside it is removed', () => {
      const doc = parse('# test\n1.1.1.1 a\n2.2.2.2 b\n\n9.9.9.9 z').removeIp('1.1.1.1').add('3.3.3.3', 'c', { header: 'test' });
      assert.equal(doc.toString(), '# test\n2.2.2.2 b\n3.3.3.3 c\n\n9.9.9.9 z');
    });

    it('matches the archlinux fixture', async () => {
      const doc = parse(await fixture('hosts_archlinux'));
      doc.add('192.168.0.1', 'host1', { header: 'header' }).add('192.168.0.2', 'host2', { header: 'header' });
      assert.equal(doc.toString(), await fixture('hosts_archlinux_out'));
    });
  });

  describe('line endings', () => {
    it('uses the first line ending in the file for new lines and keeps the others', () => {
      const doc = HostsDocument.parse('1.1.1.1 a\r\n# c\n2.2.2.2 b\n');
      assert.equal(doc.eol, '\r\n');
      assert.equal(doc.add('3.3.3.3', 'x').toString(), '1.1.1.1 a\r\n# c\n2.2.2.2 b\n3.3.3.3 x\r\n');
      assert.equal(HostsDocument.parse('1.1.1.1 a\n').eol, '\n');
    });

    it('uses the eol option, or the platform default for a file without line endings', () => {
      assert.equal(parse('1.1.1.1 a\n', '\r\n').add('::1', 'x').toString(), '1.1.1.1 a\n::1 x\r\n');
      assert.match(HostsDocument.parse('1.1.1.1 a').add('::1', 'x').toString(), /^1\.1\.1\.1 a\r?\n::1 x$/);
      assert.match(new HostsDocument().add('::1', 'x').toString(), /^::1 x\r?\n$/);
    });

    it('treats a lone carriage return as whitespace', () => {
      assert.equal(parse('1.1.1.1 a\r2.2.2.2 b').add('1.1.1.1', 'x').toString(), '1.1.1.1 a\r2.2.2.2 b x');
    });
  });

  describe('validation', () => {
    const doc = () => parse('127.0.0.1 localhost\n');
    const unchanged = (fn, message) => {
      const d = doc();
      assert.throws(() => fn(d), { name: 'TypeError', message });
      assert.equal(d.toString(), '127.0.0.1 localhost\n');
    };

    it('rejects anything that is not an ip address', () => {
      for (const ip of ['*', '', 'localhost', '1.2.3', '300.1.1.1', '01.2.3.4', ' 1.2.3.4', '1.2.3.4\n', '::1%', 'fe80::1%a b', 'fe80::1%a#b', null, undefined, 5, {}, ['1.2.3.4']]) {
        unchanged(d => d.add(ip, 'x'), /`ip`/);
        unchanged(d => d.remove(ip, 'x'), /`ip`/);
        unchanged(d => d.removeIp(ip), /`ip`/);
      }
    });

    it('rejects hostnames that could change the structure of the file', () => {
      for (const host of ['', 'a b', 'a\tb', 'x\n6.6.6.6 bank.com', 'a\r', 'a#b', '#', 'caf\u00e9', 'a\u00a0b', 'a\u2028b', '\x7f', null, undefined, 5, {}, [['a']]]) {
        unchanged(d => d.add('1.2.3.4', host), /`hosts`/);
        unchanged(d => d.add('1.2.3.4', ['ok', host]), /`hosts`/);
        unchanged(d => d.remove('127.0.0.1', ['localhost', host]), /`hosts`/);
        unchanged(d => d.removeHost(['localhost', host]), /`hosts`/);
      }
    });

    it('rejects unusable headers, line endings and text', () => {
      for (const header of [true, false, null, 5, '', '  ', '\n', 'a\nb', 'a\n', 'caf\u00e9', ' '.repeat(100_000) + '\n'])
        unchanged(d => d.add('1.2.3.4', 'x', { header }), /`header`/);
      for (const eol of ['', '\r', '\n\n', 'crlf', null, 5])
        assert.throws(() => HostsDocument.parse('', { eol }), /`eol`/);
      assert.throws(() => HostsDocument.parse(null), /`text`/);
    });

    it('does not confuse hostnames with object properties', () => {
      const d = parse('127.0.0.1 constructor toString __proto__');
      assert.equal(d.removeHost('__proto__').toString(), '127.0.0.1 constructor toString');
    });
  });
});
