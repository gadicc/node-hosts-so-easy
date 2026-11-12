'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const { isIP, SocketAddress } = require('node:net');
const { inspect } = require('node:util');
const { writeHosts } = require('./write.cjs');

/* c8 ignore next 3 */
const DEFAULT_FILE = process.platform === 'win32'
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  : '/etc/hosts';

// Hostnames compare like a resolver compares them: only ASCII letters fold.
const lower = s => s.replace(/[A-Z]+/g, upper => upper.toLowerCase());
const fail = (what, value) => { throw new TypeError(`${what}, got ${typeof value}: ${inspect(value)}`); };

/* --- VALIDATION --- */

// Canonical form used to match addresses: "::1" equals "0:0:0:0:0:0:0:1" and
// "FE80::1". A zone id ("%eth0") is part of the address and is case-sensitive.
function ipKey(ip) {
  const family = typeof ip === 'string' ? isIP(ip) : 0;
  if (family !== 6) return family ? ip : undefined;
  const zone = ip.indexOf('%');
  const address = zone < 0 ? ip : ip.slice(0, zone);
  return new SocketAddress({ address, family: 'ipv6' }).address + (zone < 0 ? '' : ip.slice(zone));
}

function checkIp(ip) {
  return ipKey(ip) ?? fail('`ip` must be an IPv4 or IPv6 address', ip);
}

// Printable ASCII without "#": no whitespace, control characters or comments,
// so a hostname can never start a new line or hide the rest of one.
const HOSTNAME = /^[\x21\x22\x24-\x7e]+$/;

function checkHosts(hosts) {
  const list = typeof hosts === 'string' ? [hosts] : hosts;
  if (!Array.isArray(list)) fail('`hosts` must be a hostname or an array of hostnames', hosts);
  const seen = new Set();
  return list.filter(host => {
    if (typeof host !== 'string' || !HOSTNAME.test(host))
      fail('`hosts` must be non-empty ASCII hostnames without whitespace or "#"', host);
    return !seen.has(lower(host)) && seen.add(lower(host));
  });
}

function checkHeader(header) {
  const text = typeof header === 'string' ? header.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '') : '';
  if (!/^[\x20-\x7e\t]+$/.test(text)) fail('`header` must be a non-empty string of printable ASCII', header);
  return text;
}

function checkEol(eol) {
  if (eol !== undefined && eol !== '\n' && eol !== '\r\n') fail('`eol` must be "\\n" or "\\r\\n"', eol);
  return eol;
}

/* --- LINES --- */

// A line is either an entry { indent, ip, key, gaps, hosts, tail, eol }, where
// gaps[i] is the whitespace before hosts[i] and tail is trailing whitespace
// plus any comment, or anything else, kept verbatim as { text, eol }.
function parseLine(body, eol) {
  const hash = body.indexOf('#');
  const content = hash < 0 ? body : body.slice(0, hash);
  // Even indexes are tokens, odd ones the whitespace between them.
  const parts = content.split(/([ \t\v\f\r]+)/);
  const start = parts[0] === '' ? 2 : 0;
  const key = ipKey(parts[start]);
  if (!key) return { text: body, eol };

  const trailing = parts.at(-1) === '' && parts.length > start + 1;
  const end = trailing ? parts.length - 2 : parts.length;
  const gaps = [], hosts = [];
  for (let i = start + 1; i < end; i += 2) {
    gaps.push(parts[i]);
    hosts.push(parts[i + 1]);
  }
  return {
    indent: start ? parts[1] : '', ip: parts[start], key, gaps, hosts,
    tail: (trailing ? parts.at(-2) : '') + body.slice(content.length), eol,
  };
}

function parseLines(text) {
  const lines = [];
  for (let pos = 0; pos < text.length;) {
    const newline = text.indexOf('\n', pos);
    if (newline < 0) {
      lines.push(parseLine(text.slice(pos), ''));
      break;
    }
    const crlf = newline > pos && text[newline - 1] === '\r';
    lines.push(parseLine(text.slice(pos, crlf ? newline - 1 : newline), crlf ? '\r\n' : '\n'));
    pos = newline + 1;
  }
  return lines;
}

const render = line => line.text
  ?? line.indent + line.ip + line.hosts.map((host, i) => line.gaps[i] + host).join('') + line.tail;

const isBlank = line => line.text !== undefined && line.text.trim() === '';
const isComment = line => line.text !== undefined && line.text.trimStart().startsWith('#');
const isHeader = (line, header) => isComment(line) && line.text.trim().slice(1).trim() === header;

/* --- DOCUMENT --- */

class HostsConflictError extends Error {
  constructor(file) {
    super(`${file} was changed by someone else since it was loaded`);
    this.name = 'HostsConflictError';
    this.code = 'ERR_HOSTS_CONFLICT';
    this.file = file;
  }
}

class HostsDocument {
  #lines;
  #eol;
  #file;
  #base;
  #encoding = 'utf8';
  #writing = Promise.resolve();

  constructor(text = '', options = {}) {
    if (typeof text !== 'string') fail('`text` must be a string', text);
    // A byte order mark is not whitespace to a resolver: it is part of the
    // first token, so a first line that starts with one is not an entry.
    this.#lines = parseLines(text);
    this.#eol = checkEol(options.eol) ?? this.#lines.find(line => line.eol)?.eol ?? os.EOL;
  }

  static parse(text, options) {
    return new HostsDocument(text, options);
  }

  static async load(file = DEFAULT_FILE, options) {
    const bytes = await fs.promises.readFile(file);
    // latin1 maps every byte to one character, so files that are not valid
    // UTF-8 (old Windows code pages) still round-trip byte for byte.
    const encoding = isUtf8(bytes) ? 'utf8' : 'latin1';
    const doc = new HostsDocument(bytes.toString(encoding), options);
    doc.#file = file;
    doc.#base = bytes;
    doc.#encoding = encoding;
    return doc;
  }

  static async edit(fn, { file, eol, atomic, retries = 3 } = {}) {
    if (!Number.isInteger(retries) || retries < 0) fail('`retries` must be a non-negative integer', retries);
    for (let attempt = 0; ; attempt++) {
      const doc = await HostsDocument.load(file, { eol });
      await fn(doc);
      try {
        return await doc.write({ atomic });
      } catch (err) {
        if (!(err instanceof HostsConflictError) || attempt >= retries) throw err;
      }
    }
  }

  get file() { return this.#file; }
  get eol() { return this.#eol; }

  entries() {
    return this.#lines.filter(line => line.key).map(line => ({ ip: line.ip, hosts: [...line.hosts] }));
  }

  add(ip, hosts, options = {}) {
    const key = checkIp(ip);
    let list = checkHosts(hosts);
    const header = options.header === undefined ? undefined : checkHeader(options.header);
    const lines = this.#lines;

    const same = lines.filter(line => line.key === key);
    const present = new Set(same.flatMap(line => line.hosts.map(lower)));
    list = list.filter(host => !present.has(lower(host)));
    if (!list.length) return this;

    let target = same[0];
    let at = lines.findLastIndex(line => line.key) + 1 || lines.length;
    const created = [];
    if (header !== undefined) {
      target = undefined;
      const top = lines.findIndex(line => isHeader(line, header));
      if (top < 0) {
        if (at > 0 && !isBlank(lines[at - 1])) created.push({ text: '' });
        created.push({ text: '# ' + header });
      } else {
        // The block runs from the header to the next blank or comment line.
        for (at = top + 1; at < lines.length && !isBlank(lines[at]) && !isComment(lines[at]); at++)
          if (lines[at].key === key) target ??= lines[at];
      }
    }

    if (target) {
      for (const host of list) {
        target.hosts.push(host);
        target.gaps.push(' ');
      }
      return this;
    }
    created.push({ indent: '', ip, key, gaps: list.map(() => ' '), hosts: list, tail: '' });
    if (created.length > 1 && at < lines.length && !isBlank(lines[at])) created.push({ text: '' });
    this.#insert(at, created);
    return this;
  }

  remove(ip, hosts) {
    const key = checkIp(ip);
    const names = new Set(checkHosts(hosts).map(lower));
    return this.#strip(line => line.key === key, host => names.has(lower(host)));
  }

  removeIp(ip) {
    const key = checkIp(ip);
    return this.#strip(line => line.key === key, () => true, true);
  }

  removeHost(hosts) {
    const names = new Set(checkHosts(hosts).map(lower));
    return this.#strip(() => true, host => names.has(lower(host)));
  }

  toString() {
    return this.#lines.map(line => render(line) + line.eol).join('');
  }

  // Resolves true if the file was written, false if there was nothing to do.
  write({ atomic = true } = {}) {
    const run = () => this.#write(atomic);
    const result = this.#writing.then(run);
    this.#writing = result.catch(() => {});
    return result;
  }

  async #write(atomic) {
    if (!this.#file) throw new Error('write() requires a document from HostsDocument.load()');
    const data = Buffer.from(this.toString(), this.#encoding);
    if (data.equals(this.#base)) return false;

    const file = await fs.promises.realpath(this.#file);
    const current = await fs.promises.readFile(file);
    if (!current.equals(data)) {
      if (!current.equals(this.#base)) throw new HostsConflictError(this.#file);
      await writeHosts(file, data, current, atomic);
    }
    this.#base = data;
    return !current.equals(data);
  }

  // New lines use the document's line ending. A file that does not end with
  // a newline still does not afterwards.
  #insert(at, created) {
    const last = this.#lines.at(-1);
    const open = at === this.#lines.length && last?.eol === '';
    if (open) last.eol = this.#eol;
    created.forEach((line, i) => { line.eol = open && i === created.length - 1 ? '' : this.#eol; });
    this.#lines.splice(at, 0, ...created);
  }

  #strip(matchesLine, matchesHost, always = false) {
    const lines = this.#lines;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.key || !matchesLine(line)) continue;
      let changed = always;
      for (let j = line.hosts.length - 1; j >= 0; j--) {
        if (!matchesHost(line.hosts[j])) continue;
        line.hosts.splice(j, 1);
        // Each host owns the gap before it, but the gap after the IP stays.
        line.gaps.splice(j === 0 && line.hosts.length ? 1 : j, 1);
        changed = true;
      }
      if (!changed || line.hosts.length) continue;

      // An emptied line disappears, but its comment is kept.
      const hash = line.tail.indexOf('#');
      if (hash >= 0) {
        lines[i] = { text: line.indent + line.tail.slice(hash), eol: line.eol };
      } else {
        if (line.eol === '' && i > 0) lines[i - 1].eol = '';
        lines.splice(i, 1);
      }
    }
    // Removing the final line can leave an empty line without a line ending,
    // which is nothing at all.
    if (lines.at(-1)?.text === '' && lines.at(-1).eol === '') lines.pop();
    return this;
  }
}

module.exports = {
  HostsDocument, HostsConflictError,
  // Internal, used by the deprecated queued API.
  checkIp, checkHosts, checkHeader, checkEol, DEFAULT_FILE,
};
