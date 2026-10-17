import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import db from './db.js';
import { auth, fail, audit, learnerHistory } from './util.js';

const r = Router();
r.use(['/students', '/groups', '/materials', '/sessions', '/overview', '/assessments', '/audit', '/settings'], auth('teacher'));

const own = (table, id, tid) => {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=? AND teacher_id=?`).get(id, tid);
  if (!row) fail(404, 'Not found.');
  return row;
};
const val = v => (v === '' || v === undefined ? null : v);
const int = v => (val(v) === null ? null : Number.isInteger(+v) ? +v : fail(400, 'Invalid number.'));

// ---------- Overview ----------
r.get('/overview', (req, res) => {
  const t = req.user.id, c = sql => db.prepare(sql).get(t).n;
  res.json({
    learners: c('SELECT COUNT(*) n FROM students WHERE teacher_id=? AND active=1'),
    groups: c('SELECT COUNT(*) n FROM learner_groups WHERE teacher_id=?'),
    published: c("SELECT COUNT(*) n FROM sessions WHERE teacher_id=? AND status='published'"),
    activity: db.prepare("SELECT status FROM games WHERE teacher_id=? AND status IN ('setup','active','paused') ORDER BY id DESC LIMIT 1").get(t)?.status ?? null,
    upcoming: c("SELECT COUNT(*) n FROM sessions s WHERE teacher_id=? AND status='published' AND NOT EXISTS (SELECT 1 FROM games g WHERE g.session_id=s.id AND g.status='ended')"),
    completed: c("SELECT COUNT(DISTINCT session_id) n FROM games WHERE teacher_id=? AND status='ended'"),
    recent: db.prepare(`SELECT t.confirmed_at, t.decision, t.points, st.display_name, s.title FROM turns t
      JOIN games g ON g.id=t.game_id JOIN sessions s ON s.id=g.session_id JOIN game_players gp ON gp.id=t.player_id
      JOIN students st ON st.id=gp.student_id WHERE g.teacher_id=? AND t.status='final' ORDER BY t.id DESC LIMIT 8`).all(t)
  });
});

// ---------- Learners ----------
const PROFILE = ['full_name', 'display_name', 'age', 'birthdate', 'lrn', 'grade_section', 'address', 'guardian_name', 'guardian_contact', 'avatar'];
const SEL = `s.id,s.username,s.full_name,s.display_name,s.age,s.birthdate,s.lrn,s.grade_section,s.address,s.guardian_name,s.guardian_contact,s.avatar,s.active,s.group_id,g.name group_name,s.created_at`;
const checkGroup = (gid, tid) => { if (gid != null) own('learner_groups', gid, tid); };

const maskLrn = l => (l ? '•'.repeat(Math.max(0, l.length - 4)) + l.slice(-4) : '');
r.get('/students', (req, res) => res.json(db.prepare(
  `SELECT ${SEL} FROM students s LEFT JOIN learner_groups g ON g.id=s.group_id WHERE s.teacher_id=? ORDER BY s.full_name`).all(req.user.id)
  .map(({ lrn, ...s }) => ({ ...s, lrn_masked: maskLrn(lrn) }))));

function createStudent(tid, b) {
  const username = String(b.username || '').trim();
  if (!username || !b.password || !String(b.full_name || '').trim()) fail(400, 'Username, password and full name are required.');
  if (String(b.password).length < 6) fail(400, 'Password must be at least 6 characters.');
  if (db.prepare('SELECT 1 FROM students WHERE username=?').get(username)) fail(409, `Username "${username}" already exists.`);
  const lrn = val(b.lrn);
  if (lrn && db.prepare('SELECT 1 FROM students WHERE teacher_id=? AND lrn=?').get(tid, lrn)) fail(409, `LRN ${lrn} already exists.`);
  const gid = int(b.group_id);
  checkGroup(gid, tid);
  const p = { display_name: b.full_name, avatar: '🦉', ...b };
  const vals = PROFILE.map(k => (k === 'age' ? int(p[k]) : val(p[k]) ?? (['address', 'guardian_name', 'guardian_contact'].includes(k) ? '' : null)));
  const info = db.prepare(`INSERT INTO students (teacher_id,username,password_hash,group_id,${PROFILE.join(',')}) VALUES (?,?,?,?,${PROFILE.map(() => '?').join(',')})`)
    .run(tid, username, bcrypt.hashSync(String(b.password), 10), gid, ...vals);
  return info.lastInsertRowid;
}
r.post('/students', (req, res) => res.status(201).json({ id: createStudent(req.user.id, req.body || {}) }));

// Optional import: validated rows, duplicates reported, never partially failing the whole batch.
r.post('/students/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : fail(400, 'No rows supplied.');
  const created = [], rejected = [];
  rows.forEach((row, i) => {
    try { created.push(createStudent(req.user.id, { ...row, group_id: row.group_id ?? req.body.group_id })); }
    catch (e) { rejected.push({ row: i + 1, username: row.username, reason: e.message }); }
  });
  audit(req, 'students_import', 'student', null, null, { created: created.length, rejected: rejected.length });
  res.json({ created: created.length, rejected });
});

r.put('/students/:id', (req, res) => {
  const b = req.body || {}, s = own('students', req.params.id, req.user.id);
  const keys = PROFILE.filter(k => k in b);
  for (const k of ['full_name', 'display_name']) if (k in b && !String(b[k] || '').trim()) fail(400, `${k.replace('_', ' ')} is required.`);
  const sets = keys.map(k => `${k}=?`), vals = keys.map(k => (k === 'age' ? int(b[k]) : b[k] === '' ? (['address', 'guardian_name', 'guardian_contact'].includes(k) ? '' : null) : b[k]));
  if ('group_id' in b) { const g = int(b.group_id); checkGroup(g, req.user.id); sets.push('group_id=?'); vals.push(g); }
  if (b.username && b.username !== s.username) {
    if (db.prepare('SELECT 1 FROM students WHERE username=? AND id!=?').get(b.username, s.id)) fail(409, 'Username already exists.');
    sets.push('username=?'); vals.push(b.username.trim());
  }
  if (b.lrn && db.prepare('SELECT 1 FROM students WHERE teacher_id=? AND lrn=? AND id!=?').get(req.user.id, b.lrn, s.id)) fail(409, 'LRN already exists.');
  if (b.password) { if (String(b.password).length < 6) fail(400, 'Password must be at least 6 characters.'); sets.push('password_hash=?'); vals.push(bcrypt.hashSync(String(b.password), 10)); }
  if (sets.length) db.prepare(`UPDATE students SET ${sets.join(',')} WHERE id=?`).run(...vals, s.id);
  res.json({ ok: true });
});

r.patch('/students/:id/active', (req, res) => {
  const s = own('students', req.params.id, req.user.id), a = req.body?.active ? 1 : 0;
  db.prepare('UPDATE students SET active=? WHERE id=?').run(a, s.id);
  audit(req, a ? 'student_activate' : 'student_deactivate', 'student', s.id, { active: s.active }, { active: a });
  res.json({ ok: true });
});

r.post('/students/:id/reset-password', (req, res) => {
  const s = own('students', req.params.id, req.user.id);
  const temp = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  db.prepare('UPDATE students SET password_hash=? WHERE id=?').run(bcrypt.hashSync(temp, 10), s.id);
  audit(req, 'student_password_reset', 'student', s.id);
  res.json({ temp_password: temp });
});

r.delete('/students/:id', (req, res) => {
  const s = own('students', req.params.id, req.user.id);
  if (db.prepare('SELECT 1 FROM game_players WHERE student_id=?').get(s.id) || db.prepare('SELECT 1 FROM assessments WHERE student_id=?').get(s.id))
    fail(409, 'This learner has research records. Deactivate the account instead.');
  db.transaction(() => {
    db.prepare('DELETE FROM session_participants WHERE student_id=?').run(s.id);
    db.prepare('DELETE FROM students WHERE id=?').run(s.id);
    audit(req, 'student_delete', 'student', s.id, { username: s.username });
  })();
  res.json({ ok: true });
});

r.get('/students/:id/history', (req, res) => {
  const s = own('students', req.params.id, req.user.id);
  res.json({ student: { id: s.id, display_name: s.display_name, full_name: s.full_name }, history: learnerHistory(s.id) });
});

// ---------- Groups ----------
const setMembers = (gid, ids, tid) => {
  const keep = [...new Set((ids || []).map(Number))];
  for (const id of keep) if (!db.prepare('SELECT 1 FROM students WHERE id=? AND teacher_id=?').get(id, tid)) fail(400, 'Unknown learner selected.');
  db.prepare('UPDATE students SET group_id=NULL WHERE group_id=?').run(gid);
  for (const id of keep) db.prepare('UPDATE students SET group_id=? WHERE id=?').run(gid, id);
};
r.get('/groups', (req, res) => res.json(db.prepare(
  `SELECT g.id,g.name,(SELECT COUNT(*) FROM students s WHERE s.group_id=g.id) members,(SELECT group_concat(s.id) FROM students s WHERE s.group_id=g.id) ids
   FROM learner_groups g WHERE g.teacher_id=? ORDER BY g.name`).all(req.user.id).map(({ ids, ...g }) => ({ ...g, student_ids: ids ? ids.split(',').map(Number) : [] }))));
r.post('/groups', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) fail(400, 'Group name is required.');
  if (db.prepare('SELECT 1 FROM learner_groups WHERE teacher_id=? AND name=?').get(req.user.id, name)) fail(409, 'Group already exists.');
  const id = db.transaction(() => {
    const gid = db.prepare('INSERT INTO learner_groups (teacher_id,name) VALUES (?,?)').run(req.user.id, name).lastInsertRowid;
    if (req.body.student_ids) setMembers(gid, req.body.student_ids, req.user.id);
    return gid;
  })();
  res.status(201).json({ id });
});
r.put('/groups/:id', (req, res) => {
  const g = own('learner_groups', req.params.id, req.user.id), name = String(req.body?.name || '').trim();
  if (!name) fail(400, 'Group name is required.');
  if (db.prepare('SELECT 1 FROM learner_groups WHERE teacher_id=? AND name=? AND id!=?').get(req.user.id, name, g.id)) fail(409, 'Group already exists.');
  db.transaction(() => {
    db.prepare('UPDATE learner_groups SET name=? WHERE id=?').run(name, g.id);
    if (req.body.student_ids) setMembers(g.id, req.body.student_ids, req.user.id);
  })();
  res.json({ ok: true });
});
r.delete('/groups/:id', (req, res) => {
  const g = own('learner_groups', req.params.id, req.user.id);
  db.transaction(() => {
    db.prepare('UPDATE students SET group_id=NULL WHERE group_id=?').run(g.id);
    db.prepare('UPDATE sessions SET group_id=NULL WHERE group_id=?').run(g.id);
    db.prepare('DELETE FROM learner_groups WHERE id=?').run(g.id);
  })();
  res.json({ ok: true });
});

// ---------- Story / question library (every save creates a new immutable version) ----------
const COLORS = { Who: '#e7515a', What: '#2878d0', Where: '#28a96b', When: '#e0a100', Why: '#8a4fd0' };
const COLORS_HOW = { ...{ Who: '#e7515a', What: '#2878d0', Where: '#28a96b', When: '#e0a100', Why: '#8a4fd0' }, How: '#1aa6a6' };
function fillQuestions(v, b) {
  const ins = db.prepare('INSERT INTO questions (version_id,qid,category,color,text,guidance,status,points,alternatives,notes) VALUES (?,?,?,?,?,?,?,?,?,?)'), seen = new Set();
  (b.questions || []).forEach((q, i) => {
    if (!String(q.text || '').trim()) fail(400, `Question ${i + 1} needs text.`);
    const qid = String(q.qid || `Q${i + 1}`).trim();
    if (seen.has(qid)) fail(400, `Duplicate question ID ${qid}.`);
    seen.add(qid);
    const pts = q.points === '' || q.points == null ? null : Number.isInteger(+q.points) && +q.points >= 0 ? +q.points : fail(400, 'Points must be a whole number.');
    ins.run(v, qid, q.category || '', q.color || COLORS_HOW[q.category] || '#62748a', q.text.trim(), q.guidance || '', ['published', 'unpublished', 'archived'].includes(q.status) ? q.status : 'published', pts, q.alternatives || '', q.notes || '');
  });
}
const writeVersion = db.transaction((mid, version, b) => {
  const v = db.prepare('INSERT INTO material_versions (material_id,version,story_title,story_text) VALUES (?,?,?,?)')
    .run(mid, version, b.story_title || '', String(b.story_text || '')).lastInsertRowid;
  fillQuestions(v, b);
  db.prepare('UPDATE materials SET current_version_id=? WHERE id=?').run(v, mid);
  return v;
});
const materialFull = m => {
  const v = db.prepare('SELECT * FROM material_versions WHERE id=?').get(m.current_version_id);
  return { id: m.id, title: m.title, status: m.status, version: v?.version, version_id: v?.id, story_title: v?.story_title, story_text: v?.story_text,
    questions: v ? db.prepare('SELECT qid,category,color,text,guidance,status,points,alternatives,notes FROM questions WHERE version_id=? ORDER BY id').all(v.id) : [] };
};
r.get('/materials', (req, res) => res.json(db.prepare(`SELECT m.id,m.title,m.status,mv.version,mv.story_title,
  (SELECT COUNT(*) FROM questions q WHERE q.version_id=mv.id AND q.status='published') questions
  FROM materials m LEFT JOIN material_versions mv ON mv.id=m.current_version_id WHERE m.teacher_id=? ORDER BY m.id DESC`).all(req.user.id)));
r.get('/materials/:id', (req, res) => res.json(materialFull(own('materials', req.params.id, req.user.id))));
r.post('/materials', (req, res) => {
  const b = req.body || {};
  if (!String(b.title || '').trim()) fail(400, 'Title is required.');
  const id = db.transaction(() => {
    const mid = db.prepare('INSERT INTO materials (teacher_id,title) VALUES (?,?)').run(req.user.id, b.title.trim()).lastInsertRowid;
    writeVersion(mid, 1, b); return mid;
  })();
  res.status(201).json({ id });
});
r.put('/materials/:id', (req, res) => {
  const m = own('materials', req.params.id, req.user.id), b = req.body || {};
  if (!String(b.title || '').trim()) fail(400, 'Title is required.');
  const cur = db.prepare('SELECT * FROM material_versions WHERE id=?').get(m.current_version_id);
  const played = cur && db.prepare('SELECT 1 FROM games WHERE material_version_id=?').get(cur.id);
  let version = cur?.version || 1;
  db.transaction(() => {
    db.prepare('UPDATE materials SET title=? WHERE id=?').run(b.title.trim(), m.id);
    if (cur && !played) { // nothing depends on this version yet: edit in place
      db.prepare('UPDATE material_versions SET story_title=?, story_text=? WHERE id=?').run(b.story_title || '', String(b.story_text || ''), cur.id);
      db.prepare('DELETE FROM questions WHERE version_id=?').run(cur.id);
      fillQuestions(cur.id, b);
    } else { // a game used it: keep it frozen, create a newer version for future sessions
      version = (cur?.version || 0) + 1;
      const nv = writeVersion(m.id, version, b);
      db.prepare('UPDATE sessions SET material_version_id=? WHERE material_version_id=? AND NOT EXISTS (SELECT 1 FROM games g WHERE g.session_id=sessions.id)').run(nv, cur?.id);
    }
  })();
  res.json({ ok: true, version, new_version: !!(cur && played) });
});
r.patch('/materials/:id/status', (req, res) => {
  const m = own('materials', req.params.id, req.user.id), s = req.body?.status;
  if (!['draft', 'published', 'archived'].includes(s)) fail(400, 'Invalid status.');
  if (s === 'published') {
    const f = materialFull(m);
    if (!f.story_text?.trim() || !f.questions.some(q => q.status === 'published')) fail(400, 'Add story text and at least one published question first.');
  }
  db.prepare('UPDATE materials SET status=? WHERE id=?').run(s, m.id);
  res.json({ ok: true });
});

// ---------- Planned sessions ----------
const DEFAULT_SETTINGS = { correct_points: 5, incorrect_points: 0, allow_repeats: false, first_step_rule: 'stay', backward_connections: true };
const cleanSettings = s => {
  const o = { ...DEFAULT_SETTINGS, ...(s || {}) };
  return {
    correct_points: Number.isInteger(+o.correct_points) && +o.correct_points >= 0 ? +o.correct_points : 5,
    incorrect_points: Number.isInteger(+o.incorrect_points) && +o.incorrect_points >= 0 ? +o.incorrect_points : 0,
    allow_repeats: !!o.allow_repeats,
    first_step_rule: o.first_step_rule === 'start' ? 'start' : 'stay',
    backward_connections: o.backward_connections !== false
  };
};
const LIST = `SELECT s.*, m.id material_id, m.title material_title, m.status material_status, mv.version material_version,
  (SELECT COUNT(*) FROM questions q WHERE q.version_id=s.material_version_id AND q.status='published') published_questions,
  (SELECT COUNT(*) FROM session_participants sp WHERE sp.session_id=s.id) participants,
  (SELECT COUNT(*) FROM games g WHERE g.session_id=s.id) games_total,
  (SELECT COUNT(*) FROM games g WHERE g.session_id=s.id AND g.status='ended') games_ended,
  (SELECT COUNT(*) FROM games g WHERE g.session_id=s.id AND g.status IN ('setup','active','paused')) games_open
  FROM sessions s LEFT JOIN material_versions mv ON mv.id=s.material_version_id LEFT JOIN materials m ON m.id=mv.material_id`;
const shape = s => ({ ...s, settings: cleanSettings(JSON.parse(s.settings || '{}')) });
const materialVersionFor = (mid, tid) => {
  if (mid == null) return null;
  const m = own('materials', mid, tid);
  if (m.status === 'archived') fail(400, 'That story set is archived.');
  return m.current_version_id;
};
function setParticipants(sid, ids, tid) {
  const keep = [...new Set((ids || []).map(Number))];
  for (const id of keep) if (!db.prepare('SELECT 1 FROM students WHERE id=? AND teacher_id=?').get(id, tid)) fail(400, 'Unknown learner selected.');
  const cur = db.prepare('SELECT student_id,status FROM session_participants WHERE session_id=?').all(sid);
  for (const c of cur) {
    if (keep.includes(c.student_id)) continue;
    if (c.status !== 'selected') fail(409, 'A learner with participation records cannot be removed.');
    db.prepare('DELETE FROM session_participants WHERE session_id=? AND student_id=?').run(sid, c.student_id);
  }
  for (const id of keep) db.prepare('INSERT OR IGNORE INTO session_participants (session_id,student_id) VALUES (?,?)').run(sid, id);
}

r.get('/sessions', (req, res) => res.json(db.prepare(`${LIST} WHERE s.teacher_id=? ORDER BY s.display_order,s.id`).all(req.user.id).map(shape)));
r.post('/sessions/reorder', (req, res) => { // display order only; results untouched
  const ids = req.body?.ids || fail(400, 'ids required');
  db.transaction(() => ids.forEach((id, i) => db.prepare('UPDATE sessions SET display_order=? WHERE id=? AND teacher_id=?').run(i, id, req.user.id)))();
  res.json({ ok: true });
});
r.get('/sessions/:id', (req, res) => {
  const s = shape(db.prepare(`${LIST} WHERE s.id=? AND s.teacher_id=?`).get(req.params.id, req.user.id) || fail(404, 'Not found.'));
  const mat = s.material_version_id ? materialFull({ ...db.prepare('SELECT * FROM materials WHERE id=?').get(s.material_id), current_version_id: s.material_version_id }) : null;
  res.json({ ...s, student_ids: db.prepare('SELECT student_id FROM session_participants WHERE session_id=?').all(s.id).map(x => x.student_id), material: mat });
});

const sessionFields = b => {
  if (!String(b.title || '').trim()) fail(400, 'Title is required.');
  return [b.title.trim(), b.description || '', b.objectives || '', b.type || 'intervention', val(b.planned_at), int(b.duration_min), int(b.group_id),
    b.narration_lang || 'en-US', Number(b.narration_rate) > 0 ? Number(b.narration_rate) : 0.9, JSON.stringify(cleanSettings(b.settings))];
};
r.post('/sessions', (req, res) => {
  const b = req.body || {}, f = sessionFields(b), t = req.user.id;
  checkGroup(f[6], t);
  const id = db.transaction(() => {
    const order = db.prepare('SELECT COALESCE(MAX(display_order),-1)+1 n FROM sessions WHERE teacher_id=?').get(t).n;
    const sid = db.prepare(`INSERT INTO sessions (teacher_id,title,description,objectives,type,planned_at,duration_min,group_id,narration_lang,narration_rate,settings,material_version_id,display_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t, ...f, materialVersionFor(b.material_id, t), order).lastInsertRowid;
    setParticipants(sid, b.student_ids, t);
    return sid;
  })();
  res.status(201).json({ id });
});
r.put('/sessions/:id', (req, res) => {
  const b = req.body || {}, t = req.user.id, s = own('sessions', req.params.id, t), f = sessionFields(b);
  if (db.prepare('SELECT 1 FROM games WHERE session_id=?').get(s.id)) fail(409, 'This session already has live-game records. Duplicate it to prepare changes.');
  checkGroup(f[6], t);
  db.transaction(() => {
    db.prepare(`UPDATE sessions SET title=?,description=?,objectives=?,type=?,planned_at=?,duration_min=?,group_id=?,narration_lang=?,narration_rate=?,settings=?,material_version_id=? WHERE id=?`)
      .run(...f, materialVersionFor(b.material_id, t) ?? s.material_version_id, s.id);
    if (b.student_ids) setParticipants(s.id, b.student_ids, t);
  })();
  res.json({ ok: true });
});
r.patch('/sessions/:id/status', (req, res) => {
  const s = own('sessions', req.params.id, req.user.id), to = req.body?.status;
  if (!['draft', 'published', 'archived'].includes(to)) fail(400, 'Invalid status.');
  if (to === 'published') {
    const miss = [];
    if (!s.material_version_id) miss.push('a story/question set');
    else {
      const v = db.prepare('SELECT story_text FROM material_versions WHERE id=?').get(s.material_version_id);
      if (!v?.story_text.trim()) miss.push('story text');
      if (!db.prepare("SELECT 1 FROM questions WHERE version_id=? AND status='published'").get(s.material_version_id)) miss.push('at least one published question');
    }
    if (miss.length) fail(400, `Cannot publish. Missing: ${miss.join(', ')}.`);
  }
  if (to !== 'published' && db.prepare("SELECT 1 FROM games WHERE session_id=? AND status IN ('setup','active','paused')").get(s.id)) fail(409, 'A live game is still open for this session.');
  db.prepare('UPDATE sessions SET status=? WHERE id=?').run(to, s.id);
  audit(req, 'session_status', 'session', s.id, { status: s.status }, { status: to });
  res.json({ ok: true });
});
r.post('/sessions/:id/duplicate', (req, res) => { // configuration only: no results, answers or attendance
  const s = own('sessions', req.params.id, req.user.id);
  const order = db.prepare('SELECT COALESCE(MAX(display_order),-1)+1 n FROM sessions WHERE teacher_id=?').get(req.user.id).n;
  const id = db.prepare(`INSERT INTO sessions (teacher_id,title,description,objectives,type,display_order,planned_at,duration_min,status,group_id,material_version_id,narration_lang,narration_rate,settings)
    VALUES (?,?,?,?,?,?,NULL,?,'draft',?,?,?,?,?)`).run(s.teacher_id, `${s.title} (copy)`, s.description, s.objectives, s.type, order, s.duration_min, s.group_id, s.material_version_id, s.narration_lang, s.narration_rate, s.settings).lastInsertRowid;
  res.status(201).json({ id });
});
r.delete('/sessions/:id', (req, res) => {
  const s = own('sessions', req.params.id, req.user.id);
  if (db.prepare('SELECT 1 FROM games WHERE session_id=?').get(s.id) || db.prepare("SELECT 1 FROM session_participants WHERE session_id=? AND status!='selected'").get(s.id))
    fail(409, 'This session has participation or research records. Archive it instead.');
  db.transaction(() => { db.prepare('DELETE FROM session_participants WHERE session_id=?').run(s.id); db.prepare('DELETE FROM sessions WHERE id=?').run(s.id); audit(req, 'session_delete', 'session', s.id, { title: s.title }); })();
  res.json({ ok: true });
});

// Attendance: selected / present / absent. Group membership alone never marks participation.
r.get('/sessions/:id/attendance', (req, res) => {
  const s = own('sessions', req.params.id, req.user.id);
  res.json(db.prepare(`SELECT st.id student_id, st.display_name, st.full_name, g.name group_name, sp.status FROM session_participants sp
    JOIN students st ON st.id=sp.student_id LEFT JOIN learner_groups g ON g.id=st.group_id WHERE sp.session_id=? ORDER BY st.full_name`).all(s.id));
});
r.patch('/sessions/:id/attendance/:sid', (req, res) => {
  const s = own('sessions', req.params.id, req.user.id), to = req.body?.status;
  if (!['selected', 'present', 'absent'].includes(to)) fail(400, 'Invalid status.');
  const row = db.prepare('SELECT status FROM session_participants WHERE session_id=? AND student_id=?').get(s.id, req.params.sid) || fail(404, 'Not a participant.');
  db.prepare('UPDATE session_participants SET status=? WHERE session_id=? AND student_id=?').run(to, s.id, req.params.sid);
  audit(req, 'attendance_change', 'session', s.id, { student: +req.params.sid, status: row.status }, { status: to }, req.body?.reason);
  res.json({ ok: true });
});

// ---------- Separate post-test / official assessment records ----------
r.get('/assessments', (req, res) => res.json(db.prepare(`SELECT a.id,a.student_id,st.display_name,st.full_name,a.kind,a.result,a.administered_on,a.notes
  FROM assessments a JOIN students st ON st.id=a.student_id WHERE a.teacher_id=? ${req.query.student_id ? 'AND a.student_id=?' : ''} ORDER BY a.id DESC`)
  .all(...[req.user.id, ...(req.query.student_id ? [req.query.student_id] : [])])));
r.post('/assessments', (req, res) => {
  const b = req.body || {};
  own('students', b.student_id, req.user.id);
  if (!['pre-test', 'post-test', 'phil-iri'].includes(b.kind) || !String(b.result || '').trim()) fail(400, 'Choose a type and enter the recorded result.');
  const id = db.prepare('INSERT INTO assessments (teacher_id,student_id,kind,result,administered_on,notes) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, b.student_id, b.kind, b.result.trim(), val(b.administered_on), b.notes || '').lastInsertRowid;
  audit(req, 'assessment_add', 'assessment', id, null, { kind: b.kind });
  res.status(201).json({ id });
});

// ---------- Teacher settings ----------
const TS = { allow_repeats: false, correct_note: 'Apply the approved correct-answer movement rule.', incorrect_note: 'Apply the approved incorrect-answer movement rule.' };
r.get('/settings', (req, res) => res.json({ ...TS, ...JSON.parse(db.prepare('SELECT settings FROM teachers WHERE id=?').get(req.user.id).settings || '{}') }));
r.put('/settings', (req, res) => {
  const b = req.body || {};
  const v = { allow_repeats: !!b.allow_repeats, correct_note: String(b.correct_note ?? TS.correct_note).slice(0, 300), incorrect_note: String(b.incorrect_note ?? TS.incorrect_note).slice(0, 300) };
  db.prepare('UPDATE teachers SET settings=? WHERE id=?').run(JSON.stringify(v), req.user.id);
  res.json(v);
});
r.get('/audit', (req, res) => res.json(db.prepare("SELECT * FROM audit WHERE actor_role='teacher' AND actor_id=? ORDER BY id DESC LIMIT 200").all(req.user.id)));

export default r;