# MongoDB Backup & Disaster Recovery Strategy

## 1. Automated Nightly Backups (MongoDB Atlas)
- **Continuous Backups**: Point-in-time recovery (PITR) with 7-day retention.
- **Daily Snapshots**: Automated daily snapshots retained for 30 days.

## 2. Self-Hosted `mongodump` Automation Script
Run daily via cron job at 02:00 AM UTC:

```bash
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/khatavala/mongo_$TIMESTAMP"

mkdir -p "$BACKUP_DIR"
mongodump --uri="$MONGO_URI" --gzip --out="$BACKUP_DIR"

# Upload to AWS S3 / Cloud Storage
aws s3 sync "$BACKUP_DIR" s3://khatavala-backups/daily/

# Retention: purge local backups older than 7 days
find /var/backups/khatavala/ -type d -mtime +7 -exec rm -rf {} +
```
