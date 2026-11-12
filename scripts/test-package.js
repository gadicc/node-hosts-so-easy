import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'hosts-so-easy-package-'));
// Works under `npm run` and when run directly with node.
const npm = (args, cwd) => execFileSync(...(process.env.npm_execpath
  ? [process.execPath, [process.env.npm_execpath, ...args]]
  : [process.platform === 'win32' ? 'npm.cmd' : 'npm', args]), {
  shell: !process.env.npm_execpath && process.platform === 'win32',
  cwd,
  encoding: 'utf8',
});
try {
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory]));
  const files = packed.files.map(file => file.path).sort();
  assert.deepEqual(files, [
    'CHANGELOG.md', 'LICENSE.txt', 'README.md', 'package.json', 'src/document.cjs', 'src/hosts.cjs',
    'src/index.cjs', 'src/index.d.cts', 'src/index.d.ts', 'src/index.js', 'src/write.cjs',
  ]);
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  // The package has no dependencies, so this needs no network.
  npm(['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund',
    path.join(directory, packed.filename)], directory);
  writeFileSync(path.join(directory, 'smoke.js'), `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import Hosts, { Hosts as Named, HostsDocument, HostsConflictError } from 'hosts-so-easy';
    const require = createRequire(import.meta.url);
    const cjs = require('hosts-so-easy');
    assert.equal(cjs, Hosts);
    assert.equal(cjs.default, Hosts);
    assert.equal(Named, Hosts);
    assert.equal(cjs.HostsDocument, HostsDocument);
    assert.equal(cjs.HostsConflictError, HostsConflictError);
    assert.equal(HostsDocument.parse('127.0.0.1 localhost\\n').add('127.0.0.2', 'example').toString(),
      '127.0.0.1 localhost\\n127.0.0.2 example\\n');
    const hosts = new Hosts({ noWrites: true, EOL: '\\n' });
    hosts.add('127.0.0.2', 'example');
    assert.equal(hosts.modify('127.0.0.1 localhost'), '127.0.0.1 localhost\\n127.0.0.2 example');
  `);
  execFileSync(process.execPath, ['smoke.js'], { cwd: directory, stdio: 'inherit' });
  console.log(`Packed and installed ${packed.filename}; ESM and CommonJS smoke tests passed.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
