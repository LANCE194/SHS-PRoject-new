import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

// Permanent storage: the SQLite file lives in DATA_DIR. In production, point DATA_DIR at a persistent disk/volume
// (e.g. /var/data) so records survive restarts and redeploys. Locally it defaults to ./data.
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'ambak.db');
const db = new Database(DB_PATH);
console.log('SQLite database:', DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
const addCol = (t, c, def) => { if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };

db.exec(`
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT DEFAULT '',
  year_section TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS learner_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(teacher_id, name)
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  age INTEGER, birthdate TEXT, lrn TEXT, grade_section TEXT,
  address TEXT DEFAULT '', guardian_name TEXT DEFAULT '', guardian_contact TEXT DEFAULT '',
  avatar TEXT DEFAULT '🦉',
  active INTEGER NOT NULL DEFAULT 1,
  group_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
addCol('teachers', 'year_section', "TEXT DEFAULT ''");
addCol('students', 'active', 'INTEGER NOT NULL DEFAULT 1');
addCol('students', 'group_id', 'INTEGER');

// Legacy placeholder tables (fixed 4 sessions, sample questions) are replaced by the dynamic schema below.
if (cols('sessions').length && !cols('sessions').includes('teacher_id')) {
  db.exec('DROP TABLE IF EXISTS results; DROP TABLE IF EXISTS questions; DROP TABLE IF EXISTS sessions;');
}

db.exec(`
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_version_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS material_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  story_title TEXT DEFAULT '', story_text TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(material_id, version)
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES material_versions(id) ON DELETE CASCADE,
  qid TEXT NOT NULL, category TEXT DEFAULT '', color TEXT DEFAULT '',
  text TEXT NOT NULL, guidance TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'published',
  UNIQUE(version_id, qid)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT DEFAULT '', type TEXT DEFAULT 'intervention',
  display_order INTEGER DEFAULT 0, planned_at TEXT, duration_min INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  group_id INTEGER, material_version_id INTEGER REFERENCES material_versions(id),
  narration_lang TEXT DEFAULT 'en-US', narration_rate REAL DEFAULT 0.9,
  settings TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS session_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  status TEXT NOT NULL DEFAULT 'selected',
  UNIQUE(session_id, student_id)
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  material_version_id INTEGER NOT NULL REFERENCES material_versions(id),
  status TEXT NOT NULL DEFAULT 'setup',
  settings TEXT DEFAULT '{}',
  current_player_id INTEGER,
  started_at TEXT, ended_at TEXT, paused_at TEXT,
  paused_total_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS game_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  turn_order INTEGER, initial_roll INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, student_id)
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  player_id INTEGER NOT NULL REFERENCES game_players(id),
  question_id INTEGER REFERENCES questions(id), qid TEXT,
  presented_at TEXT, confirmed_at TEXT,
  decision TEXT, points INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER, paused_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT, correction_reason TEXT, corrected INTEGER NOT NULL DEFAULT 0,
  event_id TEXT UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_turn ON turns(game_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id INTEGER NOT NULL UNIQUE REFERENCES turns(id),
  game_id INTEGER NOT NULL, player_id INTEGER NOT NULL,
  prev_position INTEGER NOT NULL, die_roll INTEGER,
  initial_position INTEGER NOT NULL,      -- after the roll / two steps back, before snake or ladder
  connection_position INTEGER NOT NULL,   -- after snake/ladder (the expected result)
  final_position INTEGER NOT NULL,        -- facilitator-confirmed physical position
  mismatch_reason TEXT,
  confirmed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS finishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL, player_id INTEGER NOT NULL,
  finished_at TEXT NOT NULL, voided INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, player_id)
);
CREATE TABLE IF NOT EXISTS prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL, player_id INTEGER NOT NULL,
  kind TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_role TEXT, actor_id INTEGER, action TEXT NOT NULL,
  entity TEXT, entity_id INTEGER, old_value TEXT, new_value TEXT, reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- Official/post-test records live apart from game data and are never derived from it.
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  kind TEXT NOT NULL, result TEXT NOT NULL, administered_on TEXT, notes TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

addCol('students', 'prefs', "TEXT NOT NULL DEFAULT '{}'");
addCol('teachers', 'settings', "TEXT NOT NULL DEFAULT '{}'");
addCol('sessions', 'objectives', "TEXT DEFAULT ''");
addCol('questions', 'points', 'INTEGER');
addCol('questions', 'alternatives', "TEXT DEFAULT ''");
addCol('questions', 'notes', "TEXT DEFAULT ''");
addCol('turns', 'notes', "TEXT DEFAULT ''");

export default db;