# GetContractorNow API Documentation

**Base URL**: `https://api.getcontractornow.com`

**Version**: 1.0

**Last Updated**: October 2025

------------------------------------------------------------------------

## Table of Contents

1.  [Authentication](#authentication)
2.  [Public Endpoints](#public-endpoints)
3.  [Contractor Endpoints](#contractor-endpoints)
4.  [Admin Endpoints](#admin-endpoints)
5.  [Webhook Endpoints](#webhook-endpoints)
6.  [Cron Endpoints](#cron-endpoints)
7.  [Error Codes](#error-codes)
8.  [Rate Limits](#rate-limits)

------------------------------------------------------------------------

## Authentication

### JWT Authentication

Protected contractor endpoints require a JWT token in the Authorization header:

    Authorization: Bearer {token}

**Get JWT Token** (Contractor):

``` bash
POST /api/contractors/login
Content-Type: application/json

{
  "email": "contractor@example.com",
  "password": "password123"
}
```

**Response**:

``` json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "contractor": {
    "id": "clxyz123",
    "email": "contractor@example.com",
    "businessName": "HVAC Pros",
    "phone": "5559876543",
    "serviceZipCodes": ["90210", "90211"],
    "status": "active",
    "isApproved": true
  }
}
```

### Admin Authentication

Admin endpoints require Basic Authentication:

    Authorization: Basic {base64(username:password)}

Username: `admin`\
Password: Set in `ADMIN_PASSWORD` environment variable

------------------------------------------------------------------------

## Public Endpoints

### Health Check

**GET** `/health`

Check API status and database connectivity.

**Response**:

``` json
{
  "status": "healthy",
  "timestamp": "2025-10-05T12:00:00.000Z",
  "database": "connected",
  "version": "1.0"
}
```

------------------------------------------------------------------------

### Submit Lead

**POST** `/api/leads/submit`

Submit a new HVAC service lead. This is the main entry point for lead generation.

**Request Body**:

``` json
{
  "customerFirstName": "John",
  "customerLastName": "Smith",
  "customerEmail": "john@example.com",
  "customerPhone": "5551234567",
  "customerAddress": "123 Main St",
  "customerCity": "Beverly Hills",
  "customerState": "CA",
  "customerZip": "90210",
  "serviceType": "ac_repair",
  "serviceDescription": "AC not cooling properly",
  "timeline": "within_24_hours",
  "budgetRange": "500-1000",
  "propertyType": "residential"
}
```

**Required Fields**: - `customerFirstName` (string) - `customerLastName` (string) - `customerPhone` (string, 10 digits) - `customerZip` (string, 5 digits) - `serviceType` (enum: `ac_repair`, `heating_repair`, `installation`, `maintenance`, `emergency`) - `timeline` (enum: `emergency`, `within_24_hours`, `within_week`, `flexible`) - `budgetRange` (string) - `propertyType` (enum: `residential`, `commercial`)

**Optional Fields**: - `customerEmail` (string) - `customerAddress` (string) - `customerCity` (string) - `customerState` (string) - `serviceDescription` (string)

**Response** (Success):

``` json
{
  "success": true,
  "message": "Lead submitted successfully",
  "leadId": "clxyz456",
  "score": 145,
  "category": "PLATINUM",
  "price": 250.00
}
```

**Response** (No Contractor Available):

``` json
{
  "success": false,
  "error": "No contractors available in your area"
}
```

------------------------------------------------------------------------

## Contractor Endpoints

All contractor endpoints require JWT authentication.

### Contractor Login

**POST** `/api/contractors/login`

Authenticate contractor and receive JWT token.

**Request Body**:

``` json
{
  "email": "contractor@example.com",
  "password": "password123"
}
```

**Response**:

``` json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "contractor": {
    "id": "clxyz123",
    "email": "contractor@example.com",
    "businessName": "HVAC Pros",
    "phone": "5559876543",
    "serviceZipCodes": ["90210", "90211"],
    "specializations": ["ac_repair", "heating_repair"],
    "status": "active",
    "isApproved": true,
    "isAcceptingLeads": true
  }
}
```

------------------------------------------------------------------------

### Get Contractor Dashboard

**GET** `/api/contractors/dashboard`

**Headers**: `Authorization: Bearer {token}`

Get contractor\'s dashboard data including stats and recent leads.

**Response**:

``` json
{
  "stats": {
    "totalLeads": 45,
    "leadsThisMonth": 12,
    "conversionRate": 67.5,
    "averageResponseTime": 120,
    "totalBilled": 2250.00,
    "pendingPayment": 375.00,
    "avgCustomerRating": 4.8
  },
  "recentLeads": [
    {
      "id": "clxyz789",
      "customerFirstName": "John",
      "customerLastName": "Smith",
      "customerPhone": "5551234567",
      "customerCity": "Beverly Hills",
      "customerState": "CA",
      "customerZip": "90210",
      "serviceType": "ac_repair",
      "timeline": "within_24_hours",
      "status": "assigned",
      "category": "PLATINUM",
      "price": 250.00,
      "createdAt": "2025-10-05T10:30:00.000Z"
    }
  ]
}
```

------------------------------------------------------------------------

### Get Contractor Leads

**GET** `/api/contractors/leads`

**Headers**: `Authorization: Bearer {token}`

**Query Parameters**: - `status` (optional): Filter by status (`pending_assignment`, `assigned`, `contacted`, `qualified`) - `limit` (optional): Number of results (default: 50) - `offset` (optional): Pagination offset (default: 0)

**Response**:

``` json
{
  "leads": [
    {
      "id": "clxyz789",
      "customerFirstName": "John",
      "customerLastName": "Smith",
      "customerPhone": "5551234567",
      "customerEmail": "john@example.com",
      "customerAddress": "123 Main St",
      "customerCity": "Beverly Hills",
      "customerState": "CA",
      "customerZip": "90210",
      "serviceType": "ac_repair",
      "serviceDescription": "AC not cooling",
      "timeline": "within_24_hours",
      "budgetRange": "500-1000",
      "propertyType": "residential",
      "status": "assigned",
      "score": 145,
      "category": "PLATINUM",
      "price": 250.00,
      "createdAt": "2025-10-05T10:30:00.000Z",
      "assignment": {
        "assignedAt": "2025-10-05T10:31:00.000Z",
        "responseDeadline": "2025-10-05T22:31:00.000Z",
        "status": "assigned"
      }
    }
  ],
  "total": 45,
  "limit": 50,
  "offset": 0
}
```

------------------------------------------------------------------------

### Update Lead Status

**PUT** `/api/contractors/leads/:leadId/status`

**Headers**: `Authorization: Bearer {token}`

**Request Body**:

``` json
{
  "status": "contacted"
}
```

**Valid Statuses**: - `assigned` - Lead just assigned to contractor - `contacted` - Contractor reached out to customer - `qualified` - Valid lead (30+ second call completed)

**Response**:

``` json
{
  "success": true,
  "lead": {
    "id": "clxyz789",
    "status": "contacted",
    "firstContactAt": "2025-10-05T11:00:00.000Z"
  }
}
```

------------------------------------------------------------------------

### Get Billing History

**GET** `/api/contractors/billing`

**Headers**: `Authorization: Bearer {token}`

**Query Parameters**: - `startDate` (optional): ISO date string - `endDate` (optional): ISO date string - `status` (optional): `pending`, `invoiced`, `paid`

**Response**:

``` json
{
  "billingRecords": [
    {
      "id": "clxyz999",
      "leadId": "clxyz789",
      "amountOwed": 250.00,
      "status": "paid",
      "dateIncurred": "2025-10-05T12:00:00.000Z",
      "invoicedAt": "2025-10-06T00:00:00.000Z",
      "paidAt": "2025-10-10T15:00:00.000Z",
      "lead": {
        "customerFirstName": "John",
        "customerLastName": "Smith",
        "serviceType": "ac_repair",
        "customerCity": "Beverly Hills",
        "customerState": "CA"
      }
    }
  ],
  "summary": {
    "totalBilled": 2250.00,
    "totalPaid": 1875.00,
    "totalPending": 375.00
  }
}
```

------------------------------------------------------------------------

### Submit Dispute

**POST** `/api/contractors/billing/:recordId/dispute`

**Headers**: `Authorization: Bearer {token}`

**Request Body**:

``` json
{
  "reason": "customer_no_contact",
  "description": "Called 3 times, customer never answered. No voicemail set up."
}
```

**Valid Reasons**: - `invalid_phone` - Phone number invalid or disconnected - `customer_no_contact` - Customer never answered calls - `wrong_info` - Lead information was incorrect - `duplicate` - Duplicate lead already received - `out_of_area` - Service area mismatch - `other` - Other reason (requires description)

**Response**:

``` json
{
  "success": true,
  "dispute": {
    "id": "clxyz111",
    "billingRecordId": "clxyz999",
    "leadId": "clxyz789",
    "status": "pending",
    "reason": "customer_no_contact",
    "description": "Called 3 times, customer never answered",
    "submittedAt": "2025-10-05T13:00:00.000Z"
  }
}
```

------------------------------------------------------------------------

### Get Disputes

**GET** `/api/contractors/disputes`

**Headers**: `Authorization: Bearer {token}`

**Query Parameters**: - `status` (optional): `pending`, `under_review`, `approved`, `denied`

**Response**:

``` json
{
  "disputes": [
    {
      "id": "clxyz111",
      "billingRecord": {
        "id": "clxyz999",
        "amountOwed": 250.00
      },
      "lead": {
        "customerFirstName": "John",
        "customerLastName": "Smith",
        "customerPhone": "5551234567"
      },
      "reason": "customer_no_contact",
      "description": "Called 3 times, no response",
      "status": "pending",
      "submittedAt": "2025-10-05T13:00:00.000Z"
    }
  ]
}
```

------------------------------------------------------------------------

### Update Profile

**PUT** `/api/contractors/profile`

**Headers**: `Authorization: Bearer {token}`

**Request Body**:

``` json
{
  "businessName": "HVAC Pros LLC",
  "phone": "5559876543",
  "serviceZipCodes": ["90210", "90211", "90212"],
  "specializations": ["ac_repair", "heating_repair", "installation"],
  "isAcceptingLeads": true
}
```

**Response**:

``` json
{
  "success": true,
  "contractor": {
    "id": "clxyz123",
    "businessName": "HVAC Pros LLC",
    "phone": "5559876543",
    "serviceZipCodes": ["90210", "90211", "90212"],
    "specializations": ["ac_repair", "heating_repair", "installation"],
    "isAcceptingLeads": true
  }
}
```

------------------------------------------------------------------------

## Admin Endpoints

All admin endpoints require Basic Authentication.

### Admin Dashboard

**GET** `/api/admin/dashboard`

**Headers**: `Authorization: Basic {credentials}`

**Response**:

``` json
{
  "stats": {
    "totalLeads": 1250,
    "leadsToday": 45,
    "totalContractors": 87,
    "activeContractors": 72,
    "approvedContractors": 65,
    "pendingContractors": 7,
    "totalRevenue": 125000.00,
    "revenueThisMonth": 32500.00,
    "pendingBilling": 4500.00,
    "averageLeadScore": 132,
    "conversionRate": 68.5
  },
  "recentActivity": [
    {
      "type": "lead_submitted",
      "data": {
        "leadId": "clxyz789",
        "customerName": "John Smith",
        "category": "PLATINUM",
        "price": 250.00
      },
      "timestamp": "2025-10-05T10:30:00.000Z"
    }
  ]
}
```

------------------------------------------------------------------------

### Get All Leads

**GET** `/api/admin/leads`

**Headers**: `Authorization: Basic {credentials}`

**Query Parameters**: - `status` (optional): Filter by status - `category` (optional): Filter by category (PLATINUM, GOLD, SILVER, BRONZE, NURTURE) - `contractorId` (optional): Filter by contractor - `startDate` (optional): Filter by date range - `endDate` (optional): Filter by date range - `limit` (optional): Results per page (default: 100) - `offset` (optional): Pagination offset

**Response**:

``` json
{
  "leads": [
    {
      "id": "clxyz789",
      "customerFirstName": "John",
      "customerLastName": "Smith",
      "customerPhone": "5551234567",
      "customerEmail": "john@example.com",
      "customerCity": "Beverly Hills",
      "customerState": "CA",
      "customerZip": "90210",
      "serviceType": "ac_repair",
      "timeline": "within_24_hours",
      "status": "qualified",
      "score": 145,
      "category": "PLATINUM",
      "price": 250.00,
      "assignment": {
        "contractor": {
          "id": "clxyz123",
          "businessName": "HVAC Pros"
        },
        "assignedAt": "2025-10-05T10:31:00.000Z"
      },
      "createdAt": "2025-10-05T10:30:00.000Z"
    }
  ],
  "total": 1250,
  "limit": 100,
  "offset": 0
}
```

------------------------------------------------------------------------

### Get All Contractors

**GET** `/api/admin/contractors`

**Headers**: `Authorization: Basic {credentials}`

**Query Parameters**: - `status` (optional): `active`, `inactive`, `suspended` - `isApproved` (optional): `true`, `false` - `zipCode` (optional): Filter by service area

**Response**:

``` json
{
  "contractors": [
    {
      "id": "clxyz123",
      "businessName": "HVAC Pros",
      "email": "contractor@example.com",
      "phone": "5559876543",
      "serviceZipCodes": ["90210", "90211"],
      "specializations": ["ac_repair", "heating_repair"],
      "status": "active",
      "isApproved": true,
      "isAcceptingLeads": true,
      "avgResponseTime": 120,
      "conversionRate": 67.5,
      "customerRating": 4.8,
      "totalLeads": 45,
      "totalRevenue": 2250.00,
      "createdAt": "2025-08-01T00:00:00.000Z"
    }
  ],
  "total": 87
}
```

------------------------------------------------------------------------

### Approve Contractor

**POST** `/api/admin/contractors/:contractorId/approve`

**Headers**: `Authorization: Basic {credentials}`

**Response**:

``` json
{
  "success": true,
  "message": "Contractor approved and onboarding email sent",
  "contractor": {
    "id": "clxyz123",
    "isApproved": true,
    "status": "active",
    "approvedAt": "2025-10-05T14:00:00.000Z"
  }
}
```

**Notes**: - Automatically sends onboarding email with login credentials - Activates contractor account - Contractor can now receive leads

------------------------------------------------------------------------

### Get Billing Records

**GET** `/api/admin/billing`

**Headers**: `Authorization: Basic {credentials}`

**Query Parameters**: - `status` (optional): `pending`, `invoiced`, `paid` - `contractorId` (optional): Filter by contractor - `startDate` (optional): ISO date string - `endDate` (optional): ISO date string - `limit` (optional): Number of records (default: 100) - `offset` (optional): Pagination offset

**Response**:

``` json
{
  "billingRecords": [
    {
      "id": "clxyz999",
      "contractor": {
        "id": "clxyz123",
        "businessName": "HVAC Pros",
        "email": "contractor@example.com"
      },
      "lead": {
        "id": "clxyz789",
        "customerFirstName": "John",
        "customerLastName": "Smith",
        "customerPhone": "5551234567",
        "customerCity": "Beverly Hills",
        "customerState": "CA",
        "serviceType": "ac_repair"
      },
      "amountOwed": 250.00,
      "status": "paid",
      "dateIncurred": "2025-10-05T12:00:00.000Z",
      "invoicedAt": "2025-10-06T00:00:00.000Z",
      "paidAt": "2025-10-10T15:00:00.000Z",
      "invoiceNumber": "INV-2025-001"
    }
  ],
  "summary": {
    "totalRevenue": 125000.00,
    "pendingBilling": 4500.00,
    "invoicedNotPaid": 2250.00,
    "totalPaid": 118250.00
  },
  "total": 1100,
  "limit": 100,
  "offset": 0
}
```

------------------------------------------------------------------------

### Update Billing Record

**PUT** `/api/admin/billing/:recordId`

**Headers**: `Authorization: Basic {credentials}`

**Request Body**:

``` json
{
  "status": "invoiced",
  "invoiceNumber": "INV-2025-001",
  "notes": "Invoice sent via email"
}
```

**Valid Status Values**: - `pending` - Charge incurred, not yet invoiced - `invoiced` - Invoice sent to contractor - `paid` - Payment received

**Response**:

``` json
{
  "success": true,
  "billingRecord": {
    "id": "clxyz999",
    "status": "invoiced",
    "invoiceNumber": "INV-2025-001",
    "invoicedAt": "2025-10-06T00:00:00.000Z",
    "notes": "Invoice sent via email"
  }
}
```

------------------------------------------------------------------------

### Get Disputes

**GET** `/api/admin/disputes`

**Headers**: `Authorization: Basic {credentials}`

**Query Parameters**: - `status` (optional): `pending`, `under_review`, `approved`, `denied` - `contractorId` (optional): Filter by contractor

**Response**:

``` json
{
  "disputes": [
    {
      "id": "clxyz111",
      "billingRecord": {
        "id": "clxyz999",
        "amountOwed": 250.00,
        "dateIncurred": "2025-10-05T12:00:00.000Z"
      },
      "contractor": {
        "id": "clxyz123",
        "businessName": "HVAC Pros",
        "email": "contractor@example.com"
      },
      "lead": {
        "id": "clxyz789",
        "customerFirstName": "John",
        "customerLastName": "Smith",
        "customerPhone": "5551234567"
      },
      "reason": "customer_no_contact",
      "description": "Called 3 times, no response",
      "status": "pending",
      "submittedAt": "2025-10-05T13:00:00.000Z"
    }
  ],
  "total": 12
}
```

------------------------------------------------------------------------

### Resolve Dispute

**POST** `/api/admin/disputes/:disputeId/resolve`

**Headers**: `Authorization: Basic {credentials}`

**Request Body**:

``` json
{
  "resolution": "approved",
  "creditAmount": 250.00,
  "resolutionNotes": "Valid dispute - customer confirmed no contact. Full credit issued."
}
```

**Valid Resolutions**: - `approved` - Dispute valid, credit contractor - `partial_credit` - Partial credit issued - `replacement_lead` - Offer replacement lead instead - `denied` - Dispute denied, charge stands

**Response**:

``` json
{
  "success": true,
  "dispute": {
    "id": "clxyz111",
    "status": "approved",
    "resolution": "approved",
    "creditAmount": 250.00,
    "resolutionNotes": "Valid dispute - customer confirmed no contact",
    "resolvedAt": "2025-10-05T16:00:00.000Z"
  },
  "billingRecord": {
    "id": "clxyz999",
    "status": "credited",
    "amountOwed": 0.00
  }
}
```

------------------------------------------------------------------------

### Export Data (CSV)

**GET** `/api/admin/export/leads`

**Headers**: `Authorization: Basic {credentials}`

**Query Parameters**: - `startDate` (optional): ISO date string - `endDate` (optional): ISO date string - `status` (optional): Filter by status - `category` (optional): Filter by category

**Response**: CSV file download

**CSV Format**:

    Lead ID,Customer Name,Email,Phone,City,State,Zip,Service Type,Timeline,Status,Category,Price,Score,Created At,Assigned At
    clxyz789,John Smith,john@example.com,5551234567,Beverly Hills,CA,90210,ac_repair,within_24_hours,qualified,PLATINUM,250.00,145,2025-10-05T10:30:00.000Z,2025-10-05T10:31:00.000Z

------------------------------------------------------------------------

**GET** `/api/admin/export/contractors`

**Headers**: `Authorization: Basic {credentials}`

**Response**: CSV file download

**CSV Format**:

    Contractor ID,Business Name,Email,Phone,Service Zip Codes,Status,Approved,Total Leads,Conversion Rate,Customer Rating,Total Revenue,Created At
    clxyz123,HVAC Pros,contractor@example.com,5559876543,"90210,90211",active,true,45,67.5,4.8,2250.00,2025-08-01T00:00:00.000Z

------------------------------------------------------------------------

**GET** `/api/admin/export/billing`

**Headers**: `Authorization: Basic {credentials}`

**Query Parameters**: - `startDate` (optional): ISO date string - `endDate` (optional): ISO date string - `status` (optional): Filter by status - `contractorId` (optional): Filter by contractor

**Response**: CSV file download

**CSV Format**:

    Billing ID,Date Incurred,Contractor,Contractor Email,Customer Name,Phone,City,State,Service Type,Amount,Status,Invoice Number,Invoiced At,Paid At
    clxyz999,2025-10-05T12:00:00.000Z,HVAC Pros,contractor@example.com,John Smith,5551234567,Beverly Hills,CA,ac_repair,250.00,paid,INV-2025-001,2025-10-06T00:00:00.000Z,2025-10-10T15:00:00.000Z

------------------------------------------------------------------------

### Get Bounced Emails

**GET** `/api/admin/bounced-emails`

**Headers**: `Authorization: Basic {credentials}`

**Response**:

``` json
{
  "bounced": [
    {
      "email": "contractor@example.com",
      "type": "Contractor",
      "businessName": "HVAC Pros",
      "bouncedAt": "2025-10-05T15:00:00.000Z",
      "reason": "550 5.1.1 Mailbox does not exist"
    }
  ]
}
```

------------------------------------------------------------------------

### Get Backup Status

**GET** `/api/admin/backup-status`

**Headers**: `Authorization: Basic {credentials}`

**Response**:

``` json
{
  "success": true,
  "backup": {
    "lastChecked": "2025-10-05T16:00:00.000Z",
    "recordCounts": {
      "leads": 1250,
      "contractors": 87,
      "billingRecords": 1100,
      "leadAssignments": 1250,
      "callLogs": 980,
      "smsLogs": 523,
      "disputes": 12,
      "customerFeedback": 456,
      "trackingNumbers": 245,
      "notificationLogs": 3200
    },
    "totalRecords": 9103,
    "databaseSize": "Check Railway Dashboard",
    "backupSchedule": "Daily at 2 AM UTC",
    "retention": "7 days",
    "provider": "Railway Managed Backups"
  }
}
```

------------------------------------------------------------------------

## Webhook Endpoints

### Twilio Call Status

**POST** `/api/webhooks/twilio/call-status`

Receives call status updates from Twilio (signature verified).

**Used for**: Automatic billing when calls exceed 30 seconds.

**Events**: - `initiated` - Call started - `ringing` - Phone ringing - `in-progress` - Call answered - `completed` - Call ended (triggers billing if 30+ seconds) - `failed` - Call failed - `busy` - Line busy - `no-answer` - No answer

**Request Body** (from Twilio):

    CallSid=CAxxxxxxxxxxxxx
    CallStatus=completed
    CallDuration=45
    From=+15551234567
    To=+15559876543
    RecordingUrl=https://...
    RecordingSid=RExxxxxxxxxxxxx
    Direction=outbound-api

**Response**:

``` xml
<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>
```

**Notes**: - Webhook signature is verified using Twilio Auth Token - Invalid signatures return 403 Forbidden - Creates CallLog record for every call - Creates BillingRecord if call duration ≥ 30 seconds - Updates lead status to \"contacted\" on first call - Security events logged to database

------------------------------------------------------------------------

### Stripe Payment Events

**POST** `/api/webhooks/stripe`

Receives payment events from Stripe (signature verified).

**Events Handled**: - `payment_intent.succeeded` - Payment successful - `payment_intent.payment_failed` - Payment failed

**Request Body** (from Stripe):

``` json
{
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_123abc",
      "amount": 25000,
      "status": "succeeded",
      "metadata": {
        "billingRecordId": "clxyz999",
        "contractorId": "clxyz123"
      }
    }
  }
}
```

**Notes**: - Webhook signature verified using Stripe webhook secret - Updates billing record status automatically - Sends confirmation emails to contractors - Records payment in system

------------------------------------------------------------------------

### SendGrid Email Events

**POST** `/api/webhooks/sendgrid`

Receives email bounce and spam events (signature verified).

**Events Handled**: - `bounce` - Email bounced (hard bounce) - `dropped` - Email dropped by SendGrid - `spamreport` - Marked as spam

**Request Body** (from SendGrid):

``` json
[
  {
    "email": "contractor@example.com",
    "event": "bounce",
    "reason": "550 5.1.1 Mailbox does not exist",
    "timestamp": 1696512000,
    "type": "bounce"
  }
]
```

**Notes**: - Signature verified using SendGrid verification key - Marks email addresses as bounced in Contractor table - Prevents future emails to bounced addresses - Admin can view bounced emails in dashboard

------------------------------------------------------------------------

## Cron Endpoints

### Recycle Tracking Numbers

**POST** `/api/cron/recycle-numbers?secret={CRON_SECRET}`

Releases tracking numbers from leads older than 7 days to make them available for reuse.

**Schedule**: Daily at midnight UTC (GitHub Actions)

**Query Parameters**: - `secret` (required): Must match `CRON_SECRET` environment variable

**Response**:

``` json
{
  "success": true,
  "recycled": 12,
  "message": "Recycled 12 tracking numbers from expired leads"
}
```

**Notes**: - Finds TrackingNumber records older than 7 days - Updates status from \"active\" to \"expired\" - Makes numbers available for new leads - Logs recycling activity

------------------------------------------------------------------------

### Send Feedback Emails

**POST** `/api/cron/send-feedback-emails?secret={CRON_SECRET}`

Sends feedback request emails to customers 24 hours after first contact.

**Schedule**: Daily at noon UTC (GitHub Actions)

**Query Parameters**: - `secret` (required): Must match `CRON_SECRET` environment variable

**Response**:

``` json
{
  "success": true,
  "sent": 8,
  "message": "Sent 8 feedback request emails"
}
```

**Notes**: - Finds leads contacted 24 hours ago - Sends email with feedback form link - Records email sent in NotificationLog - Skips if customer email bounced - One-time send per lead

------------------------------------------------------------------------

## Error Codes

  Code   Description
  ------ --------------------------------------------------------
  200    Success
  201    Created
  400    Bad Request - Invalid input or missing required fields
  401    Unauthorized - Missing or invalid authentication
  403    Forbidden - Access denied or invalid signature
  404    Not Found - Resource doesn\'t exist
  409    Conflict - Duplicate resource
  429    Too Many Requests - Rate limit exceeded
  500    Internal Server Error - Something went wrong

**Error Response Format**:

``` json
{
  "error": "Error message description",
  "details": "Additional context if available"
}
```

**Example Error Responses**:

``` json
{
  "error": "Missing required fields",
  "details": "customerPhone and customerZip are required"
}
```

``` json
{
  "error": "No contractors available in your area",
  "details": "Zip code: 99999"
}
```

``` json
{
  "error": "Invalid authentication credentials"
}
```

``` json
{
  "error": "Lead not found",
  "details": "Lead ID: clxyz789 does not exist"
}
```

------------------------------------------------------------------------

## Rate Limits

**Notes**: - Finds leads contacted 24 hours ago (status = \"contacted\", firstContactAt = 24hrs ago) - Sends email with feedback form link - Records email sent in NotificationLog - Skips if customer email bounced - One-time send per lead

------------------------------------------------------------------------

## Error Codes

  Code   Description
  ------ --------------------------------------------------------
  200    Success
  201    Created
  400    Bad Request - Invalid input or missing required fields
  401    Unauthorized - Missing or invalid authentication
  403    Forbidden - Access denied or invalid webhook signature
  404    Not Found - Resource doesn\'t exist
  409    Conflict - Duplicate resource
  429    Too Many Requests - Rate limit exceeded
  500    Internal Server Error - Something went wrong

**Error Response Format**:

``` json
{
  "error": "Error message description",
  "details": "Additional context if available"
}
```

**Example Error Responses**:

**Missing Required Fields**:

``` json
{
  "error": "Missing required fields",
  "details": "customerPhone and customerZip are required"
}
```

**No Contractors Available**:

``` json
{
  "error": "No contractors available in your area",
  "details": "Zip code: 99999"
}
```

**Invalid Authentication**:

``` json
{
  "error": "Invalid authentication credentials"
}
```

**Resource Not Found**:

``` json
{
  "error": "Lead not found",
  "details": "Lead ID: clxyz789 does not exist"
}
```

**Duplicate Entry**:

``` json
{
  "error": "Duplicate billing record",
  "details": "Billing record already exists for this call"
}
```

------------------------------------------------------------------------

## Rate Limits

**Public Endpoints**: - 100 requests per 15 minutes per IP address - Lead submission: 10 per hour per IP

**Authentication Endpoints** (Login): - 5 login attempts per 15 minutes per IP

**Authenticated Endpoints**: - No rate limit (protected by authentication)

**Webhook Endpoints**: - No rate limit (signature verified)

**Cron Endpoints**: - 1 request per scheduled run (secret-protected)

**Rate Limit Headers**:

    X-RateLimit-Limit: 100
    X-RateLimit-Remaining: 95
    X-RateLimit-Reset: 1696512000

**Rate Limit Exceeded Response**:

``` json
{
  "error": "Rate limit exceeded",
  "details": "Too many requests. Please try again in 15 minutes."
}
```

------------------------------------------------------------------------

## Security

### Authentication Methods

1.  **JWT Tokens** (Contractor Portal)
    - Issued on login via `/api/contractors/login`
    - Expires in 24 hours
    - Include in Authorization header: `Bearer {token}`
2.  **Basic Auth** (Admin Portal)
    - Username: `admin`
    - Password: From `ADMIN_PASSWORD` environment variable
    - Base64 encoded in Authorization header
3.  **Webhook Signatures**
    - **Twilio**: X-Twilio-Signature header (verified using Auth Token)
    - **Stripe**: Stripe-Signature header (verified using webhook secret)
    - **SendGrid**: X-Twilio-Email-Event-Webhook-Signature header
4.  **Cron Secrets**
    - Query parameter `secret` must match `CRON_SECRET` environment variable

### HTTPS Only

All endpoints require HTTPS. HTTP requests are automatically redirected to HTTPS.

### CORS

CORS is enabled for: - `https://getcontractornow.com` - `https://www.getcontractornow.com` - `https://app.getcontractornow.com`

### Data Privacy

- Customer phone numbers are masked in logs
- Payment information never stored (handled by Stripe)
- Passwords hashed with bcrypt (12 rounds)
- Sensitive data encrypted at rest in PostgreSQL
- PCI compliance via Stripe

### Security Headers

All responses include security headers: - `X-Content-Type-Options: nosniff` - `X-Frame-Options: DENY` - `X-XSS-Protection: 1; mode=block` - `Strict-Transport-Security: max-age=31536000`

------------------------------------------------------------------------

## Monitoring

### Error Tracking

All errors are automatically sent to Sentry: - **Dashboard**: https://sentry.io - **Project**: `getcontractornow-backend` - **Environment**: `production` - **DSN**: Set in `SENTRY_DSN` environment variable

**Error Capture**: - All uncaught exceptions - All promise rejections - Manual captures via `Sentry.captureException()` - Request context included (URL, method, headers)

### Logging

Application logs available in Railway: - **Access**: Railway Dashboard → Service → Logs - **Filters**: Error level, timestamp, keyword - **Retention**: 7 days

**Log Levels**: - `error`: Critical failures - `warn`: Non-critical issues - `info`: General information - `debug`: Detailed debugging (not in production)

### Health Monitoring

Monitor API health via `/health` endpoint: - Returns 200 status when healthy - Checks database connectivity - Returns current timestamp and version

**Health Check Response**:

``` json
{
  "status": "healthy",
  "timestamp": "2025-10-05T12:00:00.000Z",
  "database": "connected",
  "version": "1.0"
}
```

### Database Monitoring

Database metrics available in Railway: - **Access**: Railway Dashboard → PostgreSQL → Metrics - **Metrics**: Connections, queries/sec, storage usage - **Alerts**: Configure in Railway settings

------------------------------------------------------------------------

## Database Schema

### Models Overview

1.  **Lead** - Customer service requests
2.  **Contractor** - Service provider profiles
3.  **LeadAssignment** - Connects leads to contractors
4.  **BillingRecord** - Tracks amounts owed
5.  **TrackingNumber** - Twilio phone number assignments
6.  **CallLog** - Call tracking and recordings
7.  **SMSLog** - Text message tracking
8.  **Dispute** - Contractor billing disputes
9.  **CustomerFeedback** - Post-service feedback
10. **NotificationLog** - Email/SMS tracking

### Key Relationships

- Lead → LeadAssignment (1:1)
- Lead → BillingRecords (1:Many)
- Lead → CallLogs (1:Many)
- Contractor → LeadAssignments (1:Many)
- Contractor → BillingRecords (1:Many)
- Lead → TrackingNumber (1:1 active at a time)

### Lead Scoring

Leads are automatically scored on submission: - **Score Range**: 0-200 points - **Categories**: - PLATINUM: 150+ points (\$250) - GOLD: 120-149 points (\$175) - SILVER: 90-119 points (\$125) - BRONZE: 60-89 points (\$85) - NURTURE: \<60 points (\$0 - not assigned)

**Scoring Factors**: - Budget range (higher = more points) - Timeline urgency (faster = more points) - Property type (commercial \> residential) - Email provided (bonus points) - Service type complexity - Zip code (service availability)

------------------------------------------------------------------------

## Support

### Technical Issues

**Error Tracking**: - Check Sentry dashboard for stack traces - Review Railway logs for deployment issues - Test with `/health` endpoint

**Database Issues**: - See `docs/database-backup.md` for backup procedures - Contact Railway support for infrastructure issues - Use Prisma Studio for data inspection

**API Questions**: - Refer to this documentation - Check `docs/QUICK_START.md` for common tasks - Review schema in `prisma/schema.prisma`

### Integration Support

**Twilio Issues**: - Verify webhook URLs in Twilio Console - Check signature verification is enabled - Review call logs in Twilio Console

**Stripe Issues**: - Verify webhook secret matches Stripe dashboard - Check test vs live mode keys - Review events in Stripe dashboard

**SendGrid Issues**: - Verify sender email is verified - Check API key permissions - Review activity feed for bounces

### Contact

- **Technical Support**: Check Sentry for errors
- **Database Admin**: See backup documentation
- **Billing Questions**: Review admin dashboard

------------------------------------------------------------------------

## Changelog

### Version 1.0 (October 2025)

**Initial Production Release**: - Complete lead routing system - Automated billing via Twilio call tracking - SMS notifications (pending A2P approval) - Email notifications via SendGrid - Contractor and admin portals - Webhook security (signature verification) - Error monitoring with Sentry - Automated backups (Railway managed) - Custom domain support - Rate limiting - JWT authentication - Dispute resolution system - Customer feedback collection - CSV export functionality

------------------------------------------------------------------------

## API Versioning

**Current Version**: 1.0

**Versioning Strategy**: - Major versions for breaking changes - Minor versions for new features - Patch versions for bug fixes

**Future Versions**: - Version endpoints will be prefixed: `/api/v2/` - Current endpoints remain at `/api/` for backwards compatibility - Deprecation notices provided 90 days before removal

------------------------------------------------------------------------

## Best Practices

### For Integrators

1.  **Always handle errors gracefully**
2.  **Implement exponential backoff for retries**
3.  **Validate input before sending**
4.  **Store webhook signatures for audit**
5.  **Use HTTPS only**
6.  **Keep API keys secure** (never commit to git)
7.  **Monitor rate limits** in response headers

### For Contractors

1.  **Change default password on first login**
2.  **Keep contact information updated**
3.  **Respond to leads within response deadline**
4.  **Document disputes with evidence**
5.  **Provide feedback on lead quality**

### For Administrators

1.  **Review disputes promptly** (within 24-48 hours)
2.  **Monitor backup status weekly**
3.  **Export billing data monthly**
4.  **Review contractor performance metrics**
5.  **Approve new contractors within 24 hours**
6.  **Keep admin password secure and rotate quarterly**

------------------------------------------------------------------------

**Version**: 1.0\
**Last Updated**: October 2025\
**Maintained by**: GetContractorNow Development Team

**Need more help?** Refer to `docs/QUICK_START.md` for quick reference guide and common tasks.