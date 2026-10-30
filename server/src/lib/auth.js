import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';

const COOKIE = 'sales_crm_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 10;
const loginAttempts = new Map();

function config() {
  return {
    username: process.env.AUTH_USERNAME || '',
    password: process.env.AUTH_PASSWORD || '',
    secret: process.env.AUTH_SECRET || '',
  };
}

export function validateAuthConfiguration() {
  const { username, password, secret } = config();
  const missing = [
    !username && 'AUTH_USERNAME',
    !password && 'AUTH_PASSWORD',
    !secret && 'AUTH_SECRET',
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing required authentication settings: ${missing.join(', ')}.`);
  if ([username, password, secret].some((value) => /^replace[-_ ]with/i.test(value) || /<[^>]+>/.test(value))) {
    throw new Error('Replace all authentication placeholder values before starting the server.');
  }
  if (password.length < 14) throw new Error('AUTH_PASSWORD must be at least 14 characters.');
  if (secret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters.');
}

function equal(a, b) {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function readCookie(req) {
  const pair = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  return pair ? pair.slice(COOKIE.length + 1) : '';
}

export function authenticatedUser(req) {
  const { username, secret } = config();
  if (!username || !secret) return null;
  const [payload, suppliedSignature, extra] = readCookie(req).split('.');
  if (!payload || !suppliedSignature || extra !== undefined || !equal(signature(payload, secret), suppliedSignature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (session.exp <= Math.floor(Date.now() / 1000) || !equal(session.username || '', username)) return null;
    return { username };
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const user = authenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = user;
  next();
}

function cookieOptions(maxAge) {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
    `Max-Age=${maxAge}`,
  ].join('; ');
}

function originAllowed(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  if (origin === process.env.CLIENT_ORIGIN) return true;
  if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

function tooManyLoginAttempts(req) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let record = loginAttempts.get(key);
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(key, record);
  }
  record.count += 1;
  if (loginAttempts.size > 1000) {
    for (const [ip, attempt] of loginAttempts) if (attempt.resetAt <= now) loginAttempts.delete(ip);
    if (loginAttempts.size > 5000) loginAttempts.delete(loginAttempts.keys().next().value);
  }
  return record.count > LOGIN_LIMIT ? Math.ceil((record.resetAt - now) / 1000) : 0;
}

export const authRouter = Router();

authRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

authRouter.get('/session', (req, res) => {
  const user = authenticatedUser(req);
  res.json({ authenticated: Boolean(user), ...(user ? { username: user.username } : {}) });
});

authRouter.post('/login', (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  const retryAfter = tooManyLoginAttempts(req);
  if (retryAfter) {
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  }
  try {
    validateAuthConfiguration();
  } catch (error) {
    return res.status(503).json({ error: 'Authentication is not configured on the server.' });
  }

  const { username, password, secret } = config();
  if (!equal(String(req.body?.username || ''), username) || !equal(String(req.body?.password || ''), password)) {
    return res.status(401).json({ error: 'Username or password is incorrect.' });
  }
  loginAttempts.delete(req.ip || req.socket.remoteAddress || 'unknown');

  const payload = Buffer.from(JSON.stringify({
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString('base64url');
  res.set('Set-Cookie', `${COOKIE}=${payload}.${signature(payload, secret)}; ${cookieOptions(SESSION_SECONDS)}`);
  res.json({ authenticated: true, username });
});

authRouter.post('/logout', (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  res.set('Set-Cookie', `${COOKIE}=; ${cookieOptions(0)}`);
  res.json({ authenticated: false });
});
