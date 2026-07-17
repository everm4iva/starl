/*
 * ☆ Account settings

 * -> the user-editable display name + profile picture, one small sidecar per user
 *    (data/account_settings/<id>.json) plus an image (data/profile_pictures/<id>.jpg).
 *
 * -> appearance (colors/font/transitions) also lives here; account-state.js calls the
 *    appearance helpers so the client's existing /account/state API doesn't change.
 *
 * -> port of account_settings.py (multer + sharp replace UploadFile + Pillow).
 */

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { requireUser, requireUserOrToken } from '../auth/middleware.js';
import { RecordStore } from '../lib/record-store.js';
import { ACCOUNT_SETTINGS_DIR, PROFILE_PICTURE_DIR } from '../config.js';
import { requireNative } from '../lib/native-require.js';

const sharp = requireNative('sharp');
import { httpError } from '../lib/http-error.js';

export const accountSettingsRouter = Router();

const settingsRecords = new RecordStore(ACCOUNT_SETTINGS_DIR);

const NAME_MAX_LENGTH = 25;
const NAME_PATTERN = /^[A-Za-z0-9 .*@|]+$/;
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;
const MAX_PICTURE_DIMENSION = 1500;
const DEFAULT_SETTINGS = { name: '', has_picture: false, updated_at: null };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PICTURE_BYTES } });

const nowIso = () => new Date().toISOString();
const picturePath = (userId) => path.join(PROFILE_PICTURE_DIR, `${userId}.jpg`);

function userId(req) {
  const id = String(req.user?.sub || '').trim();
  if (!id) throw httpError(401, 'Invalid user payload');
  return id;
}

function validateName(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned || cleaned.length > NAME_MAX_LENGTH || !NAME_PATTERN.test(cleaned)) {
    throw httpError(400, "Name must be 1-25 characters using letters, numbers, spaces, '.', '*', '@' or '|'");
  }
  return cleaned;
}

function readSettings(uid) {
  let record = settingsRecords.get(uid);
  if (record === null) {
    record = { ...DEFAULT_SETTINGS, updated_at: nowIso() };
    settingsRecords.put(uid, record);
  }
  return record;
}

function settingsResponse(uid, record) {
  return {
    name: record.name || '',
    picture_url: record.has_picture ? `/account/settings/picture/${uid}` : null,
    updated_at: record.updated_at,
  };
}

// --- appearance (used by account-state.js) ---

export function getAppearance(uid) {
  const record = settingsRecords.get(uid);
  const appearance = record && typeof record === 'object' ? record.appearance : null;
  return appearance && typeof appearance === 'object' ? appearance : null;
}

export function setAppearance(uid, appearance) {
  const record = readSettings(uid);
  record.appearance = appearance;
  record.updated_at = nowIso();
  settingsRecords.put(uid, record);
}

// --- routes ---

accountSettingsRouter.get('/account/settings', requireUser, (req, res) => {
  const uid = userId(req);
  res.json(settingsResponse(uid, readSettings(uid)));
});

accountSettingsRouter.put('/account/settings', requireUser, (req, res) => {
  const uid = userId(req);
  const name = validateName(req.body?.name);
  const record = readSettings(uid);
  record.name = name;
  record.updated_at = nowIso();
  settingsRecords.put(uid, record);
  res.json(settingsResponse(uid, record));
});

accountSettingsRouter.post('/account/settings/picture', requireUser, upload.single('file'), async (req, res, next) => {
  try {
    const uid = userId(req);
    if (!req.file || !req.file.buffer) throw httpError(400, 'File is required');
    const raw = req.file.buffer;
    if (raw.length > MAX_PICTURE_BYTES) throw httpError(400, 'Picture must be under 2MB');

    let meta;
    try { meta = await sharp(raw).metadata(); } catch { throw httpError(400, 'File is not a valid image'); }
    if (!meta.width || !meta.height) throw httpError(400, 'File is not a valid image');
    if (meta.width !== meta.height) throw httpError(400, 'Picture must have a 1:1 aspect ratio');
    if (meta.width > MAX_PICTURE_DIMENSION) {
      throw httpError(400, `Picture must be at most ${MAX_PICTURE_DIMENSION}x${MAX_PICTURE_DIMENSION}`);
    }

    fs.mkdirSync(PROFILE_PICTURE_DIR, { recursive: true });
    await sharp(raw).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(picturePath(uid));

    const record = readSettings(uid);
    record.has_picture = true;
    record.updated_at = nowIso();
    settingsRecords.put(uid, record);
    res.json(settingsResponse(uid, record));
  } catch (err) {
    next(err);
  }
});

accountSettingsRouter.get('/account/settings/picture/:user_id', requireUserOrToken, (req, res) => {
  const p = picturePath(req.params.user_id);
  if (!fs.existsSync(p)) throw httpError(404, 'No picture set');
  res.sendFile(p, { headers: { 'Content-Type': 'image/jpeg' } });
});

// multer "file too large" -> aka: da old 2MB message
accountSettingsRouter.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ detail: 'Picture must be under 2MB' });
  next(err);
});
