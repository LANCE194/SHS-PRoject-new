import { useCallback, useEffect, useRef, useState } from 'react';

export const fmt = ms => { const s = Math.floor((ms || 0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const fmtH = ms => { const s = Math.floor((ms || 0) / 1000); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const when = iso => (iso ? new Date(iso).toLocaleString() : '—');
export const AVATARS = ['🦉', '🐯', '🐼', '🦊', '🐸', '🚀'];
export const AVATAR_NAMES = [['🦉', 'Owl'], ['🐯', 'Tiger'], ['🐼', 'Panda'], ['🦊', 'Fox'], ['🐸', 'Frog'], ['🚀', 'Rocket']];
export const COLOR_NAMES = [['#2878d0', 'Blue'], ['#28a96b', 'Green'], ['#e7515a', 'Red'], ['#e0a100', 'Gold'], ['#8a4fd0', 'Purple'], ['#1aa6a6', 'Teal'], ['#ff8c42', 'Orange'], ['#e36cb0', 'Pink']];
export const TOKENS = { star: '⭐', circle: '🔵', book: '📘', shield: '🛡️' };
export const TOKEN_NAMES = [['star', 'Star'], ['circle', 'Circle'], ['book', 'Book'], ['shield', 'Shield']];
export const LANGS = { en: { label: 'English', tag: 'en-US' }, fil: { label: 'Filipino', tag: 'fil-PH' } };
export const TAG_TO_KEY = tag => (String(tag).toLowerCase().startsWith('fil') ? 'fil' : 'en');

export const GUIDE_TEXT = {
  en: 'Hello! I am Tala, your friendly reading guide. Listen to the story, answer the questions with your teacher, and enjoy the board game!',
  fil: 'Kumusta! Ako si Tala, ang iyong kaibigang gabay sa pagbabasa. Making sa kuwento, sagutin ang mga tanong kasama ang iyong guro, at mag-enjoy sa laro!'
};

// Browser text-to-speech with pause/resume/stop. Text always stays visible on screen as well.
export function useSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => { if (supported) speechSynthesis.cancel(); }, [supported]);
  const play = useCallback((text, tag = 'en-US', rate = 0.9) => {
    if (!supported) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = tag; u.rate = rate;
    const v = speechSynthesis.getVoices().find(x => x.lang?.toLowerCase().startsWith(tag.slice(0, 2).toLowerCase()));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }, [supported]);
  return { supported, play, pause: () => supported && speechSynthesis.pause(), resume: () => supported && speechSynthesis.resume(), stop: () => supported && speechSynthesis.cancel() };
}

export function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination); o.frequency.value = 660; g.gain.value = 0.05; o.start(); o.stop(c.currentTime + 0.12);
  } catch { /* sound unavailable */ }
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export const Dice = ({ value }) => (
  <div className="dice" role="img" aria-label={value ? `Die showing ${value}` : 'Die not rolled yet'}>
    {[...Array(9)].map((_, i) => <i key={i} className={(PIPS[value] || []).includes(i) ? 'pip' : ''} />)}
  </div>
);

export function Pw({ label = 'Password', value, onChange, required = true }) {
  const [show, setShow] = useState(false);
  return (
    <label>{label}
      <span className="pw">
        <input required={required} type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete="current-password" />
        <button type="button" className="btn small dark" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
      </span>
    </label>
  );
}

// Loads data on mount/refresh; keeps the last good value if a refresh fails.
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const ref = useRef(fn); ref.current = fn;
  const reload = useCallback(async () => { try { setData(await ref.current()); setErr(''); } catch (e) { setErr(e.message); } }, deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return [data, reload, err];
}

export const Status = ({ children }) => {
  const k = String(children).toLowerCase().replace(/[^a-z]+/g, '-');
  return <span className={`badge b-${k}`}>{children}</span>;
};
export const Tabs = ({ tabs, value, onChange }) => (
  <nav className="navtabs" aria-label="Sections">
    {tabs.map(([k, l]) => <button key={k} className={value === k ? 'on' : ''} aria-current={value === k ? 'page' : undefined} onClick={() => onChange(k)}>{l}</button>)}
  </nav>
);
