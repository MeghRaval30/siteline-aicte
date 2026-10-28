# SiteLine for AICTE — one container serving the API and the built web app.
# Build:  docker build -t siteline-aicte .
# Run:    docker run -p 3000:3000 -e JWT_SECRET=change-me -e SEED_DEMO=true -v siteline-data:/app/server/data siteline-aicte

FROM node:20-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npx prisma generate
COPY --from=client /app/client/dist /app/client/dist
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/app/server/data/siteline.db \
    AI_AUTOSTART=false \
    OLLAMA_URL=http://ollama:11434
RUN mkdir -p data uploads
VOLUME ["/app/server/data", "/app/server/uploads"]
EXPOSE 3000
# Create/upgrade the schema on start; load demo data only when asked to (SEED_DEMO=true) and only once.
CMD ["sh", "-c", "npx prisma db push --skip-generate && if [ \"$SEED_DEMO\" = \"true\" ] && [ ! -f data/.seeded ]; then node prisma/seed.js && touch data/.seeded; fi && node index.js"]
