#!/usr/bin/env sh
# An immediate backup, on top of the daily one. Useful before a large migration.
set -e
cd "$(dirname "$0")"
docker compose -f docker-compose.yml exec backup /backup.sh
echo "✓ Done. It is in the cortex-deploy_cortex-backups volume; pull it out of the host with:"
echo "  docker compose -f deploy/docker-compose.yml cp backup:/backups ./backups-copy"
