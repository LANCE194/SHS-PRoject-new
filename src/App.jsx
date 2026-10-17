import { useEffect, useState } from 'react';
import { api, setToken } from './api.js';
import { GUIDE_TEXT, LANGS, Pw, TAG_TO_KEY, useSpeech } from './ui.jsx';
import Learner from './Learner.jsx';
import Teacher from './Teacher.jsx';

const store = (() => { try { return JSON.parse(localStorage.getItem('ambakGuide')) || {}; } catch { return {}; } })();

// Landing: Tala reading guide with working voice, language and speed controls.
function Landing({ go }) {
  const [lang, setLang] = useState(store.lang || 'en'), [rate, setRate] = useState(store.rate || 0.9);
  const sp = useSpeech();
  useEffect(() => { localStorage.setItem('ambakGuide', JSON.stringify({ lang, rate })); }, [lang, rate]);
  return (
    <div className="landing-page">
      <section className="hero card">
        <span className="pill">📖 Reading + Games + Movement</span>
        <h1 className="mega">A.M.B.A.K.</h1>
        <h2 className="tagline">A Computer-Assisted, Game-Based, and Movement-Based Reading Intervention</h2>
        <p>Welcome to A.M.B.A.K.! Explore stories, answer comprehension questions, and enjoy a reading adventure through teamwork and movement. Let's begin!</p>
        <button className="btn" onClick={go}>Log In</button>
        <div className="voicebar">
          <button className="btn out" onClick={() => sp.play(GUIDE_TEXT[lang], LANGS[lang].tag, rate)} disabled={!sp.supported}>▶ Play Voice</button>
          <button className="btn out" onClick={sp.pause} disabled={!sp.supported}>⏸ Pause</button>
          <button className="btn out" onClick={sp.resume} disabled={!sp.supported}>⏯ Resume</button>
          <button className="btn out" onClick={sp.stop} disabled={!sp.supported}>⏹ Stop</button>
          <label>Language<select value={lang} onChange={e => { sp.stop(); setLang(e.target.value); }}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Speed <b>{rate.toFixed(1)}×</b><input type="range" min="0.5" max="1.5" step="0.1" value={rate} onChange={e => setRate(+e.target.value)} aria-label="Voice speed" /></label>
        </div>
        {!sp.supported && <p className="muted">Voice is not available in this browser. The guide message is shown at right.</p>}
      </section>
      <aside className="tala card">
        <div className="tala-art"><span>🦉</span><span>📘</span></div>
        <h2>Meet Tala</h2>
        <p className="muted">Your friendly reading guide.</p>
        <p className="guide-text">{GUIDE_TEXT[lang]}</p>
      </aside>
    </div>
  );
}

function Login({ initialRole = 'student', onLogin, onSignup, onBack }) {
  const [role, setRole] = useState(initialRole);
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault(); setErr('');
    try { const r = await api('/login', 'POST', { role, ...f }); setToken(r.token); onLogin(r.role); }
    catch (x) { setErr(x.message); }
  };
  return (
    <div className="center">
      <form className="card login-card narrow" onSubmit={submit}>
        <small className="eyebrow">WELCOME BACK</small>
        <h2>Sign in to A.M.B.A.K.</h2>
        <div className="seg" role="tablist">
          {[['student', 'Learner'], ['teacher', 'Teacher']].map(([k, l]) => <button type="button" role="tab" aria-selected={role === k} key={k} className={role === k ? 'on' : ''} onClick={() => setRole(k)}>{l}</button>)}
        </div>
        <label>Username<input required autoComplete="username" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></label>
        <Pw value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn wide big">Sign in as {role === 'teacher' ? 'teacher' : 'learner'}</button>
        <p className="muted center-t">{role === 'teacher'
          ? <>New teacher? <a href="#" onClick={e => { e.preventDefault(); onSignup(); }}>Sign up</a> (secret code needed). Forgot your password? Ask the project administrator.</>
          : 'Learner accounts are provided by your teacher. Forgot your password? Ask your teacher.'}</p>
        <button type="button" className="linkbtn" onClick={onBack}>← Back to home</button>
      </form>
    </div>
  );
}

function Signup({ onLogin, onBack }) {
  const [f, setF] = useState({ username: '', password: '', year_section: '', full_name: '', code: '' });
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault(); setErr('');
    try { const r = await api('/signup', 'POST', f); setToken(r.token); onLogin(r.role); }
    catch (x) { setErr(x.message); }
  };
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>Teacher Sign Up</h1>
        <label>Full name<input required value={f.full_name} onChange={set('full_name')} /></label>
        <label>Year level & section<input required placeholder="e.g. Grade 5 - Sampaguita" value={f.year_section} onChange={set('year_section')} /></label>
        <label>Username<input required value={f.username} onChange={set('username')} /></label>
        <Pw value={f.password} onChange={set('password')} />
        <label>Secret code<input required inputMode="numeric" value={f.code} onChange={set('code')} /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn">Create account</button>
        <button type="button" className="btn dark" onClick={onBack}>Back to login</button>
      </form>
    </div>
  );
}

function tokenRole() {
  try {
    const p = JSON.parse(atob(localStorage.getItem('ambakToken').split('.')[1]));
    return p.exp * 1000 > Date.now() ? p.role : null;
  } catch { return null; }
}

export default function App() {
  const [role, setRole] = useState(tokenRole);
  const [view, setView] = useState('landing'); // landing | login | signup
  const logout = () => { setToken(null); setRole(null); setView('landing'); };
  if (role === 'teacher') return <Teacher logout={logout} />;
  if (role === 'student') return <Learner logout={logout} />;
  if (view === 'signup') return <Signup onLogin={setRole} onBack={() => setView('login')} />;
  if (view === 'login') return <Login onLogin={setRole} onSignup={() => setView('signup')} onBack={() => setView('landing')} />;
  return <Landing go={() => setView('login')} />;
}