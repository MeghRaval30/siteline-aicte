# SiteLine · AICTE

**Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System**
Smart India Hackathon 2026 · Problem Statement **SIH26262** (AICTE / Ministry of Education's Innovation Cell)

AICTE moves applications from technical institutions through scrutiny, re-scrutiny, the Expert Visit Committee (EVC), SAC/SHC and other stages under the Approval Process Handbook (APH). Many approvals are conditional on time-bound undertakings and on keeping prescribed documents, such as lease deeds and fire NOCs, valid. Today, tracking application movement, stage-wise pendency, EVC scheduling, undertakings and document validity is manual and fragmented. SiteLine puts all of it in one live system that raises alerts by itself.

## What it does

| Need in the problem statement | How SiteLine handles it |
|---|---|
| Application movement through APH stages | A **workflow state machine** covering Submitted → Scrutiny → Deficiency ⇄ Re-scrutiny → EVC → Executive Committee → LoA / Conditional / LoR, with SAC appeal and SHC hearing as side tracks. Every move is role-gated and guarded (for example, an application can't reach EC until the EVC report is filed), and every move is time-stamped. |
| Stage-wise pendency | Each stage has an **SLA**. The system shows days in stage, SLA breaches, ageing buckets, a **Regional Office × stage heatmap**, a kanban pipeline board and SLA adherence history. |
| EVC scheduling | A **smart panel builder** ranks experts and blocks anyone from the institution's home state (conflict of interest) or already on a visit that day. It prefers lighter workloads and matching specialisations. Experts file reports from their own login. |
| Time-bound undertakings | Created when approval is granted with conditions. Institutions submit evidence, officers verify, waive or mark as breached (which puts the institution under show-cause). Overdue status is tracked automatically. |
| Document submission, renewal and validity | Prescribed documents carry validity dates and move through Valid → Expiring Soon → Expired automatically. Institutions upload renewals with files. Once a renewal is verified, the old record is superseded and **its alerts close by themselves**. |
| Alert management | Standing **monitoring rules**, adapted from odoo_2026's playbooks, run every 10 minutes and on demand. Each fires once per item, refreshes its wording and auto-resolves when the condition clears. Officers get one digest notification per rule run; institutions get each alert that concerns them. |

### What makes it different
- **Plain-English rules.** Type *"Warn me 90 days before any lease deed of engineering colleges in the Western region expires"* and a local LLM turns it into a validated rule. You see how many items it would match today before saving it. A keyword parser takes over if no model is running.
- **AI assistant with tools.** It answers questions such as "which applications are stuck past SLA?" or "status of Sahyadri Institute of Technology" by calling real database tools, and shows its reasoning trace. It runs locally on Ollama, so no data leaves the server. An instant keyword router keeps it working offline. Answers respect the asker's role.
- **Compliance Health Score.** Every institution gets a score out of 100 and a grade from A to D. Every deducted point is explained, so reviewers can sort by risk and send bulk reminder digests.
- **Verifiable letters.** LoA and LoR letters carry a QR code and a verification code. A public `/verify` page lets anyone, such as a student, parent or bank, check that a letter is genuine.
- **AI Import Studio**, ported from odoo_2026. It takes registers and document lists as desks actually keep them: title rows, abbreviated headers, mixed date formats, "MH"/"maha.", CAPS names, "540 seats", duplicates and TOTAL rows. Three voters judge every column (header text, value shape and the local AI model), and the screen shows how each one voted. Values are cleaned, missing required columns can be filled for every row (provisional IDs, a default type), re-imports update instead of duplicating, and imported validity dates raise alerts immediately. Three realistic sample files are built in.
- **Role-scoped views.** The Approval Bureau (Admin) sees the whole country, Regional Officers see their region, EVC experts see their panels, and institutions see only themselves. Every action is written to the audit trail.

## Run it

Requirements: Node 18+ (tested on 24). Optional: [Ollama](https://ollama.com) with `qwen2.5:7b` (or `llama3.1:8b`) for the LLM features. Without it, everything still works through the keyword fallbacks.

```bash
npm run setup     # installs server + client, creates the SQLite DB, seeds demo data, builds the client
npm start         # http://localhost:3000
```

For development with hot reload, run `npm run dev --prefix server` and `npm run dev --prefix client` (the client runs on http://localhost:5173).
Reset the demo data at any time with `npm run seed --prefix server`. All dates are relative to today, so the demo always has something expiring next week.

### Demo logins (password `demo1234`)
| Role | Email |
|---|---|
| Approval Bureau (Admin) | `admin@aicte.gov.in` |
| Regional Officer, WRO Mumbai | `officer@aicte.gov.in` |
| EVC Expert | `expert@aicte.gov.in` |
| Institution (Sahyadri Institute of Technology, Pune) | `institute@sahyadri-it.edu.in` |

### Test
```bash
npm run seed --prefix server && npm run e2e --prefix server   # 48 checks: full lifecycle, all four roles, Import Studio (reseed afterwards)
```

## Demo script (about 6 minutes)
1. **Admin** → Dashboard: pendency by stage, heatmap, insights. Click a heatmap cell to drill into those applications. Open the **pipeline board**.
2. **Alert Center → Monitoring rules**: type a rule in English, see the live match count, save it, then **Run all now**.
3. **AI Assistant**: "Which applications are stuck past their SLA?" Expand the reasoning trace.
4. **Institution** → Dashboard: score ring, deficiencies to answer, lease deed expiring in 21 days. **Renew** it by uploading a file. Answer the deficiencies, then submit for re-scrutiny.
5. **Officer** → Documents: **Verify** the renewal; the toast reports the alerts that closed automatically. Open the application, clear re-scrutiny, then **Schedule EVC** and watch the conflict-of-interest blocking.
6. **Officer** → **Import Studio**: import the hand-kept WRO register sample. Show the header found on line 4, the votes, the 43 auto-fixes, the duplicate and the missing state, then import and watch new alerts appear.
7. **Expert** → My Visits: file the report and move the application to the Executive Committee.
8. **Admin** → **Approve with undertakings**, open the **LoA**, scan its QR code, or open `/verify/<code>` in a private window.

## Stack
React 18 + Vite + Recharts (UI theme: warm claude.ai canvas with LinkedIn-style cards) · Express + Prisma + SQLite · Ollama (local LLM, optional).

```
server/
  shared/workflow.js        APH stage machine, SLAs, role-gated transitions
  shared/compliance.js      status sweeper + Compliance Health Score
  modules/alerts/engine.js  monitoring rules (playbooks), dedupe, auto-resolve, fan-out
  modules/alerts/compiler.js English → rule (LLM with keyword fallback)
  modules/evc/              conflict-aware panel suggester and scheduling
  modules/ai/               tool-calling agent + offline router
  modules/import/           Import Studio: reader, header finder, three-voter mapper, cleaners, samples
client/src/pages/           Dashboard, Applications (list/board), ApplicationDetail, EVC, Compliance,
                            Institutions, Alerts, Reports, ImportStudio, Letter, Verify, AIChat
```

Built on top of two earlier projects by the team: **SiteLine** (asset workflows, AI agent, command palette) and **odoo_2026** (HR playbooks, natural-language rule compiler, AI import studio, mass actions).
