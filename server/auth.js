import crypto from 'node:crypto';

const COOKIE = 'hub_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function secret() {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || 'dev-secret';
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

export function isAuthed(req) {
  if (!process.env.APP_PASSWORD) return true; // no password set: open (local dev only)
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const [exp, sig] = token.split('.');
  return !!sig && Number(exp) > Date.now() && safeEqual(sig, sign(exp));
}

export function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not signed in' });
}

const attempts = new Map(); // ip -> { count, resetAt }

export function login(req, res) {
  const ip = req.ip;
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && rec.resetAt > now && rec.count >= 10) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  const ok = process.env.APP_PASSWORD && safeEqual(req.body?.password ?? '', process.env.APP_PASSWORD);
  if (!ok) {
    const next = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + 15 * 60 * 1000 };
    next.count += 1;
    attempts.set(ip, next);
    return res.status(401).json({ error: 'Wrong password' });
  }
  attempts.delete(ip);
  const exp = String(now + MAX_AGE_MS);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${exp}.${sign(exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_MS / 1000}${secure}`,
  );
  res.json({ ok: true });
}

export function logout(_req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
}
