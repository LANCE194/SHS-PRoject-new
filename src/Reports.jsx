import { useEffect, useState } from 'react';
import { api, download } from './api.js';
import { Status, Tabs, fmt, useLoad, when } from './ui.jsx';
import { CorrectForm } from './Live.jsx';

export default function Reports() {
  const [tab, setTab] = useState('games');
  return (
    <>
      <section className="card"><h1>Preliminary A.M.B.A.K. Intervention Progress - Not an Official Phil-IRI Diagnosis</h1>
        <p>These records indicate intervention performance only. They do not automatically classify learners as frustration-level, instructional-level, or independent-level.</p>
      </section>
      <Tabs value={tab} onChange={setTab} tabs={[['games', 'Session summaries'], ['attendance', 'Attendance'], ['learner', 'Learner history'], ['assess', 'Assessments'], ['audit', 'Audit log']]} />
      {tab === 'games' && <GameReports />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'learner' && <LearnerHistory />}
      {tab === 'assess' && <Assessments />}
      {tab === 'audit' && <Audit />}
    </>
  );
}

// Finish order comes only from facilitator-confirmed Step 30 results in the live game.
export function FinishTracker() {
  const [games] = useLoad(() => api('/games'));
  const [gid, setGid] = useState(''), [st, setSt] = useState(null), [c, setC] = useState(null), [err, setErr] = useState('');
  useEffect(() => { if (games?.length && !gid) setGid(String(games[0].id)); }, [games, gid]);
  useEffect(() => { if (gid) api('/games/' + gid).then(setSt).catch(x => setErr(x.message)); }, [gid]);
  const act = async fn => { setErr(''); try { const s = await fn(); setSt(s); return s; } catch (x) { setErr(x.message); return null; } };
  const finished = (st?.players || []).filter(p => p.finished).sort((a, b) => a.rank - b.rank);
  const last = [...finished].sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1))[0];
  const correctLast = () => {
    const t = st.turns.find(x => x.player_id === last.id && x.final_position === 30 && x.status === 'final');
    if (t) setC({ tid: t.id, decision: t.decision, points: t.points, final_position: t.final_position, reason: '' });
  };
  return (
    <section className="card"><h1>Physical Game Finish Tracker</h1>
      <p>Ranks are assigned only when the facilitator confirms that a player completed the physical board (confirmed Step 30 in the live game).</p>
      <label>Game<select value={gid} onChange={e => setGid(e.target.value)}>{games?.map(g => <option key={g.id} value={g.id}>#{g.id} · {g.session_title} · {g.status}</option>)}</select></label>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="scroll"><table><thead><tr><th>Rank</th><th>Player</th><th>Status</th><th>Finish Time</th></tr></thead>
        <tbody>{st?.players.map(p => <tr key={p.id}><td>{p.finished ? `${p.rank}${p.tie ? ' (tie)' : ''}` : '—'}</td><td>{p.avatar} {p.display_name}</td><td>{p.finished ? 'Finished' : `Step ${p.position || 'Start'}`}</td><td>{p.finished ? when(p.finished_at) : '—'}</td></tr>)}</tbody></table></div>
      {!finished.length && st && <p className="muted">No verified finishes recorded.</p>}
      <button className="btn amber" disabled={!last} onClick={correctLast}>Correct Last Finish</button>
      <CorrectForm c={c} setC={setC} act={act} id={gid} />
    </section>
  );
}

export function ExportPage() {
  const [names, setNames] = useState(false), [err, setErr] = useState('');
  return (
    <section className="card"><h1>Data Export</h1>
      <p>Exports omit passwords and full LRNs.</p>
      <label className="check"><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} /> Include learner full names (identifiable — store securely)</label>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn green" onClick={() => download(`/export/turns.csv?names=${names ? 1 : 0}`, 'ambak-results.csv').catch(x => setErr(x.message))}>Export Results CSV</button>
      <button className="btn purple" onClick={() => window.print()}>Print Current Report</button>
    </section>
  );
}

function GameReports() {
  const [games] = useLoad(() => api('/games'));
  const [r, setR] = useState(null), [names, setNames] = useState(false), [err, setErr] = useState('');
  const open = async id => { setErr(''); try { setR(await api(`/games/${id}/report`)); } catch (x) { setErr(x.message); } };
  const exp = id => download(`/export/turns.csv?${id ? `game_id=${id}&` : ''}names=${names ? 1 : 0}`, 'ambak-turns.csv').catch(x => setErr(x.message));
  return (
    <>
      <div className="card"><h3>Games</h3>
        {err && <p className="err" role="alert">{err}</p>}
        <label className="check"><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} /> Include learner full names in CSV (identifiable — store securely)</label>
        <button className="btn dark" onClick={() => exp()}>Export all events (CSV)</button>
        <div className="scroll"><table><thead><tr><th>#</th><th>Session</th><th>Material</th><th>Players</th><th>Status</th><th>Started</th><th /></tr></thead>
          <tbody>{games?.map(g => <tr key={g.id}><td>{g.id}</td><td>{g.session_title}</td><td>v{g.version}</td><td>{g.players}</td><td><Status>{g.status}</Status></td><td>{when(g.started_at)}</td>
            <td><button className="btn small" onClick={() => open(g.id)}>Summary</button> <button className="btn small dark" onClick={() => exp(g.id)}>CSV</button></td></tr>)}</tbody></table></div>
      </div>
      {r && (
        <div className="card"><h3>{r.game.session_title} — game #{r.game.id}</h3>
          <p>Material: {r.game.material_title} v{r.game.version} · Started {when(r.game.started_at)} · Ended {when(r.game.ended_at)} · Total time {fmt(r.game.elapsed_ms)}</p>
          <div className="scroll"><table>
            <thead><tr><th>Learner</th><th>Game points</th><th>Correct</th><th>Incorrect</th><th>Game accuracy</th><th>Active answer time</th><th>Board step</th><th>Physical finish</th></tr></thead>
            <tbody>{r.players.map(p => <tr key={p.id}><td>{p.avatar} {p.display_name}</td><td>{p.points}</td><td>{p.correct}</td><td>{p.incorrect}</td><td>{p.accuracy == null ? 'Not yet available' : p.accuracy + '%'}</td><td>{fmt(p.active_ms)}</td><td>{p.position || 'Start'}</td>
              <td>{p.finished ? `#${p.rank}${p.tie ? ' (tie)' : ''} · ${when(p.finished_at)}` : '—'}</td></tr>)}</tbody></table></div>
          <p className="muted">Game points, physical finish rank and official assessments are separate measures. Game results are not Phil-IRI scores.</p>
          <h4>Question events</h4>
          <div className="scroll"><table><thead><tr><th>Time</th><th>Learner</th><th>Q</th><th>Result</th><th>Pts</th><th>Roll</th><th>From → To</th><th>Active time</th></tr></thead>
            <tbody>{[...r.turns].reverse().map(t => <tr key={t.id}><td>{when(t.confirmed_at)}</td><td>{t.display_name}</td><td>{t.qid || '—'}</td><td>{t.decision}{t.corrected ? ' (corrected)' : ''}</td><td>{t.points}</td><td>{t.die_roll ?? '—'}</td><td>{t.final_position != null ? `${t.prev_position} → ${t.final_position}` : '—'}</td><td>{t.duration_ms != null ? fmt(t.duration_ms) : '—'}</td></tr>)}</tbody></table></div>
          {r.prizes.length > 0 && <><h4>Prizes</h4><ul>{r.prizes.map(p => <li key={p.id}>{p.display_name}: {p.kind} {p.note && `— ${p.note}`}</li>)}</ul></>}
        </div>
      )}
    </>
  );
}

function Attendance() {
  const [sessions] = useLoad(() => api('/sessions'));
  const [sid, setSid] = useState('');
  const [rows, reload] = useLoad(() => (sid ? api(`/sessions/${sid}/attendance`) : Promise.resolve([])), [sid]);
  const set = async (stu, status) => { await api(`/sessions/${sid}/attendance/${stu}`, 'PATCH', { status }); reload(); };
  return (
    <div className="card"><h3>Attendance & participation</h3>
      <label>Session<select value={sid} onChange={e => setSid(e.target.value)}><option value="">— choose —</option>{sessions?.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <div className="scroll"><table><thead><tr><th>Learner</th><th>Group</th><th>Status</th></tr></thead>
        <tbody>{rows?.map(r => <tr key={r.student_id}><td>{r.display_name}</td><td>{r.group_name}</td><td><select value={r.status} onChange={e => set(r.student_id, e.target.value)}><option value="selected">Selected (not yet confirmed)</option><option value="present">Participated</option><option value="absent">Absent</option></select></td></tr>)}</tbody></table></div>
      <p className="muted">Group membership never counts as participation. Learners are marked “Participated” when you start a live game with them.</p>
    </div>
  );
}

function LearnerHistory() {
  const [students] = useLoad(() => api('/students'));
  const [id, setId] = useState('');
  const [h] = useLoad(() => (id ? api(`/students/${id}/history`) : Promise.resolve(null)), [id]);
  return (
    <div className="card"><h3>Learner history across sessions</h3>
      <label>Learner<select value={id} onChange={e => setId(e.target.value)}><option value="">— choose —</option>{students?.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
      {h && <div className="scroll"><table><thead><tr><th>Session</th><th>Date</th><th>Status</th><th>Points</th><th>Correct</th><th>Incorrect</th><th>Active time</th><th>Finish</th></tr></thead>
        <tbody>{h.history.map(x => <tr key={x.pid}><td>{x.title}</td><td>{when(x.started_at)}</td><td>{x.game_status}</td><td>{x.points}</td><td>{x.correct}</td><td>{x.incorrect}</td><td>{fmt(x.active_ms)}</td><td>{x.finished ? `#${x.rank}${x.tie ? ' (tie)' : ''}` : '—'}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function Audit() {
  const [rows] = useLoad(() => api('/audit'));
  return (
    <div className="card"><h3>Audit log (latest 200)</h3>
      <div className="scroll"><table><thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Old</th><th>New</th><th>Reason</th></tr></thead>
        <tbody>{rows?.map(a => <tr key={a.id}><td>{when(a.created_at + 'Z')}</td><td>{a.action}</td><td>{a.entity} {a.entity_id}</td><td><code>{a.old_value}</code></td><td><code>{a.new_value}</code></td><td>{a.reason}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export function Assessments() {
  const [students] = useLoad(() => api('/students'));
  const [rows, reload] = useLoad(() => api('/assessments'));
  const [f, setF] = useState({ student_id: '', kind: 'post-test', result: '', administered_on: '', notes: '' }), [err, setErr] = useState('');
  const save = async e => { e.preventDefault(); setErr(''); try { await api('/assessments', 'POST', f); setF({ ...f, result: '', notes: '' }); reload(); } catch (x) { setErr(x.message); } };
  return (
    <>
      <form className="card" onSubmit={save}>
        <h3>Post-test & official assessment records</h3>
        <p className="muted">Kept apart from game data. Enter results exactly as administered (e.g. the approved Phil-IRI format). Nothing here is calculated from game points or board rank.</p>
        <div className="grid">
          <label>Learner<select required value={f.student_id} onChange={e => setF({ ...f, student_id: e.target.value })}><option value="">—</option>{students?.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
          <label>Type<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="pre-test">Pre-test</option><option value="post-test">Post-test</option><option value="phil-iri">Phil-IRI</option></select></label>
          <label>Result<input required value={f.result} onChange={e => setF({ ...f, result: e.target.value })} /></label>
          <label>Date administered<input type="date" value={f.administered_on} onChange={e => setF({ ...f, administered_on: e.target.value })} /></label>
        </div>
        <label>Notes<input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn">Save record</button>
      </form>
      <div className="card"><div className="scroll"><table><thead><tr><th>Learner</th><th>Type</th><th>Result</th><th>Date</th><th>Notes</th></tr></thead>
        <tbody>{rows?.map(a => <tr key={a.id}><td>{a.full_name}</td><td>{a.kind}</td><td>{a.result}</td><td>{a.administered_on}</td><td>{a.notes}</td></tr>)}</tbody></table></div></div>
    </>
  );
}
