import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Dice, LANGS, Status, TAG_TO_KEY, TOKENS, fmt, fmtH, useLoad, useSpeech, when } from './ui.jsx';
import { FINISH, LADDERS, SNAKES, planCorrect, planIncorrect } from './rules.js';

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const PALETTE = ['#ff6b6b', '#ffc857', '#4ecdc4', '#5aa9ff', '#9b7fe0', '#ff8c42', '#66c07a', '#e36cb0'];

export default function Live() {
  const [id, setId] = useState(null);
  const [games, reloadGames] = useLoad(() => api('/games'));
  const auto = useRef(false);
  useEffect(() => { // reopen an unfinished game after a refresh
    if (games && !auto.current) { auto.current = true; const open = games.find(g => ['setup', 'active', 'paused'].includes(g.status)); if (open) setId(open.id); }
  }, [games]);
  return <Console id={id} setId={setId} games={games} reloadGames={reloadGames} />;
}

function Console({ id, setId, games, reloadGames }) {
  const [sessions] = useLoad(() => api('/sessions'));
  const [students] = useLoad(() => api('/students'));
  const [groups] = useLoad(() => api('/groups'));
  const [tset] = useLoad(() => api('/settings'));
  const [sid, setSid] = useState(''), [gid, setGid] = useState(''), [picked, setPicked] = useState([]), [preview, setPreview] = useState(null);
  const [st, setSt] = useState(null), [at, setAt] = useState(Date.now()), [, tick] = useState(0);
  const [save, setSave] = useState({ s: 'idle', msg: '' });
  const [dec, setDec] = useState(null), [roll, setRoll] = useState(null), [rolling, setRolling] = useState(false);
  const [actual, setActual] = useState(''), [mreason, setMreason] = useState(''), [notes, setNotes] = useState('');
  const [ask, setAsk] = useState(null), [askText, setAskText] = useState('');
  const [rot, setRot] = useState(0), [spin, setSpin] = useState(false);
  const ev = useRef(null);
  const published = sessions?.filter(s => s.status === 'published') || [];

  const apply = s => { setSt(s); setAt(Date.now()); };
  const load = async () => { try { apply(await api('/games/' + id)); } catch (e) { setSave({ s: 'error', msg: `Offline — showing the last saved state. ${e.message}` }); } };
  useEffect(() => {
    setSt(null);
    if (!id) return;
    load(); const p = setInterval(load, 5000);
    return () => clearInterval(p);
  }, [id]); // eslint-disable-line
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 500); return () => clearInterval(t); }, []);

  // Never say "saved" unless the backend confirmed it. Returns the new state, or null on failure.
  const act = async fn => {
    setSave({ s: 'saving', msg: 'Saving…' });
    try { const s = await fn(); apply(s); setSave({ s: 'saved', msg: 'Saved ✓' }); return s; }
    catch (e) { setSave({ s: 'error', msg: `Not saved: ${e.message}` }); if (!e.data) load(); return null; }
  };
  const post = (path, body) => act(() => api(`/games/${id}/${path}`, 'POST', body ?? {}));

  const g = st?.game, players = st?.players || [], pending = st?.pending || null;
  useEffect(() => { setDec(null); setRoll(null); setRolling(false); setActual(''); setMreason(''); setNotes(''); ev.current = null; }, [pending?.id]);
  useEffect(() => { if (g && !sid) setSid(String(g.session_id)); }, [g]); // eslint-disable-line

  const me = players.find(p => p.id === st?.current_player_id);
  const alive = players.filter(p => !p.finished);
  const next = me && alive.length > 1 ? alive[(alive.findIndex(p => p.id === me.id) + 1) % alive.length] : null;
  const drift = g?.status === 'active' ? Date.now() - at : 0;
  const status = !g ? 'Not Started' : { setup: 'Setting up order', active: 'In progress', paused: 'Paused', ended: 'Ended' }[g.status];
  const active = g?.status === 'active';

  // ----- setup (before a game exists) -----
  const chooseSession = async v => {
    setSid(v); setPreview(null);
    if (!v) return;
    const s = await api('/sessions/' + v); setPreview(s);
    if (!gid) setPicked(s.student_ids);
  };
  const chooseGroup = v => { setGid(v); const gr = groups.find(x => String(x.id) === v); if (gr) setPicked(gr.student_ids.filter(i => students?.find(s => s.id === i && s.active))); };
  const toggle = i => setPicked(p => (p.includes(i) ? p.filter(x => x !== i) : [...p, i]));
  const startGame = async () => {
    setSave({ s: 'saving', msg: 'Creating game…' });
    try { const r = await api('/games', 'POST', { session_id: +sid, student_ids: picked }); setSave({ s: 'saved', msg: 'Game created — set the playing order.' }); reloadGames(); setId(r.id); }
    catch (e) { setSave({ s: 'error', msg: e.message }); }
  };

  // ----- movement logic (physical board; the facilitator confirms the real position) -----
  const S = g?.settings || { correct_points: 5, incorrect_points: 0, first_step_rule: 'stay', backward_connections: true };
  const plan = !me || !pending ? null : dec === 'correct' ? (roll ? planCorrect(me.position, roll) : null) : dec === 'incorrect' ? planIncorrect(me.position, S.first_step_rule, S.backward_connections) : null;
  const finalPos = actual === '' ? plan?.after : Number(actual);
  const mismatch = plan && finalPos !== plan.after;
  const ready = !!plan && Number.isInteger(finalPos) && finalPos >= 0 && finalPos <= FINISH && (!mismatch || mreason.trim()) && active;
  const via = p => (LADDERS[p] ? 'ladder' : 'snake');
  const line = plan && me && (dec === 'correct'
    ? (plan.overshoot ? `Roll ${roll} would pass Step 30, so ${me.display_name} stays on Step ${me.position}.` : `Step ${me.position || 'Start'} + ${roll} = ${plan.initial}${plan.after !== plan.initial ? ` → ${via(plan.initial)} to ${plan.after}` : ''}`)
    : `Step ${me.position || 'Start'} − 2 = ${plan.initial}${plan.after !== plan.initial ? ` → ${via(plan.initial)} to ${plan.after}` : ''} (no die roll)`);
  const hint = dec === 'correct' ? tset?.correct_note : dec === 'incorrect' ? tset?.incorrect_note : null;
  const confirm = async () => {
    ev.current ||= uid(); // same event id on retry => no double points
    await act(() => api(`/games/${id}/turns/${pending.id}/outcome`, 'POST', { event_id: ev.current, decision: dec, die_roll: dec === 'correct' ? roll : null, actual_position: finalPos, reason: mreason, notes }));
  };

  // ----- wheel -----
  const items = st?.wheel || (preview?.material?.questions || []).filter(q => q.status === 'published');
  const n = Math.max(items.length, 1), seg = 360 / n, R = 150;
  const center = qid => (Math.max(0, items.findIndex(w => w.qid === qid)) + 0.5) * seg;
  useEffect(() => { if (pending && !spin) setRot(r => r - (((r + center(pending.qid)) % 360) + 360) % 360); }, [pending?.id]); // eslint-disable-line
  const spinWheel = async path => {
    setSpin(true);
    const s = await post(path);
    if (s?.pending) setRot(r => r + 1800 + ((((-center(s.pending.qid) - r) % 360) + 360) % 360));
    setTimeout(() => setSpin(false), 3100);
  };
  const pt = (a, r) => [R + r * Math.sin((a * Math.PI) / 180), R - r * Math.cos((a * Math.PI) / 180)];

  const submitAsk = async () => {
    const ok = await post(ask === 'skip' ? 'skip' : 'undo', { reason: askText });
    if (ok) { setAsk(null); setAskText(''); }
  };
  const canUndo = (g?.status === 'active' || g?.status === 'paused') && !pending && st?.turns.some(t => t.status === 'final');
  const msg = !pending ? 'No result selected.' : !dec ? 'Question selected. Mark the answer correct or incorrect.' : `Marked ${dec}.${dec === 'correct' && !roll ? ' Press Roll Movement Dice and enter the physical die number.' : ''}`;

  return (
    <>
      <section className="card"><h1>Live Game Monitoring</h1>
        <div className="grid">
          <label>Active Group<select value={gid} disabled={!!id} onChange={e => chooseGroup(e.target.value)}><option value="">Select a group</option>{groups?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>Session<select value={sid} disabled={!!id} onChange={e => chooseSession(e.target.value)}><option value="">Select a published session</option>{published.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}{id && g && !published.find(s => s.id === g.session_id) && <option value={g.session_id}>{g.session_title}</option>}</select></label>
          <label>Activity Status<input readOnly value={status} /></label>
        </div>

        <div className="grid4 stats three">
          <div className="stat accent"><small>Current Player</small><b>{me ? `${me.avatar} ${me.display_name}` : '-'}</b></div>
          <div className="stat accent"><small>Next Player</small><b>{next ? `${next.avatar} ${next.display_name}` : '-'}</b></div>
          <div className="stat accent"><small>Elapsed Time</small><b className="mono">{fmtH((g?.elapsed_ms || 0) + drift)}</b></div>
        </div>

        <div className="actions">
          <button className="btn green" disabled={!!id || !sid || !picked.length} onClick={startGame}>Start Game</button>
          <button className="btn amber" disabled={!active} onClick={() => post('pause')}>Pause</button>
          <button className="btn" disabled={g?.status !== 'paused'} onClick={() => post('resume')}>Resume</button>
          <button className="btn red" disabled={!(active || g?.status === 'paused')} onClick={() => window.confirm('End this game? Finalize or skip any pending question first.') && post('end', { confirm: true })}>End Game</button>
          <button className="btn dark" disabled={!active || !me} onClick={() => setAsk(ask === 'skip' ? null : 'skip')}>Next Player</button>
          <button className="btn purple" disabled={!active || !pending || dec !== 'correct'} onClick={() => setRolling(true)} title="Enter the number from the learner's physical die">Roll Movement Dice</button>
          <span className={'savechip ' + save.s} role="status" aria-live="polite">{save.msg || 'Ready'}</span>
        </div>
        {g?.status === 'paused' && <p className="warn" role="alert">Paused — timers are stopped and no answers can be recorded.</p>}
        {g?.status === 'ended' && <p className="ok">Game ended {when(g.ended_at)}. See Progress Reports for the summary.</p>}
        {ask && (
          <div className="confirm"><label>{ask === 'skip' ? 'Reason for moving to the next player (required)' : 'Reason for undoing the last result (required)'}<input value={askText} onChange={e => setAskText(e.target.value)} /></label>
            <button className="btn" disabled={!askText.trim()} onClick={submitAsk}>{ask === 'skip' ? 'Confirm: Next Player' : 'Confirm: Undo Last Result'}</button><button className="btn out" onClick={() => { setAsk(null); setAskText(''); }}>Cancel</button></div>
        )}

        {!id && sid && (
          <div className="confirm"><b>Confirm participants ({picked.length})</b>
            <div className="checklist">{students?.filter(s => s.active).map(s => (
              <label key={s.id} className="check pillcheck"><input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} /> {s.avatar} {s.display_name}{s.group_name ? ` · ${s.group_name}` : ''}</label>))}</div>
            <p className="muted">Press Start Game to create the game, then record each learner's physical die roll for the playing order.</p></div>
        )}
        {g?.status === 'setup' && <OrderDice players={players} onSubmit={b => post('order', b)} error={save.s === 'error' ? save.msg : ''} />}

        <div className="dice-center"><Dice value={dec === 'correct' ? roll : null} /></div>
        <div className="info">
          {plan ? <><b>Expected:</b> {line} → <b>Step {plan.after}</b>{hint && <><br /><small className="muted">{hint}</small></>}</>
            : rolling && dec === 'correct' && !roll ? <>Learner rolls the <b>physical</b> die. Enter the number shown:</>
              : pending && !dec ? 'Mark the answer correct or incorrect.' : 'Physical board movement instructions will appear here.'}
          {rolling && dec === 'correct' && <div>{[1, 2, 3, 4, 5, 6].map(k => <button key={k} className={'btn die' + (roll === k ? ' sel' : '')} onClick={() => setRoll(k)}>{k}</button>)}</div>}
          {plan && (
            <div className="confirm">
              <label>Confirmed physical position (0 = Start)<input type="number" min="0" max="30" value={actual === '' ? plan.after : actual} onChange={e => setActual(e.target.value)} /></label>
              {mismatch && <label>Reason it differs from the expected result<input value={mreason} onChange={e => setMreason(e.target.value)} /></label>}
              <small className="muted">Points on save: {dec === 'correct' ? (pending.points ?? S.correct_points) : S.incorrect_points}{finalPos === FINISH ? ' · Step 30 will be recorded as a verified finish.' : ''}</small>
            </div>
          )}
        </div>

        <div className="wheelwrap">
          <div>
            <h3>Question Wheel - Identifiers Only</h3>
            <div className="wheelbox">
              <div className="pointer" aria-hidden="true" />
              <svg viewBox={`0 0 ${R * 2} ${R * 2}`} className="wheel-svg" style={{ transform: `rotate(${rot}deg)`, transition: spin ? 'transform 3s cubic-bezier(.17,.67,.2,1)' : 'none' }} role="img" aria-label={`Wheel with ${items.length} question identifiers`}>
                {items.length <= 1 ? <circle cx={R} cy={R} r={R - 4} fill={items[0]?.color || PALETTE[0]} /> : items.map((w, i) => {
                  const [x0, y0] = pt(i * seg, R - 4), [x1, y1] = pt((i + 1) * seg, R - 4), [tx, ty] = pt((i + 0.5) * seg, R * 0.68);
                  return <g key={w.qid}><path d={`M${R} ${R} L${x0} ${y0} A${R - 4} ${R - 4} 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`} fill={w.color || PALETTE[i % PALETTE.length]} stroke="#fff" strokeWidth="3" />
                    <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize="18" fontWeight="800" fill="#fff" stroke="#183153" strokeWidth=".6">{w.qid}</text></g>;
                })}
                <circle cx={R} cy={R} r="26" fill="#183153" stroke="#fff" strokeWidth="5" />
              </svg>
            </div>
            <div className="actions below">
              <button className="btn" disabled={!active || !me || !!pending || spin} onClick={() => spinWheel('question')}>{spin ? 'Spinning…' : 'Spin Question'}</button>
              <button className="btn out" disabled={!active || !pending || !!dec || spin} onClick={() => spinWheel('respin')} title="Replace the unanswered question with a new draw (kept in the record)">Spin Again</button>
            </div>
          </div>
          <div>
            <div className="selected">
              {pending ? (
                <>
                  <h4>Selected: {pending.qid} <small>· {pending.category}</small></h4>
                  <p className="qtext">{pending.text}</p>
                  <p className="muted"><b>Answer guide (facilitator only):</b> {pending.guidance || '—'}</p>
                  {pending.alternatives && <p className="muted"><b>Also acceptable:</b> {pending.alternatives}</p>}
                  {pending.notes && <p className="muted"><b>Private notes:</b> {pending.notes}</p>}
                  <span className="badge b-pending">Pending — not yet saved as a result</span>
                  {'speechSynthesis' in window && <button className="btn small out" onClick={() => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(pending.text)); }}>Repeat Question</button>}
                </>
              ) : <><h4>Selected: None</h4><p className="muted">Spin the wheel to select a published question.</p></>}
            </div>
            <label>Optional Facilitator Notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
            <div className="actions">
              <button className={'btn green' + (dec === 'correct' ? ' sel' : '')} disabled={!active || !pending} onClick={() => setDec('correct')}>Mark Correct</button>
              <button className={'btn red' + (dec === 'incorrect' ? ' sel' : '')} disabled={!active || !pending} onClick={() => { setDec('incorrect'); setRoll(null); setRolling(false); }}>Mark Incorrect</button>
            </div>
            <div className="actions">
              <button className="btn" disabled={!ready || save.s === 'saving'} onClick={confirm}>Confirm Result</button>
              <button className="btn out" disabled={!canUndo} onClick={() => setAsk(ask === 'undo' ? null : 'undo')}>Undo Last Result</button>
            </div>
            <p className="muted">{msg}</p>
            {save.s === 'error' && <p className="err" role="alert">{save.msg}</p>}
          </div>
        </div>

        <History st={st} act={act} id={id} />
      </section>

      {st && g.status !== 'setup' && (
        <div className="two">
          <Queue players={players} />
          <Board players={players} />
          <Story st={st} />
          <Prizes st={st} act={act} id={id} />
        </div>
      )}

      <section className="card"><h2>Games</h2>
        {id && <button className="btn" onClick={() => { setId(null); setSid(''); setGid(''); setPicked([]); setPreview(null); setSave({ s: 'idle', msg: '' }); }}>+ New game</button>}
        <div className="scroll"><table><thead><tr><th>#</th><th>Session</th><th>Material</th><th>Players</th><th>Status</th><th>Started</th><th /></tr></thead>
          <tbody>{games?.map(x => (
            <tr key={x.id}><td>{x.id}</td><td>{x.session_title}</td><td>v{x.version}</td><td>{x.players}</td><td><Status>{x.status}</Status></td><td>{when(x.started_at)}</td>
              <td><button className="btn small" onClick={() => setId(x.id)}>{x.status === 'ended' ? 'View' : 'Open'}</button></td></tr>))}</tbody></table></div>
      </section>
    </>
  );
}

// Turn order: the facilitator records each learner's PHYSICAL die roll (the website never rolls for them).
function OrderDice({ players, onSubmit, error }) {
  const [rolls, setRolls] = useState({}), [manual, setManual] = useState(false), [order, setOrder] = useState({}), [sorted, setSorted] = useState(false);
  const nextP = players.find(p => !rolls[p.id]);
  const last = Object.values(rolls).filter(Boolean).slice(-1)[0];
  const vals = players.map(p => rolls[p.id]).filter(Boolean);
  const tied = players.filter(p => rolls[p.id] && vals.filter(v => v === rolls[p.id]).length > 1);
  const byRoll = [...players].sort((a, b) => (rolls[b.id] || 0) - (rolls[a.id] || 0));
  const ready = manual ? players.every(p => order[p.id]) : players.every(p => rolls[p.id]) && !tied.length;
  const submit = () => onSubmit(manual
    ? { order: [...players].sort((a, b) => order[a.id] - order[b.id]).map(p => p.id) }
    : { order: byRoll.map(p => p.id) });
  return (
    <div className="confirm"><h3>Initial Player-Identification Dice</h3>
      <p className="muted">Each selected player rolls the physical die once. Tied players roll again (tap “Re-roll”). These rolls set the starting order only and are separate from board movement.</p>
      <div className="dice-row"><Dice value={last} />
        {!manual && (nextP ? <div><p><b>{nextP.avatar} {nextP.display_name}</b> — enter the number rolled:</p>{[1, 2, 3, 4, 5, 6].map(k => <button key={k} className="btn die" onClick={() => setRolls({ ...rolls, [nextP.id]: k })}>{k}</button>)}</div> : <p className="ok">All rolls recorded.</p>)}
      </div>
      <div className="scroll"><table><thead><tr><th>Learner</th><th>{manual ? 'Order #' : 'Roll'}</th>{!manual && <th />}</tr></thead>
        <tbody>{(sorted && !manual ? byRoll : players).map(p => (
          <tr key={p.id} className={tied.includes(p) ? 'tie' : ''}><td>{p.avatar} {p.display_name}</td>
            <td>{manual ? <input type="number" min="1" max={players.length} value={order[p.id] ?? ''} onChange={e => setOrder({ ...order, [p.id]: e.target.value })} aria-label={`Order for ${p.display_name}`} /> : rolls[p.id] ?? '—'}</td>
            {!manual && <td>{rolls[p.id] && <button className="btn small out" onClick={() => setRolls({ ...rolls, [p.id]: undefined })}>Re-roll</button>}</td>}</tr>))}</tbody></table></div>
      {tied.length > 0 && !manual && <p className="warn">Tie: {tied.map(p => p.display_name).join(', ')} — re-roll, or set the order manually.</p>}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn amber" disabled={manual || tied.length > 0 || !players.every(p => rolls[p.id])} onClick={() => setSorted(true)}>Order by Highest Roll</button>
        <button className="btn purple" onClick={() => setManual(!manual)}>{manual ? 'Use Die Rolls' : 'Set Manual Order'}</button>
        <button className="btn green" disabled={!ready} onClick={submit}>Confirm Order</button>
      </div>
    </div>
  );
}

function Queue({ players }) {
  return (
    <div className="card"><h3>Turn queue</h3>
      <ol className="queue">{players.map(p => (
        <li key={p.id} className={p.status.toLowerCase()}><span>{p.avatar} {p.display_name}</span><Status>{p.status}</Status><small>Step {p.position || 'Start'} · {p.points} pts</small></li>))}</ol>
    </div>
  );
}

function Board({ players }) {
  const rows = [];
  for (let r = 5; r >= 0; r--) { const row = [1, 2, 3, 4, 5].map(c => r * 5 + c); rows.push(r % 2 ? row.reverse() : row); }
  const at = k => players.filter(p => p.position === k);
  return (
    <div className="card"><h3>Board (confirmed positions)</h3>
      <div className="board" role="img" aria-label="30-step Snake and Ladder board">
        {rows.flat().map(k => (
          <div key={k} className={'cell' + (k === FINISH ? ' fin' : '')} title={LADDERS[k] ? `Ladder to ${LADDERS[k]}` : SNAKES[k] ? `Snake to ${SNAKES[k]}` : ''}>
            <small>{k}</small>{LADDERS[k] && <em className="lad">🪜{LADDERS[k]}</em>}{SNAKES[k] && <em className="snk">🐍{SNAKES[k]}</em>}
            <span>{at(k).map(p => `${p.avatar}${TOKENS[p.token] || ''}`).join(' ')}</span></div>))}
      </div>
      <p className="muted">Start: {at(0).map(p => p.avatar).join(' ') || '—'}</p>
    </div>
  );
}

function Story({ st }) {
  const { story, game } = st;
  const sp = useSpeech();
  const tag = game.narration_lang || 'en-US';
  const play = () => sp.play(story.text, tag, game.narration_rate || 0.9);
  return (
    <div className="card"><h3>{story.title || 'Story'} <small className="muted">({LANGS[TAG_TO_KEY(tag)].label}, {Number(game.narration_rate || 0.9).toFixed(1)}×)</small></h3>
      {sp.supported ? <div className="actions">
        <button className="btn" onClick={play}>▶ Play</button><button className="btn out" onClick={sp.pause}>⏸ Pause</button><button className="btn out" onClick={sp.resume}>Resume</button>
        <button className="btn out" onClick={sp.stop}>⏹ Stop</button><button className="btn out" onClick={play}>↻ Replay</button>
      </div> : <p className="muted">Narration is not available in this browser. Read the story aloud from the text below.</p>}
      <p className="story">{story.text}</p>
    </div>
  );
}

function Prizes({ st, act, id }) {
  const [f, setF] = useState({ player_id: '', kind: 'consolation', note: '' });
  if (!st.players.length) return null;
  return (
    <div className="card"><h3>Prizes (recorded separately from points)</h3>
      {st.prizes.length > 0 && <ul>{st.prizes.map(p => <li key={p.id}>{p.display_name}: {p.kind}{p.note ? ` — ${p.note}` : ''}</li>)}</ul>}
      <div className="grid">
        <label>Learner<select value={f.player_id} onChange={e => setF({ ...f, player_id: e.target.value })}><option value="">—</option>{st.players.map(p => <option key={p.id} value={p.id}>{p.display_name}{p.finished ? ` (finished #${p.rank})` : ''}</option>)}</select></label>
        <label>Prize<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="grand">Grand prize</option><option value="consolation">Consolation</option></select></label>
        <label>Note<input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      </div>
      <button className="btn dark" disabled={!f.player_id} onClick={() => act(() => api(`/games/${id}/prizes`, 'POST', { ...f, player_id: +f.player_id }))}>Record prize</button>
    </div>
  );
}

// Correction of a saved event: reason required, original kept in the audit log.
export function CorrectForm({ c, setC, act, id }) {
  if (!c) return null;
  return (
    <div className="confirm"><h4>Correct a saved event (original is kept in the audit log)</h4>
      <div className="grid">
        <label>Decision<select value={c.decision} onChange={e => setC({ ...c, decision: e.target.value })}><option>correct</option><option>incorrect</option></select></label>
        <label>Points<input type="number" min="0" value={c.points} onChange={e => setC({ ...c, points: e.target.value })} /></label>
        <label>Final position<input type="number" min="0" max="30" value={c.final_position} onChange={e => setC({ ...c, final_position: e.target.value })} /></label>
      </div>
      <label>Reason (required)<input value={c.reason} onChange={e => setC({ ...c, reason: e.target.value })} /></label>
      <button className="btn" disabled={!c.reason.trim()} onClick={async () => { if (await act(() => api(`/games/${id}/turns/${c.tid}/correct`, 'POST', { decision: c.decision, points: +c.points, final_position: +c.final_position, reason: c.reason }))) setC(null); }}>Save correction</button>
      <button className="btn dark" onClick={() => setC(null)}>Cancel</button>
    </div>
  );
}

function History({ st, act, id }) {
  const [c, setC] = useState(null);
  const turns = st?.turns || [];
  return (
    <>
      <h3>Answer History</h3>
      {!turns.length ? <p className="muted">No answers recorded yet.</p> : (
        <div className="scroll"><table><thead><tr><th>Learner</th><th>Q</th><th>Result</th><th>Pts</th><th>Move</th><th>Time</th><th /></tr></thead>
          <tbody>{turns.map(t => (
            <tr key={t.id} className={t.status === 'voided' ? 'dim' : ''}><td>{t.display_name}</td><td>{t.qid || '—'}</td>
              <td>{t.status === 'voided' ? (t.decision ? 'undone' : 'spun again') : t.decision}{t.corrected ? ' (corrected)' : ''}{t.reason ? ` — ${t.reason}` : ''}{t.status === 'voided' && t.correction_reason ? ` — ${t.correction_reason}` : ''}</td><td>{t.status === 'voided' ? '—' : t.points}</td>
              <td>{t.final_position != null ? `${t.prev_position || 'Start'}${t.die_roll ? ` +${t.die_roll}` : ' −2'} → ${t.final_position}` : '—'}{t.mismatch_reason ? ` ⚠ ${t.mismatch_reason}` : ''}</td>
              <td>{t.duration_ms != null ? fmt(t.duration_ms) : '—'}</td>
              <td>{t.status === 'final' && t.final_position != null && <button className="btn small dark" onClick={() => setC({ tid: t.id, decision: t.decision, points: t.points, final_position: t.final_position, reason: '' })}>Correct</button>}</td></tr>))}</tbody></table></div>
      )}
      <CorrectForm c={c} setC={setC} act={act} id={id} />
    </>
  );
}
