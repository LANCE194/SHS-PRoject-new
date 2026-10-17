// npm test : boots the API on a temp DB and checks the board rules, permissions, and gameplay flow.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planCorrect, planIncorrect, connection } from '../src/rules.js';

assert.equal(connection(3), 10); assert.equal(connection(6), 17); assert.equal(connection(12), 23); assert.equal(connection(21), 27);
assert.equal(connection(15), 1); assert.equal(connection(9), 5); assert.equal(connection(26), 22); assert.equal(connection(29), 18);
assert.equal(connection(10), 10);
assert.deepEqual(planCorrect(27, 3), { initial: 30, after: 30, overshoot: false });
assert.equal(planCorrect(27, 4).after, 27);            // exact finish: overshoot stays
assert.equal(planIncorrect(12).after, 10);             // two steps back, no die
assert.equal(planIncorrect(5).after, 10);              // 5-2=3 -> ladder to 10
assert.equal(planIncorrect(1).after, 1);               // boundary rule 'stay'
assert.equal(planIncorrect(1, 'start').after, 0);

const DB = '/tmp/ambak-smoke.db', PORT = 3999, base = `http://localhost:${PORT}/api`;
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, DB_FILE: DB, PORT, JWT_SECRET: 'test' }, stdio: 'inherit' });
const call = async (url, method = 'GET', body, tok) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: 'Bearer ' + tok }) }, body: body && JSON.stringify(body) });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[1] || 'GET'} ${a[0]} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
try {
  await new Promise(r => setTimeout(r, 2500));
  const T = (await ok('/login', 'POST', { role: 'teacher', username: 'teacher', password: 'ambak123' })).token;
  assert.equal((await call('/login', 'POST', { role: 'teacher', username: 'teacher', password: 'bad' })).status, 401);
  assert.equal((await call('/students')).status, 401);

  const gid = (await ok('/groups', 'POST', { name: 'Group A' }, T)).id;
  const a = (await ok('/students', 'POST', { username: 'ana', password: 'secret1', full_name: 'Ana Cruz', lrn: '123456789012', group_id: gid }, T)).id;
  const b = (await ok('/students', 'POST', { username: 'ben', password: 'secret1', full_name: 'Ben Lim' }, T)).id;
  assert.equal((await call('/students', 'POST', { username: 'ana', password: 'secret1', full_name: 'Dup' }, T)).status, 409);

  const list = await ok('/students', 'GET', null, T);
  assert.equal(list.find(x => x.id === a).lrn, undefined); assert.equal(list.find(x => x.id === a).lrn_masked, '••••••••9012');
  const g2 = (await ok('/groups', 'POST', { name: 'Group B', student_ids: [a, b] }, T)).id;
  assert.deepEqual((await ok('/groups', 'GET', null, T)).find(x => x.id === g2).student_ids.sort(), [a, b].sort());
  const mat = (await ok('/materials', 'GET', null, T))[0];
  assert.equal((await ok('/sessions', 'GET', null, T)).length, 4); // seeded demo sessions
  const sid = (await ok('/sessions', 'POST', { title: 'Session 1', objectives: 'obj', material_id: mat.id, student_ids: [a, b] }, T)).id;
  assert.equal((await call(`/games`, 'POST', { session_id: sid, student_ids: [a] }, T)).status, 400); // draft session blocked
  await ok(`/sessions/${sid}/status`, 'PATCH', { status: 'published' }, T);

  // learner permissions
  const L = (await ok('/login', 'POST', { role: 'student', username: 'ana', password: 'secret1' })).token;
  assert.equal((await call('/students', 'GET', null, L)).status, 401);
  assert.equal((await call('/games', 'POST', { session_id: sid, student_ids: [a] }, L)).status, 401);
  const me = await ok('/me', 'GET', null, L);
  assert.equal(me.lrn_masked, '••••••••9012'); assert.equal(me.lrn, undefined);
  assert.equal((await ok('/me/summary', 'GET', null, L)).accuracy, null);
  await ok('/me', 'PUT', { display_name: 'Ana', avatar: '🐯', prefs: { language: 'fil', voice: false, rate: 1.2, sound: false } }, L);
  const me2 = await ok('/me', 'GET', null, L);
  assert.equal(me2.prefs.language, 'fil'); assert.equal(me2.prefs.voice, false); assert.equal(me2.prefs.rate, 1.2);
  assert.equal((await call('/settings', 'GET', null, L)).status, 401);
  await ok('/me', 'PUT', { display_name: 'Ana', avatar: '🐯', prefs: { ...me2.prefs, color: '#e7515a', token: 'shield' } }, L);
  const me3 = await ok('/me', 'GET', null, L); assert.equal(me3.prefs.token, 'shield'); assert.equal(me3.prefs.color, '#e7515a');
  const ov = await ok(`/me/sessions/${sid}`, 'GET', null, L);
  assert.ok(ov.story_text && ov.title === 'Session 1' && ov.questions === undefined); // story only, never questions
  assert.equal((await call('/me/sessions/999999', 'GET', null, L)).status, 404);

  // live game
  const g = (await ok('/games', 'POST', { session_id: sid, student_ids: [a, b] }, T)).id;
  assert.equal((await call(`/games/${g}/question`, 'POST', {}, T)).status, 409); // order not set yet
  let st = await ok(`/games/${g}`, 'GET', null, T);
  const [pa, pb] = [st.players.find(p => p.student_id === a).id, st.players.find(p => p.student_id === b).id];
  assert.equal((await call(`/games/${g}/order`, 'POST', { rolls: { [pa]: 4, [pb]: 4 } }, T)).status, 409); // tie
  st = await ok(`/games/${g}/order`, 'POST', { rolls: { [pa]: 6, [pb]: 2 } }, T);
  assert.equal(st.current_player_id, pa);

  let n = 0;
  const turn = async (dec, roll, actual, reason) => {
    const s1 = await ok(`/games/${g}/question`, 'POST', {}, T);
    const s1b = await ok(`/games/${g}/question`, 'POST', {}, T);
    assert.equal(s1.pending.id, s1b.pending.id); // no second pending turn
    const body = { event_id: `ev-${++n}`, decision: dec, die_roll: roll, actual_position: actual, reason };
    const r = await call(`/games/${g}/turns/${s1.pending.id}/outcome`, 'POST', body, T);
    return { r, tid: s1.pending.id, body };
  };
  const cycle = async (roll, expectA) => {
    const x = await turn('correct', roll, expectA);
    assert.equal(x.r.status, 200, JSON.stringify(x.r.data));
    assert.equal(x.r.data.players.find(p => p.id === pa).position, expectA);
    const y = await turn('incorrect', null, 0);
    assert.equal(y.r.status, 200, JSON.stringify(y.r.data));
    return x;
  };
  // mismatch needs a reason
  const bad = await turn('correct', 1, 5);
  assert.equal(bad.r.status, 400); assert.equal(bad.r.data.expected, 1);
  const first = await call(`/games/${g}/turns/${bad.tid}/outcome`, 'POST', { ...bad.body, actual_position: 1 }, T);
  assert.equal(first.status, 200);
  // replay of the same event is idempotent; points awarded once
  const replay = await call(`/games/${g}/turns/${bad.tid}/outcome`, 'POST', { ...bad.body, actual_position: 1 }, T);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.players.find(p => p.id === pa).points, 5);
  assert.equal((await call(`/games/${g}/turns/${bad.tid}/outcome`, 'POST', { ...bad.body, event_id: 'other', actual_position: 1 }, T)).status, 409);
  const yb = await turn('incorrect', null, 0); assert.equal(yb.r.status, 200);
  await cycle(2, 10);   // 1+2=3 -> ladder 10
  await cycle(2, 23);   // 10+2=12 -> ladder 23
  await cycle(4, 27);   // 23+4=27
  await cycle(4, 27);   // overshoot stays
  st = (await turn('correct', 3, 30)).r.data;   // exact finish
  const A = st.players.find(p => p.id === pa);
  assert.equal(A.finished, true); assert.equal(A.rank, 1); assert.equal(A.points, 30);
  assert.equal(st.players.find(p => p.id === pb).points, 0);  // points and rank are separate measures
  assert.equal(st.current_player_id, pb);

  // incorrect answer: exactly two back, correction keeps audit
  const corr = await ok(`/games/${g}/turns/${bad.tid}/correct`, 'POST', { decision: 'incorrect', points: 0, final_position: 1, reason: 'test' }, T);
  assert.equal(corr.players.find(p => p.id === pa).points, 25);
  assert.equal((await call(`/games/${g}/turns/${bad.tid}/correct`, 'POST', { points: 0 }, T)).status, 400); // reason required
  const audit = await ok('/audit', 'GET', null, T);
  assert.ok(audit.some(x => x.action === 'turn_correction' && x.old_value));

  // undo the finishing result (reason required), then re-confirm the finish
  assert.equal((await call(`/games/${g}/undo`, 'POST', {}, T)).status, 400);
  st = await ok(`/games/${g}/undo`, 'POST', { reason: 'wrong cell' }, T);
  const A2 = st.players.find(p => p.id === pa);
  assert.equal(A2.finished, false); assert.equal(A2.position, 27); assert.equal(st.current_player_id, pa);
  st = (await turn('correct', 3, 30)).r.data;
  assert.equal(st.players.find(p => p.id === pa).finished, true);
  assert.equal((await call(`/games/${g}/end`, 'POST', {}, T)).status, 400); // needs confirmation
  const pend = await ok(`/games/${g}/question`, 'POST', {}, T);
  const rs = await ok(`/games/${g}/respin`, 'POST', {}, T);
  assert.ok(rs.pending && rs.pending.id !== pend.pending.id); // spin again replaces the unanswered draw
  assert.equal((await call(`/games/${g}/end`, 'POST', { confirm: true }, T)).status, 409); // pending turn
  await ok(`/games/${g}/skip`, 'POST', { reason: 'learner left' }, T);
  await ok(`/games/${g}/pause`, 'POST', {}, T);
  assert.equal((await call(`/games/${g}/question`, 'POST', {}, T)).status, 409);
  await ok(`/games/${g}/resume`, 'POST', {}, T);
  st = await ok(`/games/${g}/end`, 'POST', { confirm: true }, T);
  assert.equal(st.game.status, 'ended');

  // learner sees only own results; session deletion is blocked once records exist
  const sum = await ok('/me/summary', 'GET', null, L);
  assert.equal(sum.completed, 1); assert.equal(sum.finishes.length, 1);
  assert.equal((await call(`/sessions/${sid}`, 'DELETE', null, T)).status, 409);
  assert.equal((await call(`/sessions/${sid}`, 'PUT', { title: 'x' }, T)).status, 409);
  const csv = await call('/export/turns.csv', 'GET', null, T);
  assert.ok(csv.data.startsWith('game_id') && !csv.data.includes('Ana Cruz'));

  await ok(`/students/${a}/active`, 'PATCH', { active: false }, T);
  assert.equal((await call('/me', 'GET', null, L)).status, 401);
  assert.equal((await call(`/students/${a}`, 'DELETE', null, T)).status, 409);
  console.log('All smoke tests passed.');
} catch (e) { console.error(e); process.exitCode = 1; } finally { srv.kill(); }
