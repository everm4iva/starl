/*
 * ☆ Worker supervisor
* like those guys in da work
 * -> optionally spawns the Python resolver worker (SPAWN_WORKER=1) and restarts it if it
 *    dies, so the brain and worker come up together. With SPAWN_WORKER=0 you manage the
 *    worker yourself (e.g. its own service) and this only health-checks it.
 */

import {spawn} from 'node:child_process';
import path from 'node:path';
import {BASE_DIR, SPAWN_WORKER} from '../config.js';
import {worker} from './worker-client.js';

let child = null;
let stopping = false;

// packaged builds ship a PyInstaller-frozen worker exe (no python required on the machine);
// dev just shells out to the real interpreter against the source script
function workerCommand() {
	if (process.env.STARL_PACKAGED === '1') {
		const bin = process.platform === 'win32' ? 'starl-worker.exe' : 'starl-worker';
		return {cmd: path.join(path.dirname(process.execPath), 'worker', bin), args: []};
	}
	const py = process.env.PYTHON || 'python';
	return {cmd: py, args: [path.join(BASE_DIR, 'worker', 'worker.py')]};
}

function launch() {
	if (stopping) return;
	const {cmd, args} = workerCommand();
	child = spawn(cmd, args, {cwd: BASE_DIR, stdio: ['ignore', 'inherit', 'inherit']});
	child.on('exit', (code, signal) => {
		child = null;
		if (stopping) return;
		console.error(`[starl] worker exited (code=${code} signal=${signal}); restarting in 2s`);
		setTimeout(launch, 2000);
	});
}

async function waitHealthy(attempts = 30, gapMs = 500) {
	for (let i = 0; i < attempts; i++) {
		try {
			await worker.health();
			return true;
		} catch {
			await new Promise((r) => setTimeout(r, gapMs));
		}
	}
	return false;
}

export async function startWorker() {
	if (SPAWN_WORKER) launch();
	const healthy = await waitHealthy();
	if (healthy) {
		console.log('[starl] resolver worker is healthy');
	} else {
		console.warn('[starl] resolver worker not reachable yet — search/playback will 502 until it is up');
	}
	return healthy;
}

export function stopWorker() {
	stopping = true;
	if (child) {
		try {
			child.kill();
		} catch {
			/* fucking ignore it */
		}
		child = null;
	}
}
