'use strict';

const { EventEmitter } = require('node:events');
const { inspect } = require('node:util');
const {
  HostsDocument, checkIp, checkHosts, checkHeader, checkEol, DEFAULT_FILE,
} = require('./document.cjs');

const TYPES = {
  atomicWrites: 'boolean', debounceTime: 'number', maxWait: 'number',
  hostsFile: 'string', noWrites: 'boolean',
};

const newBatch = () => ({ ops: [], waiters: [], firstAt: 0 });
let warned = false;

/**
 * The 1.x queued API, kept for one major version on top of HostsDocument.
 * Changes are applied in call order, batched, and written after a debounce.
 * @deprecated Use HostsDocument.edit() or HostsDocument.load() / write().
 */
class Hosts extends EventEmitter {
  #options;
  #pending = newBatch();  // changes not yet handed to a write
  #current = null;        // the batch being written, if any
  #timer = null;
  #due = false;           // the timer fired while a write was in progress

  constructor(options) {
    super();
    if (!warned) {
      warned = true;
      process.emitWarning('The queued Hosts API is deprecated and will be removed in 3.0; '
        + 'use HostsDocument.edit() or HostsDocument.load() / write().',
      'DeprecationWarning', 'HOSTS_SO_EASY_DEP001');
    }

    const config = this.#options = {
      atomicWrites: true, debounceTime: 500, maxWait: undefined, header: false,
      hostsFile: DEFAULT_FILE, noWrites: false, EOL: undefined,
    };
    for (const [key, value] of Object.entries(options ?? {})) {
      if (!Object.hasOwn(config, key))
        throw new TypeError('No such config option: ' + key);
      if (key === 'header')
        config.header = value === false ? false : checkHeader(value);
      else if (key === 'EOL')
        config.EOL = checkEol(value);
      else if (typeof value !== TYPES[key] || (TYPES[key] === 'number' && !(value >= 0 && value < 2 ** 31)))
        throw new TypeError(`new Hosts(options) key \`${key}\` expects a ${TYPES[key]}`
          + `${TYPES[key] === 'number' ? ' of milliseconds' : ''}, got ${typeof value}: ${inspect(value)}`);
      else
        config[key] = value;
    }
    config.maxWait ??= Math.max(2000, config.debounceTime);
  }

  add(ip, host) {
    checkIp(ip);
    const hosts = checkHosts(host);
    const { header } = this.#options;
    this.#enqueue(doc => doc.add(ip, hosts, header ? { header } : undefined));
  }

  remove(ip, host) {
    if (ip === '*') {
      if (host === '*')
        throw new TypeError("hosts.remove('*', '*') not allowed.  Be more specific.");
      return this.removeHost(host);
    }
    checkIp(ip);
    if (host === '*')
      return this.#enqueue(doc => doc.removeIp(ip));
    const hosts = checkHosts(host);
    this.#enqueue(doc => doc.remove(ip, hosts));
  }

  removeHost(host) {
    const hosts = checkHosts(host);
    this.#enqueue(doc => doc.removeHost(hosts));
  }

  clearQueue() {
    clearTimeout(this.#timer);
    this.#timer = null;
    // A write under way cannot be stopped, but it will not be tried again.
    if (this.#current) this.#current.cancelled = true;
    const batch = this.#pending;
    this.#pending = newBatch();
    for (const waiter of batch.waiters) waiter();
  }

  // Apply and clear the pending changes against a string; no file access.
  modify(contents) {
    const doc = HostsDocument.parse(contents, { eol: this.#options.EOL });
    for (const op of this.#pending.ops) op(doc);
    this.clearQueue();
    return doc.toString();
  }

  // Settles once every change made so far is on disk (or has failed).
  updateFinish(callback) {
    if (callback !== undefined && typeof callback !== 'function')
      throw new TypeError('hosts.updateFinish(callback) expects `callback` to be a function, '
        + `got ${typeof callback}: ${inspect(callback)}`);

    let batch = null;
    if (this.#options.noWrites) {
      // Nothing will ever be written, so there is nothing to wait for.
    } else if (this.#pending.ops.length) {
      batch = this.#pending;
      // Changes kept after a failed write have no timer: asking for them retries.
      if (!this.#timer) this.#schedule();
    } else {
      batch = this.#current;
    }

    if (callback) {
      // On a later tick, so a throwing callback cannot disturb an update.
      if (batch) batch.waiters.push(err => process.nextTick(callback, err));
      else process.nextTick(callback);
      return;
    }
    if (!batch) return Promise.resolve();
    return new Promise((resolve, reject) => {
      batch.waiters.push(err => err ? reject(err) : resolve());
    });
  }

  #enqueue(op) {
    this.#pending.ops.push(op);
    if (!this.#options.noWrites) this.#schedule();
  }

  // Debounce, but never postpone a batch for longer than maxWait.
  #schedule() {
    const { debounceTime, maxWait } = this.#options;
    const now = Date.now();
    if (!this.#timer) this.#pending.firstAt = now;
    clearTimeout(this.#timer);
    const wait = Math.max(0, Math.min(debounceTime, this.#pending.firstAt + maxWait - now));
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#flush();
    }, wait);
  }

  #flush() {
    if (this.#current) {
      this.#due = true;
      return;
    }
    clearTimeout(this.#timer);
    this.#timer = null;
    const batch = this.#pending;
    if (!batch.ops.length) return;
    this.#pending = newBatch();
    this.#run(batch);
  }

  async #run(batch) {
    const { hostsFile: file, EOL: eol, atomicWrites: atomic } = this.#options;
    this.#current = batch;
    let error;
    try {
      this.emit('updateStart');
      // Reads the file afresh, and again if someone else writes it meanwhile.
      await HostsDocument.edit(doc => { for (const op of batch.ops) op(doc); }, { file, eol, atomic });
    } catch (err) {
      error = err;
      // Keep the changes, ahead of newer ones, for the next update.
      if (!batch.cancelled) this.#pending.ops = batch.ops.concat(this.#pending.ops);
    } finally {
      this.#current = null;
    }

    const observed = batch.waiters.length > 0 || this.listenerCount('updateFinish') > 0;
    try {
      this.emit('updateFinish', error);
    } finally {
      for (const waiter of batch.waiters) waiter(error);
      if (error && !observed)
        process.emitWarning(`hosts-so-easy: failed to update ${file}: ${error.message}`,
          { code: 'HOSTS_SO_EASY_UPDATE_FAILED' });
      if (this.#due) {
        this.#due = false;
        this.#flush();
      }
    }
  }
}

module.exports = Hosts;
