// auth.js - Authentication utilities

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d'; // Token valid for 7 days

// Hash password
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

// Compare password
async function comparePassword(password, hashedPassword) {
  return bcrypt.compare(password, hashedPassword);
}

// Generate JWT token
function generateToken(contractorId) {
  return jwt.sign(
    { contractorId },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Middleware to protect contractor routes
async function contractorAuth(req, res, next) {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    // Get token from Authorization header or cookie
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.contractorToken;
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Verify token
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Get contractor from database
    const contractor = await prisma.contractor.findUnique({
      where: { id: decoded.contractorId }
    });
    
    if (!contractor) {
      return res.status(401).json({ error: 'Contractor not found' });
    }
    
    if (contractor.status !== 'active') {
      return res.status(403).json({ error: 'Contractor account is not active' });
    }
    
    // Attach contractor to request (matches authenticateContractor behavior)
    req.contractor = contractor;
    req.contractorId = contractor.id; // Also set ID for backwards compatibility
    
    await prisma.$disconnect();
    next();
    
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  contractorAuth
};