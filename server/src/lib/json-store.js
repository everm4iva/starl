/*
 * ☆ Whole-file JSON store
 * -> wraps a single small JSON file with safe read/write + an in-memory mirror so reads
 *    never hit disk after the first load. Used only for the tiny users.json and
 *    revoked_tokens.json. Port of storage.JsonStore
 */

import fs from 'node:fs';
import path from 'node:path';
import {atomicWriteJson} from './atomic-write.js';

export class JsonStore {
	constructor(filePath, defaultValue) {
		this.path = filePath;
		this.defaultValue = defaultValue;
		this._cache = null;
		fs.mkdirSync(path.dirname(filePath), {recursive: true});
		if (!fs.existsSync(filePath)) this.write(defaultValue);
	}

	read() {
		if (this._cache !== null) return structuredClone(this._cache);
		try {
			const content = fs.readFileSync(this.path, 'utf-8').trim();
			this._cache = content ? JSON.parse(content) : this.defaultValue;
		} catch {
			this._cache = this.defaultValue;
		}
		return structuredClone(this._cache);
	}

	write(value) {
		this._cache = value;
		atomicWriteJson(this.path, value);
	}
}
