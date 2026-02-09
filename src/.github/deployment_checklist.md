# Deployment Checklist

## Before Every Deployment

- [ ] All tests passing locally
- [ ] Code reviewed and approved
- [ ] Environment variables updated in Railway (if needed)

## Before Database Migrations

- [ ] **CREATE MANUAL BACKUP IN RAILWAY**
  1. Railway Dashboard → PostgreSQL → Backups
  2. Click "Create Backup"
  3. Add description: "Pre-migration backup - [feature name]"
  
- [ ] Run migration in test environment first
- [ ] Verify migration success
- [ ] Test rollback procedure

## After Deployment

- [ ] Verify deployment in Railway logs
- [ ] Test critical endpoints:
  - [ ] https://api.getcontractornow.com/health
  - [ ] https://app.getcontractornow.com/contractor
  - [ ] https://app.getcontractornow.com/admin
- [ ] Check Sentry for new errors
- [ ] Monitor for 15 minutes

## Emergency Rollback

If deployment fails:

1. Railway Dashboard → Deployments
2. Find last working deployment
3. Click "..." → "Redeploy"
4. If database migration failed → Restore from backup