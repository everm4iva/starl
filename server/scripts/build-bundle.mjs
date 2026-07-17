// ☆ Bundle
// -> squashes src/index.js and everything it imports (except sharp, a native addon that
//    can't live inside a SEA blob) into one CJS file the SEA step can snapshot.
// -> the banner sets STARL_PACKAGED before a single line of app code runs, so config-file.js
//    (BASE_DIR), worker-process.js (worker binary vs python) and native-require.js (sharp)
//    all see "packaged" from their very first import.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

await build({
  entryPoints: [path.join(root, 'src', 'index.js')],
  outfile: path.join(root, 'build', 'bundle.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['sharp'],
  define: { __SERVER_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "process.env.STARL_PACKAGED = '1';" },
  logLevel: 'info',
});
