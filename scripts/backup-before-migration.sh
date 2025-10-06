#!/bin/bash

# Pre-migration backup script
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backups/pre-migration-$DATE.sql"

echo "Creating pre-migration backup..."

# Create backups directory if it doesn't exist
mkdir -p backups

# Export database
railway run -- pg_dump $DATABASE_URL > $BACKUP_FILE

if [ $? -eq 0 ]; then
    echo "✅ Backup created: $BACKUP_FILE"
    
    # Compress backup
    gzip $BACKUP_FILE
    echo "✅ Backup compressed: $BACKUP_FILE.gz"
    
    # Get file size
    SIZE=$(du -h "$BACKUP_FILE.gz" | cut -f1)
    echo "📦 Backup size: $SIZE"
    
    echo ""
    echo "You can now safely run: npx prisma migrate deploy"
else
    echo "❌ Backup failed!"
    exit 1
fi