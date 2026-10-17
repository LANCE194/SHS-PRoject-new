// Single source of truth for the physical 30-step board (used by server and client).
export const FINISH = 30;
export const LADDERS = { 3: 10, 6: 17, 12: 23, 21: 27 };
export const SNAKES = { 15: 1, 9: 5, 26: 22, 29: 18 };
export const connection = p => LADDERS[p] ?? SNAKES[p] ?? p;
export const connectionType = p => (p in LADDERS ? 'ladder' : p in SNAKES ? 'snake' : null);

// Correct answer: physical die roll moves forward; overshooting Step 30 = stay (exact finish rule).
export function planCorrect(pos, roll) {
  const raw = pos + roll;
  if (raw > FINISH) return { initial: pos, after: pos, overshoot: true };
  return { initial: raw, after: connection(raw), overshoot: false };
}

// Incorrect answer: exactly two steps back, no die. Boundary (<Step 1) rule is a pending team decision:
// rule 'stay' = remain where you are, 'start' = go to Start (0). Connections after backward move are configurable.
export function planIncorrect(pos, rule = 'stay', applyConn = true) {
  let raw = pos - 2;
  if (raw < 1) raw = rule === 'start' ? 0 : pos;
  return { initial: raw, after: applyConn ? connection(raw) : raw };
}
