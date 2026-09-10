#!/usr/bin/env sh
# Copia de seguridad inmediata, además de la diaria. Útil antes de una migración grande.
set -e
cd "$(dirname "$0")"
docker compose -f docker-compose.yml exec backup /backup.sh
echo "✓ Hecha. Está en el volumen cortex-deploy_cortex-backups; sácala del host:"
echo "  docker compose -f deploy/docker-compose.yml cp backup:/backups ./backups-copia"
