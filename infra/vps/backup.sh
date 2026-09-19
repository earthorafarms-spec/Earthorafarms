#!/usr/bin/env bash
# Nightly Earthora Postgres backup — pg_dump (custom format) + 30-day retention.
set -euo pipefail
DIR=/opt/earthora/backups
TS=$(date +%Y%m%d-%H%M%S)
docker exec earthora-postgres pg_dump -U earthora -d earthora -Fc -f /backups/earthora-$TS.dump
find "$DIR" -name 'earthora-*.dump' -mtime +30 -delete
echo "$(date -Is) backup ok: earthora-$TS.dump ($(du -h "$DIR/earthora-$TS.dump" | cut -f1))" >> "$DIR/backup.log"
