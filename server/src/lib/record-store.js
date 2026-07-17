/*
 * ☆ Per-record JSON store
 * -> each record (a track, an image, a user's state) is its own small <id>.json
 *    sidecar file.
 *    Writing one record rewrites only that tiny file, never a giant
 *    index. An in-memory index rebuilt from the sidecars keeps lookups "O(1)".
 *
 * -> open any <id>.json by hand to read exactly that record. The directory IS the
 *    database, and it's human-readable. Port of record_store.RecordStore.
 *
 * note about nodejs: this runs in a single-threaded event loop, so the in-memory index and a
 * synchronous sidecar write are consistent without a mutex - there is no await between
 * the memory update and the disk write. Cross-process safety (multiple node workers)
 * still comes from the disk-fallback-on-miss read, exactly like the Python version.
 */

import fs from 'node:fs';
import path from 'node:path';
import {atomicWriteJson, safeUnlink} from './atomic-write.js';

// a record is always a plain object, anything else (a list, a number, half a file) isnt one,
// so we just say "nothing here" rather than letting it into the index
function readRecord(filePath) {
	try {
		const meta = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
		return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
	} catch {
		return null; // missing, unreadable, or a half-written sidecar
	}
}

function sidecarNames(directory) {
	try {
		return fs.readdirSync(directory).filter((name) => name.endsWith('.json'));
	} catch {
		return [];
	}
}

export class RecordStore {
	constructor(directory, secondaryIndexes = {}) {
		this.directory = directory;
		this._secondaryDefs = secondaryIndexes;
		this._records = new Map();
		this._secondary = {}; // name -> map(key -> set(recordId))
		for (const name of Object.keys(secondaryIndexes)) this._secondary[name] = new Map();
		this._loaded = false;
	}

	_sidecarPath(recordId) {
		return path.join(this.directory, `${recordId}.json`);
	}

	// every [index, key] this record files under. a keyFn that throws or comes back empty just
	// means "not in this one", so one odd record can never break the whole store
	*_indexKeys(meta) {
		for (const [name, keyFn] of Object.entries(this._secondaryDefs)) {
			let key = null;
			try {
				key = keyFn(meta);
			} catch {
				key = null;
			}
			if (key) yield [name, key];
		}
	}

	_index(recordId, meta) {
		for (const [name, key] of this._indexKeys(meta)) {
			const byKey = this._secondary[name];
			if (!byKey.has(key)) byKey.set(key, new Set());
			byKey.get(key).add(recordId);
		}
	}

	_deindex(recordId, meta) {
		for (const [name, key] of this._indexKeys(meta)) {
			const ids = this._secondary[name].get(key);
			if (!ids) continue;
			ids.delete(recordId);
			if (ids.size === 0) this._secondary[name].delete(key); // dont keep empty sets around
		}
	}

	// park a record in memory and file it under all its indexes, the two always go together
	_remember(recordId, meta) {
		this._records.set(recordId, meta);
		this._index(recordId, meta);
	}

	// first touch reads the whole directory back into memory, after that its all in-memory
	ensureLoaded() {
		if (this._loaded) return;
		fs.mkdirSync(this.directory, {recursive: true});
		for (const name of sidecarNames(this.directory)) {
			const meta = readRecord(path.join(this.directory, name));
			if (meta) this._remember(name.slice(0, -'.json'.length), meta);
		}
		this._loaded = true;
	}

	get(recordId) {
		this.ensureLoaded();
		let meta = this._records.get(recordId);
		if (!meta) {
			// not in memory, but another process may have just written it, so peek at the disk
			meta = readRecord(this._sidecarPath(recordId));
			if (!meta) return null;
			this._remember(recordId, meta);
		}
		return structuredClone(meta); // a copy, so a caller cant mutate whats in the index
	}

	findIdsBy(indexName, key) {
		if (!key) return [];
		this.ensureLoaded();
		const ids = this._secondary[indexName]?.get(key);
		return ids ? [...ids] : [];
	}

	has(recordId) {
		this.ensureLoaded();
		return this._records.has(recordId);
	}

	put(recordId, meta) {
		this.ensureLoaded();
		const stored = structuredClone(meta);
		const old = this._records.get(recordId);
		if (old) this._deindex(recordId, old); // the old keys may not be the new ones
		this._remember(recordId, stored);
		fs.mkdirSync(this.directory, {recursive: true});
		atomicWriteJson(this._sidecarPath(recordId), stored);
	}

	putIfAbsent(recordId, meta) {
		this.ensureLoaded();
		if (this._records.has(recordId) || fs.existsSync(this._sidecarPath(recordId))) return false;
		this.put(recordId, meta);
		return true;
	}

	delete(recordId) {
		this.ensureLoaded();
		const old = this._records.get(recordId);
		if (old) this._deindex(recordId, old);
		this._records.delete(recordId);
		safeUnlink(this._sidecarPath(recordId)); // already gone is totally fine
	}
}
