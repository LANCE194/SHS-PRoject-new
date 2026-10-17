import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import db from './db.js';
import { sign, HttpError, fail } from './util.js';
import learner from './learner.js';
import teacher from './teacher.js';
import game from './game.js';

const app = express();
// Fixed default secret code shared by every teacher. Nothing is generated; set TEACHER_CODE only if you want a different one.
const DEFAULT_TEACHER_CODE = '482915';
const TEACHER_CODE = String(process.env.TEACHER_CODE || DEFAULT_TEACHER_CODE);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Simple in-memory rate limiting (login + teacher sign-up).
const hits = new Map();
const limited = (key, max) => {
  const t = Date.now(), a = hits.get(key);
  if (a && t - a.t < 15 * 60 * 1000) return a.n >= max;
  return false;
};
const hit = key => { const t = Date.now(), a = hits.get(key); hits.set(key, a && t - a.t < 15 * 60 * 1000 ? { n: a.n + 1, t: a.t } : { n: 1, t }); };

app.post('/api/login', (req, res) => {
  const { role, username, password } = req.body || {};
  const key = `login|${req.ip}|${String(username || '').toLowerCase()}`;
  if (limited(key, 8)) fail(429, 'Too many attempts. Try again later.');
  const table = role === 'teacher' ? 'teachers' : 'students';
  const row = db.prepare(`SELECT * FROM ${table} WHERE username = ?`).get(String(username || '').trim());
  const ok = row && (table === 'teachers' || row.active) && bcrypt.compareSync(String(password || ''), row.password_hash);
  if (!ok) { hit(key); fail(401, 'Incorrect username or password.'); }
  hits.delete(key);
  const r = table === 'teachers' ? 'teacher' : 'student';
  res.json({ token: sign(row.id, r), role: r });
});

// Teacher sign-up stays gated by the secret code (no open registration).
app.post('/api/signup', (req, res) => {
  const { username, password, full_name, year_section, code } = req.body || {};
  const key = `signup|${req.ip}`;
  if (limited(key, 5)) fail(429, 'Too many attempts. Try again later.');
  if (!username || !password || !full_name || !year_section || !code) fail(400, 'All fields are required.');
  if (String(code).trim() !== TEACHER_CODE) { hit(key); fail(403, 'Invalid secret code.'); }
  if (String(password).length < 6) fail(400, 'Password must be at least 6 characters.');
  hits.delete(key);
  if (db.prepare('SELECT 1 FROM teachers WHERE username = ?').get(username.trim())) fail(409, 'Username already exists.');
  const info = db.prepare('INSERT INTO teachers (username,password_hash,full_name,year_section) VALUES (?,?,?,?)')
    .run(username.trim(), bcrypt.hashSync(password, 10), full_name.trim(), year_section.trim());
  res.status(201).json({ token: sign(info.lastInsertRowid, 'teacher'), role: 'teacher' });
});

app.use('/api', learner);
app.use('/api', teacher);
app.use('/api', game);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

const dist = path.resolve('dist');
app.use(express.static(dist));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.use((e, _req, res, _next) => {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...e.extra });
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});

app.listen(process.env.PORT || 3001, () => console.log('A.M.B.A.K. API running'));