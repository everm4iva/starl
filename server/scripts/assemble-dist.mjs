// ☆ Assemble
// -> puts the last pieces around the exe so dist/<platform>/ is a folder you can hand to
//    someone and it just works: the editable web/ site, and sharp's native binding (its own
//    tiny npm install, since copying node_modules by hand is exactly the kind of thing that
//    breaks the moment a dependency version shifts).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.platform;
const distDir = path.join(root, 'dist', platform);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const sharpVersion = pkg.dependencies.sharp;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log('[build] copying web/ ...');
copyDir(path.join(root, 'web'), path.join(distDir, 'web'));

console.log('[build] installing sharp for', platform, '...');
const nativeDir = path.join(distDir, 'native');
fs.mkdirSync(nativeDir, { recursive: true });
fs.writeFileSync(path.join(nativeDir, 'package.json'), JSON.stringify({
  name: 'starl-server-native',
  private: true,
  dependencies: { sharp: sharpVersion },
}, null, 2));
// npm on windows is a .cmd shim, and those refuse to spawn directly without a shell (EINVAL) -
// a single command string + shell:true sidesteps that without the args-array shell warning
execFileSync('npm install --omit=dev --no-audit --no-fund', { cwd: nativeDir, stdio: 'inherit', shell: true });

console.log('[build] dist ready ->', distDir);
