const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../../shared/prismaClient');

const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body; // role is stripped by Zod validation

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'EMAIL_ALREADY_EXISTS' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password_hash: hashedPassword,
        role: 'Institution'
      },
      select: { id: true, name: true, email: true, role: true, status: true }
    });

    const token = jwt.sign(
      { user_id: user.id, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret_if_not_set',
      { expiresIn: '24h' }
    );

    return res.status(201).json({ success: true, data: { user, token } });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' });
    }

    if (user.status === 'Inactive') {
      return res.status(403).json({ success: false, error: 'ACCOUNT_INACTIVE' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' });
    }

    const token = jwt.sign(
      { user_id: user.id, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret_if_not_set',
      { expiresIn: '24h' }
    );

    const { password_hash, ...userWithoutPassword } = user;
    return res.status(200).json({ success: true, data: { user: userWithoutPassword, token } });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

const getMe = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: { user: req.user } });
  } catch (error) {
    console.error('GetMe error:', error);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

module.exports = {
  signup,
  login,
  getMe
};
