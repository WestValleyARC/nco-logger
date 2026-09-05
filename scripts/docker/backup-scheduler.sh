#!/bin/sh
set -eu

interval="${NCO_BACKUP_INTERVAL_SECONDS:-900}"
retention="${NCO_BACKUP_RETENTION_DAYS:-30}"
case "$interval" in *[!0-9]*|'') echo 'NCO_BACKUP_INTERVAL_SECONDS must be an integer' >&2; exit 2;; esac
case "$retention" in *[!0-9]*|'') echo 'NCO_BACKUP_RETENTION_DAYS must be an integer' >&2; exit 2;; esac
if [ "$interval" -lt 300 ]; then echo 'Backup interval must be at least 300 seconds' >&2; exit 2; fi

while :; do
    set -- backup --production --require-uploads
    if [ -n "${NCO_BACKUP_S3_BUCKET:-}" ]; then
        set -- "$@" --s3-bucket "$NCO_BACKUP_S3_BUCKET" --s3-prefix "${NCO_BACKUP_S3_PREFIX:-hamlive}"
    else
        echo 'WARNING: no off-host backup destination is configured' >&2
    fi
    node /app/server/dist/bin/dbBackup.js "$@"
    node /app/server/dist/bin/dbBackup.js prune --dir "${HAMLIVE_BACKUP_DIR:-/backups}" --keep-days "$retention" --yes
    sleep "$interval"
done
