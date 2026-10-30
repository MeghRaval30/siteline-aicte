// Runtime configuration that must be safe before the server accepts a request.
const crypto = require('crypto');

const WEAK_SECRETS = new Set(['', 'change-me', 'changeme', 'secret', 'fallback_secret_if_not_set']);

let devSecret;
function jwtSecret() {
  const s = process.env.JWT_SECRET || '';
  if (!WEAK_SECRETS.has(s) && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production');
  }
  // Development only: a per-process random secret, so a weak .env never signs real tokens.
  if (!devSecret) {
    devSecret = crypto.randomBytes(48).toString('hex');
    console.warn('[config] JWT_SECRET is missing or weak; using a random development secret (sessions end on restart)');
  }
  return devSecret;
}

const TOKEN_TTL = process.env.TOKEN_TTL || '8h';

// Browser origins allowed to call the API with credentials. Same-origin requests need no entry.
const corsOrigins = () => (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);

module.exports = { jwtSecret, TOKEN_TTL, corsOrigins };
