// Compiled by `npm run test:types`; never run.
import Hosts = require('hosts-so-easy');

const legacy: Hosts = new Hosts({ noWrites: true });
const viaDefault: Hosts = new Hosts.default();
const viaName: Hosts = new Hosts.Hosts();
const doc: Hosts.HostsDocument = Hosts.HostsDocument.parse('');
const entries: Hosts.Entry[] = doc.add('::1', 'x').entries();
const conflict: Hosts.HostsConflictError = new Hosts.HostsConflictError('/etc/hosts');
const { HostsDocument } = Hosts;
const written: Promise<boolean> = HostsDocument.edit(d => { d.removeHost('x'); });

export = { legacy, viaDefault, viaName, entries, conflict, written };
