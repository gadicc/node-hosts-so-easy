// Compiled by `npm run test:types`; never run.
import Hosts, { Hosts as Named, HostsDocument, HostsConflictError } from 'hosts-so-easy';
import type { Entry, EOL, EditOptions, HostsOptions } from 'hosts-so-easy';

const doc: HostsDocument = HostsDocument.parse('127.0.0.1 localhost\n', { eol: '\n' });
const chained: HostsDocument = doc.add('::1', ['a', 'b'] as const, { header: 'mine' }).remove('::1', 'a').removeIp('::1').removeHost(['b']);
const entries: Entry[] = chained.entries();
const eol: EOL = doc.eol;
const file: string | undefined = doc.file;
const text: string = new HostsDocument().toString();
const options: EditOptions = { file: '/etc/hosts', atomic: false, retries: 1, eol };
const written: Promise<boolean> = HostsDocument.edit(async d => { d.add('::1', 'x'); }, options);
const fluent: Promise<boolean> = HostsDocument.edit(d => d.add('::1', 'x').removeHost('y'));
const fluentAsync: Promise<boolean> = HostsDocument.edit(async d => d.add('::1', 'x'));
const count: number = new Hosts().removeAllListeners('updateStart').listenerCount('updateFinish');
const loaded: Promise<boolean> = HostsDocument.load().then(d => d.write({ atomic: true }));

try { await doc.write(); } catch (err) {
  if (err instanceof HostsConflictError) { const code: 'ERR_HOSTS_CONFLICT' = err.code; const f: string = err.file; }
}

const legacyOptions: HostsOptions = { header: false, debounceTime: 0, maxWait: 10, EOL: '\r\n' };
const hosts: Hosts = new Named(legacyOptions);
hosts.add('127.0.0.1', 'x');
hosts.remove('*', ['x']);
hosts.on('updateFinish', (err?: Error) => {}).once('updateStart', () => {});
const done: Promise<void> = hosts.updateFinish();
const nothing: void = hosts.updateFinish((err?: Error) => {});
const out: string = hosts.modify('');

// @ts-expect-error hosts must be strings
doc.add('::1', [1]);
// @ts-expect-error not a line ending
HostsDocument.parse('', { eol: '\r' });
// @ts-expect-error header is false or a string
new Hosts({ header: true });
// @ts-expect-error unknown event
hosts.on('error', () => {});

export { entries, file, text, written, fluent, fluentAsync, count, loaded, done, nothing, out };
