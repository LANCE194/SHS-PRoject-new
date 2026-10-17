import bcrypt from 'bcryptjs';
import db from './db.js';
const [username, password, ...name] = process.argv.slice(2);
if (!username || !password) { console.log('Usage: npm run create-teacher <username> <password> [full name]'); process.exit(1); }
db.prepare('INSERT INTO teachers (username,password_hash,full_name) VALUES (?,?,?)')
  .run(username, bcrypt.hashSync(password, 10), name.join(' '));
console.log('Teacher created:', username);
