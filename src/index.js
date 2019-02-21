import fs from 'fs';

import atomicWrite from 'atomic-write';
import EventEmitter from 'eventemitter3';

const win = process.platform === 'win32';
/* istanbul ignore next */
const DEFAULT_EOL = win ? '\r\n' : '\n';
/* istanbul ignore next */
const DEFAULT_HOSTS = win ? 'C:/Windows/System32/drivers/etc/hosts' : '/etc/hosts';

function debounce(func, delay) {
  let timeout;
  return function() {
    clearTimeout(timeout);
    const args = arguments, that = this;
    timeout = setTimeout(() => func.apply(that,args), delay);
  }
}

/* istanbul ignore next */
const isArray = Array.isArray ||
  (arg => Object.prototype.toString.call(arg) === '[object Array]');

function arrayJoinFunc(arr, separatorFunc) {
  return arr.map(
    (el, i) => el + (i < arr.length-1 ? separatorFunc(el, i) : '')
  ).join('');
}

function noop() {}

function ifErrThrow(err) {
  /* istanbul ignore next */
  if (err)
    throw err;
}

const isSkipLine = line => !line || line.match(/^\#|^\s*$/);

class Hosts extends EventEmitter {

  /* --- PUBLIC API --- */

  constructor(options) {
    super();

    this.writeInProgress = false;
    this.queue = { add: {}, remove: {}, removeHost: {} };
    this.hostsFile = {};
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
        if (typeof config[key] !== 'undefined') {
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
      ? atomicWrite.writeFile.bind(atomicWrite)
      : fs.writeFile.bind(fs);

    this._queueUpdate = config.noWrites
      ? noop
      : debounce(this._update.bind(this, ifErrThrow), config.debounceTime);

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
    this.queue.add = {};
    this.queue.remove = {};
    this.queue.removeHost = {};
  }

  updateFinish(callback) {
    if (callback) {

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
      } else if (isSkipLine(line)) {
        return line;
      }

      let hosts = line.split(/[\s]+/);
      const ip = hosts.shift();

      // Null only on invalid /etc/hosts (e.g. IP with no hostname), but let's still run.
      let whitespace = line.match(/\s+/g);
      whitespace = whitespace ? whitespace.slice() : [];

      // removeHost
      hosts = hosts.filter(x => !queue.removeHost[x]);

      if (queue.add[ip]) {
        hosts = hosts.concat(queue.add[ip].filter(x => !hosts.includes(x)));
        delete queue.add[ip];
      }

      if (queue.remove[ip]) {
        if (queue.remove[ip] === '*') {
          hosts = [];
        } else {
          let host;
          while ((host = queue.remove[ip].pop()))
            hosts = hosts.filter(x => x !== host)
        }
      }

      if (hosts.length)
        return ip +
          (whitespace[0] || ' ') +
          arrayJoinFunc(hosts, (x, i) => whitespace[i+1] || ' ');

      return undefined;
    });

    let startIndex;
    if (arr[0] === '') {
      arr.pop();
      startIndex = 0;
    } else if (header && headerLine) {
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
      arr.splice(++startIndex, 0, ip + ' ' + queue.add[ip].join(' '));

    this.clearQueue();

    return arr.filter(x => x !== undefined).join(this.config.EOL);
  }

  _runUpdateFinishCallbacks(err) {
    for (let i = 0; i < this.updateFinishCallbacks.length; i++)
      this.updateFinishCallbacks[i](err);
    this.updateFinishCallbacks = [];
  }

  /* --- FILE MANAGEMENT (INTERNAL) --- */

  _updateContents(contents, callback) {
    this._writeFile(this.config.hostsFile, contents, err => {
      if (err) {
        callback(err);
        this.emit('updateFinish', err);
        return;
      }

      this.writeInProgress = false;
      callback();
      this.emit('updateFinish'); // success
    });
  }

  // note: callback is only currently used for testing
  _update(callback) {
    if (this.writeInProgress)
      return this._queueUpdate();

    this.writeInProgress = true;
    this.emit('updateStart');

    // Check if file has changed to avoid unnecessary reread.
    // TODO don't check if we've written since last read.
    fs.stat(this.config.hostsFile, (err, stats) => {
      if (err) {
        callback(err);
        this.emit('updateFinish', err);
        return;
      }

      if (this.hostsFile.ctime && this.hostsFile.ctime.getTime() === stats.ctime.getTime()) {

        this._updateContents(this.modify(this.hostsFile.raw), callback);

      } else {

        this.hostsFile.ctime = stats.ctime;
        fs.readFile(this.config.hostsFile, (err, file) => {
          if (err) {
            callback(err);
            this.emit('updateFinish', err);
            return;
          }

          this.hostsFile.raw = file.toString();
          this._updateContents(this.modify(this.hostsFile.raw), callback);
        });

      }
    });
  }

}

export { noop };
export default Hosts;
