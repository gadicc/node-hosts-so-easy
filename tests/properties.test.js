import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HostsDocument } from 'hosts-so-easy';
import { SEED, random, file, ops, apply, groupOf, GROUPS, HOSTS } from './support/gen.js';

const CASES = 400;

// Run `check` against many generated inputs, naming the seed that failed.
function property(name, check) {
  it(name, () => {
    for (let i = 0; i < CASES; i++) {
      const seed = SEED + i;
      try {
        check(random(seed));
      } catch (err) {
        err.message = `[HOSTS_SEED=${seed}] ${err.message}`;
        throw err;
      }
    }
  });
}

// Only ASCII letters fold, as in a resolver. (Not how the library does it.)
const lower = s => [...s].map(c => c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c).join('');
const lines = text => text.split('\n');
const comments = text => lines(text).filter(l => l.includes('#')).map(l => l.slice(l.indexOf('#')).replace(/\r$/, ''));

// What the entries mean: address group -> set of lowercased hostnames.
function meaning(entries) {
  const map = new Map();
  for (const { ip, hosts } of entries) {
    assert.notEqual(groupOf(ip), -1, `unexpected ip ${ip}`);
    if (!map.has(groupOf(ip))) map.set(groupOf(ip), new Set());
    for (const host of hosts) map.get(groupOf(ip)).add(lower(host));
  }
  return new Map([...map].filter(([, hosts]) => hosts.size).sort(([a], [b]) => a - b)
    .map(([group, hosts]) => [group, [...hosts].sort()]));
}

// The same operations applied to that meaning by the simplest possible code.
function model(entries, list) {
  const map = new Map(GROUPS.map((_, i) => [i, new Set()]));
  for (const { ip, hosts } of entries) for (const host of hosts) map.get(groupOf(ip)).add(lower(host));
  for (const { name, args } of list) {
    const hosts = [name === 'removeHost' ? args[0] : args[1] ?? []].flat().map(lower);
    if (name === 'add') hosts.forEach(h => map.get(groupOf(args[0])).add(h));
    if (name === 'remove') hosts.forEach(h => map.get(groupOf(args[0])).delete(h));
    if (name === 'removeIp') map.get(groupOf(args[0])).clear();
    if (name === 'removeHost') for (const set of map.values()) hosts.forEach(h => set.delete(h));
  }
  return new Map([...map].filter(([, hosts]) => hosts.size).map(([group, hosts]) => [group, [...hosts].sort()]));
}

describe('properties', () => {
  property('an unmodified document serializes to exactly its input', r => {
    const text = file(r);
    assert.equal(HostsDocument.parse(text).toString(), text);
    const noise = Array.from({ length: r.int(60) }, () => r.pick([...' \t\r\n#af019:.%\ufeff'])).join('');
    assert.equal(HostsDocument.parse(noise).toString(), noise);
  });

  property('adding then removing a new address restores the input', r => {
    const text = file(r);
    const doc = HostsDocument.parse(text);
    const hosts = r.some(HOSTS, 3);
    assert.equal(doc.add('192.0.2.77', hosts).remove('192.0.2.77', hosts).toString(), text);
    assert.equal(doc.add('192.0.2.77', hosts).removeIp('192.0.2.77').toString(), text);
  });

  property('adding then removing a new host restores the input', r => {
    const text = file(r);
    const ip = r.pick(r.pick(GROUPS));
    // Removing the last host of a line removes the line, so leave out files
    // where the address has a line without hosts to begin with.
    if (HostsDocument.parse(text).entries().some(e => groupOf(e.ip) === groupOf(ip) && !e.hosts.length)) return;
    assert.equal(HostsDocument.parse(text).add(ip, 'brand-new').remove(ip, 'brand-new').toString(), text);
    assert.equal(HostsDocument.parse(text).add(ip, 'brand-new').removeHost('BRAND-NEW').toString(), text);
  });

  property('any sequence of changes has the same effect as on a plain map', r => {
    const doc = HostsDocument.parse(file(r));
    const before = doc.entries();
    const list = ops(r, 6, r.chance(0.5));
    assert.deepEqual(meaning(apply(doc, list).entries()), model(before, list));
  });

  property('each host appears once per address, however it is spelled', r => {
    const doc = apply(HostsDocument.parse(''), ops(r, 12, r.chance(0.5)));
    const seen = new Set();
    for (const { ip, hosts } of doc.entries()) {
      for (const host of hosts) {
        const id = `${groupOf(ip)} ${lower(host)}`;
        assert.ok(!seen.has(id), `duplicate ${id} in ${JSON.stringify(doc.toString())}`);
        seen.add(id);
      }
    }
  });

  property('the output parses back to the same entries', r => {
    const doc = apply(HostsDocument.parse(file(r)), ops(r, 6, r.chance(0.5)));
    assert.deepEqual(HostsDocument.parse(doc.toString()).entries(), doc.entries());
    assert.equal(HostsDocument.parse(doc.toString()).toString(), doc.toString());
  });

  property('comments are never altered, lost or invented', r => {
    const text = file(r);
    assert.deepEqual(comments(apply(HostsDocument.parse(text), ops(r)).toString()), comments(text));
  });

  property('entries for other addresses are left exactly as they were', r => {
    const text = file(r);
    const ip = r.pick(r.pick(GROUPS));
    const others = t => lines(t.replace('\uFEFF', '')).map(l => l.replace(/\r$/, '')).filter(l => {
      const [entry] = HostsDocument.parse(l).entries();
      return entry && groupOf(entry.ip) !== groupOf(ip);
    });
    const doc = HostsDocument.parse(text).add(ip, r.some(HOSTS, 3)).remove(ip, r.some(HOSTS, 3)).removeIp(ip);
    assert.deepEqual(others(doc.toString()), others(text));
  });

  property('repeating a change changes nothing more', r => {
    const text = file(r);
    const list = ops(r, 1);
    const once = apply(HostsDocument.parse(text), list).toString();
    assert.equal(apply(apply(HostsDocument.parse(text), list), list).toString(), once);
    assert.equal(HostsDocument.parse(once).remove('192.0.2.77', 'absent').removeHost('absent').removeIp('192.0.2.77').toString(), once);
  });

  property('line endings come from the input, and the final newline is kept', r => {
    const text = file(r);
    const doc = HostsDocument.parse(text);
    const list = ops(r);
    const out = apply(doc, list).toString();
    const endings = t => new Set(t.match(/\r?\n/g));
    // (A lone carriage return is whitespace, but looks like CRLF once a line ending follows it.)
    if (!/\r(?!\n)/.test(text)) for (const eol of endings(out)) assert.ok(endings(text).has(eol) || eol === doc.eol);
    if (text.endsWith('\n') && out.replace('\uFEFF', '')) assert.ok(out.endsWith('\n'));
    // A file without a final newline only gains one if its last line goes.
    if (text.replace('\uFEFF', '') && list.every(op => op.name === 'add')) assert.equal(out.endsWith('\n'), text.endsWith('\n'));
  });

  property('invalid arguments throw and leave the document untouched', r => {
    const text = file(r);
    const doc = HostsDocument.parse(text);
    const nasty = ['', ' ', 'a b', 'a\nb', 'a#b', '#', null, 7, 'caf\u00e9', '1.2.3.4\n', 'x\r\n6.6.6.6 evil'];
    const bad = r.pick(nasty);
    for (const attempt of [
      () => doc.add(bad, 'ok'), () => doc.add('127.0.0.1', ['ok', bad]), () => doc.remove(bad, 'localhost'),
      () => doc.remove('127.0.0.1', ['localhost', bad]), () => doc.removeIp(bad), () => doc.removeHost(['localhost', bad]),
      () => doc.add('127.0.0.1', 'ok', { header: r.pick([true, '', ' ', 'a\nb', null, 7, 'caf\u00e9']) }),
    ]) {
      assert.throws(attempt, TypeError);
      assert.equal(doc.toString(), text);
    }
  });

  it('parses pathological lines in linear time', () => {
    const start = performance.now();
    const spaces = HostsDocument.parse('1.1.1.1 a' + ' '.repeat(1e6) + 'b');
    const hosts = HostsDocument.parse('1.2.3.4 ' + 'a '.repeat(2e5));
    const hashes = HostsDocument.parse('#'.repeat(1e6) + '\n'.repeat(1e5));
    assert.deepEqual(spaces.entries(), [{ ip: '1.1.1.1', hosts: ['a', 'b'] }]);
    assert.equal(hosts.entries()[0].hosts.length, 2e5);
    assert.equal(hashes.entries().length, 0);
    assert.ok(performance.now() - start < 2000, 'parsing took too long');
  });
});
