// ☆ SEA
// -> turns the bundled CJS file into an actual standalone exe: make a V8 snapshot blob,
//    copy the current Node binary, then inject the blob into that copy (postject). This has
//    to run on the OS you want the exe for - Node doesn't cross-build SEA binaries.
import { execFileSync } from 'node:child_process';
import { inject } from 'postject';
import { rcedit } from 'rcedit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const platform = process.platform; // win32 | darwin | linux
const distDir = path.join(root, 'dist', platform);
const exeName = platform === 'win32' ? 'starl-server.exe' : 'starl-server';
const exePath = path.join(distDir, exeName);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(distDir, { recursive: true });

// the recipe for the blob: what file to snapshot, where to put it
const seaConfigPath = path.join(buildDir, 'sea-config.json');
fs.writeFileSync(seaConfigPath, JSON.stringify({
  main: path.join('build', 'bundle.cjs'),
  output: path.join('build', 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
}, null, 2));

console.log('[build] generating SEA blob...');
execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { cwd: root, stdio: 'inherit' });

console.log('[build] copying node binary ->', exePath);
fs.copyFileSync(process.execPath, exePath);
fs.chmodSync(exePath, 0o755);

// windows/mac binaries carry a signature that has to come off before injecting, or the
// exe just refuses to run once its bytes no longer match what was signed
if (platform === 'darwin') {
  try { execFileSync('codesign', ['--remove-signature', exePath]); } catch { /* no signature, fine */ }
}
if (platform === 'win32') {
  try { execFileSync('signtool', ['remove', '/s', exePath]); } catch { /* signtool not installed, or nothing to remove */ }
}

// -> has to happen BEFORE the blob gets injected below, not after: rcedit is near instant on
//    a plain node.exe but basically hangs forever once postject's appended section is in
//    there (learned this one the hard way, sat there for ages thinking it was just "slow")
if (platform === 'win32') {
  console.log('[build] stamping exe metadata (icon, name, version)...');
  const iconPath = pkg.icon && path.join(root, pkg.icon);
  await rcedit(exePath, {
    'version-string': {
      CompanyName: pkg.company || '',
      ProductName: pkg.productName || pkg.name,
      FileDescription: pkg.description || '',
      LegalCopyright: pkg.license || '',
      // not a real recognized PE field, windows explorer wont show it in the properties
      // dialog, but its in there if anyone goes looking (or another tool reads it back out)
      URL: pkg.repository?.url || pkg.homepage || '',
    },
    'file-version': pkg.version,
    'product-version': pkg.version,
    ...(iconPath && fs.existsSync(iconPath) ? { icon: iconPath } : {}),
  });
}

console.log('[build] injecting blob into exe...');
const blob = fs.readFileSync(path.join(buildDir, 'sea-prep.blob'));
// the sentinel Node actually embeds varies by Node version/build (some ship the older
// dashed-UUID form, newer ones a plain hex id with a ":0"/":1" flag) - read whichever one
// is really in this copy of the binary instead of hardcoding a string that can go stale
// (spent an embarrassing amount of time thinking i broke this before finding that out lol)
const exeBytes = fs.readFileSync(exePath);
const fuseMatch = /NODE_SEA_FUSE_[a-z0-9-]+/.exec(exeBytes.toString('latin1'));
if (!fuseMatch) throw new Error('could not find a NODE_SEA_FUSE sentinel in the copied node binary');
const sentinelFuse = fuseMatch[0].replace(/:\d$/, '');

await inject(exePath, 'NODE_SEA_BLOB', blob, {
  sentinelFuse,
  machoSegmentName: platform === 'darwin' ? 'NODE_SEA' : undefined,
});

if (platform === 'darwin') {
  try { execFileSync('codesign', ['--sign', '-', exePath]); } catch { /* best effort, still runs unsigned locally */ }
}

console.log('[build] done ->', exePath);
