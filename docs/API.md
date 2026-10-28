# SiteLine REST API (v1)

Base path: `/api/v1`. Every response is JSON: `{ "success": true, "data": … }` or `{ "success": false, "error": "human-readable message" }`.
Authenticate with `POST /auth/login` and send `Authorization: Bearer <token>` on every other call. Results are always scoped to the caller: the Approval Bureau (Admin) sees the whole country, an Officer sees their region, an Expert sees their panels, and an Institution sees only itself. Every write is checked against role and region.

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ user, token }` |
| GET | `/auth/me` | current user |

## Applications & workflow
| Method | Path | Notes |
|---|---|---|
| GET | `/applications` | filters: `stage, status, type, region, search, overdue=1, active=1, institution_id, limit`; each row carries `sla` and `checklist` progress |
| GET | `/applications/meta` | stages, transitions, application types, checklist templates |
| GET | `/applications/:id` | full record: journey, deficiencies, EVC visits, undertakings, checklist, allowed actions for the caller |
| POST | `/applications` | `{ type, academic_year, institution_id?, intake_requested?, courses? }`; the checklist is created from the type's template |
| POST | `/applications/:id/transition` | `{ to, remarks, deficiencies[], undertakings[] }`; role-gated, guarded, optimistic-locked (409 if stale) |
| POST | `/applications/:id/checklist/:itemId/upload` | `{ file_name, file_data(base64) }` |
| PATCH | `/applications/:id/checklist/:itemId/review` | `{ decision: Verified\|Deficient, remarks }` |
| PATCH | `/applications/:id/assign` | `{ officer_id }` |
| POST | `/applications/:id/deficiencies` · PATCH `/applications/deficiencies/:id/respond\|review` | deficiency loop |
| GET | `/applications/:id/letter` · POST `/applications/:id/letter/revoke` | LoA/LoR data · revoke (Admin) |
| GET | `/applications/verify/:code` | **public**, no token: verifies a letter, including revocation |

## EVC
`GET /evc` · `GET /evc/suggest?application_id&date` (ranked, conflict-checked experts) · `POST /evc` · `PATCH /evc/:id/reschedule|cancel|report`

## Compliance
`GET|POST /compliance/documents` (upload or renew with `renewal_of_id`) · `PATCH /compliance/documents/:id/verify` · `GET|POST /compliance/undertakings` · `PATCH /compliance/undertakings/:id/submit|review` · `GET /compliance/doc-types`

## Alerts & rules
`GET /alerts` · `PATCH /alerts/:id/acknowledge|resolve` · `GET|POST /alerts/rules` · `POST /alerts/rules/compile` (English → rule proposal) · `PATCH|DELETE /alerts/rules/:id` · `POST /alerts/run`

## Institutions, dashboard, import, settings
`GET /institutions` (with compliance score) · `GET /institutions/:id` · `POST /institutions/remind` · `GET /institutions/regions` · `GET /dashboard/overview` (KPIs, pipeline, heatmap, automation counters) · `POST /import/analyze|preview|commit` · `GET /import/samples/:name` · `GET|PUT /settings/sla` · `GET /outbox` · `GET /activity-logs` · `GET /notifications` · `POST /ai/chat`

## Example
```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"officer@aicte.gov.in","password":"demo1234"}' | jq -r .data.token)
curl -s "localhost:3000/api/v1/applications?overdue=1" -H "Authorization: Bearer $TOKEN" | jq '.data[] | {app_number, stage, sla}'
```
