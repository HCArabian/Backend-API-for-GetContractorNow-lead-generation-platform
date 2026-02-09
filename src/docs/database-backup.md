# Database Backup & Recovery Guide

## Automated Backups (Railway)

- **Schedule**: Daily at 2 AM UTC
- **Retention**: 7 days
- **Location**: Railway managed storage (encrypted)

## Manual Backup (On-Demand)

### Create Manual Backup:

1. Railway Dashboard → PostgreSQL service
2. Click "Backups" tab
3. Click "Create Backup"
4. Add description (e.g., "Pre-deployment backup - [date]")

### Export Database Locally:
```bash
# Get database credentials from Railway
railway variables

# Export full database
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Compress backup
gzip backup-$(date +%Y%m%d).sql