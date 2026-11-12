import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'hosts-so-easy-package-'));
const npm = (args, cwd) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd,
  encoding: 'utf8',
});
try {
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory]));
  const files = packed.files.map(file => file.path).sort();
  assert.deepEqual(files, [
    'CHANGELOG.md', 'LICENSE.txt', 'README.md', 'package.json', 'src/index.cjs', 'src/index.js',
  ]);
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund',
    path.join(directory, packed.filename)], directory);
  writeFileSync(path.join(directory, 'smoke.js'), `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import Hosts from 'hosts-so-easy';
    const require = createRequire(import.meta.url);
    assert.equal(require('hosts-so-easy'), Hosts);
    assert.equal(require('hosts-so-easy').default, Hosts);
    const hosts = new Hosts({ noWrites: true, EOL: '\\n' });
    hosts.add('127.0.0.2', 'example');
    assert.equal(hosts.modify('127.0.0.1 localhost'), '127.0.0.1 localhost\\n127.0.0.2 example');
  `);
  execFileSync(process.execPath, ['smoke.js'], { cwd: directory, stdio: 'inherit' });
  console.log(`Packed and installed ${packed.filename}; ESM and CommonJS smoke tests passed.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
