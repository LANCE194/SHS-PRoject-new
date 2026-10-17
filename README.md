# A.M.B.A.K. Reading Intervention (React + Express + SQLite)

Teacher-controlled website for the physical 30-step Snake-and-Ladder reading game.

## Run
    npm install
    npm run dev        # API :3001, web :5173
    npm test           # smoke tests: board rules, permissions, gameplay, audit
Demo teacher: `teacher` / `ambak123` (change it). More teachers: `npm run create-teacher <username> <password> [full name]`
Teacher sign-up needs the secret code (`TEACHER_CODE`, default 482915 — change it).

## Production
    npm run build && JWT_SECRET=your-secret TEACHER_CODE=123456 npm start
    npm run backup     # safe copy to backups/ + integrity/restore check (run on a schedule)

## Screens (match the approved screenshots)
Landing (Tala guide with working voice, language, speed) → Login (Learner/Teacher tabs). Learner: Home, Sessions, My Dashboard, App Settings (language, voice, speed, sound saved per learner). Teacher sidebar: Overview, Learners, Groups, Sessions, Story Editor, Question Editor, Live Game, Finish Tracker, Progress Reports, Data Export, Settings.

## Roles
- **Learner** (view only): home cards, session history, progress, achievements, profile (display name/avatar only), password change. Cannot start games or see others' data; LRN is masked.
- **Teacher**: learners (create/edit/deactivate/reset password/import), groups, story library (versioned), sessions (draft/publish/duplicate/reorder/archive), live game, reports, CSV, attendance, separate assessments, audit log.

## Gameplay rules (src/rules.js, shared by server and UI)
Ladders 3→10, 6→17, 12→23, 21→27. Snakes 15→1, 9→5, 26→22, 29→18. Correct: physical die forward. Incorrect: exactly 2 back, no die. Overshooting 30 = stay; finish only when the facilitator confirms Step 30. Facilitator always confirms the physical position; differences need a reason and are audited. Points (5/0 default), finish rank, and assessments are separate.

## Decisions to confirm with the research team (implemented as settings/defaults)
- Back-two before Step 1: default stay put (session setting: go to Start).
- Snake/ladder after moving backward: applied (session setting).
- Question repeats: off; wheel resets when all questions used.
- Pause: all timers exclude paused time. Turn-order ties: re-roll or enter order manually.
- Accuracy = correct / (correct + incorrect); skipped turns excluded.
- Consent/assent, retention period: not implemented — define per protocol.

## Upgrade note
The old fixed `sessions`/`questions`/`results` placeholder tables are replaced by the dynamic schema on first start. Teachers and learner accounts are kept.
