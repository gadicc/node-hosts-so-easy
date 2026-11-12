import Hosts = require('./index.cjs');

export default Hosts;
export { Hosts };

export declare const HostsDocument: typeof Hosts.HostsDocument;
export type HostsDocument = Hosts.HostsDocument;
export declare const HostsConflictError: typeof Hosts.HostsConflictError;
export type HostsConflictError = Hosts.HostsConflictError;

export type EOL = Hosts.EOL;
export type Entry = Hosts.Entry;
export type ParseOptions = Hosts.ParseOptions;
export type WriteOptions = Hosts.WriteOptions;
export type EditOptions = Hosts.EditOptions;
export type AddOptions = Hosts.AddOptions;
export type HostsOptions = Hosts.HostsOptions;
