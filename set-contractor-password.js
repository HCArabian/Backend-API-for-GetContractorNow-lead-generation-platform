const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('./auth');
require('dotenv').config();

const prisma = new PrismaClient();

async function setPassword() {
  try {
    // Get contractor email from command line
    const email = process.argv[2];
    const password = process.argv[3];
    
    if (!email || !password) {
      console.log('Usage: node set-contractor-password.js <email> <password>');
      process.exit(1);
    }
    
    // Find contractor
    const contractor = await prisma.contractor.findUnique({
      where: { email: email.toLowerCase() }
    });
    
    if (!contractor) {
      console.log('❌ Contractor not found with email:', email);
      process.exit(1);
    }
    
    // Hash password
    const passwordHash = await hashPassword(password);
    
    // Update contractor
    await prisma.contractor.update({
      where: { id: contractor.id },
      data: { passwordHash }
    });
    
    console.log('✅ Password updated successfully for:', contractor.businessName);
    console.log('   Email:', email);
    console.log('   You can now login with this password.');
    
    await prisma.$disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setPassword();