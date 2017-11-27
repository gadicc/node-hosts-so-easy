import fs from 'fs';

import atomicWrite from 'atomic-write';
import debounce from 'lodash/debounce';

const win = process.env === 'win32';
const EOL = win ? '\r\n' : '\n';
const HOSTS_FILE = win ? 'C:/Windows/System32/drivers/etc/hosts' : '/etc/hosts';
//const HOSTS_FILE = 'sample_hosts';

const queue = { add: {}, remove: {}, removeHost: {} };

const hosts = {

  add: function add(ip, host) {
    if (!queue.add[ip])
      queue.add[ip] = [];

    if (typeof host === 'object')
      queue.add[ip] = queue.add[ip].concat(host);
    else
      queue.add[ip].push(host);

    queueWrite();
  },

  remove: function remove(ip, host) {
    if (!queue.remove[ip])
      queue.remove[ip] = [];

    // skip if we already have a '*'
    if (typeof queue.remove[ip] === 'string')
      return;

    if (host === '*')
      queue.remove[ip] = '*';
    else if (typeof host === 'object')
      queue.remove[ip] = queue.add[ip].concat(host);
    else
      queue.remove[ip].push(host);

    queueWrite();
  },

  removeHost: function removeHost(host) {
    queue.removeHost[host] = true;
    queueWrite();
  },

  clearQueue: function clearQueue() {
    queue.add = {};
    queue.remove = {};
    queue.removeHost = {};
  }

};

function arrayJoinFunc(arr, separatorFunc) {
  return arr.map(
    (el, i) => el + (i < arr.length-1 ? separatorFunc(el, i) : '')
  ).join('');
}

function modify(input) {
  const arr = input.split(/\r?\n/).map(line => {
    if (line === '' || line.startsWith('#'))
      return line;

    let hosts = line.split(/[\s]+/);
    const whitespace = line.match(/\s+/g).slice();
    const ip = hosts.shift();

    // removeHost
    hosts = hosts.filter(x => !queue.removeHost[x]);
    queue.removeHost = {};

    if (queue.add[ip]) {
      hosts = hosts.concat(queue.add[ip].filter(x => !hosts.includes(x)));
      delete queue.add[ip];
    }

    if (queue.remove[ip]) {
      let host;
      while ((host = queue.remove[ip].pop()))
        hosts = hosts.filter(x => x !== host)
    }

    if (hosts.length)
      return ip +
        (whitespace[0] || ' ') +
        arrayJoinFunc(hosts, (x, i) => whitespace[i+1] || ' ');

    return undefined;
  });

  // Start before trailing newlines and comments
  let startIndex;
  if (arr.length) {
    startIndex = arr.length - 1;
    while (startIndex > 0 && (!arr[startIndex] || arr[startIndex].startsWith('#')))
      startIndex--;
  } else {
    startIndex = 0;
  }

  // TODO: try mimic preceeding whitespace pattern?
  for (const ip in queue.add)
    arr.splice(++startIndex, 0, ip + ' ' + queue.add[ip].join(' '));

  hosts.clearQueue();

  return arr.join(EOL);
}

let writeInProgress = false;

function write() {
  if (writeInProgress)
    return queueWrite();

  writeInProgress = true;

  // TODO, cache & stat to invalidate
  fs.readFile(HOSTS_FILE, function(err, file) {
    if (err) {
      console.warn(err);
      console.warn('Creating empty hosts file');
      file = '';
    }

    //atomicWrite.
    fs.writeFile(HOSTS_FILE, modify(file.toString()), err => {
      if (err)
        throw err;
      writeInProgress = false;
    });
  });
}

const queueWrite = debounce(write, 500);

// for testing
export { queue, modify };

export default hosts;
