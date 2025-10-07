const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh';

// Generate access token (30 minutes)
function generateAccessToken(adminId, email, role) {
  return jwt.sign(
    { adminId, email, role, type: 'access' },
    JWT_SECRET,
    { expiresIn: '30m' }
  );
}

// Generate refresh token (7 days)
function generateRefreshToken(adminId) {
  return jwt.sign(
    { adminId, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
}

// Verify access token
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    return null;
  }
}

// Verify refresh token
function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    return null;
  }
}

// Middleware to authenticate admin requests
async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Verify admin still exists and is active
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.adminId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true
      }
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: 'Admin account not found or inactive' });
    }

    // Add admin to request
    req.admin = admin;
    next();

  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Hash password
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Compare password
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  authenticateAdmin,
  hashPassword,
  comparePassword
};