const fs = require('node:fs');

const atomicWrite = require('write-file-atomic');
const EventEmitter = require('eventemitter3');

const win = process.platform === 'win32';
const DEFAULT_EOL = win ? '\r\n' : '\n';
const DEFAULT_HOSTS = win ? 'C:/Windows/System32/drivers/etc/hosts' : '/etc/hosts';

function debounce(func, delay) {
  let timeout;
  return function() {
    clearTimeout(timeout);
    const args = arguments, that = this;
    timeout = setTimeout(() => func.apply(that,args), delay);
  }
}

const isArray = Array.isArray;

function arrayJoinFunc(arr, separatorFunc) {
  return arr.map(
    (el, i) => el + (i < arr.length-1 ? separatorFunc(el, i) : '')
  ).join('');
}

function noop() {}

const isSkipLine = line => !line || /^\s*(?:#|$)/.test(line);
const dictionary = () => Object.create(null);
const newQueue = () => ({ add: dictionary(), remove: dictionary(), removeHost: dictionary() });

class Hosts extends EventEmitter {

  /* --- PUBLIC API --- */

  constructor(options) {
    super();

    this.writeInProgress = false;
    this.queue = newQueue();
    this.updateFinishCallbacks = [];

    const config = this.config = {
      atomicWrites: true,
      debounceTime: 500,
      header: false,
      hostsFile: DEFAULT_HOSTS,
      noWrites: false,
      EOL:  DEFAULT_EOL,
    };

    if (options) {
      for (const key in options) {
        if (Object.hasOwn(config, key)) {
          if (key === 'header' && typeof options[key] !== 'boolean'
              && typeof options[key] !== 'string')
            throw new Error('new Hosts(options) key `header` should be a '
              + `boolean or string but got `
              + `a ${typeof options[key]}: ` + JSON.stringify(options[key]));
          else if (key !== 'header' && typeof config[key] !== typeof options[key])
            throw new Error('new Hosts(options) key `' + key + '` expects '
              + `a ${typeof config[key]} like ${config[key]} but got `
              + `a ${typeof options[key]}: ` + JSON.stringify(options[key]));
          else
            config[key] = options[key];
        } else
          throw new Error("No such config option: " + key);
      }
    }

    this._writeFile = config.atomicWrites
      ? (filename, contents, callback) => atomicWrite(filename, contents)
        .then(() => callback(), callback)
      : fs.writeFile.bind(fs);

    this._queueUpdate = config.noWrites
      ? noop
      : debounce(() => this._update(), config.debounceTime);

    this.on('updateFinish', this._runUpdateFinishCallbacks.bind(this));
  }

  add(ip, host) {
    const queue = this.queue;

    if (typeof ip !== 'string')
      throw new Error('hosts.add(ip, host) expects `ip` to be a string, not '
        + (typeof ip) + ': ' + JSON.stringify(ip));

    if (!queue.add[ip])
      queue.add[ip] = [];

    if (typeof host === 'string')
      queue.add[ip].push(host);
    else if (isArray(host))
      queue.add[ip] = queue.add[ip].concat(host);
    else
      throw new Error('hosts.add(ip, host) expects `host` to be a string or '
        + `array of strings, not ${typeof host}: ` + JSON.stringify(host));

    this._queueUpdate();
  }

  remove(ip, host) {
    const queue = this.queue;

    if (typeof ip !== 'string')
      throw new Error('hosts.remove(ip, host) expects `ip` to be a string, '
        + `${typeof ip}: ` + JSON.stringify(ip));

    if (!queue.remove[ip])
      queue.remove[ip] = [];

    // Don't do anything if there is already a '*' for this host in the queue
    if (queue.remove[ip] === '*')
      return;

    if (ip === '*') {

      if (host === '*')
        throw new Error("hosts.remove('*', '*') not allowed.  Be more specific.");
      else if (typeof host === 'string')
        this.queue.removeHost[host] = true;
      else if (isArray(host))
        host.forEach(host => this.queue.removeHost[host] = true);
      else throw new Error("hosts.remove('*', host) expects `host` to be a "
        + `string or array of strings, not ${typeof host}: `
        + JSON.stringify(host));

    } else if (host === '*')
      queue.remove[ip] = '*';
    else if (typeof host === 'string')
      queue.remove[ip].push(host);
    else if (isArray(host))
      queue.remove[ip] = queue.remove[ip].concat(host);
    else
      throw new Error('hosts.remove(ip, host) expects `host` to be a string or '
        + `array of strings, not ${typeof host}: ` + JSON.stringify(host));

    this._queueUpdate();
  }

  removeHost(host) {
    if (typeof host !== 'string')
      throw new Error('hosts.removeHost(host) expects `host` to be a string, '
        + `not ${typeof host}: ` + JSON.stringify(host));

    this.queue.removeHost[host] = true;
    this._queueUpdate();
  }

  clearQueue() {
    this.queue = newQueue();
  }

  updateFinish(callback) {
    if (callback !== undefined) {

      if (typeof callback === 'function')
        this.updateFinishCallbacks.push(callback);
      else
        throw new Error('hosts.updateFinish(callback) expects `callback` to '
          + `be a function, not ${typeof callback}: `
          + JSON.stringify(callback));

    } else {

      return new Promise((resolve, reject) => {
        this.updateFinishCallbacks.push(function(err) {
          if (err)
            reject(err);
          resolve();
        });
      });

    }
  }

  /* --- INTERNAL API --- */

  modify(input) {
    let headerLine;
    const queue = this.queue;
    const header = this.config.header ? '# ' + this.config.header : false;

    const arr = input.split(/\r?\n/).map((line, lineNumber) => {
      if (header && line === header) {
        headerLine = lineNumber;
        return line;
      } else if (isSkipLine(line)) {
        return line;
      }

      const [, leading, entry, comment] = line.match(/^(\s*)([^#]*?)(\s*#.*|\s*)$/);
      let hosts = entry.trim().split(/\s+/);
      const ip = hosts.shift();

      // Null only on invalid /etc/hosts (e.g. IP with no hostname), but let's still run.
      let whitespace = entry.match(/\s+/g);
      whitespace = whitespace ? whitespace.slice() : [];

      // removeHost
      hosts = hosts.filter(x => !queue.removeHost[x]);

      if (queue.add[ip]) {
        hosts = [...new Set(hosts.concat(queue.add[ip]))];
        delete queue.add[ip];
      }

      if (queue.remove[ip]) {
        if (queue.remove[ip] === '*') {
          hosts = [];
        } else {
          hosts = hosts.filter(x => !queue.remove[ip].includes(x));
        }
      }

      if (hosts.length)
        return leading + ip +
          (whitespace[0] || ' ') +
          arrayJoinFunc(hosts, (x, i) => whitespace[i+1] || ' ') + comment;

      return comment.includes('#') ? leading + comment.trimStart() : undefined;
    });

    let startIndex;
    if (input === '') {
      arr.pop();
      startIndex = -1;
      if (header) arr.splice(++startIndex, 0, header);
    } else if (header && headerLine !== undefined) {
      // Start below headerLine, then below valid entries,
      // but above any whitespace and comments.
      startIndex = headerLine;
      while (startIndex < arr.length && !isSkipLine(arr[startIndex+1]))
        startIndex++;
    } else {
      // Start before trailing newlines and comments
      startIndex = arr.length - 1;
      while (startIndex > 0 && isSkipLine(arr[startIndex]))
        startIndex--;

      // i.e. if header && !headerLine, insert the header over here
      if (header) {
        arr.splice(++startIndex, 0, '', header);
        ++startIndex;
      }
    }

    // TODO: try mimic preceeding whitespace pattern?
    for (const ip in queue.add)
      arr.splice(++startIndex, 0, ip + ' ' + [...new Set(queue.add[ip])].join(' '));

    this.clearQueue();

    return arr.filter(x => x !== undefined).join(this.config.EOL);
  }

  _runUpdateFinishCallbacks(err) {
    const callbacks = this.updateFinishCallbacks;
    this.updateFinishCallbacks = [];
    for (const callback of callbacks) callback(err);
  }

  /* --- FILE MANAGEMENT (INTERNAL) --- */

  _finishUpdate(err, callback) {
    const observed = this.updateFinishCallbacks.length > 0 || this.listenerCount('updateFinish') > 1;
    this.writeInProgress = false;
    this.emit('updateFinish', err);
    if (callback) callback(err);
    else if (err && !observed) throw err;
  }

  _updateContents(contents, callback, pending) {
    this._writeFile(this.config.hostsFile, contents, err => {
      if (err && pending) {
        for (const ip of Object.keys(pending.add)) {
          this.queue.add[ip] = (pending.add[ip]).concat(this.queue.add[ip] || []);
        }
        for (const ip of Object.keys(pending.remove)) {
          const current = this.queue.remove[ip];
          this.queue.remove[ip] = current === '*' || pending.remove[ip] === '*'
            ? '*' : pending.remove[ip].concat(current || []);
        }
        Object.assign(this.queue.removeHost, pending.removeHost);
      }
      this._finishUpdate(err, callback);
    });
  }

  // note: callback is only currently used for testing
  _update(callback) {
    if (this.writeInProgress)
      return this._queueUpdate();

    this.writeInProgress = true;
    this.emit('updateStart');

    // Always read the current contents: timestamp caches can discard a previous
    // write or an external edit made within the filesystem's timestamp precision.
    fs.readFile(this.config.hostsFile, 'utf8', (err, file) => {
      if (err) {
        this._finishUpdate(err, callback);
        return;
      }
      const pending = structuredClone(this.queue);
      this._updateContents(this.modify(file), callback, pending);
    });
  }

}

module.exports = Hosts;
// Preserve the Babel-era require(...).default entry point.
module.exports.default = Hosts;
module.exports.noop = noop;
