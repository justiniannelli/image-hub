import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal .env loader (no dependency). Reads image-hub/.env wherever the app is started from.
// Real environment variables win.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  /* no .env file */
}

// Imported after .env is loaded so DATA_DIR etc. are picked up.
const { default: express } = await import('express');
const { db, IMG_DIR, MEDIUMS, guessMedium, saveDataUrl, saveBuffer, readImage, removeImage, imageInUse } = await import(
  './db.js'
);
const { generateImage, assist, improvePrompt, config } = await import('./providers.js');
const { requireAuth, login, logout, isAuthed } = await import('./auth.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '60mb' }));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message || 'Server error' });
  });

// ---------- auth ----------
app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/me', (req, res) => res.json({ authed: isAuthed(req), passwordRequired: !!process.env.APP_PASSWORD }));

app.use('/api', requireAuth);
app.get('/files/:name', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.join(IMG_DIR, path.basename(req.params.name)), (err) => err && res.status(404).end());
});

app.get('/api/config', (_req, res) => res.json({ ...config(), mediums: MEDIUMS }));

// ---------- project folders ----------
const projectQuery = `
  SELECT p.*,
    (SELECT COUNT(*) FROM generations g WHERE g.project_id = p.id) AS count,
    (SELECT output FROM generations g WHERE g.project_id = p.id ORDER BY g.id DESC LIMIT 1) AS cover
  FROM projects p`;

app.get('/api/projects', (_req, res) => {
  res.json(db.prepare(`${projectQuery} ORDER BY p.name COLLATE NOCASE`).all());
});

app.post('/api/projects', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name);
  res.json(db.prepare(`${projectQuery} WHERE p.id = ?`).get(info.lastInsertRowid));
});

app.patch('/api/projects/:id', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json(db.prepare(`${projectQuery} WHERE p.id = ?`).get(req.params.id));
});

// Deleting a project folder keeps its images; they just move out of the folder.
app.delete('/api/projects/:id', (req, res) => {
  db.prepare('UPDATE generations SET project_id = NULL WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- style folders ----------
function styleWithImages(s) {
  return {
    ...s,
    images: db.prepare('SELECT file FROM style_images WHERE style_id = ? ORDER BY id').all(s.id).map((r) => r.file),
  };
}

app.get('/api/styles', (_req, res) => {
  res.json(db.prepare('SELECT * FROM styles ORDER BY name COLLATE NOCASE').all().map(styleWithImages));
});

app.post('/api/styles', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!/^[\w-]+$/.test(name)) return res.status(400).json({ error: 'Style names can use letters, numbers, - and _ only' });
  if (db.prepare('SELECT 1 FROM styles WHERE name = ?').get(name)) {
    return res.status(409).json({ error: 'A style with that name exists' });
  }
  const files = (req.body.images || []).slice(0, 12).map(saveDataUrl);
  const info = db.prepare('INSERT INTO styles (name, description) VALUES (?, ?)').run(name, String(req.body.description || ''));
  const ins = db.prepare('INSERT INTO style_images (style_id, file) VALUES (?, ?)');
  files.forEach((f) => ins.run(info.lastInsertRowid, f));
  res.json(styleWithImages(db.prepare('SELECT * FROM styles WHERE id = ?').get(info.lastInsertRowid)));
});

// Update description, add images (data URLs) and/or remove images (file names).
app.patch('/api/styles/:id', (req, res) => {
  const style = db.prepare('SELECT * FROM styles WHERE id = ?').get(req.params.id);
  if (!style) return res.status(404).json({ error: 'Not found' });
  const { description, addImages = [], removeImages = [] } = req.body || {};
  if (typeof description === 'string') db.prepare('UPDATE styles SET description = ? WHERE id = ?').run(description, style.id);
  for (const f of removeImages) {
    db.prepare('DELETE FROM style_images WHERE style_id = ? AND file = ?').run(style.id, f);
    if (!imageInUse(f)) removeImage(f);
  }
  const have = db.prepare('SELECT COUNT(*) AS n FROM style_images WHERE style_id = ?').get(style.id).n;
  const ins = db.prepare('INSERT INTO style_images (style_id, file) VALUES (?, ?)');
  addImages.slice(0, Math.max(0, 12 - have)).map(saveDataUrl).forEach((f) => ins.run(style.id, f));
  res.json(styleWithImages(db.prepare('SELECT * FROM styles WHERE id = ?').get(style.id)));
});

app.delete('/api/styles/:id', (req, res) => {
  const files = db.prepare('SELECT file FROM style_images WHERE style_id = ?').all(req.params.id).map((r) => r.file);
  db.prepare('DELETE FROM styles WHERE id = ?').run(req.params.id);
  files.forEach((f) => !imageInUse(f) && removeImage(f));
  res.json({ ok: true });
});

// ---------- images ----------
function hydrate(g) {
  return { ...g, styles: JSON.parse(g.styles), refs: JSON.parse(g.refs), favorite: !!g.favorite, improved: !!g.improved };
}

const genSelect = `SELECT g.*, p.name AS project_name FROM generations g LEFT JOIN projects p ON p.id = g.project_id`;

// Filters: q (search), project, fav=1, medium, sort=new|old
app.get('/api/generations', (req, res) => {
  const where = [];
  const params = [];
  const { q, project, fav, medium, sort } = req.query;
  if (project) {
    where.push('g.project_id = ?');
    params.push(project);
  }
  if (fav === '1') where.push('g.favorite = 1');
  if (medium) {
    where.push('g.medium = ?');
    params.push(medium);
  }
  if (q) {
    where.push('(g.prompt LIKE ? OR g.full_prompt LIKE ? OR g.styles LIKE ? OR p.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const order = sort === 'old' ? 'g.id ASC' : 'g.id DESC';
  const rows = db
    .prepare(`${genSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`)
    .all(...params);
  // Count of images per medium, for the filter menu.
  const counts = Object.fromEntries(
    db.prepare('SELECT medium, COUNT(*) AS n FROM generations GROUP BY medium').all().map((r) => [r.medium, r.n]),
  );
  res.json({ items: rows.map(hydrate), mediumCounts: counts });
});

app.get('/api/generations/:id', (req, res) => {
  const g = db.prepare(`${genSelect} WHERE g.id = ?`).get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  const versions = db.prepare('SELECT * FROM generations WHERE thread_id = ? ORDER BY id').all(g.thread_id);
  res.json({ generation: hydrate(g), versions: versions.map(hydrate) });
});

// Toggle favorite, change medium, or move to another project folder.
app.patch('/api/generations/:id', (req, res) => {
  const { favorite, medium, projectId } = req.body || {};
  if (typeof favorite === 'boolean') db.prepare('UPDATE generations SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, req.params.id);
  if (MEDIUMS.includes(medium)) db.prepare('UPDATE generations SET medium = ? WHERE id = ?').run(medium, req.params.id);
  if (projectId !== undefined) {
    db.prepare('UPDATE generations SET project_id = ? WHERE id = ?').run(projectId || null, req.params.id);
  }
  const g = db.prepare(`${genSelect} WHERE g.id = ?`).get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  res.json(hydrate(g));
});

app.delete('/api/generations/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM generations WHERE id = ?').get(req.params.id);
  if (!g) return res.json({ ok: true });
  db.prepare('DELETE FROM generations WHERE id = ?').run(g.id);
  // If this was the first version, the next one becomes the start of the version list.
  const next = db.prepare('SELECT id FROM generations WHERE thread_id = ? ORDER BY id LIMIT 1').get(g.thread_id);
  if (next && g.thread_id === g.id) {
    db.prepare('UPDATE generations SET thread_id = ? WHERE thread_id = ?').run(next.id, g.id);
  }
  for (const f of [g.output, ...JSON.parse(g.refs)]) if (!imageInUse(f)) removeImage(f);
  res.json({ ok: true, nextId: next?.id ?? null });
});

app.post(
  '/api/generate',
  wrap(async (req, res) => {
    const { provider, aspect = 'auto', parentId = null, remix = false, autoImprove = false } = req.body || {};
    const projectId = req.body?.projectId || null;
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Write a prompt first' });
    if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) {
      return res.status(400).json({ error: 'That project folder no longer exists' });
    }
    const cfg = config();
    if (!cfg[provider]?.enabled) return res.status(400).json({ error: `${provider} is not set up on the server` });

    // @style mentions
    const names = [...new Set([...prompt.matchAll(/@([\w-]+)/g)].map((m) => m[1].toLowerCase()))];
    const styles = names
      .map((n) => db.prepare('SELECT * FROM styles WHERE name = ?').get(n))
      .filter(Boolean)
      .map(styleWithImages);
    const known = new Set(styles.map((s) => s.name.toLowerCase()));
    let used = prompt.replace(/@([\w-]+)/g, (m, n) => (known.has(n.toLowerCase()) ? `${n} style` : m));

    // reference files, in order: previous version (remix) or its references (edit prompt), your uploads, style images
    const parent = parentId ? db.prepare('SELECT * FROM generations WHERE id = ?').get(parentId) : null;
    const refFiles = [];
    if (remix && parent) refFiles.push(parent.output);
    if (!remix && parent) {
      // Edit prompt: start again from the same references the earlier version used (e.g. your base model image),
      // minus its style images, which come back only if the new prompt still mentions that style.
      const parentStyleFiles = new Set(
        JSON.parse(parent.styles).flatMap((n) => {
          const s = db.prepare('SELECT * FROM styles WHERE name = ?').get(n);
          return s ? styleWithImages(s).images : [];
        }),
      );
      refFiles.push(...JSON.parse(parent.refs).filter((f) => !parentStyleFiles.has(f)));
    }
    const uploaded = (req.body.refImages || []).slice(0, 6).map(saveDataUrl);
    refFiles.push(...uploaded);
    const styleFiles = styles.flatMap((s) => s.images.slice(0, 3));
    refFiles.push(...styleFiles);
    const allRefs = [...new Set(refFiles)].slice(0, 12);

    if (autoImprove) used = await improvePrompt(used);
    if (styles.length) {
      used +=
        '\n\nStyle guidance:\n' +
        styles.map((s) => `- ${s.name}: ${s.description || 'match the style reference images'}`).join('\n');
    }
    if (remix && parent) used = 'Edit the first reference image as follows. ' + used;
    if (styleFiles.length) used += '\nThe style reference images show the look to match, not the subject.';

    let out;
    try {
      out = await generateImage(provider, { prompt: used, aspect, refs: allRefs.map(readImage) });
    } catch (e) {
      uploaded.forEach((f) => !imageInUse(f) && removeImage(f));
      throw e;
    }
    const output = saveBuffer(out.buffer, out.mime);
    const medium = guessMedium(`${prompt} ${styles.map((s) => `${s.name} ${s.description}`).join(' ')}`);
    // New versions stay in the same folder as the version they came from.
    const folder = parent ? parent.project_id : projectId;

    const info = db
      .prepare(
        `INSERT INTO generations
          (project_id, thread_id, parent_id, provider, model, prompt, full_prompt, styles, refs, output, aspect, medium, improved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        folder,
        parent ? parent.thread_id : null,
        parent ? parent.id : null,
        provider,
        out.model,
        prompt,
        used,
        JSON.stringify(styles.map((s) => s.name)),
        JSON.stringify(allRefs),
        output,
        aspect,
        medium,
        autoImprove ? 1 : 0,
      );
    if (!parent) db.prepare('UPDATE generations SET thread_id = id WHERE id = ?').run(info.lastInsertRowid);
    res.json(hydrate(db.prepare(`${genSelect} WHERE g.id = ?`).get(info.lastInsertRowid)));
  }),
);

// ---------- prompt assistant ----------
app.post(
  '/api/assist',
  wrap(async (req, res) => {
    const messages = (req.body?.messages || []).slice(-20);
    const styleNotes = db
      .prepare('SELECT name, description FROM styles')
      .all()
      .map((s) => `@${s.name}: ${s.description}`)
      .join('\n');
    res.json({ reply: await assist(messages, styleNotes) });
  }),
);

// ---------- static front end ----------
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = process.env.PORT || 3000;
// Only this computer can open it, unless HOST is set (the Dockerfile sets 0.0.0.0 for hosting).
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`Image Hub on http://localhost:${port}`);
  if (!process.env.APP_PASSWORD) console.warn('Note: APP_PASSWORD is not set, so there is no login screen.');
  // Report which keys were found, never their values.
  for (const k of ['GEMINI_API_KEY', 'OPENAI_API_KEY']) {
    const v = process.env[k];
    console.log(`${k}: ${v ? `found (${v.length} characters)` : v === '' ? 'empty' : 'not set'}`);
  }
});
