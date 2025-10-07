const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function clearRateLimit() {
  const email = process.argv[2];

  if (!email) {
    console.error('Usage: node clear-rate-limit.js <email>');
    process.exit(1);
  }

  try {
    // Check if there's a LoginAttempt or similar table
    // Update the contractor to reset failed attempts
    await prisma.contractor.updateMany({
      where: { email: email },
      data: {
        // Add any rate limit fields here if they exist
        // failedLoginAttempts: 0,
        // lockedUntil: null,
      }
    });

    console.log(`✅ Rate limit cleared for ${email}`);
    console.log('You can now try logging in again.');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

clearRateLimit();