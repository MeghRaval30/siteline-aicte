# Handoff prompt — SiteLine · AICTE (SIH26262)

> **How to use this file:** copy everything below the line into a new Claude Code chat on the machine that will continue the work. It is written to that next session, which starts with no memory of the previous one.

---

You are picking up an in-progress **Smart India Hackathon (SIH) 2026** project from another Claude session on a different computer. You have no memory of that session; everything you need is in this prompt and in the repository. Read this whole prompt before touching anything. Then follow **§0 First 15 minutes** exactly.

The person you are working with is a member of the hackathon team (not necessarily the repo owner). Be direct, work fast, verify everything you change, and keep the demo working at all times — a half-finished feature that breaks the demo is worse than no feature.

---

## 0. First 15 minutes (do these in order)

1. **Check the clock.** Run `date`. The original deadline was **2026-10-28, 23:00 IST** (this handoff was written at 21:40 IST that day). If that deadline has passed, ask the user what the new goal is (finale prep, judging round, bug fixes) before building anything.
2. **Check tools:** `node -v` (need ≥ 18; tested on 24), `npm -v`, `git --version`, `gh --version`. Optional: `ollama --version` and `ollama list` (for the AI features).
   - Missing `gh`? Install it (Windows: `winget install --id GitHub.cli`; macOS: `brew install gh`; Debian/Ubuntu: `sudo apt install gh`) or ask the user to.
3. **GitHub login (the user's own account).** Run `gh auth status`.
   - If it is **not logged in**, ask the user to run `gh auth login` **themselves in their terminal** (choose GitHub.com → HTTPS → "Login with a web browser") and tell you when done. **Never** ask the user to paste a password or token into the chat, and never type credentials on their behalf.
   - Then run `gh auth setup-git` so `git push` uses that login.
4. **Get the code.** `gh repo clone MeghRaval30/siteline-aicte` then `cd siteline-aicte`. (Public repo: https://github.com/MeghRaval30/siteline-aicte, default branch `main`.)
5. **Set commit identity to the user's GitHub account** (repo-local, so commits are attributed to them):
   ```bash
   LOGIN=$(gh api user --jq .login); ID=$(gh api user --jq .id); NAME=$(gh api user --jq '.name // .login')
   git config user.name "$NAME"
   git config user.email "$ID+$LOGIN@users.noreply.github.com"
   ```
6. **Check push rights:** `gh api repos/MeghRaval30/siteline-aicte --jq .permissions.push`
   - `true` → they are a collaborator; you can push branches/PRs to this repo directly.
   - `false` → see **§10 Committing to GitHub**: fork under their account (`gh repo fork --remote`) and open PRs, and tell the user to ask **MeghRaval30** (the repo owner) to add them as a collaborator.
7. **Install, seed, build, run:**
   ```bash
   npm run setup        # installs server+client, creates server/.env from .env.example, creates SQLite DB, seeds demo data, builds client
   npm start            # serves API + built UI on http://localhost:3000
   ```
   If you plan to edit the frontend a lot, run the Vite dev server instead: `npm run dev --prefix client` (http://localhost:5173, proxies /api to :3000) alongside `npm start`.
8. **Prove it works before changing anything:** in another terminal run
   ```bash
   npm run seed --prefix server && npm run e2e --prefix server   # expect: ALL CHECKS PASSED (72 checks)
   npm run seed --prefix server                                   # e2e mutates data — always reseed afterwards
   ```
   Then open http://localhost:3000 and sign in with the demo accounts in §3. If anything fails here, fix setup first and tell the user.

---

## 1. The problem statement

**SIH26262 — Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System.**
Problem creator: Sarim Moin, AICTE · Department: Ministry of Education's Innovation Cell (MIC) · Technology bucket: Smart Automation · Category: Software.

Background (as given): *AICTE processes applications from technical institutions through different stages, including scrutiny/re-scrutiny, Expert Visit Committee (EVC), SAC/SHC and other stages prescribed under the applicable Approval Process Handbook (APH). Certain approvals are also granted subject to time-bound undertakings and compliance requirements, including the submission and renewal of prescribed documents such as lease documents. Monitoring application movement, stage-wise pendency, EVC scheduling, institutional undertakings, compliance submissions and document validity…* (the screenshot the team had was cut off here; if the user can paste the rest — especially "expected solution" — read it and check the backlog against it).

How the product maps to it:

| Need | Where it lives |
|---|---|
| Application movement through APH stages | `server/shared/workflow.js` state machine + `POST /applications/:id/transition` + Application detail page (stage tracker, timeline) |
| Stage-wise pendency | Per-stage SLA; dashboard pendency chart, ageing buckets, Regional Office × stage heatmap, kanban board, Reports CSVs |
| EVC scheduling | `server/modules/evc` — conflict-of-interest + availability aware panel suggester, scheduling, expert report filing |
| Time-bound undertakings | Created on conditional approval; institution submits proof; officer verifies/waives/breaches (breach → institution "Under Show-Cause") |
| Prescribed documents & validity/renewal | `ComplianceDocument` with validity; status sweep (Valid → Expiring Soon → Expired); renewals supersede and auto-close alerts |
| Alert management | Playbook-style rules engine (`server/modules/alerts/engine.js`), English → rule compiler, Alert Center UI, notifications |

---

## 2. Project history (why the code looks the way it does)

The team had two earlier hackathon projects:
- **siteline** (https://github.com/MeghRaval30/siteline) — an Express + Prisma + React asset-management app with an Ollama tool-calling AI agent, command palette and a dark design system.
- **odoo_2026** (https://github.com/MeghRaval30/odoo_2026) — a Django HR/payroll app whose standout ideas were *playbooks* (standing rules that raise reminders but never act), an English → rule compiler with a keyword fallback, an AI Import Studio (three-voter column mapping), and mass actions.

`siteline-aicte` is siteline rebuilt for the AICTE domain, with odoo_2026's best ideas ported into Node. History (newest first):
- `78907bd` QA review fixes — crash, authorization (IDOR) holes, races, workflow and UX defects (22 fixes, see §8)
- `b68e60b` AI Import Studio ported from odoo_2026
- `ff15946` the AICTE rebuild
- older commits are the original siteline history

UI direction from the user: **take inspiration from claude.ai and linkedin.com** → current "Ivory & Clay" light theme (warm cream canvas, clay accent `#c96442`, serif display type like claude.ai; white bordered cards, pill buttons, system font, LinkedIn-blue links/search). Keep that look for anything new.

---

## 3. Running, accounts, demo data

- Stack: **Node/Express + Prisma 5 + SQLite** (`server/`), **React 18 + Vite + Recharts 3 + lucide-react 0.460** (`client/`), optional **Ollama** for the LLM.
- One port in "prod" mode: `npm start` serves the API **and** `client/dist` on http://localhost:3000. After changing client code you must `npm run build --prefix client` (or use the dev server on :5173).
- After changing **server** code you must restart the server (`npm start` has no auto-reload; `npm run dev --prefix server` uses nodemon).
- `server/.env` (git-ignored) holds `DATABASE_URL="file:./dev.db"` and `JWT_SECRET`. `npm run setup` copies it from `server/.env.example`; put a long random `JWT_SECRET` in it. Optional env: `OLLAMA_MODEL` (comma list of preferred tags), `AI_AUTOSTART=false` (don't spawn/pull Ollama at startup), `ALERT_INTERVAL_MIN` (default 10).
- **Ollama warning:** on startup `server/shared/ollamaSetup.js` starts `ollama serve` and, if no `qwen2.5` model is installed, **pulls `qwen2.5:7b-instruct` (~4.7 GB) in the background**. On a slow/metered network set `AI_AUTOSTART=false` and run `ollama pull qwen2.5:7b` yourself. `server/shared/llm.js` picks the first installed of `qwen2.5:7b-instruct, qwen2.5:7b, qwen2.5, llama3.1:8b, llama3.1, llama3`. Without any model everything still works through keyword fallbacks (the UI says which engine answered).

Demo logins (password **`demo1234`**):

| Role | Email | Sees |
|---|---|---|
| Admin — Approval Bureau | `admin@aicte.gov.in` | whole country, can approve/reject, edit national rules |
| Officer — Regional Officer, WRO Mumbai | `officer@aicte.gov.in` | only Western Regional Office (Maharashtra, Goa) |
| Expert — EVC member | `expert@aicte.gov.in` | applications on panels they sit on; files EVC reports |
| Institution — Sahyadri Institute of Technology, Pune | `institute@sahyadri-it.edu.in` | only itself |

Seed (`server/prisma/seed.js`): 9 Regional Offices, 46 **fictional** institutions, ~99 applications spread across every stage with realistic histories and SLA breaches, 12 experts in different states, ~322 compliance documents, undertakings, EVC visits, 10 default alert rules — **all dates relative to today**, and the seed runs the alert rules once at the end so the Alert Center is populated immediately. Re-seeding deletes everything and changes all IDs (old browser sessions just bounce to login). Keep institution names fictional and keep the "SPECIMEN — not an official document" line on letters.

---

## 4. Architecture tour

```
package.json                 root scripts: setup, start, seed, e2e
README.md                    features, setup, demo script (keep it in sync)
server/
  index.js                   mounts routers under /api/v1, serves /uploads and client/dist, starts alert scheduler
  e2e.js                     72-check end-to-end API suite (needs a running server; mutates data)
  prisma/schema.prisma       data model (SQLite; use `npx prisma db push`, there are no migrations)
  prisma/seed.js             demo data (see §3)
  shared/
    workflow.js              STAGES (label, SLA days, owner, colour), TRANSITIONS (role-gated, optional `when(app)` guard), slaInfo(), allowedTransitions()
    scope.js                 appScope(user), instScope(user), canTouchInstitution(user, id), ok/fail helpers, h() async wrapper
    compliance.js            sweepStatuses() (Expiring Soon/Expired/Overdue), Compliance Health Score (100 minus explained deductions, grade A–D)
    llm.js                   Ollama wrapper with model auto-pick; throws 'Ollama unavailable' so callers fall back
    authenticate.js / requireRole.js / notify.js / logActivity.js / prismaClient.js / ollamaSetup.js
  modules/
    auth/                    POST /auth/login, /auth/signup, GET /auth/me
    applications/            list/detail/create, transition engine, deficiencies, letter, public verify
    evc/                     list, suggest panel, schedule, reschedule, cancel, report
    compliance/              documents (upload/renew/verify), undertakings (create/submit/review)
    alerts/                  engine.js (rules → alerts), compiler.js (English → rule), alert.routes.js
    institutions/            list with scores, detail, regions, bulk reminder digests
    dashboard/               role-aware overview (KPIs, pipeline, heatmap, ageing, throughput, adherence…)
    ai/                      tools.js (read-only DB tools), agent.js (Ollama tool-calling + keyword router), ai.routes.js
    import/                  Import Studio: schema.js (targets, synonyms, cleaners), studio.js (reader, header finder, 3-voter mapper, validation), samples.js, import.routes.js
    users/, notifications/   users list/create; notifications + activity log (audit trail)
client/src/
  App.jsx                    routes + <Only roles> route guards
  api/client.js              fetch wrapper: adds Bearer token, unwraps {data}, friendly error codes; 401 → /login (except on /auth/*)
  components/
    Layout.jsx               sidebar (role-filtered nav), top bar, notifications, command palette, error boundaries
    ui.jsx                   shared helpers: fmtDate, StageBadge, SlaPill, StatusBadge, GradeBadge, ScoreRing, Modal, toast(), Stat, downloadCsv (CSV-injection safe), fileToBase64
    EvcModals.jsx            ScheduleEvcModal (smart panel builder), EvcReportModal
    ComplianceModals.jsx     UploadDocModal (upload/renew), SubmitUndertakingModal, ReviewUndertakingModal
    ErrorBoundary.jsx, CommandPalette.jsx
  pages/                     Dashboard (Admin/Officer, Expert, Institution variants), Applications (list + kanban + new),
                             ApplicationDetail (tracker, actions, tabs, TransitionModal), EVC, Compliance (documents/undertakings),
                             Institutions, InstitutionDetail, Alerts (alerts + rules + English rule builder), Reports,
                             ImportStudio, Letter (printable LoA/LoR with QR), Verify (public), AIChat, ActivityLogs, Settings, Login
  index.css                  original siteline design system (sl-* classes, tokens)
  theme.css                  "Ivory & Clay" light theme overrides + aq-* component styles (loaded after index.css)
```

### Data model (Prisma)
`User` (role Admin|Officer|Expert|Institution; `region_id` for officers, `institution_id` for institution users, `state` + `specialization` for experts) · `Region` (code WRO/SRO/…, states CSV) · `Institution` (aicte_id like `1-4421907351`, type, ownership, state, city, region, status Active/Under Show-Cause) · `Application` (app_number `APH/<year>/<REGION>/<seq>`, type, stage, status, stage_entered_at, assigned officer, intake/courses, letter_code, rescrutiny_count) · `StageTransition` (from/to, actor, remarks, days_in_stage, sla_breached) · `Deficiency` (category, severity, status Open/Responded/Accepted, due_date) · `EVCVisit` + `EVCMember` (panel, chair, status, recommendation, score, report) · `Undertaking` (category, due_date, status Pending/Submitted/Verified/Overdue/Breached/Waived) · `ComplianceDocument` (doc_type, validity, status, file_url, renewal_of_id) · `AlertRule` (trigger, params JSON, criteria JSON, severity, notify_roles) · `Alert` (unique per rule+entity, status Open/Acknowledged/Resolved) · `Notification` · `ActivityLog` · `ConversationSession`.

### Workflow (server/shared/workflow.js)
`SUBMITTED(3d) → SCRUTINY(15d) → [DEFICIENCY(15d, institution) ⇄ RESCRUTINY(10d)] → EVC(21d) → EC_REVIEW(10d) → APPROVED | CONDITIONAL (needs ≥1 undertaking) | REJECTED (needs remarks)`; `REJECTED → SAC(30d)` **once, within 30 days**; `SAC → EVC | SHC | APPROVED | CONDITIONAL | REJECTED`; `SHC(30d) → CONDITIONAL | REJECTED`; `SCRUTINY → EC_REVIEW` fast-track only for *Extension of Approval*; `WITHDRAWN` by institution/admin. Guards in the transition route: open deficiencies need responses before re-scrutiny; EC needs an EVC report filed **in the current round**; optimistic lock (`updateMany where stage + stage_entered_at`) returns **409** on double submits.

### Scoping & authorization rules (do not regress these)
- Reads use `appScope(user)` / `instScope(user)`. Every **write** on an institution-owned record must call `canTouchInstitution(user, institutionId)` (officer = own region, institution = itself, admin = all). Experts cannot upload documents. Officer-created alert rules are pinned to the officer's region; only Admin edits national rules. Officer audit trail is regional.
- Frontend: `<Only roles=[…]>` guards in `App.jsx` plus role-filtered nav in `Layout.jsx`. Server checks are the real protection; the UI guards are courtesy.

### Alert engine (server/modules/alerts/engine.js)
Triggers: `DOC_EXPIRING{days,doc_type}`, `DOC_EXPIRED{doc_type}`, `UNDERTAKING_DUE{days}`, `UNDERTAKING_OVERDUE`, `STAGE_SLA_BREACH{stage,grace_days}`, `EVC_UPCOMING{days}`, `EVC_REPORT_PENDING{days}`, `DEFICIENCY_OVERDUE`; criteria `{region, institution_type, state, application_type}`. `runAll()` = status sweep + every active rule; runs at startup, every `ALERT_INTERVAL_MIN`, after document verification / undertaking changes / imports, and from "Run all now". One alert per (rule, entity); wording refreshed each run; auto-resolved when the condition clears; **manually resolved alerts stay resolved**. Staff get one digest notification per rule run; institution users get each alert about them.

### AI
- `POST /ai/chat {message, session_id, fast}`: `fast:true` → keyword router only (instant); otherwise Ollama tool-calling with read-only tools (`pendency_by_stage`, `pendency_by_region`, `list_applications`, `application_status`, `expiring_documents`, `undertakings_status`, `evc_schedule`, `compliance_ranking`, `institution_profile`, `open_alerts`), all scoped to the asking user; falls back to the router on any model error; off-topic questions get a scope message. The UI shows which engine answered and the tool trace.
- `POST /alerts/rules/compile {text}`: domain-relevance gate → LLM JSON proposal → validated against real vocabularies → keyword parser fallback → returns proposal + live match count. Never auto-saves.
- Import Studio: header-row detection, junk-row removal, three voters per column (header synonyms, value shape, LLM), reconciled with vetoes; cleans dates (5 formats + Excel serials), states ("MH", "maha."), programme/ownership/document vocabularies, recasing, "540 seats"; gap filling (provisional IDs `1-9…`, default values); duplicates; create vs update; commit supersedes document records and runs the alert rules. Three demo files are generated on request from live data: `GET /import/samples/:name`.

### API surface (all under `/api/v1`, JSON `{success, data, error}`; auth = `Authorization: Bearer <jwt>`)
- auth: `POST /auth/login`, `POST /auth/signup` (⚠ creates an Institution user with no institution — see backlog), `GET /auth/me`
- applications: `GET /applications/verify/:code` (public), `GET /applications/meta`, `GET /applications?stage&status&type&region&search&overdue=1&active=1&institution_id&limit`, `GET /applications/:id`, `POST /applications`, `POST /applications/:id/transition {to, remarks, deficiencies[], undertakings[]}`, `PATCH /applications/:id/assign`, `POST /applications/:id/deficiencies`, `PATCH /applications/deficiencies/:did/respond`, `PATCH /applications/deficiencies/:did/review`, `GET /applications/:id/letter`
- evc: `GET /evc`, `GET /evc/suggest?application_id&date`, `POST /evc`, `PATCH /evc/:id/reschedule|cancel|report`
- compliance: `GET /compliance/doc-types`, `GET|POST /compliance/documents`, `PATCH /compliance/documents/:id/verify`, `GET|POST /compliance/undertakings`, `PATCH /compliance/undertakings/:id/submit|review`
- alerts: `GET /alerts`, `PATCH /alerts/:id/acknowledge|resolve`, `GET /alerts/triggers`, `GET|POST /alerts/rules`, `POST /alerts/rules/compile`, `PATCH|DELETE /alerts/rules/:id`, `POST /alerts/run`
- institutions: `GET /institutions/regions`, `GET /institutions?search&region&type&grade`, `GET /institutions/:id`, `POST /institutions/remind {ids[] | grade}`
- import: `GET /import/targets`, `GET /import/samples`, `GET /import/samples/:name`, `POST /import/analyze|preview|commit`
- other: `GET /dashboard/overview`, `GET|POST /users`, `GET /users/me`, `GET /notifications`, `PATCH /notifications/read-all`, `PATCH /notifications/:id/read`, `GET /activity-logs`, `POST /ai/chat`, `GET /ai/status`, `GET /ai/insights`

---

## 5. Conventions (match them)

- Server routes: wrap handlers in `h(async (req,res)=>…)`; respond with `ok(res, data)` / `fail(res, status, 'Human readable message')` — the client shows `error` verbatim in toasts, so write it for an end user. Log meaningful actions with `logActivity` and tell affected people with `notify`.
- Comments explain *why*, briefly, in the existing tone. No dead code, no TODOs left behind.
- Client: use `apiClient` (never raw fetch except for blobs/public pages), helpers from `components/ui.jsx`, existing `sl-*` classes + `aq-*` additions in `theme.css`. Toast every mutation result. Disable buttons while busy and guard against double submits (`useRef` inflight flag, see `TransitionModal`).
- **lucide-react is pinned at 0.460** — check an icon exists before importing it; a missing icon import crashes the screen (that exact bug crashed the whole app once). After any client change, run the undefined-component scan in §7.
- **Recharts 3**: chart-level `onClick` no longer gets `activePayload`; put `onClick={(_, index) => …}` on `<Bar>`.
- Dates: Indian format via `fmtDate` (`en-IN`). Money/numbers: none yet.
- Keep fictional institution names and the SPECIMEN watermark on letters (the app must not impersonate real institutions or issue things that look like genuine AICTE documents).

---

## 6. Current status — what works (verified 2026-10-28 21:30 IST)

Everything below was clicked through in a browser as all four roles and is covered by `server/e2e.js` (72 checks, all passing):
- Login/logout, role dashboards (Admin/Officer command centre with KPIs linking to matching lists, pendency chart with clickable bars, ageing, regional heatmap, top alerts, longest past SLA, throughput, compliance grades; Expert "my visits"; Institution home with score ring, deficiencies to answer, documents to renew, undertakings due).
- Applications list (search, stage/region/type filters, past-SLA, CSV) and kanban pipeline board; new application with required-field validation; full lifecycle through every stage incl. deficiency loop, EVC, EC decisions, conditional approval with undertakings, rejection → one SAC appeal → SHC; LoA/LoR letter with QR + public verification (case-insensitive).
- EVC: smart panel builder (blocks home-state experts and double-booked experts, ranks by load/specialisation, choose chair), one open visit per application, report filing by panel members.
- Compliance: document validity table + filters + CSV, upload/renew with file, verify/reject (renewal supersedes old record and auto-closes its alerts), "renewal under verification" state, date validation; undertakings submit/review/waive/breach.
- Institutions: compliance score + grade with explained deductions, filters, bulk reminder digests with honest counts, detail page.
- Alert Center: alerts list with ack/resolve and click-through; monitoring rules with English rule builder (live preview), save/pause/delete, run all.
- Reports: 4 CSV registers, SLA adherence and decisions charts. Import Studio with 3 sample files. AI assistant (instant mode + LLM mode). Audit trail (regional for officers). Notifications that navigate. Command palette (Ctrl+K) finds pages, applications and institutions. Error boundaries. Phone width usable.

---

## 7. How to verify any change (do this every time)

1. Server change → restart server. Client change → `npm run build --prefix client` (or dev server).
2. `npm run seed --prefix server && npm run e2e --prefix server` → must print `ALL CHECKS PASSED`; then `npm run seed --prefix server` again (the suite mutates data). Add new checks to `server/e2e.js` for every feature/bug you touch (follow the existing `check(cond, msg)` style).
3. Undefined-component scan (catches the missing-icon crash class):
   ```bash
   cd client && node -e "
   const fs=require('fs'),path=require('path');const files=[];(function w(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);fs.statSync(p).isDirectory()?w(p):/\.jsx?$/.test(p)&&files.push(p);}})('src');
   let bad=0;for(const f of files){const s=fs.readFileSync(f,'utf8');const def=new Set();
    for(const m of s.matchAll(/import\s+(\w+)?\s*,?\s*(?:\{([^}]+)\})?\s*from/g)){if(m[1])def.add(m[1]);if(m[2])m[2].split(',').forEach(x=>{const n=x.trim().split(/\s+as\s+/).pop();if(n)def.add(n);});}
    for(const m of s.matchAll(/(?:function|const|let|class)\s+([A-Z]\w*)/g))def.add(m[1]);
    const used=[...s.matchAll(/<([A-Z]\w*)[\s/>]/g)].map(m=>m[1]);const miss=[...new Set(used)].filter(u=>!def.has(u));
    if(miss.length){bad++;console.log(f,miss.join(','));}}console.log(bad?'UNDEFINED FOUND':'ok');"
   ```
4. Click through the changed screens in a browser as the relevant roles, and check the browser console for errors.

---

## 8. Already fixed in the QA review (don't reintroduce)

Command-palette crash (missing `X` import) + no error boundary · cross-region/cross-institution writes (document verify, undertaking review/submit, alert ack/resolve, assign, deficiencies, EVC reschedule/cancel) · experts uploading documents · officer national audit trail · officer rules affecting all regions · guessable upload filenames · CSV formula injection · double-submit duplicate transitions and EVC visits · endless SAC appeals · SAC re-visit reusing an old EVC report · manually resolved alerts reopening · duplicate pending renewals · documents with valid-to before valid-from or already expired · New Course without courses / non-positive intake · wrong password reloading the page · AI confusing region with stage (added `pendency_by_region`) · AI answering off-topic questions with data dumps · rule compiler hallucinating rules from nonsense · KPI cards landing on mismatched lists · dead chart bars, top alerts and notifications · palette not finding institutions · intake/courses not shown · misleading reminder counts · audit trail `#null` and US date format.

---

## 9. Backlog — what to do next (in priority order)

Ask the user which of these to do; recommend in this order. For each, add e2e checks and keep the demo working.

**✅ DONE (2026-10-28 22:15): P0 mandatory document checklist** — `shared/checklist.js` templates per application type, `ChecklistItem` model, `POST /applications/:id/checklist/:itemId/upload`, `PATCH …/review`, scrutiny start/clear guards, Checklist tab, deficiency pre-fill, docs progress on cards. Kept below for reference.

**P0 — Mandatory document checklist at submission (biggest gap an AICTE judge will notice).** Today an application is just a type + academic year. Real APH applications require a set of documents/affidavits that scrutiny verifies item by item.
- Model: `ChecklistTemplate {application_type, item_key, label, required, accepts_doc_type?}` (seed per application type: e.g. Land documents, Building plan approval, Building Completion Certificate, Fire NOC, Structural Stability Certificate, Affidavit (notarised), Society/Trust registration, Corpus FD, Faculty list, Library & lab lists, Affiliation/NOC from State Government) and `ApplicationChecklistItem {application_id, item_key, status Pending/Uploaded/Verified/Deficient, file_url, remarks, verified_by}`.
- Institution: when creating an application, see the checklist; upload per item (reuse the upload/base64 + random filename pattern); cannot submit until all required items are uploaded (or allow draft → submit).
- Officer in SCRUTINY: per-item Verify / Mark deficient (with reason); "Raise deficiencies from checklist" creates `Deficiency` rows automatically and moves to DEFICIENCY; clearing scrutiny requires all required items Verified.
- UI: a "Checklist" tab on ApplicationDetail with progress bar; checklist completion % on list/board cards.

**P1**
1. **Outbox / email-SMS simulation:** `Outbox {to, channel, subject, body, status, sent_at}` written by `notify()` for institution users; Outbox page for Admin; optional real SMTP via nodemailer when `SMTP_URL` is set. Reminders and alerts then "reach" institutions outside the app.
2. **Admin-editable SLAs:** `StageSla {stage, days, working_days_only}` overriding `STAGES[*].sla_days`; Settings page section for Admin; optional holiday list so SLA counts working days.
3. **Structured EVC report:** checklist (land, built-up area, classrooms, labs, library, faculty, amenities) with compliant/non-compliant + remarks + photo uploads; recommendation derived/validated from it; show it on the application and letter.
4. **Letter status on verify page:** show current institution status (e.g. "Under Show-Cause") and allow Admin to revoke a letter (`letter_revoked_at`), which the public verify page must show.
5. **Audit trail filters + export** (actor, entity, date range, search; CSV).
6. **Signup:** `POST /auth/signup` currently creates an Institution user with no institution. Either disable it in the UI/API or require an AICTE ID + verification by an officer.

**P2**
- Server-side pagination/sorting for applications, documents, institutions (lists currently cap at 500; dashboard and scores are computed in memory per request).
- Security hardening for any real deployment: JWT in an httpOnly cookie instead of localStorage, login rate limiting, password reset, CORS allow-list instead of `*`, authenticated file downloads, file type/size validation, Postgres instead of SQLite.
- Accessibility: clickable cards/rows need `role="button"`, `tabIndex=0` and Enter/Space handlers; focus trap in modals; SLA status not by colour alone.
- Import Studio: import history page and undo of an import batch.
- Performance/UX: code-split routes (Vite warns about a ~900 KB chunk); dashboard KPI grid wraps 5+2 at common widths — use 4+3 or 7 equal columns; kanban on phones; drag-and-drop on the board (respecting the same role/transition rules).
- Tests: run e2e against a separate test database instead of the demo DB; add a few UI smoke tests.

---

## 10. Committing to GitHub (from the user's own account)

Rules: commit **everything you change**, small logical commits with clear messages (imperative summary line; body explains what and why). Never commit `server/.env`, `*.db`, `server/uploads/`, `node_modules/`, `client/dist/` (they are git-ignored — check `git status` before every commit). Never force-push `main`. Never rewrite published history.

1. Make sure §0 steps 3, 5 and 6 are done (`gh auth status` OK, `git config user.email` is the user's noreply address).
2. Start each piece of work on a branch: `git switch -c feat/<short-topic>` (or `fix/<topic>`).
3. Verify (§7), then commit: `git add -A && git status` (inspect!) → `git commit -m "…"`.
4. Push and open a PR:
   - **Collaborator (`permissions.push == true`):**
     ```bash
     git push -u origin feat/<topic>
     gh pr create --base main --fill
     gh pr merge --squash --delete-branch   # only when the user says to merge (or the team agreed to merge directly during the hackathon)
     ```
   - **Not a collaborator:** fork under the user's own account and PR from there:
     ```bash
     gh repo fork --remote --remote-name fork      # creates <their-login>/siteline-aicte; adds remote "fork"
     git push -u fork feat/<topic>
     gh pr create --repo MeghRaval30/siteline-aicte --base main --head <their-login>:feat/<topic> --fill
     ```
     and tell the user: "ask MeghRaval30 to add you as a collaborator (repo Settings → Collaborators) or to merge this PR."
5. If `git push` fails with an authentication error, stop and ask the user to run `gh auth login` and `gh auth setup-git` themselves; do not work around it.
6. Before ending the session: everything committed and pushed, `main` (or the PR) builds, `npm run e2e` passes after a reseed, README updated for any user-visible change, demo data reseeded. Tell the user exactly what was pushed (branch/PR links).

---

## 11. Demo-day checklist (share with the user when relevant)

- `git pull`, `npm run setup` (or at least `npm run build --prefix client`), `npm run seed --prefix server` right before presenting (dates are relative to today).
- `npm start`; keep Ollama running and warm the model by asking the AI one question beforehand (first answer is slow). If the AI is slow, tick **Instant mode** in the chat.
- Six-minute script is in `README.md` → "Demo script". Strong moments: dashboard heatmap drill-down; English → rule with live match count; AI region question with reasoning trace; institution renews a lease → officer verifies → alert closes itself; EVC panel builder blocking a home-state expert; conditional approval → LoA with QR → `/verify/<code>` in a private window; Import Studio on the messy WRO register.
- Have a second browser profile/private window ready for the institution login.

Start now with §0. Report back to the user after setup with: the time, whether e2e passed, your GitHub push permission, and the backlog item you recommend starting with.
