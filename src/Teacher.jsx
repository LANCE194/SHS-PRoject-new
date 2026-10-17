import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Status, useLoad, when } from './ui.jsx';
import { QuestionEditor, Sessions, StoryEditor } from './Library.jsx';
import Live from './Live.jsx';
import Reports, { ExportPage, FinishTracker } from './Reports.jsx';

const NAV = [['overview', 'Overview'], ['learners', 'Learners'], ['groups', 'Groups'], ['sessions', 'Sessions'], ['story', 'Story Editor'], ['questions', 'Question Editor'], ['live', 'Live Game'], ['finish', 'Finish Tracker'], ['reports', 'Progress Reports'], ['export', 'Data Export'], ['settings', 'Settings']];

export default function Teacher({ logout }) {
  const [tab, setTab] = useState('overview');
  return (
    <div className="shell">
      <header className="topbar noprint">
        <b className="brand">🧑‍🏫 A.M.B.A.K. Teacher Dashboard</b>
        <nav aria-label="Top"><button className="toplink" onClick={() => setTab('overview')}>Overview</button><button className="toplink" onClick={() => window.print()}>Print</button><button className="toplink" onClick={logout}>Log Out</button></nav>
        <span className="userpill">Authorized teacher view</span>
      </header>
      <div className="with-side">
        <aside className="sidebar noprint"><nav aria-label="Teacher sections">{NAV.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}</nav></aside>
        <main className="content">
          {tab === 'overview' && <Overview go={setTab} />}
          {tab === 'learners' && <Learners />}
          {tab === 'groups' && <Groups />}
          {tab === 'sessions' && <Sessions />}
          {tab === 'story' && <StoryEditor />}
          {tab === 'questions' && <QuestionEditor />}
          {tab === 'live' && <Live />}
          {tab === 'finish' && <FinishTracker />}
          {tab === 'reports' && <Reports />}
          {tab === 'export' && <ExportPage />}
          {tab === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}

function Overview({ go }) {
  const [o] = useLoad(() => api('/overview'));
  if (!o) return null;
  const act = { setup: 'Setting up', active: 'In progress', paused: 'Paused' }[o.activity] || 'None';
  return (
    <section className="card"><h1>Intervention Overview</h1>
      <div className="grid4 stats">
        <div className="stat accent"><small>Registered Learners</small><b>{o.learners}</b></div>
        <div className="stat accent"><small>Groups</small><b>{o.groups}</b></div>
        <div className="stat accent"><small>Unlocked Sessions</small><b>{o.published}</b></div>
        <div className="stat accent"><small>Activity Status</small><b>{act}</b></div>
      </div>
      <h3>Shortcuts</h3>
      {[['learners', 'Add Learner'], ['groups', 'Manage Groups'], ['sessions', 'Sessions'], ['live', 'Live Game'], ['reports', 'Progress Reports']].map(([k, l]) => <button key={k} className="btn" onClick={() => go(k)}>{l}</button>)}
      <h3>Recent activity</h3>
      {o.recent.length ? <ul>{o.recent.map((r, i) => <li key={i}>{when(r.confirmed_at)} — {r.display_name}: {r.decision} in “{r.title}” ({r.points} pts)</li>)}</ul> : <p className="muted">Nothing recorded yet.</p>}
    </section>
  );
}

const EMPTY = { username: '', password: '', full_name: '', display_name: '', age: '', birthdate: '', lrn: '', grade_section: '', address: '', guardian_name: '', guardian_contact: '', group_id: '' };
const FIELDS = [['full_name', 'Full name'], ['display_name', 'Display name'], ['age', 'Age', 'number'], ['birthdate', 'Birthdate', 'date'], ['lrn', 'LRN'], ['grade_section', 'Grade & section'], ['address', 'Address'], ['guardian_name', 'Parent/guardian'], ['guardian_contact', 'Guardian contact']];

function Learners() {
  const [students, reload] = useLoad(() => api('/students'));
  const [groups] = useLoad(() => api('/groups'));
  const [form, setForm] = useState(EMPTY), [editId, setEditId] = useState(null), [editLrn, setEditLrn] = useState('');
  const [q, setQ] = useState(''), [gf, setGf] = useState(''), [showInactive, setShowInactive] = useState(false);
  const [err, setErr] = useState(''), [note, setNote] = useState('');
  const [csv, setCsv] = useState(''), [imp, setImp] = useState(null);

  const save = async e => {
    e.preventDefault(); setErr(''); setNote('');
    try {
      const body = { ...form };
      if (editId && !body.lrn) delete body.lrn; // blank = keep existing LRN
      if (editId) await api('/students/' + editId, 'PUT', body); else await api('/students', 'POST', body);
      setForm(EMPTY); setEditId(null); reload();
    } catch (x) { setErr(x.message); }
  };
  const edit = s => { setEditId(s.id); setEditLrn(s.lrn_masked); setForm({ ...EMPTY, ...s, lrn: '', group_id: s.group_id ?? '', password: '' }); window.scrollTo(0, 0); };
  const run = async (fn, msg) => { setNote(''); setErr(''); try { const r = await fn(); if (msg) setNote(msg(r)); reload(); } catch (x) { setErr(x.message); } };
  const importCsv = async () => {
    const [head, ...lines] = csv.trim().split(/\r?\n/).map(l => l.split(',').map(c => c.trim()));
    const rows = lines.filter(l => l.some(Boolean)).map(l => Object.fromEntries(head.map((h, i) => [h, l[i] ?? ''])));
    try { setImp(await api('/students/import', 'POST', { rows })); reload(); } catch (x) { setErr(x.message); }
  };
  const shown = (students || []).filter(s => (showInactive || s.active) && (!gf || String(s.group_id) === gf) &&
    `${s.full_name} ${s.display_name} ${s.username} ${s.grade_section ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <section className="card"><h1>Learner Management</h1>
        <p>Full LRNs and passwords are not displayed here.</p>
        <div className="grid">
          <label>Search<input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, username, grade…" /></label>
          <label>Group<select value={gf} onChange={e => setGf(e.target.value)}><option value="">All groups</option>{groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show deactivated</label>
        </div>
        {err && <p className="err" role="alert">{err}</p>}{note && <p className="ok" role="status">{note}</p>}
        <div className="scroll"><table>
          <thead><tr><th>Display</th><th>Full Name</th><th>Age</th><th>Username</th><th>LRN</th><th>Group</th><th>Status</th><th /></tr></thead>
          <tbody>{shown.map(s => (
            <tr key={s.id} className={s.active ? '' : 'dim'}><td>{s.avatar} {s.display_name}</td><td>{s.full_name}</td><td>{s.age}</td><td>{s.username}</td><td>{s.lrn_masked}</td><td>{s.group_name}</td><td>{s.active ? 'Active' : 'Deactivated'}</td>
              <td className="actions">
                <button className="btn small" onClick={() => edit(s)}>Edit</button>
                <button className="btn small dark" onClick={() => run(() => api(`/students/${s.id}/active`, 'PATCH', { active: !s.active }))}>{s.active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn small dark" onClick={() => confirm(`Reset password for ${s.full_name}?`) && run(() => api(`/students/${s.id}/reset-password`, 'POST'), r => `New temporary password for ${s.username}: ${r.temp_password} (share it securely)`)}>Reset password</button>
                <button className="btn small red" onClick={() => confirm(`Delete ${s.full_name}? Only possible if no records exist.`) && run(() => api('/students/' + s.id, 'DELETE'))}>Delete</button>
              </td></tr>))}</tbody>
        </table></div>
      </section>

      <form className="card" onSubmit={save}>
        <h2>{editId ? 'Edit learner account' : 'Create learner account'}</h2>
        <div className="grid">
          <label>Username<input required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
          <label>Password {editId && '(leave blank to keep)'}<input required={!editId} minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          <label>Group<select value={form.group_id} onChange={e => setForm({ ...form, group_id: e.target.value })}><option value="">No group</option>{groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          {FIELDS.map(([k, label, type]) => (
            <label key={k}>{label}{k === 'lrn' && editId ? ' (blank keeps current)' : ''}<input type={type || 'text'} required={k === 'full_name'} placeholder={k === 'lrn' && editId ? editLrn : ''} value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} /></label>
          ))}
        </div>
        <button className="btn green">{editId ? 'Save changes' : 'Create account'}</button>
        {editId && <button type="button" className="btn dark" onClick={() => { setEditId(null); setForm(EMPTY); }}>Cancel</button>}
      </form>

      <section className="card">
        <h2>Import learners (optional)</h2>
        <p className="muted">Paste CSV with a header row, e.g. <code>username,password,full_name,grade_section,lrn</code>. Duplicates and invalid rows are reported, not imported.</p>
        <textarea rows={4} value={csv} onChange={e => setCsv(e.target.value)} />
        <button className="btn" onClick={importCsv} disabled={!csv.trim()}>Import</button>
        {imp && <div role="status"><p className="ok">{imp.created} created.</p>{imp.rejected.map(r => <p key={r.row} className="err">Row {r.row} ({r.username || 'no username'}): {r.reason}</p>)}</div>}
      </section>
    </>
  );
}

// Group registration: name + members. Playing order is set per live game, from the physical die rolls.
function Groups() {
  const [groups, reload] = useLoad(() => api('/groups'));
  const [students] = useLoad(() => api('/students'));
  const [name, setName] = useState(''), [picked, setPicked] = useState([]), [err, setErr] = useState(''), [msg, setMsg] = useState('');
  const existing = groups?.find(g => g.name.toLowerCase() === name.trim().toLowerCase());
  const run = async fn => { setErr(''); setMsg(''); try { await fn(); reload(); } catch (x) { setErr(x.message); } };
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const submit = e => {
    e.preventDefault();
    run(async () => {
      if (existing) await api('/groups/' + existing.id, 'PUT', { name, student_ids: picked }); else await api('/groups', 'POST', { name, student_ids: picked });
      setMsg(existing ? 'Group updated.' : 'Group created.'); setName(''); setPicked([]);
    });
  };
  const load = g => { setName(g.name); setPicked(g.student_ids); window.scrollTo(0, 0); };
  return (
    <>
      <form className="card" onSubmit={submit}>
        <h1>Group Registration</h1>
        <label>Group Name or ID<input required value={name} onChange={e => setName(e.target.value)} /></label>
        <h3>Select Players</h3>
        <div className="checklist">{students?.filter(s => s.active).map(s => (
          <label key={s.id} className="check pillcheck"><input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} /> {s.avatar} {s.display_name}{s.group_name && s.group_name !== name ? ` · ${s.group_name}` : ''}</label>))}</div>
        {err && <p className="err" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
        <button className="btn green">Create or Update Group</button>
        <p className="muted">A learner belongs to one group. Group membership is not attendance — you confirm who plays when you start a live game, and set the playing order there from each learner's physical die roll.</p>
      </form>
      <section className="card"><h2>Registered groups</h2>
        <div className="scroll"><table><thead><tr><th>Group</th><th>Members</th><th /></tr></thead>
          <tbody>{groups?.map(g => (
            <tr key={g.id}><td>{g.name}</td><td>{g.members}</td><td className="actions">
              <button className="btn small" onClick={() => load(g)}>Edit members</button>
              <button className="btn small red" onClick={() => confirm(`Delete group ${g.name}? Learners keep their accounts.`) && run(() => api('/groups/' + g.id, 'DELETE'))}>Delete</button></td></tr>))}</tbody></table></div>
      </section>
    </>
  );
}

function Settings() {
  const [s, , lerr] = useLoad(() => api('/settings'));
  const [f, setF] = useState(null), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  useEffect(() => { if (s) setF(s); }, [s]);
  if (!f) return lerr ? <p className="err">{lerr}</p> : null;
  const save = async e => { e.preventDefault(); setErr(''); setMsg(''); try { await api('/settings', 'PUT', f); setMsg('Settings saved.'); } catch (x) { setErr(x.message); } };
  return (
    <section className="card"><h1>Teacher Settings</h1>
      <form onSubmit={save}>
        <label className="check"><input type="checkbox" checked={f.allow_repeats} onChange={e => setF({ ...f, allow_repeats: e.target.checked })} /> Allow question repetition before the pool is exhausted (default for new sessions)</label>
        <label>Correct-Answer Physical Movement (reminder shown during live games)<input value={f.correct_note} onChange={e => setF({ ...f, correct_note: e.target.value })} /></label>
        <label>Incorrect-Answer Physical Movement (reminder shown during live games)<input value={f.incorrect_note} onChange={e => setF({ ...f, incorrect_note: e.target.value })} /></label>
        <p className="note warn-note">Snakes, ladders, danger zones, rewards, final-square rules, and finish conditions must follow the approved physical-game protocol. They do not add comprehension points unless an approved scoring procedure explicitly requires it.</p>
        {err && <p className="err" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
        <button className="btn green">Save settings</button>
      </form>
    </section>
  );
}