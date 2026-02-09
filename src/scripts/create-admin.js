const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@getcontractornow.com';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const name = 'Admin User';

  // Check if admin exists
  const existing = await prisma.admin.findUnique({
    where: { email }
  });

  if (existing) {
    console.log('❌ Admin already exists with email:', email);
    return;
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create admin
  const admin = await prisma.admin.create({
    data: {
      email,
      passwordHash,
      name,
      role: 'super_admin',
      isActive: true
    }
  });

  console.log('✅ Admin created successfully!');
  console.log('Email:', email);
  console.log('Password:', password);
  console.log('⚠️ IMPORTANT: Change this password after first login!');
}

createAdmin()
  .catch(console.error)
  .finally(() => prisma.$disconnect());