// ☆ Worker freeze
// -> bundles the python resolver worker into one exe with PyInstaller, so an operator never
//    needs python installed at all. Has to run on the target OS - PyInstaller doesn't cross-build.
// -> needs `pip install -r worker/requirements.txt pyinstaller` first (see package.json scripts).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.platform;
const distWorkerDir = path.join(root, 'dist', platform, 'worker');
const workDir = path.join(root, 'build', 'worker');
const specDir = path.join(root, 'build');
const python = process.env.PYTHON || (platform === 'win32' ? 'python' : 'python3');

console.log('[build] freezing worker with pyinstaller...');
execFileSync(python, [
  '-m', 'PyInstaller',
  '--onefile',
  '--name', 'starl-worker',
  '--distpath', distWorkerDir,
  '--workpath', workDir,
  '--specpath', specDir,
  '--noconfirm',
  path.join(root, 'worker', 'worker.py'),
], { cwd: root, stdio: 'inherit' });

console.log('[build] worker exe ->', distWorkerDir);
