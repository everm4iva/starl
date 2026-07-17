/*
 * ☆ Desktop shortcut
 * -> drops a little shortcut on your desktop so you can start the server without digging
 *    for the exe every time, just double click and youre off
 * -> its best effort on purpose, if it cant make one it just shrugs and logs, never crashes
 * -> we only do this for a real packaged build, in dev theres no exe to point at, so we skip
 *    (also keeps dev runs from spamming your desktop with junk shortcuts, you know...)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { BASE_DIR, SERVER_NAME } from '../config.js';

// is the actual bundled exe, or just plain node running the source
function isPackaged() {
  return Boolean(process.pkg) || process.env.STARL_PACKAGED === '1';
}

// the desktop folder, close enough across the big three, staying simple, i sometimes overthink it.
function desktopDir() {
  return path.join(os.homedir(), 'Desktop');
}

// windows likes a real .lnk, easiest way is to ask the built-in scripting host to make it - thanks claude for this :3
function makeWindowsShortcut(target, linkPath, workingDir) {
  const ps = [
    '$w = New-Object -ComObject WScript.Shell;',
    `$s = $w.CreateShortcut(${JSON.stringify(linkPath)});`,
    `$s.TargetPath = ${JSON.stringify(target)};`,
    `$s.WorkingDirectory = ${JSON.stringify(workingDir)};`,
    '$s.Save();',
  ].join(' ');
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
}

// linux (unix power!!!!) wants a .desktop entry, its just a tiny ini file describing the app.
// Terminal=true so you actually get to watch the server talk, otherwise it starts invisibly
function makeLinuxShortcut(target, linkPath, workingDir) {
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${SERVER_NAME}`,
    'Comment=Start the Starl audio server',
    `Exec="${target}"`,
    `Path=${workingDir}`,
    'Terminal=true',
    '',
  ].join('\n');
  fs.writeFileSync(linkPath, entry, 'utf-8');
  // it has to be executable or the desktop just shrugs and shows it as a text file
  fs.chmodSync(linkPath, 0o755);
}

// mac has no .desktop thing, but a symlink to the binary double-clicks open in Terminal,
// which is close enough and needs nothing extra installed
function makeMacShortcut(target, linkPath) {
  fs.symlinkSync(target, linkPath);
}

// where the shortcut goes + how to make it, per os. keeps ensureShortcut tiny and flat
function shortcutPlan(dir) {
  if (process.platform === 'win32') {
    return {
      linkPath: path.join(dir, `${SERVER_NAME}.lnk`),
      make: (target, linkPath) => makeWindowsShortcut(target, linkPath, BASE_DIR),
    };
  }
  if (process.platform === 'darwin') {
    return {linkPath: path.join(dir, SERVER_NAME), make: makeMacShortcut};
  }
  return {
    linkPath: path.join(dir, `${SERVER_NAME}.desktop`),
    make: (target, linkPath) => makeLinuxShortcut(target, linkPath, BASE_DIR),
  };
}

// the one thing bootstrap calls, wraps it all so a failure here never takes the boot down
export function ensureShortcut() {
  if (!isPackaged()) {
    console.log('[starl] dev run, so no desktop shortcut (only packaged builds get one)');
    return;
  }
  try {
    const dir = desktopDir();
    if (!fs.existsSync(dir)) return;

    const {linkPath, make} = shortcutPlan(dir);
    // lstat not exists: a symlink pointing at a moved exe is broken but still "there",
    // and existsSync follows the link and says no, so wed make it over and over
    if (fs.lstatSync(linkPath, {throwIfNoEntry: false})) return;

    make(process.execPath, linkPath);
    console.log(`[starl] made a desktop shortcut -> ${linkPath}`);
  } catch (err) {
    console.log('[starl] couldnt make a desktop shortcut, no biggie:', err.message);
  }
}
