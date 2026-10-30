const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../../shared/prismaClient');
const logActivity = require('../../shared/logActivity');
const { jwtSecret, TOKEN_TTL } = require('../../shared/config');

const sign = user => jwt.sign({ user_id: user.id, role: user.role }, jwtSecret(), { expiresIn: TOKEN_TTL, algorithm: 'HS256' });

// A real bcrypt hash of a random string: comparing against it when the email is unknown
// keeps the response time the same, so login timing does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 10);

// Per-account lockout after repeated failures (in addition to the per-IP rate limit on the route).
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map(); // email -> { count, until }
const lockedFor = email => { const f = failures.get(email); return f && f.until > Date.now() ? f.until - Date.now() : 0; };
function recordFailure(email) {
  const f = failures.get(email) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= LOCK_AFTER) { f.until = Date.now() + LOCK_MS; f.count = 0; }
  failures.set(email, f);
}

const signup = async (req, res) => {
  // Accounts are issued by AICTE (institution users are linked to their institution); no self-registration.
  if (process.env.ALLOW_SIGNUP !== 'true') return res.status(403).json({ success: false, error: 'Self-registration is disabled. Institution accounts are issued by AICTE.' });
  try {
    const { name, email, password } = req.body; // role is stripped by Zod validation

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'EMAIL_ALREADY_EXISTS' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password_hash: hashedPassword, role: 'Institution' },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    return res.status(201).json({ success: true, data: { user, token: sign(user) } });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

const login = async (req, res) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    const { password } = req.body;
    if (lockedFor(email)) return res.status(429).json({ success: false, error: 'TOO_MANY_ATTEMPTS' });

    const user = await prisma.user.findUnique({ where: { email } });
    const isValid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    // Status is checked only after the password, so a wrong password never reveals an inactive account.
    if (!user || !isValid) {
      recordFailure(email);
      if (user) await logActivity({ actorUserId: user.id, action: 'Failed sign-in attempt', entityType: 'User', entityId: user.id });
      return res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' });
    }
    if (user.status === 'Inactive') return res.status(403).json({ success: false, error: 'ACCOUNT_INACTIVE' });
    failures.delete(email);

    const { password_hash, ...userWithoutPassword } = user;
    return res.status(200).json({ success: true, data: { user: userWithoutPassword, token: sign(user) } });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(current_password, user.password_hash))) return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    await prisma.user.update({ where: { id: user.id }, data: { password_hash: await bcrypt.hash(new_password, 10) } });
    await logActivity({ actorUserId: user.id, action: 'Changed password', entityType: 'User', entityId: user.id });
    return res.json({ success: true, data: { changed: true } });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

const getMe = async (req, res) => res.status(200).json({ success: true, data: { user: req.user } });

module.exports = { signup, login, changePassword, getMe };
