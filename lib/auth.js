// Email/password accounts with server-side sessions in SQLite.
const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const COOKIE = 'pc_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === check.length && crypto.timingSafeEqual(expected, check);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

async function createSession(db, res, userId, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3);
  await db.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, userId, expires]);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`
  );
}

async function destroySession(db, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Express middleware: sets req.user (or null).
function loadUser(db) {
  return async (req, _res, next) => {
    const token = readCookie(req, COOKIE);
    req.user = null;
    if (token) {
      const [user] = await db.query(
        `SELECT u.id, u.email, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = $1 AND s.expires_at > now()`,
        [token]
      );
      req.user = user || null;
    }
    next();
  };
}

const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in.' }));
const requireAdmin = (req, res, next) =>
  req.user && req.user.is_admin ? next() : res.status(req.user ? 403 : 401).json({ error: 'Admins only.' });

async function ensureAdmin(db, email, password) {
  if (!email || !password) return;
  email = email.trim().toLowerCase();
  const [existing] = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) await db.query('UPDATE users SET is_admin = true WHERE id = $1', [existing.id]);
  else await db.query('INSERT INTO users (email, password_hash, is_admin) VALUES ($1, $2, true)', [email, hashPassword(password)]);
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, loadUser, requireUser, requireAdmin, ensureAdmin };
