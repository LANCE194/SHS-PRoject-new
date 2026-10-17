import { useEffect, useState } from 'react';
import { api } from './api.js';
import { AVATAR_NAMES, AVATARS, COLOR_NAMES, GUIDE_TEXT, LANGS, Pw, Status, TOKEN_NAMES, TOKENS, beep, fmt, useLoad, useSpeech, when } from './ui.jsx';

// View-only for learners: they never start, control, or grade anything here.
export default function Learner({ logout }) {
  const [tab, setTab] = useState('home');
  const [openId, setOpenId] = useState(null);
  const [me, reloadMe] = useLoad(() => api('/me'));
  const [sum, reloadSum] = useLoad(() => api('/me/summary'));
  const [sessions, reloadSessions] = useLoad(() => api('/me/sessions'));
  const sp = useSpeech();
  useEffect(() => { // pick up teacher-finalized records
    const refresh = () => { reloadSum(); reloadSessions(); };
    const t = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', refresh); };
  }, [reloadSum, reloadSessions]);
  if (!me) return null;
  const P = me.prefs;
  const nav = [['home', 'Home'], ['sessions', 'Sessions'], ['dash', 'My Dashboard'], ['settings', 'App Settings']];

  return (
    <div className="shell">
      <header className="topbar">
        <b className="brand">{openId ? '📚 Session Overview' : '📘 A.M.B.A.K.'}</b>
        <nav aria-label="Main">{nav.map(([k, l]) => <button key={k} className={'toplink' + (tab === k ? ' on' : '')} onClick={() => { setOpenId(null); setTab(k); }}>{l}</button>)}<button className="toplink" onClick={() => { sp.stop(); logout(); }}>Log Out</button></nav>
        <span className="userpill">{me.avatar} {me.display_name}</span>
      </header>
      <main className="page">
        {openId && <SessionOverview sid={openId} me={me} reloadMe={reloadMe} back={() => setOpenId(null)} />}
        {!openId && tab === 'home' && (
          <>
            <section className="card">
              <h1>Welcome, {me.display_name}!</h1>
              <p>A.M.B.A.K. is an interactive reading intervention that helps learners practice reading comprehension through computer-assisted storytelling, game-based questions, and physical movement using a Snake-and-Ladder board.</p>
              <button className="btn" disabled={!sp.supported || !P.voice} onClick={() => { if (P.sound) beep(); sp.play(GUIDE_TEXT[P.language], LANGS[P.language].tag, P.rate); }}>🔊 Meet Your Reading Guide</button>
              {!P.voice && <p className="muted">Voice Assistant is off. You can turn it on in App Settings.</p>}
            </section>
            <h2 className="sect">Your Reading Adventure</h2>
            {!sessions?.length ? <p className="muted">Your teacher has not assigned a session yet.</p> : (
              <div className="adventure">{sessions.map(s => (
                <article key={s.id} className={'card quest' + (s.status === 'Archived' ? ' locked' : '')}>
                  <div className={'qnum' + (s.completed ? ' done' : '')}>{s.status === 'Archived' ? '🔒' : s.completed ? '✓' : s.number}</div>
                  <Status>{s.status}</Status>
                  <h3>Session {s.number}: {s.title}</h3>
                  <p>{s.description}</p>
                  <div className="progress" role="progressbar" aria-valuenow={s.progress} aria-valuemin="0" aria-valuemax="100"><i style={{ width: s.progress + '%' }} /></div>
                  <small className="muted">{s.progress}% progress</small>
                  <p className="muted small-note">{s.status === 'Completed' ? 'Completed — see My Dashboard.' : 'Your teacher will start the game with you.'}</p>
                  {s.status !== 'Archived' && <button className="btn small" onClick={() => setOpenId(s.id)}>Open session</button>}
                </article>))}</div>
            )}
          </>
        )}

        {!openId && tab === 'sessions' && (
          <div className="card"><h2>My Sessions</h2>
            {!sessions?.length ? <p className="muted">No sessions yet.</p> : (
              <div className="scroll"><table><thead><tr><th>Session</th><th>Status</th><th>Date</th><th>Result</th></tr></thead>
                <tbody>{sessions.map(s => (
                  <tr key={s.id}><td>{s.title}</td><td><Status>{s.status}</Status></td><td>{s.completed ? when(s.completed_on) : s.planned_at ? when(s.planned_at) : '—'}</td>
                    <td>{s.result ? `${s.result.points} pts · ${s.result.correct} correct · ${s.result.incorrect} not yet${s.result.finished ? ` · Finished Step 30` : ''}` : '—'}</td></tr>))}</tbody></table></div>
            )}
          </div>
        )}

        {!openId && tab === 'dash' && sum && (
          <>
            <section className="card">
              <h1 className="dashname">{me.avatar} {me.display_name}</h1>
              <div className="grid4 stats">
                <div className="stat accent"><small>Sessions Participated</small><b>{sum.sessions_participated}</b></div>
                <div className="stat accent"><small>Questions Attempted</small><b>{sum.questions}</b></div>
                <div className="stat accent"><small>Correct / Incorrect</small><b>{sum.correct} / {sum.incorrect}</b></div>
                <div className="stat accent"><small>Points / Accuracy</small><b>{sum.points} / {sum.accuracy == null ? 'Not yet available' : sum.accuracy + '%'}</b></div>
              </div>
            </section>
            <div className="two">
              <section className="card"><h2>Physical Game Completion</h2>
                <p className="muted">Based only on facilitator-recorded finish order.</p>
                <div className="scroll"><table><thead><tr><th>Rank</th><th>Player</th><th>Status</th><th>Finish Time</th></tr></thead>
                  <tbody>{sum.completion.length ? sum.completion.map((c, i) => <tr key={i}><td>{c.rank ? `${c.rank}${c.tie ? ' (tie)' : ''}` : '—'}</td><td>{me.display_name}</td><td>{c.status}</td><td>{c.finished_at ? when(c.finished_at) : '—'}</td></tr>) : <tr><td colSpan="4">No verified finishes recorded.</td></tr>}</tbody></table></div>
              </section>
              <section className="card"><h2>Reading Comprehension Performance</h2>
                <p className="muted">Based on comprehension points. Game results only — not an official reading assessment.</p>
                <div className="scroll"><table><thead><tr><th>Session</th><th>Points</th><th>Accuracy</th></tr></thead>
                  <tbody>{sum.performance.length ? sum.performance.map((p, i) => <tr key={i}><td>{p.session}</td><td>{p.points}</td><td>{p.accuracy == null ? 'Not yet available' : p.accuracy + '%'}</td></tr>) : <tr><td colSpan="3">No comprehension results recorded.</td></tr>}</tbody></table></div>
              </section>
            </div>
            <p className="note good">{sum.questions ? 'You completed part of your reading adventure! Keep practicing your comprehension skills.' : 'Your reading adventure is about to begin!'} Time answering: {fmt(sum.active_ms)}.</p>
            {sum.achievements.length > 0 && <section className="card"><h2>My Achievements</h2><div className="grid4">{sum.achievements.map(a => <div key={a.key} className="stat"><b>{a.icon}</b>{a.label}</div>)}</div></section>}
          </>
        )}

        {!openId && tab === 'settings' && <Settings me={me} reload={reloadMe} cancel={() => setTab('home')} />}
      </main>
    </div>
  );
}

function Settings({ me, reload, cancel }) {
  const init = { display_name: me.display_name, avatar: me.avatar, ...me.prefs };
  const [f, setF] = useState(init);
  const [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' }), [pmsg, setPmsg] = useState(''), [perr, setPerr] = useState('');
  const sp = useSpeech();
  const save = async e => {
    e.preventDefault(); setMsg(''); setErr('');
    try {
      await api('/me', 'PUT', { display_name: f.display_name, avatar: f.avatar, prefs: { language: f.language, voice: f.voice, rate: f.rate, sound: f.sound, color: f.color, token: f.token } });
      await reload(); setMsg('Settings saved.'); if (f.sound) beep();
    } catch (x) { setErr(x.message); }
  };
  const changePw = async e => {
    e.preventDefault(); setPmsg(''); setPerr('');
    try { await api('/me/password', 'POST', pw); setPmsg('Password changed.'); setPw({ current: '', next: '' }); } catch (x) { setPerr(x.message); }
  };
  return (
    <div className="settings-wrap">
      <form className="card" onSubmit={save}>
        <h1>App Settings</h1>
        <div className="grid">
          <label>Language<select value={f.language} onChange={e => setF({ ...f, language: e.target.value })}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Voice Assistant<select value={f.voice ? 'on' : 'off'} onChange={e => setF({ ...f, voice: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
          <label>Speech Speed <b>{Number(f.rate).toFixed(1)}×</b><input type="range" min="0.5" max="1.5" step="0.1" value={f.rate} onChange={e => setF({ ...f, rate: +e.target.value })} /></label>
          <label>Sound Settings<select value={f.sound ? 'on' : 'off'} onChange={e => setF({ ...f, sound: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></select></label>
          <label>Display Name<input value={f.display_name} maxLength={40} onChange={e => setF({ ...f, display_name: e.target.value })} /></label>
          <label>Avatar<select value={f.avatar} onChange={e => setF({ ...f, avatar: e.target.value })}>{AVATARS.map(a => <option key={a}>{a}</option>)}</select></label>
        </div>
        <button type="button" className="btn out" disabled={!sp.supported} onClick={() => sp.play(GUIDE_TEXT[f.language], LANGS[f.language].tag, f.rate)}>▶ Test voice</button>
        <button type="button" className="btn out" onClick={sp.stop}>⏹ Stop</button>
        {msg && <p className="ok" role="status">{msg}</p>}{err && <p className="err" role="alert">{err}</p>}
        <div><button className="btn green">Save Settings</button><button type="button" className="btn out" onClick={() => { setF(init); cancel(); }}>Cancel</button></div>
      </form>
      <section className="card"><h2>My Details</h2>
        <div className="grid">
          <label>Full name<input readOnly value={me.full_name} /></label><label>Username<input readOnly value={me.username} /></label>
          <label>Grade & section<input readOnly value={me.grade_section ?? ''} /></label><label>Group<input readOnly value={me.group_name ?? ''} /></label>
          <label>LRN<input readOnly value={me.lrn_masked} /></label>
        </div>
        <p className="muted">Your teacher manages your official details.</p>
      </section>
      <form className="card" onSubmit={changePw}>
        <h2>Change password</h2>
        <div className="grid"><Pw label="Current password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /><Pw label="New password (6+ characters)" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></div>
        {pmsg && <p className="ok" role="status">{pmsg}</p>}{perr && <p className="err" role="alert">{perr}</p>}
        <button className="btn">Change password</button>
      </form>
    </div>
  );
}

const INSTRUCTIONS = {
  en: 'Listen carefully to the story and follow the words on the screen. Wait for your turn. When the facilitator spins the question wheel, your question will appear. Answer the question verbally. The facilitator will check your answer and record your score. Follow the physical Snake-and-Ladder game rules as directed.',
  fil: 'Making nang mabuti sa kuwento at sundan ang mga salita sa screen. Hintayin ang iyong turn. Kapag pinaikot ng facilitator ang question wheel, lalabas ang iyong tanong. Sagutin ang tanong nang pasalita. Susuriin ng facilitator ang iyong sagot at itatala ang iyong puntos. Sundin ang mga patakaran ng pisikal na Snake-and-Ladder ayon sa utos.'
};

// Session overview: read-only details + read-along story (no questions or answers) + avatar customization.
function SessionOverview({ sid, me, reloadMe, back }) {
  const [s, , err] = useLoad(() => api('/me/sessions/' + sid), [sid]);
  const sp = useSpeech();
  const P = me.prefs, tag = LANGS[P.language].tag;
  const [reading, setReading] = useState(false);
  const [av, setAv] = useState({ avatar: me.avatar, color: P.color, token: P.token, name: me.display_name });
  const [msg, setMsg] = useState(''), [aerr, setAerr] = useState('');
  const saveAvatar = async () => {
    setMsg(''); setAerr('');
    try {
      await api('/me', 'PUT', { display_name: av.name, avatar: av.avatar, prefs: { ...P, color: av.color, token: av.token } });
      await reloadMe(); setMsg('Avatar saved.'); if (P.sound) beep();
    } catch (x) { setAerr(x.message); }
  };
  if (err) return <p className="err" role="alert">{err} <button className="btn small" onClick={back}>Return Home</button></p>;
  if (!s) return null;
  return (
    <div className="two">
      {reading ? (
        <section className="card"><h1>{s.story_title || 'Story'}</h1>
          {sp.supported && P.voice ? <div className="actions">
            <button className="btn" onClick={() => sp.play(s.story_text, tag, P.rate)}>▶ Play</button><button className="btn out" onClick={sp.pause}>⏸ Pause</button>
            <button className="btn out" onClick={sp.resume}>Resume</button><button className="btn out" onClick={sp.stop}>⏹ Stop</button>
          </div> : <p className="muted">{P.voice ? 'Narration is not available in this browser.' : 'Voice Assistant is off. Turn it on in App Settings to hear the story.'}</p>}
          <p className="story">{s.story_text}</p>
          <button className="btn out" onClick={() => { sp.stop(); setReading(false); }}>Back</button>
        </section>
      ) : (
        <section className="card">
          <h1>Session {s.number}: {s.title}</h1>
          <p>{s.description}</p>
          <h3>Learning Objectives</h3><p>{s.objectives || '—'}</p>
          <h3>Assigned Story</h3><p>{s.story_title || 'No story assigned yet.'}</p>
          <h3>Registered Group</h3><p>{s.group || 'The facilitator has not assigned you to a group for this session.'}</p>
          <h3>Instructions</h3><p>{INSTRUCTIONS[P.language]}</p>
          <div className="actions">
            <button className="btn" disabled={!sp.supported || !P.voice} onClick={() => sp.play(INSTRUCTIONS[P.language], tag, P.rate)}>🔊 Read Instructions</button>
            <button className="btn green" disabled={!s.story_text} onClick={() => { sp.stop(); setReading(true); }}>Start Story</button>
            <button className="btn out" onClick={() => { sp.stop(); back(); }}>Return Home</button>
          </div>
          <p className="muted small-note">Start Story lets you read along. Your teacher runs the question wheel and the board game.</p>
        </section>
      )}
      <section className="card"><h1>Customize Avatar</h1>
        <div className="avatar-preview" style={{ background: av.color }} role="img" aria-label="Avatar preview"><span>{av.avatar}</span><small>{TOKENS[av.token]}</small></div>
        <label>Avatar Appearance<select value={av.avatar} onChange={e => setAv({ ...av, avatar: e.target.value })}>{AVATAR_NAMES.map(([e, n]) => <option key={e} value={e}>{n}</option>)}</select></label>
        <label>Avatar Color<select value={av.color} onChange={e => setAv({ ...av, color: e.target.value })}>{COLOR_NAMES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        <label>Game Token<select value={av.token} onChange={e => setAv({ ...av, token: e.target.value })}>{TOKEN_NAMES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <label>Player Display Name<input value={av.name} maxLength={40} onChange={e => setAv({ ...av, name: e.target.value })} /></label>
        {msg && <p className="ok" role="status">{msg}</p>}{aerr && <p className="err" role="alert">{aerr}</p>}
        <button className="btn purple" onClick={saveAvatar}>Save Avatar</button>
      </section>
    </div>
  );
}
