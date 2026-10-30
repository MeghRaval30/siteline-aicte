const jwt = require('jsonwebtoken');
const prisma = require('./prismaClient');
const { jwtSecret } = require('./config');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
    
    // Verify user is not inactive
    const user = await prisma.user.findUnique({
      where: { id: decoded.user_id },
      select: { id: true, role: true, region_id: true, institution_id: true, status: true, email: true, name: true, state: true }
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'User not found' });
    }

    if (user.status === 'Inactive') {
      return res.status(403).json({ success: false, error: 'ACCOUNT_INACTIVE', message: 'Account is inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error during authentication' });
  }
};

module.exports = authenticate;
