# Quick Start Guide

**GetContractorNow Backend API**

---

## For Developers

### Local Development Setup

**1. Clone Repository**

```bash
git clone <your-repo-url>
cd getcontractornow-backend
```

**2. Install Dependencies**

```bash
npm install
```

**3. Setup Environment Variables**

Create `.env` file in root directory:

```bash
cp .env.example .env
```

**Edit `.env` with your credentials**:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/getcontractornow"

# Twilio
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="your_auth_token"
TWILIO_PHONE_NUMBER="+15551234567"

# SendGrid
SENDGRID_API_KEY="SG.xxxxxxxxxxxxx"
SENDGRID_FROM_EMAIL="noreply@getcontractornow.com"
SENDGRID_WEBHOOK_VERIFICATION_KEY="your_verification_key"

# Stripe
STRIPE_SECRET_KEY_TEST="sk_test_xxxxxxxxxxxxx"
STRIPE_SECRET_KEY_LIVE="sk_live_xxxxxxxxxxxxx"
STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxx"

# Authentication
JWT_SECRET="your_random_secret_key_at_least_32_characters_long"
ADMIN_PASSWORD="your_secure_admin_password_change_this"

# Cron Jobs
CRON_SECRET="your_cron_secret_here_random_string"

# Error Monitoring
SENTRY_DSN="https://xxxxxxxxxxxxx@sentry.io/xxxxxxxxxxxxx"

# Domains
RAILWAY_URL="https://api.getcontractornow.com"
```

**4. Run Database Migrations**

```bash
npx prisma migrate dev
```

**5. Generate Prisma Client**

```bash
npx prisma generate
```

**6. Start Development Server**

```bash
npm run dev
```

Server runs at: `http://localhost:3000`

**7. Open Prisma Studio (Optional)**

View and edit database in GUI:

```bash
npx prisma studio
```

---

### Common Development Commands

**Database Management:**

```bash
# Create new migration
npx prisma migrate dev --name your_migration_name

# Deploy migrations to production
npx prisma migrate deploy

# Reset database (CAUTION: deletes all data)
npx prisma migrate reset

# Generate Prisma Client after schema changes
npx prisma generate

# Open Prisma Studio (database GUI)
npx prisma studio
```

**Backup Management:**

```bash
# Create backup before migration
./scripts/backup-before-migration.sh

# Manual database export (Railway)
railway run -- pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Compress backup
gzip backup-$(date +%Y%m%d).sql

# Restore from backup
psql $DATABASE_URL < backup-YYYYMMDD.sql
```

**Deployment:**

```bash
# Deploy to production (Railway auto-deploys from main branch)
git add .
git commit -m "Your commit message"
git push origin main

# View deployment logs
railway logs

# View live logs
railway logs --follow

# Open Railway dashboard
railway open
```

**Testing Endpoints:**

```bash
# Test health check
curl https://api.getcontractornow.com/health

# Test lead submission
curl -X POST https://api.getcontractornow.com/api/leads/submit \
  -H "Content-Type: application/json" \
  -d '{
    "customerFirstName": "Test",
    "customerLastName": "Customer",
    "customerPhone": "5551234567",
    "customerZip": "90210",
    "customerCity": "Beverly Hills",
    "customerState": "CA",
    "serviceType": "ac_repair",
    "timeline": "within_24_hours",
    "budgetRange": "1000-3000",
    "propertyType": "residential"
  }'

# Test contractor login
curl -X POST https://api.getcontractornow.com/api/contractors/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "contractor@example.com",
    "password": "password123"
  }'
```

---

### Project Structure

```
getcontractornow-backend/
├── index.js                 # Main application file (Express server)
├── scoring.js              # Lead scoring algorithm
├── assignment.js           # Contractor assignment logic
├── notifications.js        # Email/SMS notification system
├── prisma/
│   ├── schema.prisma       # Database schema (10 models)
│   └── migrations/         # Database migrations
├── public/
│   ├── contractor.html     # Contractor portal UI
│   ├── admin-dashboard.html # Admin dashboard UI
│   └── styles.css          # Shared styles
├── scripts/
│   └── backup-before-migration.sh
├── docs/
│   ├── API.md              # Complete API documentation
│   ├── QUICK_START.md      # This file
│   └── database-backup.md  # Backup procedures
├── .github/
│   ├── workflows/          # GitHub Actions (cron jobs)
│   │   ├── recycle-numbers.yml
│   │   └── send-feedback-emails.yml
│   └── DEPLOYMENT_CHECKLIST.md
├── package.json
├── .env                    # Environment variables (not in git)
└── .gitignore
```

---

### Environment-Specific Configuration

**Development:**
- Uses test Stripe keys (STRIPE_SECRET_KEY_TEST)
- Database: Local PostgreSQL or Railway dev
- CORS: Allows all origins (*)
- Logging: Verbose console output
- Error details: Full stack traces

**Production:**
- Uses live Stripe keys (STRIPE_SECRET_KEY_LIVE)
- Database: Railway PostgreSQL (production)
- CORS: Restricted to approved domains
- Logging: Railway logs + Sentry
- Error details: Generic messages only

---

## For Integrators

### Testing Lead Submission

**Basic Lead Submission:**

```bash
curl -X POST https://api.getcontractornow.com/api/leads/submit \
  -H "Content-Type: application/json" \
  -d '{
    "customerFirstName": "John",
    "customerLastName": "Smith",
    "customerEmail": "john@example.com",
    "customerPhone": "5551234567",
    "customerAddress": "123 Main St",
    "customerCity": "Beverly Hills",
    "customerState": "CA",
    "customerZip": "90210",
    "serviceType": "ac_repair",
    "serviceDescription": "AC not cooling properly, started yesterday",
    "timeline": "within_24_hours",
    "budgetRange": "500-1000",
    "propertyType": "residential"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Lead submitted successfully",
  "leadId": "clxyz456",
  "score": 145,
  "category": "PLATINUM",
  "price": 250.00
}
```

---

### Service Types

Valid serviceType values:

- ac_repair - Air Conditioning Repair
- heating_repair - Heating System Repair  
- installation - New HVAC System Installation
- maintenance - Routine Maintenance
- emergency - Emergency Service
- duct_cleaning - Duct Cleaning Service
- thermostat - Thermostat Installation/Repair

---

### Timeline Options

Valid timeline values:

- emergency - Immediate assistance needed (highest priority)
- within_24_hours - Service within 24 hours
- within_week - Service within a week
- flexible - Flexible scheduling

---

### Budget Ranges

Valid budgetRange values:

- under_500 - Under $500
- 500-1000 - $500 - $1,000
- 1000-3000 - $1,000 - $3,000
- 3000-5000 - $3,000 - $5,000
- 5000-10000 - $5,000 - $10,000
- over_10000 - Over $10,000

---

### Property Types

Valid propertyType values:

- residential - Single family home
- commercial - Commercial property
- multi_family - Apartment/Multi-unit
- condo - Condominium

---

### Error Handling

**No Contractor Available:**

```json
{
  "success": false,
  "error": "No contractors available in your area"
}
```

**Missing Required Fields:**

```json
{
  "error": "Missing required fields",
  "details": "customerPhone and customerZip are required"
}
```

**Invalid Phone Number:**

```json
{
  "error": "Invalid phone number format",
  "details": "Phone must be 10 digits"
}
```

**Invalid Zip Code:**

```json
{
  "error": "Invalid zip code format",
  "details": "Zip code must be 5 digits"
}
```

**Rate Limit Exceeded:**

```json
{
  "error": "Rate limit exceeded",
  "details": "Too many requests. Please try again in 15 minutes."
}
```

---

### Integration Examples

**JavaScript (Frontend):**

```javascript
async function submitLead(leadData) {
  try {
    const response = await fetch('https://api.getcontractornow.com/api/leads/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leadData)
    });

    const data = await response.json();

    if (data.success) {
      console.log('Lead submitted:', data.leadId);
      console.log('Lead score:', data.score);
      console.log('Lead category:', data.category);
      console.log('Lead price:', data.price);
    } else {
      console.error('Lead submission failed:', data.error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
}
```

**PHP:**

```php
<?php
function submitLead($leadData) {
    $url = 'https://api.getcontractornow.com/api/leads/submit';
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json'
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($leadData));
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200) {
        $data = json_decode($response, true);
        if ($data['success']) {
            return $data;
        }
    }
    
    return [
        'success' => false,
        'error' => 'Submission failed'
    ];
}
?>
```

**Python:**

```python
import requests

def submit_lead(lead_data):
    url = 'https://api.getcontractornow.com/api/leads/submit'
    headers = {'Content-Type': 'application/json'}
    
    try:
        response = requests.post(url, headers=headers, json=lead_data)
        data = response.json()
        
        if response.status_code == 200 and data.get('success'):
            return data
        else:
            return {
                'success': False,
                'error': data.get('error', 'Unknown error')
            }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }
```

---

## For Contractors

### Accessing Contractor Portal

**URL:** https://app.getcontractornow.com/contractor

**Login:**

1. Use email and password provided in onboarding email
2. First-time login: Change your password
3. Portal shows your leads, billing, disputes, and stats

**Features:**

- View assigned leads with contact info
- See tracking numbers for each lead
- Track billing records
- Submit disputes
- Update profile and service areas
- View performance metrics

---

### API Access for Contractors

Contractors can access the API programmatically using JWT authentication.

**Step 1: Get JWT Token**

```bash
curl -X POST https://api.getcontractornow.com/api/contractors/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "contractor": {
    "id": "clxyz123",
    "businessName": "HVAC Pros",
    "email": "contractor@example.com"
  }
}
```

**Step 2: Use Token for API Requests**

```bash
curl -X GET https://api.getcontractornow.com/api/contractors/leads \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## For Administrators

### Accessing Admin Dashboard

**URL:** https://app.getcontractornow.com/admin

**Login:**

- Username: admin
- Password: Set in ADMIN_PASSWORD environment variable

**Features:**

- View all leads and contractors
- Approve new contractors (sends onboarding email automatically)
- Manage billing and disputes
- Export data to CSV
- Monitor system health and backup status
- View bounced emails
- Track performance metrics

---

### Common Admin Tasks

**Approve New Contractor:**

```bash
curl -X POST https://api.getcontractornow.com/api/admin/contractors/{contractorId}/approve \
  -u admin:your_admin_password
```

This automatically:
- Sets contractor status to "active"
- Sets isApproved to true
- Sends onboarding email with login credentials

**Export Leads to CSV:**

```bash
curl -X GET "https://api.getcontractornow.com/api/admin/export/leads?startDate=2025-10-01&endDate=2025-10-31" \
  -u admin:your_admin_password \
  -o leads.csv
```

**Export Billing Records:**

```bash
curl -X GET "https://api.getcontractornow.com/api/admin/export/billing?status=pending" \
  -u admin:your_admin_password \
  -o billing-pending.csv
```

**View Backup Status:**

```bash
curl -X GET https://api.getcontractornow.com/api/admin/backup-status \
  -u admin:your_admin_password
```

**Resolve Dispute:**

```bash
curl -X POST https://api.getcontractornow.com/api/admin/disputes/{disputeId}/resolve \
  -u admin:your_admin_password \
  -H "Content-Type: application/json" \
  -d '{
    "resolution": "approved",
    "creditAmount": 250.00,
    "resolutionNotes": "Valid dispute - customer confirmed no contact"
  }'
```

---

## Troubleshooting

### Common Issues

**Database connection failed**

- Check DATABASE_URL in environment variables
- Verify database is running (Railway dashboard)
- Check network connectivity
- Ensure database credentials are correct

**Twilio error: Authentication failed**

- Verify TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN
- Check credentials in Twilio dashboard
- Ensure no extra spaces in .env file
- Confirm credentials are for correct Twilio account

**Email not sending**

- Check SENDGRID_API_KEY is valid and not expired
- Verify sender email is verified in SendGrid
- Check SendGrid activity feed for bounces or blocks
- Ensure SendGrid account is active

**Stripe payment failing**

- Ensure using correct key (test vs live mode)
- Check webhook secret matches Stripe dashboard
- Verify webhook URL in Stripe settings
- Confirm Stripe account is active

**No contractors available**

- Check contractors exist for that zip code in database
- Verify contractors are approved (isApproved = true)
- Confirm contractors have status = "active"
- Check contractor serviceZipCodes array includes the zip

**JWT token invalid**

- Token may be expired (24hr lifetime)
- Re-login to get new token
- Check JWT_SECRET has not changed
- Verify token format: "Bearer {token}"

**Admin dashboard will not load**

- Check admin password is correct
- Verify Basic Auth format: admin:password base64 encoded
- Clear browser cache
- Check Railway logs for errors

---

### Health Checks

**API Health:**

```bash
curl https://api.getcontractornow.com/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2025-10-05T12:00:00.000Z",
  "database": "connected",
  "version": "1.0"
}
```

**Database Connection:**

```bash
railway run -- npx prisma db push --skip-generate
```

**Check Recent Deployments:**

- Railway Dashboard → Deployments
- View logs for errors
- Check deployment status and build time

---

### Logs and Monitoring

**View Application Logs:**

```bash
railway logs
```

**View Live Logs (real-time):**

```bash
railway logs --follow
```

**Filter Logs by Level:**

```bash
railway logs --filter error
railway logs --filter warn
```

**View Sentry Errors:**

1. Go to https://sentry.io
2. Select getcontractornow-backend project
3. View recent issues
4. Check error frequency and affected users

**Monitor Database with Prisma Studio:**

```bash
npx prisma studio
```

Opens at: http://localhost:5555

---

### Getting Help

**Documentation:**

- API Reference: docs/API.md
- Database Backup: docs/database-backup.md
- Deployment Checklist: .github/DEPLOYMENT_CHECKLIST.md

**Logs and Monitoring:**

- Application Logs: Railway Dashboard → Logs
- Error Tracking: Sentry Dashboard
- Database GUI: Prisma Studio (npx prisma studio)

**Support Channels:**

- Technical Issues: Check Sentry for stack traces
- Database Issues: Railway support at support@railway.app
- Twilio Issues: Twilio support portal
- SendGrid Issues: SendGrid support
- Stripe Issues: Stripe support dashboard

---

## Production Deployment Checklist

Before deploying to production:

### Environment Setup

- [ ] All environment variables set in Railway
- [ ] ADMIN_PASSWORD changed from default
- [ ] JWT_SECRET is at least 32 characters
- [ ] CRON_SECRET is random and secure
- [ ] Using live Stripe keys (not test keys)
- [ ] SendGrid sender email verified
- [ ] Twilio phone numbers purchased

### Database

- [ ] Database migrations tested locally
- [ ] Manual backup created in Railway
- [ ] Backup schedule enabled (daily at 2 AM UTC)
- [ ] Backup retention set to 7 days

### Testing

- [ ] All endpoints tested and working
- [ ] Lead submission flow tested end-to-end
- [ ] Contractor login tested
- [ ] Admin dashboard accessible
- [ ] Billing automation tested (30+ second call)

### Webhooks

- [ ] Twilio webhooks configured for all numbers
- [ ] Stripe webhooks configured
- [ ] SendGrid webhooks configured
- [ ] All webhook signatures verified

### Domains and SSL

- [ ] Custom domains configured (api. and app.)
- [ ] DNS records added and propagated
- [ ] SSL certificates active and valid
- [ ] All URLs updated to use custom domains

### Security

- [ ] CORS settings configured for production domains
- [ ] Rate limiting enabled
- [ ] Webhook signature verification enabled
- [ ] Error monitoring active (Sentry)
- [ ] Sensitive data not logged

### Automation

- [ ] Cron jobs scheduled (GitHub Actions)
- [ ] Number recycling job tested
- [ ] Feedback email job tested
- [ ] GitHub secrets configured (CRON_SECRET)

### Notifications

- [ ] Contractor onboarding email tested
- [ ] Lead notification email tested
- [ ] Payment confirmation email tested
- [ ] Dispute notification email tested

### Final Checks

- [ ] All tests passing
- [ ] No console errors in portals
- [ ] Mobile responsive (contractor and admin portals)
- [ ] Performance acceptable (less than 2s page loads)
- [ ] Documentation up to date

---

## Quick Reference

### Essential URLs

- Production API: https://api.getcontractornow.com
- Contractor Portal: https://app.getcontractornow.com/contractor
- Admin Dashboard: https://app.getcontractornow.com/admin
- Health Check: https://api.getcontractornow.com/health
- Railway Dashboard: https://railway.app/dashboard
- Sentry Dashboard: https://sentry.io
- Stripe Dashboard: https://dashboard.stripe.com
- Twilio Console: https://console.twilio.com
- SendGrid Dashboard: https://app.sendgrid.com

### Essential Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /health | GET | Check API health |
| /api/leads/submit | POST | Submit new lead |
| /api/contractors/login | POST | Contractor login |
| /api/contractors/dashboard | GET | Contractor stats |
| /api/contractors/leads | GET | Get contractor leads |
| /api/contractors/billing | GET | Get billing history |
| /api/admin/dashboard | GET | Admin overview |
| /api/admin/contractors | GET | All contractors |
| /api/admin/billing | GET | All billing records |

### Essential Commands

| Task | Command |
|------|---------|
| Start dev server | npm run dev |
| Run migrations | npx prisma migrate deploy |
| Generate Prisma Client | npx prisma generate |
| Create backup | ./scripts/backup-before-migration.sh |
| View logs | railway logs |
| Deploy | git push origin main |
| Open database GUI | npx prisma studio |

### Essential Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| DATABASE_URL | PostgreSQL connection | postgresql://user:pass@host/db |
| TWILIO_ACCOUNT_SID | Twilio authentication | ACxxxxxxxxxxxxx |
| SENDGRID_API_KEY | SendGrid authentication | SG.xxxxxxxxxxxxx |
| STRIPE_SECRET_KEY_LIVE | Stripe payments | sk_live_xxxxxxxxxxxxx |
| JWT_SECRET | Token signing | random-32-char-string |
| ADMIN_PASSWORD | Admin access | secure-password |
| CRON_SECRET | Cron job auth | random-string |
| SENTRY_DSN | Error tracking | https://xxx@sentry.io/xxx |

---

## Version History

**v1.0 (October 2025)**

- Initial production release
- Complete lead routing system with scoring (0-200 points)
- Automated billing via Twilio (30+ second calls)
- SMS notifications via Twilio (pending A2P approval)
- Email notifications via SendGrid
- Contractor and admin portals
- Webhook security (signature verification for Twilio, Stripe, SendGrid)
- Error monitoring with Sentry
- Automated database backups (Railway managed)
- Custom domain support (api. and app. subdomains)
- Rate limiting (100 req/15min public, 5 req/15min auth)
- JWT authentication for contractors
- Basic auth for admin
- Dispute resolution system
- Customer feedback collection
- CSV export functionality
- GitHub Actions cron jobs (number recycling, feedback emails)

---

**Need more help?** Refer to the complete API Documentation (docs/API.md) for detailed endpoint specifications.

**Version:** 1.0  
**Last Updated:** October 2025  
**Maintained by:** GetContractorNow Development Team