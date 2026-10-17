import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from './db.js';
import { auth, fail, learnerHistory } from './util.js';

const r = Router();
const AVATARS = ['🦉', '🐯', '🐼', '🦊', '🐸', '🚀'];
const COLORS = ['#2878d0', '#28a96b', '#e7515a', '#e0a100', '#8a4fd0', '#1aa6a6', '#ff8c42', '#e36cb0'];
const TOKENS = ['star', 'circle', 'book', 'shield'];
const cleanPrefs = p => ({
  language: p?.language === 'fil' ? 'fil' : 'en',
  voice: p?.voice !== false,
  rate: Math.min(1.5, Math.max(0.5, Number(p?.rate) || 0.9)),
  sound: p?.sound !== false,
  color: COLORS.includes(p?.color) ? p.color : COLORS[0],
  token: TOKENS.includes(p?.token) ? p.token : 'star'
});
r.use('/me', auth('student'));

// Identity always comes from the token, never from a browser-supplied ID. LRN is masked.
r.get('/me', (req, res) => {
  const s = db.prepare(`SELECT s.id,s.username,s.full_name,s.display_name,s.avatar,s.grade_section,s.lrn,s.prefs,g.name group_name
    FROM students s LEFT JOIN learner_groups g ON g.id=s.group_id WHERE s.id=?`).get(req.user.id);
  const lrn = s.lrn ? '•'.repeat(Math.max(0, s.lrn.length - 4)) + s.lrn.slice(-4) : '';
  delete s.lrn;
  res.json({ ...s, prefs: cleanPrefs(JSON.parse(s.prefs || '{}')), lrn_masked: lrn });
});

r.put('/me', (req, res) => {
  const { display_name, avatar, prefs } = req.body || {};
  if (!String(display_name || '').trim() || String(display_name).length > 40) fail(400, 'Enter a display name (up to 40 characters).');
  if (!AVATARS.includes(avatar)) fail(400, 'Invalid avatar.');
  db.prepare('UPDATE students SET display_name=?, avatar=?, prefs=? WHERE id=?').run(display_name.trim(), avatar, JSON.stringify(cleanPrefs(prefs)), req.user.id);
  res.json({ ok: true });
});

r.post('/me/password', (req, res) => {
  const { current, next } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM students WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), row.password_hash)) fail(400, 'Current password is incorrect.');
  if (String(next || '').length < 6) fail(400, 'New password must be at least 6 characters.');
  db.prepare('UPDATE students SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), req.user.id);
  res.json({ ok: true });
});

// View-only session history: status is derived from saved records.
function mySessions(sid) {
  const rows = db.prepare(`SELECT s.id,s.title,s.description,s.objectives,s.type,s.display_order,s.planned_at,s.status sstatus,sp.status attendance
    FROM session_participants sp JOIN sessions s ON s.id=sp.session_id
    WHERE sp.student_id=? AND s.status!='draft' ORDER BY s.display_order,s.id`).all(sid);
  const hist = learnerHistory(sid);
  return rows.map((s, idx) => {
    const mine = hist.filter(h => h.session_id === s.id);
    const done = mine.filter(h => h.game_status === 'ended');
    const open = mine.some(h => h.game_status !== 'ended');
    const anyEnded = db.prepare("SELECT 1 FROM games WHERE session_id=? AND status='ended'").get(s.id);
    let status = 'Scheduled';
    if (done.length) status = 'Completed';
    else if (open) status = 'In Progress';
    else if (anyEnded) status = 'Absent/Not Participated';
    else if (s.planned_at && s.planned_at < new Date().toISOString().slice(0, 16)) status = 'Not Yet Completed';
    const completed = done.length > 0;
    if (s.sstatus === 'archived') status = 'Archived';
    const last = done[0];
    const live = mine.find(h => h.game_status !== 'ended');
    const progress = completed ? 100 : live ? Math.round((live.position / 30) * 100) : 0;
    return {
      id: s.id, number: idx + 1, title: s.title, description: s.description, objectives: s.objectives, progress,
      planned_at: s.planned_at, status, completed,
      completed_on: last?.ended_at ?? null,
      result: last ? { points: last.points, correct: last.correct, incorrect: last.incorrect, finished: last.finished, rank: last.rank, tie: last.tie } : null
    };
  });
}
r.get('/me/sessions', (req, res) => res.json(mySessions(req.user.id)));

// Session overview for one assigned, published session: story text for read-along, never questions or answers.
r.get('/me/sessions/:id', (req, res) => {
  const s = db.prepare(`SELECT s.id,s.title,s.description,s.objectives,s.material_version_id FROM session_participants sp
    JOIN sessions s ON s.id=sp.session_id WHERE sp.student_id=? AND s.id=? AND s.status='published'`).get(req.user.id, req.params.id) || fail(404, 'Session not found.');
  const v = s.material_version_id ? db.prepare('SELECT story_title,story_text FROM material_versions WHERE id=?').get(s.material_version_id) : null;
  const group = db.prepare('SELECT g.name FROM students st LEFT JOIN learner_groups g ON g.id=st.group_id WHERE st.id=?').get(req.user.id)?.name ?? null;
  const number = mySessions(req.user.id).find(x => x.id === s.id)?.number ?? null;
  res.json({ id: s.id, number, title: s.title, description: s.description, objectives: s.objectives, story_title: v?.story_title ?? null, story_text: v?.story_text ?? null, group });
});

r.get('/me/summary', (req, res) => {
  const sessions = mySessions(req.user.id);
  const hist = learnerHistory(req.user.id);
  const correct = hist.reduce((a, h) => a + h.correct, 0), incorrect = hist.reduce((a, h) => a + h.incorrect, 0);
  const latest = db.prepare(`SELECT t.decision,t.points,t.confirmed_at,s.title FROM turns t
    JOIN game_players gp ON gp.id=t.player_id JOIN games g ON g.id=gp.game_id JOIN sessions s ON s.id=g.session_id
    WHERE gp.student_id=? AND t.status='final' ORDER BY t.id DESC LIMIT 1`).get(req.user.id) || null;
  const finished = hist.filter(h => h.finished);
  const achievements = [];
  if (sessions.some(s => s.completed)) achievements.push({ key: 'first', label: 'First session completed', icon: '🌟' });
  if (correct + incorrect > 0) achievements.push({ key: 'part', label: 'Took part in the reading game', icon: '📖' });
  if (finished.length) achievements.push({ key: 'step30', label: 'Reached Step 30', icon: '🏁' });
  res.json({
    assigned: sessions.length,
    completed: sessions.filter(s => s.completed).length,
    not_completed: sessions.filter(s => !s.completed).length,
    latest,
    points: hist.reduce((a, h) => a + h.points, 0),
    questions: correct + incorrect, correct, incorrect,
    accuracy: correct + incorrect ? Math.round((correct / (correct + incorrect)) * 100) : null, // game accuracy, not Phil-IRI
    active_ms: hist.reduce((a, h) => a + h.active_ms, 0),
    finishes: finished.map(h => ({ session: h.title, rank: h.rank, tie: h.tie, finished_at: h.finished_at })),
    sessions_participated: hist.length,
    // own rows only: learners never see other learners' results
    completion: hist.map(h => ({ session: h.title, status: h.finished ? 'Finished' : h.game_status === 'ended' ? 'Not finished' : 'In progress', rank: h.rank, tie: h.tie, finished_at: h.finished_at })),
    performance: hist.map(h => ({ session: h.title, points: h.points, accuracy: h.correct + h.incorrect ? Math.round((h.correct / (h.correct + h.incorrect)) * 100) : null })),
    achievements
  });
});

export default r;
