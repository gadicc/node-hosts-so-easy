// Seeded generators for property tests. Set HOSTS_SEED to reproduce a run.

export const SEED = Number(process.env.HOSTS_SEED ?? 20260101);

export function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = n => Math.floor(next() * n);
  const pick = list => list[int(list.length)];
  const some = (list, max) => Array.from({ length: int(max + 1) }, () => pick(list));
  return { next, int, pick, some, chance: p => next() < p };
}

// Each group lists spellings of one address: the tests' own notion of which
// addresses are equal, independent of the library's.
export const GROUPS = [
  ['127.0.0.1'],
  ['10.0.0.5'],
  ['::1', '0:0:0:0:0:0:0:1', '0::1'],
  ['fe80::1', 'FE80::1', 'fe80:0::1'],
  ['fe80::1%eth0', 'FE80::1%eth0'],
  ['fe80::1%ETH0'],
  ['::ffff:1.2.3.4', '::FFFF:102:304'],
];
export const groupOf = ip => GROUPS.findIndex(group => group.includes(ip));
export const HOSTS = ['localhost', 'LocalHost', 'web', 'db', 'a.example.com', 'A.Example.COM', 'x-1', '_srv', 'constructor'];

// Tokens a file may hold that the library itself would refuse to add.
const FOREIGN = ['caf\u00e9', 'ban\u212a', 'WEB\u00a0db', '\ufeffweb', '*'];
const SPACE = [' ', ' ', '\t', '  ', '\t\t', ' \t', '\v', '\f', '\r'];
const COMMENTS = ['# comment', '#', '#127.0.0.1 old', '# caf\u00e9 \u2028 # more', '#\ttabbed  '];
const OPAQUE = ['localhost 127.0.0.1', '300.1.1.1 bad', '* star', 'justoneword', '1.2.3 short'];

export function file(r) {
  let text = '';
  const count = r.int(9);
  for (let i = 0; i < count; i++) {
    const kind = r.int(10);
    // A byte order mark belongs at the start of a file, but may be anywhere.
    let line = (r.chance(i ? 0.03 : 0.1) ? '\ufeff' : '') + (r.chance(0.2) ? r.pick(SPACE) : '');
    if (kind < 5) {
      line += r.pick(r.pick(GROUPS));
      for (const host of r.some(HOSTS, 4)) line += r.pick(SPACE) + (r.chance(0.05) ? r.pick(FOREIGN) : host);
      if (r.chance(0.3)) line += r.pick(SPACE);
      if (r.chance(0.3)) line += r.pick(COMMENTS);
    } else if (kind < 7) {
      line += r.pick(COMMENTS);
    } else if (kind < 9) {
      line += r.chance(0.5) ? '' : r.pick(SPACE);
    } else {
      line += r.pick(OPAQUE);
    }
    text += line + (i === count - 1 && r.chance(0.4) ? '' : r.pick(['\n', '\n', '\r\n']));
  }
  return text;
}

// With `headers`, some additions go to one of two header blocks.
export function ops(r, max = 6, headers = false) {
  return Array.from({ length: 1 + r.int(max) }, () => {
    const ip = r.pick(r.pick(GROUPS));
    const hosts = r.chance(0.5) ? r.pick(HOSTS) : r.some(HOSTS, 3);
    const where = headers && r.chance(0.6) ? [{ header: r.pick(['mine', 'comment']) }] : [];
    return r.pick([
      { name: 'add', args: [ip, hosts, ...where] },
      { name: 'add', args: [ip, hosts, ...where] },
      { name: 'remove', args: [ip, hosts] },
      { name: 'removeIp', args: [ip] },
      { name: 'removeHost', args: [hosts] },
    ]);
  });
}

export const apply = (doc, list) => list.reduce((d, op) => d[op.name](...op.args), doc);
