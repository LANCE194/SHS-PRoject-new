import { useEffect, useState } from 'react';
import { api } from './api.js';
import { LANGS, Status, TAG_TO_KEY, useLoad, useSpeech } from './ui.jsx';

const CATS = ['Who', 'What', 'Where', 'When', 'Why', 'How'];

// ---------- Story Editor ----------
export function StoryEditor() {
  const [mats, reloadMats] = useLoad(() => api('/materials'));
  const [sessions] = useLoad(() => api('/sessions'));
  const [mid, setMid] = useState(''), [sid, setSid] = useState('');
  const [mat, setMat] = useState(null);
  const [f, setF] = useState({ story_title: '', story_text: '', published: false });
  const [lang, setLang] = useState('en'), [rate, setRate] = useState(0.9);
  const [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const sp = useSpeech();

  const loadMat = async id => {
    setMid(id); setMsg(''); setErr('');
    if (!id) { setMat(null); return setF({ story_title: '', story_text: '', published: false }); }
    const m = await api('/materials/' + id);
    setMat(m); setF({ story_title: m.story_title || m.title, story_text: m.story_text || '', published: m.status === 'published' });
  };
  const pickSession = async id => {
    setSid(id); setMsg(''); setErr('');
    if (!id) return;
    const s = await api('/sessions/' + id);
    setLang(TAG_TO_KEY(s.narration_lang)); setRate(Number(s.narration_rate) || 0.9);
    if (s.material_id) await loadMat(String(s.material_id));
  };
  const save = async e => {
    e.preventDefault(); setMsg(''); setErr('');
    try {
      const body = { title: f.story_title, story_title: f.story_title, story_text: f.story_text, questions: mat?.questions || [] };
      let id = mid;
      if (id) await api('/materials/' + id, 'PUT', body); else id = String((await api('/materials', 'POST', body)).id);
      await api(`/materials/${id}/status`, 'PATCH', { status: f.published ? 'published' : 'draft' });
      if (sid) {
        const s = await api('/sessions/' + sid);
        await api('/sessions/' + sid, 'PUT', { ...s, material_id: +id, narration_lang: LANGS[lang].tag, narration_rate: rate });
      }
      await reloadMats(); await loadMat(id); setMsg('Story saved.' + (sid ? ' Assigned to the session.' : ''));
    } catch (x) { setErr(x.message); }
  };
  return (
    <form className="card" onSubmit={save}>
      <h1>Story Editor</h1>
      <div className="grid">
        <label>Story set<select value={mid} onChange={e => loadMat(e.target.value)}><option value="">+ New story set</option>{mats?.map(m => <option key={m.id} value={m.id}>{m.title} (v{m.version})</option>)}</select></label>
        <label>Assign to Session<select value={sid} onChange={e => pickSession(e.target.value)}><option value="">— none —</option>{sessions?.map((s, i) => <option key={s.id} value={s.id}>Session {i + 1}: {s.title}</option>)}</select></label>
        <label>Story Title<input required value={f.story_title} onChange={e => setF({ ...f, story_title: e.target.value })} /></label>
      </div>
      <label>Full Story Text<textarea required rows={9} value={f.story_text} onChange={e => setF({ ...f, story_text: e.target.value })} /></label>
      <div className="grid">
        <label>Reading language<select value={lang} onChange={e => { sp.stop(); setLang(e.target.value); }}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Reading speed <b>{rate.toFixed(1)}×</b><input type="range" min="0.5" max="1.5" step="0.1" value={rate} onChange={e => setRate(+e.target.value)} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={f.published} onChange={e => setF({ ...f, published: e.target.checked })} /> Published</label>
      {err && <p className="err" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
      <div className="actions">
        <button className="btn green">Save Story</button>
        <button type="button" className="btn purple" disabled={!sp.supported || !f.story_text} onClick={() => sp.play(f.story_text, LANGS[lang].tag, rate)}>Preview Narration</button>
        <button type="button" className="btn out" onClick={sp.stop}>Stop Preview</button>
      </div>
      {!sp.supported && <p className="muted">Narration preview is not available in this browser.</p>}
      <p className="muted">Reading language and speed are saved to the assigned session. A story is versioned once a live game has used it: later edits become a newer version and past games keep theirs.</p>
    </form>
  );
}

// ---------- Question Editor ----------
const BLANK_Q = { idx: null, qid: '', category: 'Who', points: 5, text: '', guidance: '', alternatives: '', notes: '', published: true };

export function QuestionEditor() {
  const [mats] = useLoad(() => api('/materials'));
  const [mid, setMid] = useState('');
  const [mat, reloadMat] = useLoad(() => (mid ? api('/materials/' + mid) : Promise.resolve(null)), [mid]);
  const [q, setQ] = useState(BLANK_Q), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  useEffect(() => { if (mats && !mid && mats[0]) setMid(String(mats[0].id)); }, [mats, mid]);
  const qs = mat?.questions || [];
  useEffect(() => { setQ({ ...BLANK_Q, qid: `Q${qs.length + 1}` }); }, [mat]); // eslint-disable-line

  const persist = async list => {
    setErr(''); setMsg('');
    try {
      const r = await api('/materials/' + mid, 'PUT', { title: mat.title, story_title: mat.story_title, story_text: mat.story_text, questions: list });
      setMsg(r.new_version ? `Saved as version ${r.version} (earlier games keep their version).` : 'Saved.'); await reloadMat(); return true;
    } catch (x) { setErr(x.message); return false; }
  };
  const save = async e => {
    e.preventDefault();
    const item = { qid: q.qid, category: q.category, points: q.points, text: q.text, guidance: q.guidance, alternatives: q.alternatives, notes: q.notes, status: q.published ? 'published' : 'unpublished' };
    await persist(q.idx == null ? [...qs, item] : qs.map((x, i) => (i === q.idx ? { ...x, ...item } : x)));
  };
  const edit = (x, i) => { setQ({ idx: i, qid: x.qid, category: x.category, points: x.points ?? '', text: x.text, guidance: x.guidance, alternatives: x.alternatives || '', notes: x.notes || '', published: x.status === 'published' }); window.scrollTo(0, 0); };
  const set = k => e => setQ({ ...q, [k]: e.target.value });

  return (
    <>
      <form className="card" onSubmit={save}>
        <h1>Question Editor</h1>
        <div className="grid">
          <label>Story set<select value={mid} onChange={e => setMid(e.target.value)}>{mats?.map(m => <option key={m.id} value={m.id}>{m.title} (v{m.version})</option>)}</select></label>
          <label>Question Number<input required value={q.qid} onChange={set('qid')} /></label>
          <label>Category<select value={q.category} onChange={set('category')}>{CATS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Point Value<input type="number" min="0" value={q.points} onChange={set('points')} /></label>
        </div>
        <label>Question Text<textarea required rows={3} value={q.text} onChange={set('text')} /></label>
        <label>Correct-Answer Guide<textarea rows={3} value={q.guidance} onChange={set('guidance')} /></label>
        <label>Acceptable Alternative Answers<textarea rows={3} value={q.alternatives} onChange={set('alternatives')} /></label>
        <label>Private Facilitator Notes<textarea rows={3} value={q.notes} onChange={set('notes')} /></label>
        <label className="check"><input type="checkbox" checked={q.published} onChange={e => setQ({ ...q, published: e.target.checked })} /> Published</label>
        {err && <p className="err" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
        <button className="btn green" disabled={!mid}>Save Question</button>
        <button type="button" className="btn out" onClick={() => setQ({ ...BLANK_Q, qid: `Q${qs.length + 1}` })}>Clear Form</button>
        <p className="muted">Answer guides and notes are for the facilitator only; learners never see them.</p>
      </form>
      <section className="card"><h2>Question Bank</h2>
        <div className="scroll"><table><thead><tr><th>ID</th><th>Story set</th><th>Category</th><th>Question</th><th>Points</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{qs.map((x, i) => (
            <tr key={x.qid}><td>{x.qid}</td><td>{mat.title}</td><td>{x.category}</td><td>{x.text}</td><td>{x.points ?? 'default'}</td><td><Status>{x.status}</Status></td>
              <td className="actions"><button className="btn small out" onClick={() => edit(x, i)}>Edit</button>
                <button className="btn small red" onClick={() => confirm(`Delete ${x.qid}?`) && persist(qs.filter((_, j) => j !== i))}>Delete</button></td></tr>))}</tbody></table></div>
      </section>
    </>
  );
}

// ---------- Sessions ----------
const BLANK_S = { title: '', description: '', objectives: '', type: 'intervention', planned_at: '', duration_min: '', group_id: '', material_id: '', narration_lang: 'en-US', narration_rate: 0.9,
  settings: { correct_points: 5, incorrect_points: 0, allow_repeats: false, first_step_rule: 'stay', backward_connections: true }, student_ids: [] };

export function Sessions() {
  const [list, reload] = useLoad(() => api('/sessions'));
  const [mats] = useLoad(() => api('/materials'));
  const [groups] = useLoad(() => api('/groups'));
  const [students] = useLoad(() => api('/students'));
  const [tset] = useLoad(() => api('/settings'));
  const [f, setF] = useState(null), [prev, setPrev] = useState(null), [err, setErr] = useState(''), [msg, setMsg] = useState('');
  const [edits, setEdits] = useState({});
  const run = async (fn, ok) => { setErr(''); setMsg(''); try { await fn(); if (ok) setMsg(ok); reload(); } catch (x) { setErr(x.message); } };

  const open = async id => {
    setErr('');
    if (!id) return setF({ ...BLANK_S, settings: { ...BLANK_S.settings, allow_repeats: !!tset?.allow_repeats } });
    const s = await api('/sessions/' + id);
    setF({ ...s, planned_at: s.planned_at ?? '', duration_min: s.duration_min ?? '', group_id: s.group_id ?? '', material_id: s.material_id ?? '' });
  };
  const save = async e => {
    e.preventDefault(); setErr('');
    try { f.id ? await api('/sessions/' + f.id, 'PUT', f) : await api('/sessions', 'POST', f); setF(null); reload(); } catch (x) { setErr(x.message); }
  };
  const move = (i, d) => { const ids = list.map(s => s.id), j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; run(() => api('/sessions/reorder', 'POST', { ids })); };
  const ed = (s, k) => edits[s.id]?.[k] ?? s[k] ?? '';
  const setEd = (s, k, v) => setEdits({ ...edits, [s.id]: { ...edits[s.id], [k]: v } });
  const saveInline = s => run(async () => { await api('/sessions/' + s.id, 'PUT', { ...s, ...edits[s.id], student_ids: undefined }); setEdits({ ...edits, [s.id]: undefined }); }, 'Session saved.');
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const setS = (k, v) => setF({ ...f, settings: { ...f.settings, [k]: v } });
  const toggle = id => setF({ ...f, student_ids: f.student_ids.includes(id) ? f.student_ids.filter(x => x !== id) : [...f.student_ids, id] });
  const addGroup = gid => setF({ ...f, student_ids: [...new Set([...f.student_ids, ...students.filter(s => s.active && String(s.group_id) === String(gid)).map(s => s.id)])] });

  if (prev) return (
    <div className="card"><h2>Preview: {prev.title}</h2>
      {prev.material ? <><h3>{prev.material.story_title}</h3><p className="story">{prev.material.story_text}</p>
        <ul>{prev.material.questions.filter(q => q.status === 'published').map(q => <li key={q.qid}><b>{q.qid}</b> ({q.category}) {q.text} <i className="muted">— {q.guidance}</i></li>)}</ul></> : <p className="err">No story/question set assigned.</p>}
      <button className="btn dark" onClick={() => setPrev(null)}>Close preview</button></div>
  );

  if (f) return (
    <form className="card" onSubmit={save}>
      <h2>{f.id ? 'Session details' : 'Create session'}</h2>
      <div className="grid">
        <label>Title<input required value={f.title} onChange={set('title')} /></label>
        <label>Type<select value={f.type} onChange={set('type')}><option value="intervention">Intervention</option><option value="practice">Practice</option><option value="review">Review</option></select></label>
        <label>Planned date/time<input type="datetime-local" value={f.planned_at} onChange={set('planned_at')} /></label>
        <label>Duration target (min)<input type="number" min="1" value={f.duration_min} onChange={set('duration_min')} /></label>
        <label>Story & question set<select value={f.material_id} onChange={set('material_id')}><option value="">— choose —</option>{mats?.filter(m => m.status !== 'archived').map(m => <option key={m.id} value={m.id}>{m.title} (v{m.version})</option>)}</select></label>
        <label>Default group<select value={f.group_id} onChange={set('group_id')}><option value="">None</option>{groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      </div>
      <label>Description<input value={f.description ?? ''} onChange={set('description')} /></label>
      <label>Learning Objectives<textarea rows={2} value={f.objectives ?? ''} onChange={set('objectives')} /></label>
      <h3>Game settings</h3>
      <div className="grid">
        <label>Default points for correct<input type="number" min="0" value={f.settings.correct_points} onChange={e => setS('correct_points', e.target.value)} /></label>
        <label>Points for incorrect<input type="number" min="0" value={f.settings.incorrect_points} onChange={e => setS('incorrect_points', e.target.value)} /></label>
        <label>If two steps back goes before Step 1<select value={f.settings.first_step_rule} onChange={e => setS('first_step_rule', e.target.value)}><option value="stay">Stay where you are</option><option value="start">Go to Start</option></select></label>
        <label className="check"><input type="checkbox" checked={f.settings.allow_repeats} onChange={e => setS('allow_repeats', e.target.checked)} /> Allow repeated questions</label>
        <label className="check"><input type="checkbox" checked={f.settings.backward_connections} onChange={e => setS('backward_connections', e.target.checked)} /> Apply snake/ladder after moving back</label>
      </div>
      <h3>Selected learners ({f.student_ids.length})</h3>
      <p className="muted">You confirm who actually plays when you start the live game.</p>
      {groups?.map(g => <button key={g.id} type="button" className="btn small dark" onClick={() => addGroup(g.id)}>+ {g.name}</button>)}
      <button type="button" className="btn small dark" onClick={() => setF({ ...f, student_ids: [] })}>Clear</button>
      <div className="checklist">{students?.filter(s => s.active || f.student_ids.includes(s.id)).map(s => (
        <label key={s.id} className="check"><input type="checkbox" checked={f.student_ids.includes(s.id)} onChange={() => toggle(s.id)} /> {s.avatar} {s.full_name}{s.group_name ? ` · ${s.group_name}` : ''}</label>))}</div>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn green">Save</button><button type="button" className="btn dark" onClick={() => setF(null)}>Cancel</button>
    </form>
  );

  return (
    <section className="card">
      <h1>Session Management</h1>
      <button className="btn" onClick={() => open(null)}>+ Create session</button>
      {err && <p className="err" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
      <div className="sessionlist">{list?.map((s, i) => (
        <article key={s.id} className="subcard">
          <div className="grid">
            <label>Session Title<input value={ed(s, 'title')} onChange={e => setEd(s, 'title', e.target.value)} /></label>
            <label>Description<input value={ed(s, 'description')} onChange={e => setEd(s, 'description', e.target.value)} /></label>
          </div>
          <label>Learning Objectives<textarea rows={2} value={ed(s, 'objectives')} onChange={e => setEd(s, 'objectives', e.target.value)} /></label>
          <div className="chips">
            <span className={s.material_status === 'published' ? 'ok-chip' : ''}>{s.material_status === 'published' ? 'Published story assigned' : s.material_title ? 'Story assigned (unpublished)' : 'No story assigned'}</span>
            <span>{s.published_questions} published question(s)</span>
            <span>{s.participants} learner(s)</span>
            <Status>{s.status === 'published' ? 'Unlocked' : s.status === 'archived' ? 'Archived' : 'Draft'}</Status>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => saveInline(s)} disabled={!edits[s.id]}>Save</button>
            {s.status === 'published' ? <button className="btn purple" onClick={() => run(() => api(`/sessions/${s.id}/status`, 'PATCH', { status: 'draft' }))}>Unpublish</button>
              : s.status !== 'archived' && <button className="btn green" onClick={() => run(() => api(`/sessions/${s.id}/status`, 'PATCH', { status: 'published' }))}>Publish</button>}
            <button className="btn small dark" onClick={() => open(s.id)}>Details</button>
            <button className="btn small dark" onClick={async () => setPrev(await api('/sessions/' + s.id))}>Preview</button>
            <button className="btn small dark" onClick={() => run(() => api(`/sessions/${s.id}/duplicate`, 'POST'))}>Duplicate</button>
            {s.status !== 'archived' && <button className="btn small dark" onClick={() => run(() => api(`/sessions/${s.id}/status`, 'PATCH', { status: 'archived' }))}>Archive</button>}
            <button className="btn small dark" aria-label="Move up" onClick={() => move(i, -1)}>↑</button><button className="btn small dark" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
            <button className="btn small red" onClick={() => confirm(`Delete “${s.title}”? Only allowed with no records; otherwise archive.`) && run(() => api('/sessions/' + s.id, 'DELETE'))}>Delete</button>
          </div>
        </article>))}</div>
    </section>
  );
}
