import jwt from 'jsonwebtoken';
import db from './db.js';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) console.warn('WARNING: JWT_SECRET is not set; using the built-in default. Set it to a long random value.');
export const SECRET = process.env.JWT_SECRET || 'change-this-secret';
export const now = () => new Date().toISOString();
export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
export const sign = (id, role) => jwt.sign({ id, role }, SECRET, { expiresIn: '12h' });

// Backend role + account-status check on every protected request.
export const auth = role => (req, _res, next) => {
  try {
    const u = jwt.verify((req.headers.authorization || '').slice(7), SECRET);
    if (!['teacher', 'student'].includes(u.role) || (role && u.role !== role)) throw new Error('role');
    const row = u.role === 'teacher'
      ? db.prepare('SELECT 1 AS active FROM teachers WHERE id=?').get(u.id)
      : db.prepare('SELECT active FROM students WHERE id=?').get(u.id);
    if (!row || !row.active) throw new Error('inactive');
    req.user = u; next();
  } catch { next(new HttpError(401, 'Unauthorized')); }
};

const j = v => (v == null ? null : JSON.stringify(v));
export const audit = (req, action, entity, entityId, oldV, newV, reason) =>
  db.prepare('INSERT INTO audit (actor_role,actor_id,action,entity,entity_id,old_value,new_value,reason) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.user?.role ?? null, req.user?.id ?? null, action, entity, entityId ?? null, j(oldV), j(newV), reason ?? null);

// Rank is derived from saved finish timestamps; equal timestamps are recorded as a tie.
export function finishRanks(gameId) {
  const f = db.prepare('SELECT player_id, finished_at FROM finishes WHERE game_id=? AND voided=0 ORDER BY finished_at').all(gameId);
  const m = new Map();
  for (const x of f) m.set(x.player_id, {
    rank: 1 + f.filter(y => y.finished_at < x.finished_at).length,
    tie: f.filter(y => y.finished_at === x.finished_at).length > 1,
    finished_at: x.finished_at
  });
  return m;
}

// One learner's saved game history across sessions (own data only; callers enforce who may ask).
export function learnerHistory(studentId) {
  const rows = db.prepare(`
    SELECT gp.id pid, g.id game_id, g.status game_status, g.started_at, g.ended_at, s.id session_id, s.title, gp.points, gp.position,
      (SELECT COUNT(*) FROM turns t WHERE t.player_id=gp.id AND t.status='final' AND t.decision='correct') correct,
      (SELECT COUNT(*) FROM turns t WHERE t.player_id=gp.id AND t.status='final' AND t.decision='incorrect') incorrect,
      (SELECT COALESCE(SUM(duration_ms),0) FROM turns t WHERE t.player_id=gp.id AND t.status='final') active_ms
    FROM game_players gp JOIN games g ON g.id=gp.game_id JOIN sessions s ON s.id=g.session_id
    WHERE gp.student_id=? ORDER BY g.id DESC`).all(studentId);
  return rows.map(r => {
    const f = finishRanks(r.game_id).get(r.pid);
    return { ...r, finished: !!f, rank: f?.rank ?? null, tie: f?.tie ?? false, finished_at: f?.finished_at ?? null };
  });
}