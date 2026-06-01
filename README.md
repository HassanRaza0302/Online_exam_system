# Online Examination System with Transaction Management and Ranking

Production-style semester project for a DBMS-focused online exam platform with:
- transaction-safe exam submission,
- ranking generation,
- session-based authentication,
- admin approval workflow,
- server-side timer enforcement.

## Tech Stack
- Frontend: HTML, CSS, Bootstrap, JavaScript
- Backend: Node.js + Express.js (Node **18–22 LTS** recommended; Node 24 may break optional ODBC drivers)
- Database: Microsoft SQL Server 2014

## Architecture
`Frontend -> Express API Layer -> SQL Server`

No direct frontend-to-database access.

## Project Structure
```text
online-exam-system/
  backend/
    src/
      middleware/
      routes/
      scripts/
      services/
  frontend/
    assets/
      css/
      js/
  database/
    Project.sql
    auth_procedures.sql
  scripts/
    start-with-browser.js
  package.json
  README.md
```

## Implemented Features

### Authentication & Authorization
- Student registration: `POST /api/register-student` (new users start as `PENDING`)
- Admin registration: `POST /api/register-admin`
- Student/Admin login with session cookies
- Account status enforcement (`PENDING`, `APPROVED`, `REJECTED`)
- Protected student/admin routes using middleware
- Password hashing with `bcryptjs`
- Auth events logged to `AuditLogs`

### Exam Flow (Student)
- List exams, start exam, save answers, submit exam
- Single-attempt restriction per student per exam
- Backend timer enforcement:
  - no answer updates after time expiry
  - auto-submit on timer expiry
- Transaction-safe submission via stored procedures
- Result and ranking retrieval APIs

### Admin Flow
- Approve/reject students
- Create exams and add questions
- View exam results and rankings
- Force ranking recalculation
- Profile analytics (created exams, student stats)

### DBMS Features
- Stored procedures:
  - `sp_SubmitExam`
  - `sp_GenerateRankings`
  - `sp_StudentLogin`
  - `sp_AdminLogin`
  - `sp_LogAuthEvent`
- Trigger for submission audit logging
- Ranking: same score receives the same rank (`DENSE_RANK` by score)
- Indexes included in schema

## Setup and Run

### 1) Install dependencies (from project root)
```bash
cd path/to/online-exam-system
npm install
```

### 2) Microsoft SQL Server 2014 (default instance)

Node connects over **TCP**. In SSMS you may use `localhost`; the app needs TCP enabled:

1. **SQL Server Configuration Manager** → *Protocols for MSSQLSERVER* → enable **TCP/IP**
2. TCP/IP → *IPAll* → **TCP Port** = `1433` → **Restart** *SQL Server (MSSQLSERVER)*
3. `services.msc` → *SQL Server (MSSQLSERVER)* = **Running**

`backend/.env` (default instance — no `\SQLEXPRESS`):

```env
DB_SERVER=localhost
DB_PORT=1433
```

Find your port if different:

```bash
npm run db:discover
```

### 3) Configure environment
Create `.env` from the example:
```bash
copy .env.example .env
```

Required keys in `backend/.env`:
- `PORT=3011`
- `SESSION_SECRET=dev_secret_change_me`
- `DB_SERVER=localhost` (or `localhost\\SQLEXPRESS`)
- `DB_PORT=1433`
- `DB_DATABASE=OnlineExamSystem`
- `DB_USER=...`
- `DB_PASSWORD=...`

### 4) Apply database schema
Run `database/Project.sql` in SSMS:
- Open SSMS
- New Query
- Open `database/Project.sql`
- Execute

### 5) Apply auth procedures + password migration (one-time)
```bash
cd backend
npm run db:auth
npm run db:hash-passwords
```

### 6) Test DB, apply features, start app

```bash
npm run db:test
npm run db:features
npm run browser
```

### 7) Start server only (optional)
From project root:

```bash
npm run browser
```

Or start the server only:

```bash
npm start
```

Open:
- Health: `http://localhost:3011/health`
- DB health: `http://localhost:3011/db/health`
- Frontend home: `http://localhost:3011/`

## Main API Endpoints

### Auth
- `POST /api/register-student`
- `POST /api/register-admin`
- `POST /api/login` (role-based alias)
- `POST /api/auth/student/login`
- `POST /api/auth/admin/login`
- `POST /api/auth/student/logout`
- `POST /api/auth/admin/logout`
- `GET /api/auth/me`

### Admin
- `POST /api/approve-student`
- `GET /api/admin/students/pending`
- `GET /api/admin/students`
- `GET /api/admin/exams`
- `PUT /api/admin/exams/:examId`
- `DELETE /api/admin/exams/:examId`
- `POST /api/admin/database/clean`
- `POST /api/create-exam` (alias)
- `POST /api/add-question` (alias)
- `POST /api/admin/exams`
- `POST /api/admin/exams/:examId/questions`
- `GET /api/admin/exams/:examId/results`
- `POST /api/admin/exams/:examId/rankings/recalculate`

### Student
- `GET /api/exams`
- `POST /api/start-exam` (alias)
- `POST /api/submit-answer` (alias)
- `POST /api/submit-exam` (alias)
- `GET /api/result?attempt_id=...`
- `GET /api/ranking?exam_id=...`

### Profiles
- `GET /api/profile/student`
- `GET /api/profile/admin`

## Utility Scripts
- `npm run db:discover` - show installed instances + TCP port (Windows, SQL Server 2014)
- `npm run db:test` - test database connection
- `npm run db:apply` - apply `database/Project.sql`
- `npm run db:auth` - apply auth stored procedures
- `npm run db:features` - apply ranking/delete/cleanup procedures (`database/feature_updates.sql`)
- `npm run db:clean -- attempts|exams|all` - clean attempt/result data from database
- `npm run db:hash-passwords` - hash legacy plaintext passwords
- `npm run stress:exam -- <examId> <users>` - concurrent submission stress simulation

## New Features
- Admin exam CRUD: create, edit (including time limit), delete (`admin-manage-exams.html`)
- Admin profile shows full student list
- Tie ranking: same score gets same rank (`DENSE_RANK` by score)
- Exam page copy/cut/paste protection during attempts
- Database cleanup tools (dashboard + `npm run db:clean`)

## Notes
- Session store is in-memory for development.
- For deployment, use a persistent session store and HTTPS-secure cookies.
- Password hashes are stored in existing `password` columns for compatibility with current schema.

