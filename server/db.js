import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Relative DATA_DIR values are relative to the image-hub folder, not wherever the app was started.
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
export const IMG_DIR = path.join(DATA_DIR, 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });

// Node's built-in SQLite (no native add-on to compile).
export const db = new DatabaseSync(path.join(DATA_DIR, 'hub.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS style_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  style_id INTEGER NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  file TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  thread_id INTEGER,
  parent_id INTEGER,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  full_prompt TEXT NOT NULL,
  styles TEXT NOT NULL DEFAULT '[]',
  refs TEXT NOT NULL DEFAULT '[]',
  output TEXT NOT NULL,
  aspect TEXT NOT NULL DEFAULT 'auto',
  medium TEXT NOT NULL DEFAULT 'Other',
  favorite INTEGER NOT NULL DEFAULT 0,
  improved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gen_project ON generations(project_id);
CREATE INDEX IF NOT EXISTS idx_gen_thread ON generations(thread_id);
`);

export const MEDIUMS = [
  'Photoreal',
  '3D render',
  'Illustration',
  'Diagram',
  'Line drawing',
  'Watercolor',
  'Pencil sketch',
  'Ink drawing',
  'Collage',
  'Other',
];

// Best guess at an image's medium from its prompt, checked most-specific first.
// It can be changed by hand in the viewer.
const MEDIUM_WORDS = [
  ['Watercolor', /watercolou?r/],
  ['Pencil sketch', /pencil|graphite|sketch/],
  ['Ink drawing', /\bink\b|pen and ink/],
  ['Collage', /collage/],
  ['Line drawing', /line ?drawing|linework|line art|outline/],
  ['Diagram', /diagram|axon|axonometric|exploded|plan view|section|isometric/],
  ['Illustration', /illustrat|vector|flat colou?r|cartoon|graphic|poster|letterpress/],
  ['3D render', /\b3d\b|render|enscape|lumion|v-?ray|white ?(box|model)/],
  ['Photoreal', /photo|realistic|photograph|camera|lens/],
];

export function guessMedium(text) {
  const t = String(text || '').toLowerCase();
  return (MEDIUM_WORDS.find(([, re]) => re.test(t)) || ['Other'])[0];
}

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

export function saveBuffer(buffer, mime) {
  const ext = EXT[mime] || '.png';
  const name = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(IMG_DIR, name), buffer);
  return name;
}

export function saveDataUrl(dataUrl) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Invalid image data');
  return saveBuffer(Buffer.from(m[2], 'base64'), m[1]);
}

export function readImage(name) {
  const file = path.join(IMG_DIR, path.basename(name));
  const ext = path.extname(file).toLowerCase();
  const mime = Object.keys(EXT).find((k) => EXT[k] === ext) || 'image/png';
  return { mime, data: fs.readFileSync(file) };
}

export function removeImage(name) {
  try {
    fs.unlinkSync(path.join(IMG_DIR, path.basename(name)));
  } catch {
    /* already gone */
  }
}

// True if a file name is still used by any generation (as output or reference) or any style.
export function imageInUse(name) {
  const like = `%"${name}"%`;
  return !!(
    db.prepare('SELECT 1 FROM generations WHERE output = ? OR refs LIKE ? LIMIT 1').get(name, like) ||
    db.prepare('SELECT 1 FROM style_images WHERE file = ? LIMIT 1').get(name)
  );
}
