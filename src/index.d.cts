/**
 * The 1.x queued API, kept for one major version on top of `HostsDocument`.
 * Changes are applied in call order, batched, and written after a debounce.
 *
 * @deprecated Use `HostsDocument.edit()` or `HostsDocument.load()` / `write()`.
 */
declare class Hosts {
  constructor(options?: Hosts.HostsOptions | null);

  add(ip: string, host: string | readonly string[]): void;
  /** `ip` may be `'*'` for every address, or `host` `'*'` for every host of `ip`. */
  remove(ip: string, host: string | readonly string[]): void;
  removeHost(host: string | readonly string[]): void;
  /** Drop the changes that have not been handed to a write yet. */
  clearQueue(): void;
  /** Apply and clear the queued changes against a string. No file access. */
  modify(contents: string): string;
  /** Settles once every change made so far is on disk, or has failed. */
  updateFinish(): Promise<void>;
  updateFinish(callback: (err?: Error) => void): void;

  on(event: 'updateStart', listener: () => void): this;
  on(event: 'updateFinish', listener: (err?: Error) => void): this;
  once(event: 'updateStart', listener: () => void): this;
  once(event: 'updateFinish', listener: (err?: Error) => void): this;
  off(event: 'updateStart' | 'updateFinish', listener: (...args: any[]) => void): this;
  removeAllListeners(event?: 'updateStart' | 'updateFinish'): this;
  listenerCount(event: 'updateStart' | 'updateFinish'): number;

  /** @deprecated The Babel-era `require('hosts-so-easy').default`. */
  static readonly default: typeof Hosts;
  static readonly Hosts: typeof Hosts;
}

declare namespace Hosts {
  type EOL = '\n' | '\r\n';

  /** One line of the file that maps an address to hostnames, as written. */
  interface Entry {
    ip: string;
    hosts: string[];
  }

  interface ParseOptions {
    /** Line ending for new lines. Default: the first one in the file, else the platform's. */
    eol?: EOL;
  }

  interface WriteOptions {
    /**
     * Replace the file by renaming a temporary file over it (default), falling
     * back to overwriting it where that is not possible. `false` always
     * overwrites in place.
     */
    atomic?: boolean;
  }

  interface EditOptions extends ParseOptions, WriteOptions {
    /** Default: the platform's hosts file. */
    file?: string;
    /** How often to start over when the file changes meanwhile. Default: 3. */
    retries?: number;
  }

  interface AddOptions {
    /** Keep new lines in a block that starts with the comment `# <header>`. */
    header?: string;
  }

  /** A hosts file held in memory, formatting included. */
  class HostsDocument {
    constructor(text?: string, options?: ParseOptions);

    static parse(text: string, options?: ParseOptions): HostsDocument;
    /** Read a file. Default: the platform's hosts file. */
    static load(file?: string, options?: ParseOptions): Promise<HostsDocument>;
    /**
     * Load the file, apply `fn` (which may be async) and write the result,
     * starting over if the file changes meanwhile. Resolves `true` if the
     * file was written.
     */
    static edit(fn: (doc: HostsDocument) => unknown, options?: EditOptions): Promise<boolean>;

    /** The file this document was loaded from, if any. */
    readonly file: string | undefined;
    /** The line ending used for new lines. */
    readonly eol: EOL;

    /** The address lines of the file, in order. Returns copies. */
    entries(): Entry[];
    add(ip: string, hosts: string | readonly string[], options?: AddOptions): this;
    remove(ip: string, hosts: string | readonly string[]): this;
    /** Remove every line for an address. */
    removeIp(ip: string): this;
    /** Remove hostnames from every address. */
    removeHost(hosts: string | readonly string[]): this;
    toString(): string;
    /**
     * Write the document back to its file. Resolves `true` if the file was
     * written and `false` if it already had these contents. Rejects with
     * `HostsConflictError` if the file changed since it was loaded.
     */
    write(options?: WriteOptions): Promise<boolean>;
  }

  class HostsConflictError extends Error {
    constructor(file: string);
    readonly name: 'HostsConflictError';
    readonly code: 'ERR_HOSTS_CONFLICT';
    readonly file: string;
  }

  /** @deprecated Options of the queued `Hosts` API. */
  interface HostsOptions {
    atomicWrites?: boolean;
    /** Milliseconds to wait after the last change before writing. Default: 500. */
    debounceTime?: number;
    /** Longest a change may wait for a write. Default: 2000, or `debounceTime` if longer. */
    maxWait?: number;
    header?: string | false;
    hostsFile?: string;
    noWrites?: boolean;
    EOL?: EOL;
  }
}

export = Hosts;
