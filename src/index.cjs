'use strict';

const { HostsDocument, HostsConflictError } = require('./document.cjs');
const Hosts = require('./hosts.cjs');

// The default export stays the deprecated queued class so that 1.x imports,
// including the Babel-era require(...).default, keep working.
module.exports = Object.assign(Hosts, { default: Hosts, Hosts, HostsDocument, HostsConflictError });
