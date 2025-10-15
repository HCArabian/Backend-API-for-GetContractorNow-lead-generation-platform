// ============================================
// CREDIT EXPIRATION JOB
// ============================================
// File: jobs/creditExpiration.js
// Handles automatic credit expiration after 60 days

const { PrismaClient } = require('@prisma/client');
const sgMail = require('@sendgrid/mail');

const prisma = new PrismaClient();

// Initialize SendGrid (if not already initialized)
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
 * Get minimum credit balance required
 */
function getMinimumCreditBalance() {
  return parseFloat(process.env.MINIMUM_CREDIT_BALANCE) || 75;
}

/**
 * Expire credits that have passed their expiresAt date
 * Returns summary of expired credits
 */
async function processExpiredCredits() {
  try {
    console.log('🔍 Checking for expired credits...');

    // Find all credit transactions that have expired
    const expiredTransactions = await prisma.creditTransaction.findMany({
      where: {
        type: 'deposit',
        expiresAt: {
          lt: new Date(), // Less than current date (expired)
        },
        isExpired: false, // Not already processed
      },
      include: {
        contractor: {
          select: {
            id: true,
            businessName: true,
            email: true,
            creditBalance: true,
          },
        },
      },
    });

    if (expiredTransactions.length === 0) {
      console.log('✅ No expired credits found');
      return {
        success: true,
        expiredCount: 0,
        totalExpiredAmount: 0,
      };
    }

    console.log(`⚠️ Found ${expiredTransactions.length} expired credit transactions`);

    let totalExpiredAmount = 0;
    const results = [];

    // Process each expired transaction
    for (const transaction of expiredTransactions) {
      try {
        const contractor = transaction.contractor;
        
        // Calculate how much of this specific transaction is still unused
        const originalAmount = transaction.amount;
        const currentBalance = contractor.creditBalance;
        
        // Expire from the contractor's current balance
        // (Only expire what's actually remaining)
        const amountToExpire = Math.min(originalAmount, currentBalance);

        if (amountToExpire <= 0) {
          // Transaction was already fully used
          await prisma.creditTransaction.update({
            where: { id: transaction.id },
            data: { isExpired: true },
          });
          console.log(`ℹ️ Transaction ${transaction.id} already fully used, marking as expired`);
          continue;
        }

        // Calculate new balance after expiration
        const newBalance = contractor.creditBalance - amountToExpire;

        console.log(`💸 Expiring credits for ${contractor.businessName}:`);
        console.log(`   - Original deposit: $${originalAmount}`);
        console.log(`   - Current balance: $${currentBalance}`);
        console.log(`   - Expiring: $${amountToExpire}`);
        console.log(`   - New balance: $${newBalance}`);

        // Use a database transaction to ensure atomic updates
        await prisma.$transaction([
          // 1. Mark original transaction as expired
          prisma.creditTransaction.update({
            where: { id: transaction.id },
            data: { isExpired: true },
          }),

          // 2. Create expiration transaction record
          prisma.creditTransaction.create({
            data: {
              contractorId: contractor.id,
              type: 'expiration',
              amount: -amountToExpire, // Negative amount (deduction)
              balanceBefore: currentBalance,
              balanceAfter: newBalance,
              description: `Credit expiration: $${amountToExpire.toFixed(2)} expired after 60 days`,
              expiresAt: null, // Expiration transactions don't expire
              relatedTransactionId: transaction.id, // Link to original deposit
            },
          }),

          // 3. Update contractor balance
          prisma.contractor.update({
            where: { id: contractor.id },
            data: {
              creditBalance: newBalance,
              // If balance drops below minimum, stop accepting leads
              isAcceptingLeads: newBalance >= getMinimumCreditBalance(),
            },
          }),
        ]);

        // Send notification email to contractor
        await sendCreditExpirationEmail(contractor, amountToExpire, newBalance);

        totalExpiredAmount += amountToExpire;
        results.push({
          contractorId: contractor.id,
          businessName: contractor.businessName,
          expiredAmount: amountToExpire,
          newBalance: newBalance,
        });

        console.log(`✅ Expired $${amountToExpire.toFixed(2)} for ${contractor.businessName}`);

      } catch (error) {
        console.error(`❌ Error expiring credits for transaction ${transaction.id}:`, error);
        // Continue processing other transactions even if one fails
      }
    }

    console.log(`\n📊 Expiration Summary:`);
    console.log(`   - Transactions processed: ${expiredTransactions.length}`);
    console.log(`   - Total expired amount: $${totalExpiredAmount.toFixed(2)}`);
    console.log(`   - Contractors affected: ${results.length}`);

    return {
      success: true,
      expiredCount: results.length,
      totalExpiredAmount: totalExpiredAmount,
      results: results,
    };

  } catch (error) {
    console.error('❌ Credit expiration process failed:', error);
    throw error;
  }
}

/**
 * Send email notification when credits expire
 */
async function sendCreditExpirationEmail(contractor, expiredAmount, newBalance) {
  try {
    const msg = {
      to: contractor.email,
      from: process.env.SENDGRID_FROM_EMAIL || 'support@getcontractornow.com',
      subject: 'Credit Expiration Notice - GetContractorNow',
      text: `
Hello ${contractor.businessName},

This is a notification that $${expiredAmount.toFixed(2)} in credits has expired from your GetContractorNow account.

Credits expire 60 days after purchase if not used.

Account Summary:
- Expired amount: $${expiredAmount.toFixed(2)}
- Current balance: $${newBalance.toFixed(2)}

To continue receiving leads, please ensure you maintain a sufficient credit balance.

Add Credits: https://www.getcontractornow.com/contractor/credits

Questions? Contact us at support@getcontractornow.com

Best regards,
GetContractorNow Team
      `,
      html: `
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #f59e0b; padding: 20px; text-align: center;">
    <h1 style="color: white; margin: 0;">Credit Expiration Notice</h1>
  </div>
  
  <div style="padding: 30px; background: #f9fafb;">
    <p>Hello <strong>${contractor.businessName}</strong>,</p>
    
    <p>This is a notification that <strong>$${expiredAmount.toFixed(2)}</strong> in credits has expired from your GetContractorNow account.</p>
    
    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
      <h3 style="margin-top: 0; color: #1f2937;">Account Summary</h3>
      <ul style="list-style: none; padding: 0; margin: 0;">
        <li style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;">
          <span style="color: #6b7280;">Expired amount:</span> 
          <strong style="float: right; color: #dc2626;">$${expiredAmount.toFixed(2)}</strong>
        </li>
        <li style="padding: 8px 0;">
          <span style="color: #6b7280;">Current balance:</span> 
          <strong style="float: right; color: #059669;">$${newBalance.toFixed(2)}</strong>
        </li>
      </ul>
    </div>
    
    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; color: #92400e;">
        <strong>Note:</strong> Credits expire 60 days after purchase if not used.
      </p>
    </div>
    
    <p>To continue receiving leads, please ensure you maintain a sufficient credit balance.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="https://www.getcontractornow.com/contractor/credits" 
         style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
        Add Credits Now
      </a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
      Questions? Contact us at <a href="mailto:support@getcontractornow.com" style="color: #2563eb;">support@getcontractornow.com</a>
      or call <a href="tel:+18188600915" style="color: #2563eb;">(818) 860-0915</a>
    </p>
  </div>
  
  <div style="background: #1f2937; padding: 20px; text-align: center;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      © 2025 GetContractorNow. All rights reserved.
    </p>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log(`📧 Expiration email sent to ${contractor.email}`);

  } catch (error) {
    console.error(`❌ Failed to send expiration email to ${contractor.email}:`, error);
    // Don't throw - email failure shouldn't stop expiration process
  }
}

/**
 * Send warning email 7 days before credits expire
 */
async function sendExpirationWarningEmails() {
  try {
    console.log('🔔 Checking for credits expiring soon...');

    // Calculate date range for credits expiring in 7 days
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    sevenDaysFromNow.setHours(0, 0, 0, 0); // Start of day

    const eightDaysFromNow = new Date();
    eightDaysFromNow.setDate(eightDaysFromNow.getDate() + 8);
    eightDaysFromNow.setHours(0, 0, 0, 0); // Start of day

    // Find credits expiring in 7 days
    const expiringTransactions = await prisma.creditTransaction.findMany({
      where: {
        type: 'deposit',
        expiresAt: {
          gte: sevenDaysFromNow,
          lt: eightDaysFromNow,
        },
        isExpired: false,
        warningEmailSent: false, // Only send warning once
      },
      include: {
        contractor: {
          select: {
            id: true,
            businessName: true,
            email: true,
            creditBalance: true,
          },
        },
      },
    });

    if (expiringTransactions.length === 0) {
      console.log('✅ No credits expiring in 7 days');
      return;
    }

    console.log(`⚠️ Found ${expiringTransactions.length} credits expiring in 7 days`);

    for (const transaction of expiringTransactions) {
      try {
        const contractor = transaction.contractor;
        const amount = transaction.amount;
        const expiresAt = transaction.expiresAt;

        // Send warning email
        const msg = {
          to: contractor.email,
          from: process.env.SENDGRID_FROM_EMAIL || 'support@getcontractornow.com',
          subject: '⚠️ Credits Expiring Soon - GetContractorNow',
          text: `
Hello ${contractor.businessName},

This is a reminder that $${amount.toFixed(2)} in credits will expire in 7 days.

Expiration Date: ${new Date(expiresAt).toLocaleDateString()}
Amount Expiring: $${amount.toFixed(2)}

What happens when credits expire?
- Unused credits are removed from your account
- No refunds are issued for expired credits
- You can still purchase new credits anytime

Don't let your credits go to waste! Make sure you're accepting leads and responding quickly.

View Dashboard: https://www.getcontractornow.com/contractor/dashboard

Questions? Contact us at support@getcontractornow.com

Best regards,
GetContractorNow Team
          `,
          html: `
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #dc2626; padding: 20px; text-align: center;">
    <h1 style="color: white; margin: 0;">⚠️ Credits Expiring Soon</h1>
  </div>
  
  <div style="padding: 30px; background: #f9fafb;">
    <p>Hello <strong>${contractor.businessName}</strong>,</p>
    
    <p>This is a reminder that <strong>$${amount.toFixed(2)}</strong> in credits will expire in <strong style="color: #dc2626;">7 days</strong>.</p>
    
    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0;">
      <p style="margin: 0 0 10px 0;"><strong style="color: #92400e;">Expiration Date:</strong> ${new Date(expiresAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      <p style="margin: 0;"><strong style="color: #92400e;">Amount Expiring:</strong> $${amount.toFixed(2)}</p>
    </div>
    
    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
      <h3 style="margin-top: 0; color: #1f2937;">What happens when credits expire?</h3>
      <ul style="color: #4b5563; line-height: 1.8;">
        <li>Unused credits are removed from your account</li>
        <li>No refunds are issued for expired credits</li>
        <li>You can still purchase new credits anytime</li>
      </ul>
    </div>
    
    <p><strong>Don't let your credits go to waste!</strong> Make sure you're accepting leads and responding quickly to maximize your credit usage.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="https://www.getcontractornow.com/contractor/dashboard" 
         style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
        View Dashboard
      </a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
      Questions? Contact us at <a href="mailto:support@getcontractornow.com" style="color: #2563eb;">support@getcontractornow.com</a>
      or call <a href="tel:+18188600915" style="color: #2563eb;">(818) 860-0915</a>
    </p>
  </div>
  
  <div style="background: #1f2937; padding: 20px; text-align: center;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      © 2025 GetContractorNow. All rights reserved.
    </p>
  </div>
</body>
</html>
          `,
        };

        await sgMail.send(msg);

        // Mark warning as sent
        await prisma.creditTransaction.update({
          where: { id: transaction.id },
          data: { warningEmailSent: true },
        });

        console.log(`📧 Warning email sent to ${contractor.email}`);

      } catch (error) {
        console.error(`❌ Failed to send warning email:`, error);
        // Continue with other transactions even if one fails
      }
    }

    console.log(`✅ Sent ${expiringTransactions.length} expiration warning emails`);

  } catch (error) {
    console.error('❌ Expiration warning process failed:', error);
  }
}

// Export functions for use in index.js
module.exports = {
  processExpiredCredits,
  sendExpirationWarningEmails,
  sendCreditExpirationEmail,
};