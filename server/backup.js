// npm run backup  -> copies the live DB safely, then verifies the copy can be opened (restoration check).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import db, { DATA_DIR } from './db.js';
const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const file = `${dir}/ambak-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
await db.backup(file);
const copy = new Database(file, { readonly: true });
const ok = copy.pragma('integrity_check', { simple: true });
const n = copy.prepare("SELECT (SELECT COUNT(*) FROM students) students, (SELECT COUNT(*) FROM turns) turns, (SELECT COUNT(*) FROM games) games").get();
console.log(`Backup: ${file}\nIntegrity: ${ok}\nRestore check -> students ${n.students}, games ${n.games}, turns ${n.turns}`);
if (ok !== 'ok') process.exit(1);