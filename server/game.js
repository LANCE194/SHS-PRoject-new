import { Router } from 'express';
import crypto from 'node:crypto';
import db from './db.js';
import { auth, fail, audit, finishRanks, now } from './util.js';
import { planCorrect, planIncorrect, FINISH } from '../src/rules.js';

const r = Router();
r.use(['/games', '/export'], auth('teacher'));

const DEF = { correct_points: 5, incorrect_points: 0, allow_repeats: false, first_step_rule: 'stay', backward_connections: true };
const settingsOf = g => ({ ...DEF, ...JSON.parse(g.settings || '{}') });
const getGame = req => db.prepare('SELECT * FROM games WHERE id=? AND teacher_id=?').get(req.params.id, req.user.id) || fail(404, 'Game not found.');
const ms = iso => Date.parse(iso);

export function gameState(g) {
  g = db.prepare('SELECT * FROM games WHERE id=?').get(g.id);
  const ranks = finishRanks(g.id), t = Date.now();
  const sess = db.prepare('SELECT title,narration_lang,narration_rate FROM sessions WHERE id=?').get(g.session_id);
  const ver = db.prepare(`SELECT mv.version,mv.story_title,mv.story_text,m.title material_title FROM material_versions mv
    JOIN materials m ON m.id=mv.material_id WHERE mv.id=?`).get(g.material_version_id);
  const players = db.prepare(`SELECT gp.id,gp.student_id,gp.turn_order,gp.initial_roll,gp.position,gp.points,s.display_name,s.avatar,s.prefs,
      (SELECT COUNT(*) FROM turns t WHERE t.player_id=gp.id AND t.status='final' AND t.decision='correct') correct,
      (SELECT COUNT(*) FROM turns t WHERE t.player_id=gp.id AND t.status='final' AND t.decision='incorrect') incorrect,
      (SELECT COALESCE(SUM(duration_ms),0) FROM turns t WHERE t.player_id=gp.id AND t.status='final') active_ms
    FROM game_players gp JOIN students s ON s.id=gp.student_id WHERE gp.game_id=? ORDER BY COALESCE(gp.turn_order,9999),gp.id`).all(g.id)
    .map(({ prefs, ...p0 }) => { const p = { ...p0, token: JSON.parse(prefs || '{}').token || 'star' }; const f = ranks.get(p.id); return { ...p, finished: !!f, rank: f?.rank ?? null, tie: f?.tie ?? false, finished_at: f?.finished_at ?? null,
      status: f ? 'Finished' : p.id === g.current_player_id ? 'Active' : 'Waiting',
      accuracy: p.correct + p.incorrect ? Math.round(p.correct / (p.correct + p.incorrect) * 100) : null }; });
  const pt = db.prepare(`SELECT t.id,t.player_id,t.qid,t.presented_at,t.paused_ms,q.text,q.guidance,q.category,q.color,q.points,q.alternatives,q.notes
    FROM turns t LEFT JOIN questions q ON q.id=t.question_id WHERE t.game_id=? AND t.status='pending'`).get(g.id);
  const clock = g.ended_at ? ms(g.ended_at) : g.paused_at ? ms(g.paused_at) : t;
  return {
    now: new Date(t).toISOString(),
    game: { id: g.id, status: g.status, session_id: g.session_id, session_title: sess.title, narration_lang: sess.narration_lang, narration_rate: sess.narration_rate,
      version: ver.version, material_title: ver.material_title, material_version_id: g.material_version_id, settings: settingsOf(g),
      started_at: g.started_at, ended_at: g.ended_at, paused: !!g.paused_at,
      elapsed_ms: g.started_at ? Math.max(0, clock - ms(g.started_at) - g.paused_total_ms) : 0 },
    story: { title: ver.story_title, text: ver.story_text },
    wheel: db.prepare("SELECT qid,category,color FROM questions WHERE version_id=? AND status='published' ORDER BY id").all(g.material_version_id),
    players, current_player_id: g.current_player_id,
    pending: pt ? { ...pt, active_ms: Math.max(0, clock - ms(pt.presented_at) - pt.paused_ms) } : null,
    turns: db.prepare(`SELECT t.id,t.player_id,t.qid,t.status,t.notes,t.decision,t.points,t.duration_ms,t.reason,t.correction_reason,t.corrected,t.confirmed_at,
        m.die_roll,m.prev_position,m.initial_position,m.connection_position,m.final_position,m.mismatch_reason,s.display_name
      FROM turns t JOIN game_players gp ON gp.id=t.player_id JOIN students s ON s.id=gp.student_id LEFT JOIN movements m ON m.turn_id=t.id
      WHERE t.game_id=? AND t.status!='pending' ORDER BY t.id DESC`).all(g.id),
    prizes: db.prepare('SELECT p.id,p.player_id,p.kind,p.note,s.display_name FROM prizes p JOIN game_players gp ON gp.id=p.player_id JOIN students s ON s.id=gp.student_id WHERE p.game_id=? ORDER BY p.id').all(g.id)
  };
}

function advance(g, fromId) {
  const ps = db.prepare('SELECT id FROM game_players WHERE game_id=? ORDER BY turn_order').all(g.id).map(p => p.id);
  const done = new Set(db.prepare('SELECT player_id FROM finishes WHERE game_id=? AND voided=0').all(g.id).map(f => f.player_id));
  const i = ps.indexOf(fromId);
  let next = null;
  for (let k = 1; k <= ps.length; k++) { const c = ps[(i + k) % ps.length]; if (!done.has(c)) { next = c; break; } }
  db.prepare('UPDATE games SET current_player_id=? WHERE id=?').run(next, g.id);
}

// ---------- List / create / read ----------
r.get('/games', (req, res) => res.json(db.prepare(`SELECT g.id,g.status,g.started_at,g.ended_at,g.created_at,s.title session_title,mv.version,
  (SELECT COUNT(*) FROM game_players gp WHERE gp.game_id=g.id) players FROM games g JOIN sessions s ON s.id=g.session_id
  JOIN material_versions mv ON mv.id=g.material_version_id WHERE g.teacher_id=? ORDER BY g.id DESC`).all(req.user.id)));

r.post('/games', (req, res) => {
  const b = req.body || {}, t = req.user.id;
  const s = db.prepare('SELECT * FROM sessions WHERE id=? AND teacher_id=?').get(b.session_id, t) || fail(404, 'Session not found.');
  const ids = [...new Set((b.student_ids || []).map(Number))], missing = [];
  if (s.status !== 'published') missing.push('a published session');
  if (!ids.length) missing.push('at least one participant');
  if (!s.material_version_id) missing.push('a story/question set');
  else {
    const v = db.prepare('SELECT story_text FROM material_versions WHERE id=?').get(s.material_version_id);
    if (!v?.story_text.trim()) missing.push('story text');
    if (!db.prepare("SELECT 1 FROM questions WHERE version_id=? AND status='published'").get(s.material_version_id)) missing.push('a published question');
  }
  for (const id of ids) if (!db.prepare('SELECT 1 FROM students WHERE id=? AND teacher_id=? AND active=1').get(id, t)) missing.push('only active learners you manage');
  if (db.prepare("SELECT 1 FROM games WHERE session_id=? AND status IN ('setup','active','paused')").get(s.id)) missing.push('no other open game for this session');
  if (missing.length) fail(400, `Cannot start. Missing: ${[...new Set(missing)].join(', ')}.`, { missing });
  const id = db.transaction(() => {
    const gid = db.prepare('INSERT INTO games (session_id,teacher_id,material_version_id,settings) VALUES (?,?,?,?)').run(s.id, t, s.material_version_id, s.settings).lastInsertRowid;
    for (const sid of ids) {
      db.prepare('INSERT INTO game_players (game_id,student_id) VALUES (?,?)').run(gid, sid);
      db.prepare("INSERT INTO session_participants (session_id,student_id,status) VALUES (?,?, 'present') ON CONFLICT(session_id,student_id) DO UPDATE SET status='present'").run(s.id, sid);
    }
    audit(req, 'game_create', 'game', gid, null, { session: s.id, players: ids.length, material_version_id: s.material_version_id });
    return gid;
  })();
  res.status(201).json({ id });
});

r.get('/games/:id', (req, res) => res.json(gameState(getGame(req))));

// ---------- Turn order (physical die rolls or the resulting order, recorded by the facilitator) ----------
r.post('/games/:id/order', (req, res) => {
  const g = getGame(req), b = req.body || {};
  if (g.status !== 'setup') fail(409, 'Turn order is already set.');
  const ps = db.prepare('SELECT id FROM game_players WHERE game_id=?').all(g.id).map(p => p.id);
  let order;
  if (b.order) {
    order = b.order.map(Number);
    if (order.length !== ps.length || new Set(order).size !== ps.length || !order.every(id => ps.includes(id))) fail(400, 'Order must list every player exactly once.');
  } else {
    const rolls = b.rolls || {};
    for (const id of ps) if (!Number.isInteger(+rolls[id]) || +rolls[id] < 1 || +rolls[id] > 6) fail(400, 'Enter the physical die roll (1-6) for every player.');
    const vals = ps.map(id => +rolls[id]);
    if (new Set(vals).size !== vals.length) fail(409, 'Tie in the order rolls. Re-roll the tied players, or enter the final order manually.');
    order = [...ps].sort((a, c) => +rolls[c] - +rolls[a]);
  }
  db.transaction(() => {
    order.forEach((id, i) => db.prepare('UPDATE game_players SET turn_order=?, initial_roll=? WHERE id=?').run(i + 1, b.order ? null : +b.rolls[id], id));
    db.prepare("UPDATE games SET status='active', started_at=?, current_player_id=? WHERE id=?").run(now(), order[0], g.id);
    audit(req, 'game_start', 'game', g.id, null, { order });
  })();
  res.json(gameState(g));
});

// ---------- Question wheel (server picks the identifier; replays return the same pending question) ----------
function drawQuestion(g, S, excludeId) {
  const all = db.prepare("SELECT id,qid FROM questions WHERE version_id=? AND status='published'").all(g.material_version_id);
  if (!all.length) fail(409, 'No published questions in this version.');
  const used = new Set(db.prepare("SELECT question_id FROM turns WHERE game_id=? AND question_id IS NOT NULL AND status!='voided'").all(g.id).map(x => x.question_id));
  let pool = S.allow_repeats ? all : all.filter(q => !used.has(q.id));
  if (!pool.length) pool = all; // all used: wheel resets (rule to be confirmed with the research team)
  if (excludeId && pool.length > 1) pool = pool.filter(q => q.id !== excludeId);
  const q = pool[crypto.randomInt(pool.length)];
  db.prepare('INSERT INTO turns (game_id,player_id,question_id,qid,presented_at) VALUES (?,?,?,?,?)').run(g.id, g.current_player_id, q.id, q.qid, now());
}
const needActive = g => {
  if (g.status !== 'active') fail(409, g.status === 'paused' ? 'Game is paused. Resume first.' : 'Game is not active.');
  if (!g.current_player_id) fail(409, 'No active player.');
};
r.post('/games/:id/question', (req, res) => {
  const g = getGame(req), S = settingsOf(g);
  needActive(g);
  db.transaction(() => { if (!db.prepare("SELECT 1 FROM turns WHERE game_id=? AND status='pending'").get(g.id)) drawQuestion(g, S); })();
  res.json(gameState(g));
});
// Spin Again: only before the answer is judged. The unanswered draw stays in the record as 'voided' and in the audit log.
r.post('/games/:id/respin', (req, res) => {
  const g = getGame(req), S = settingsOf(g);
  needActive(g);
  db.transaction(() => {
    const pt = db.prepare("SELECT * FROM turns WHERE game_id=? AND status='pending'").get(g.id) || fail(409, 'There is no pending question to replace.');
    db.prepare("UPDATE turns SET status='voided', correction_reason=? WHERE id=?").run(String(req.body?.reason || 'Spun again before answering').slice(0, 200), pt.id);
    audit(req, 'question_respin', 'turn', pt.id, { qid: pt.qid }, null, req.body?.reason);
    drawQuestion(g, S, pt.question_id);
  })();
  res.json(gameState(g));
});

// ---------- Facilitator verification + physical movement confirmation ----------
r.post('/games/:id/turns/:tid/outcome', (req, res) => {
  const g = getGame(req), b = req.body || {}, S = settingsOf(g);
  db.transaction(() => {
    if (!b.event_id) fail(400, 'event_id is required.');
    const t = db.prepare('SELECT * FROM turns WHERE id=? AND game_id=?').get(req.params.tid, g.id) || fail(404, 'Turn not found.');
    if (t.status === 'final') { if (t.event_id === b.event_id) return; fail(409, 'This question was already finalized.'); } // safe replay
    if (t.status !== 'pending') fail(409, 'This turn is not pending.');
    if (g.status === 'paused') fail(409, 'Game is paused. Resume first.');
    if (g.status !== 'active') fail(409, 'Game is not active.');
    if (t.player_id !== g.current_player_id) fail(409, 'It is not this player\'s turn.');
    const p = db.prepare('SELECT * FROM game_players WHERE id=?').get(t.player_id);
    let plan, roll = null;
    if (b.decision === 'correct') {
      roll = Number(b.die_roll);
      if (!Number.isInteger(roll) || roll < 1 || roll > 6) fail(400, 'Enter the physical die roll (1-6).');
      plan = planCorrect(p.position, roll);
    } else if (b.decision === 'incorrect') plan = planIncorrect(p.position, S.first_step_rule, S.backward_connections);
    else fail(400, 'Decision must be correct or incorrect.');
    const actual = Number(b.actual_position);
    if (b.actual_position == null || !Number.isInteger(actual) || actual < 0 || actual > FINISH) fail(400, 'Confirm the actual physical board position (0-30).');
    const mismatch = actual !== plan.after;
    if (mismatch && !String(b.reason || '').trim()) fail(400, 'Actual position differs from the expected result. Enter a reason.', { expected: plan.after });
    const at = now(), qp = t.question_id ? db.prepare('SELECT points FROM questions WHERE id=?').get(t.question_id)?.points : null;
    const points = b.decision === 'correct' ? (qp ?? S.correct_points) : S.incorrect_points;
    db.prepare("UPDATE turns SET status='final',decision=?,points=?,confirmed_at=?,duration_ms=?,event_id=?,notes=? WHERE id=?")
      .run(b.decision, points, at, Math.max(0, ms(at) - ms(t.presented_at) - t.paused_ms), b.event_id, String(b.notes || '').slice(0, 500), t.id);
    db.prepare(`INSERT INTO movements (turn_id,game_id,player_id,prev_position,die_roll,initial_position,connection_position,final_position,mismatch_reason,confirmed_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(t.id, g.id, p.id, p.position, roll, plan.initial, plan.after, actual, mismatch ? b.reason.trim() : null, req.user.id);
    db.prepare('UPDATE game_players SET position=?, points=points+? WHERE id=?').run(actual, points, p.id);
    if (mismatch) audit(req, 'position_mismatch', 'turn', t.id, { expected: plan.after }, { actual }, b.reason.trim());
    if (actual === FINISH) db.prepare('INSERT INTO finishes (game_id,player_id,finished_at) VALUES (?,?,?) ON CONFLICT(game_id,player_id) DO UPDATE SET finished_at=excluded.finished_at, voided=0 WHERE finishes.voided=1').run(g.id, p.id, at); // only on facilitator-verified Step 30
    advance(g, p.id);
  })();
  res.json(gameState(g));
});

r.post('/games/:id/skip', (req, res) => {
  const g = getGame(req), reason = String(req.body?.reason || '').trim();
  if (!reason) fail(400, 'A reason is required to skip a turn.');
  if (g.status !== 'active') fail(409, g.status === 'paused' ? 'Game is paused. Resume first.' : 'Game is not active.');
  db.transaction(() => {
    const at = now(), pt = db.prepare("SELECT * FROM turns WHERE game_id=? AND status='pending'").get(g.id);
    if (pt) db.prepare("UPDATE turns SET status='skipped',decision='skipped',reason=?,confirmed_at=?,duration_ms=? WHERE id=?").run(reason, at, Math.max(0, ms(at) - ms(pt.presented_at) - pt.paused_ms), pt.id);
    else db.prepare("INSERT INTO turns (game_id,player_id,status,decision,reason,presented_at,confirmed_at) VALUES (?,?, 'skipped','skipped',?,?,?)").run(g.id, g.current_player_id, reason, at, at);
    audit(req, 'turn_skip', 'game', g.id, null, { player: g.current_player_id }, reason);
    advance(g, g.current_player_id);
  })();
  res.json(gameState(g));
});

// Pause: all timers exclude paused time.
r.post('/games/:id/pause', (req, res) => {
  const g = getGame(req);
  if (g.status !== 'active') fail(409, 'Game is not active.');
  db.prepare("UPDATE games SET status='paused', paused_at=? WHERE id=?").run(now(), g.id);
  res.json(gameState(g));
});
r.post('/games/:id/resume', (req, res) => {
  const g = getGame(req);
  if (g.status !== 'paused') fail(409, 'Game is not paused.');
  db.transaction(() => {
    const d = Math.max(0, Date.now() - ms(g.paused_at));
    db.prepare("UPDATE games SET status='active', paused_at=NULL, paused_total_ms=paused_total_ms+? WHERE id=?").run(d, g.id);
    db.prepare("UPDATE turns SET paused_ms=paused_ms+? WHERE game_id=? AND status='pending'").run(d, g.id);
  })();
  res.json(gameState(g));
});

r.post('/games/:id/end', (req, res) => {
  const g = getGame(req);
  if (!req.body?.confirm) fail(400, 'Confirmation required to end the session.');
  if (g.status === 'ended') return res.json(gameState(g));
  if (g.status === 'setup') fail(409, 'Set the turn order first, or leave the game unstarted.');
  if (db.prepare("SELECT 1 FROM turns WHERE game_id=? AND status='pending'").get(g.id)) fail(409, 'Finalize or skip the pending question first.');
  db.transaction(() => {
    const at = now();
    db.prepare("UPDATE games SET status='ended', ended_at=?, paused_at=NULL, paused_total_ms=paused_total_ms+? WHERE id=?").run(at, g.paused_at ? Math.max(0, ms(at) - ms(g.paused_at)) : 0, g.id);
    db.prepare("UPDATE session_participants SET status='absent' WHERE session_id=? AND status='selected'").run(g.session_id);
    audit(req, 'game_end', 'game', g.id);
  })();
  res.json(gameState(g));
});

// Authorized correction: reason required, original values preserved in the audit log, derived values recomputed.
r.post('/games/:id/turns/:tid/correct', (req, res) => {
  const g = getGame(req), b = req.body || {}, reason = String(b.reason || '').trim();
  if (!reason) fail(400, 'A reason is required for a correction.');
  db.transaction(() => {
    const t = db.prepare("SELECT * FROM turns WHERE id=? AND game_id=? AND status='final'").get(req.params.tid, g.id) || fail(404, 'Finalized turn not found.');
    const m = db.prepare('SELECT * FROM movements WHERE turn_id=?').get(t.id);
    const decision = b.decision ?? t.decision, pos = b.final_position ?? m.final_position, pts = b.points ?? t.points;
    if (!['correct', 'incorrect'].includes(decision)) fail(400, 'Invalid decision.');
    if (!Number.isInteger(+pos) || +pos < 0 || +pos > FINISH || !Number.isInteger(+pts) || +pts < 0) fail(400, 'Invalid correction values.');
    db.prepare('UPDATE turns SET decision=?,points=?,corrected=1,correction_reason=? WHERE id=?').run(decision, +pts, reason, t.id);
    db.prepare('UPDATE movements SET final_position=? WHERE turn_id=?').run(+pos, t.id);
    const pid = t.player_id;
    const total = db.prepare("SELECT COALESCE(SUM(points),0) n FROM turns WHERE player_id=? AND status='final'").get(pid).n;
    const last = db.prepare("SELECT m.final_position FROM movements m JOIN turns tt ON tt.id=m.turn_id WHERE m.player_id=? AND tt.status='final' ORDER BY m.id DESC LIMIT 1").get(pid) ?? { final_position: 0 };
    db.prepare('UPDATE game_players SET points=?, position=? WHERE id=?').run(total, last.final_position, pid);
    const fin = db.prepare('SELECT * FROM finishes WHERE game_id=? AND player_id=?').get(g.id, pid);
    if (last.final_position === FINISH) {
      if (!fin) db.prepare('INSERT INTO finishes (game_id,player_id,finished_at) VALUES (?,?,?)').run(g.id, pid, t.confirmed_at);
      else if (fin.voided) db.prepare('UPDATE finishes SET voided=0, finished_at=? WHERE id=?').run(t.confirmed_at, fin.id);
    } else if (fin && !fin.voided) db.prepare('UPDATE finishes SET voided=1 WHERE id=?').run(fin.id);
    audit(req, 'turn_correction', 'turn', t.id, { decision: t.decision, points: t.points, final_position: m.final_position }, { decision, points: +pts, final_position: +pos }, reason);
  })();
  res.json(gameState(g));
});

// Undo the most recent finalized result (reason required). The original stays in the record as 'voided' and in the audit log.
r.post('/games/:id/undo', (req, res) => {
  const g = getGame(req), reason = String(req.body?.reason || '').trim();
  if (!reason) fail(400, 'A reason is required to undo a result.');
  if (!['active', 'paused'].includes(g.status)) fail(409, 'Game is not in progress.');
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM turns WHERE game_id=? AND status='pending'").get(g.id)) fail(409, 'Finalize or skip the pending question first.');
    const t = db.prepare("SELECT * FROM turns WHERE game_id=? AND status='final' ORDER BY id DESC LIMIT 1").get(g.id) || fail(404, 'Nothing to undo.');
    const m = db.prepare('SELECT * FROM movements WHERE turn_id=?').get(t.id);
    db.prepare("UPDATE turns SET status='voided', correction_reason=? WHERE id=?").run(reason, t.id);
    const total = db.prepare("SELECT COALESCE(SUM(points),0) n FROM turns WHERE player_id=? AND status='final'").get(t.player_id).n;
    db.prepare('UPDATE game_players SET points=?, position=? WHERE id=?').run(total, m.prev_position, t.player_id);
    db.prepare('UPDATE finishes SET voided=1 WHERE game_id=? AND player_id=?').run(g.id, t.player_id);
    db.prepare('UPDATE games SET current_player_id=? WHERE id=?').run(t.player_id, g.id);
    audit(req, 'turn_undo', 'turn', t.id, { decision: t.decision, points: t.points, final_position: m.final_position }, null, reason);
  })();
  res.json(gameState(g));
});

r.post('/games/:id/prizes', (req, res) => { // prize status is its own record
  const g = getGame(req), b = req.body || {};
  if (!['grand', 'consolation'].includes(b.kind)) fail(400, 'Invalid prize kind.');
  const p = db.prepare('SELECT id FROM game_players WHERE id=? AND game_id=?').get(b.player_id, g.id) || fail(404, 'Player not found.');
  const id = db.prepare('INSERT INTO prizes (game_id,player_id,kind,note) VALUES (?,?,?,?)').run(g.id, p.id, b.kind, b.note || '').lastInsertRowid;
  audit(req, 'prize_record', 'prize', id, null, { player: p.id, kind: b.kind });
  res.status(201).json(gameState(g));
});

// ---------- Reports and CSV (backend-saved records only) ----------
r.get('/games/:id/report', (req, res) => {
  const g = getGame(req), st = gameState(g);
  res.json({ ...st, attendance: db.prepare(`SELECT s.display_name,sp.status FROM session_participants sp JOIN students s ON s.id=sp.student_id WHERE sp.session_id=? ORDER BY s.display_name`).all(g.session_id) });
});

const csv = rows => rows.map(r => r.map(v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
r.get('/export/turns.csv', (req, res) => {
  const names = req.query.names === '1';
  const rows = db.prepare(`SELECT g.id game_id, s.title session, mv.version material_version, st.id learner_id, ${names ? 'st.full_name,' : ''} t.id turn_id, t.qid, t.decision, t.points,
      t.status, t.presented_at, t.confirmed_at, t.duration_ms, m.prev_position, m.die_roll, m.initial_position, m.connection_position, m.final_position, t.corrected
    FROM turns t JOIN games g ON g.id=t.game_id JOIN sessions s ON s.id=g.session_id JOIN material_versions mv ON mv.id=g.material_version_id
    JOIN game_players gp ON gp.id=t.player_id JOIN students st ON st.id=gp.student_id LEFT JOIN movements m ON m.turn_id=t.id
    WHERE g.teacher_id=? ${req.query.game_id ? 'AND g.id=?' : ''} AND t.status!='pending' ORDER BY t.id`).all(...[req.user.id, ...(req.query.game_id ? [req.query.game_id] : [])]);
  const head = rows.length ? Object.keys(rows[0]) : ['game_id'];
  audit(req, 'export_csv', 'export', null, null, { rows: rows.length, names });
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="ambak-turns.csv"').send(csv([head, ...rows.map(r => head.map(h => r[h]))]));
});

export default r;
