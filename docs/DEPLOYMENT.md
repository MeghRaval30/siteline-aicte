# Deploying SiteLine for AICTE

SiteLine is one Node.js service that serves the REST API and the built web app, plus a database. The local AI model is optional.

## Option A: Docker (recommended)

```bash
docker compose up -d --build                 # app on http://localhost:3000, demo data loaded on first start
docker compose --profile ai up -d --build    # also runs an Ollama model server next to the app
docker compose exec ollama ollama pull qwen2.5:7b   # once, if you use the AI profile
```

Environment variables (set them in `.env` next to `docker-compose.yml` or in your orchestrator):

| Variable | Default | Meaning |
|---|---|---|
| `JWT_SECRET` | `change-me-…` | **Set a long random value in production.** |
| `SEED_DEMO` | `true` | Load the demo data on first start. Use `false` for a real deployment. |
| `DATABASE_URL` | `file:/app/server/data/siteline.db` | SQLite file, kept on the `siteline-data` volume |
| `OLLAMA_URL` | `http://ollama:11434` | Where the local model server is. Without one, the AI features fall back to keyword routing. |
| `ALERT_INTERVAL_MIN` | `10` | How often the monitoring rules run |
| `ALLOW_SIGNUP` | unset | Self-registration stays off unless this is `true`. Accounts are issued by AICTE. |

Uploaded files live on the `siteline-uploads` volume. Back up both volumes.

## Option B: Plain Node.js (on-premise server or VM)

```bash
npm run setup     # installs, creates the database, seeds demo data, builds the web app
npm start         # port 3000; put it behind nginx or Apache with HTTPS
```

## Moving to PostgreSQL

The data layer is Prisma, so the switch is a configuration change:

1. In `server/prisma/schema.prisma` set `provider = "postgresql"`.
2. Set `DATABASE_URL=postgresql://user:password@host:5432/siteline`.
3. Run `npx prisma db push` (or adopt `prisma migrate` for versioned migrations).

Note: SQLite `contains` searches ignore case, but PostgreSQL's don't. Add `mode: 'insensitive'` to the search filters in the application, institution and document routes if you want the same behaviour.

## Integrating with existing systems

Everything the UI does goes through the JSON REST API under `/api/v1` (see [API.md](API.md)). An existing portal can create applications, push documents and read status, pendency and alerts with a bearer token, and the public letter-verification endpoint needs no token. The AI runs on your own server through Ollama, so no data is sent to third parties.

## Production checklist

- A strong `JWT_SECRET`, HTTPS in front, and `SEED_DEMO=false`.
- Restrict CORS to your domain (`server/index.js`) and add login rate limiting at the proxy.
- Daily backups of the data and uploads volumes. Prefer PostgreSQL for multi-user production load.
- Run `npm run e2e --prefix server` against a staging copy before every release.
