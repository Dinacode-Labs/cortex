#!/usr/bin/env sh
# Restore a Cortex backup.
#
#   ./restore.sh <backup.sql.gz>                     ← DESTRUCTIVE: replaces the real database
#   ./restore.sh <backup.sql.gz> --target-db <name>  ← drill: restores into another database
#
# The drill is the one to run every month. A backup that has never been restored is not a
# backup, it is a file.
set -e

cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.yml"
BACKUP="$1"
[ -n "$BACKUP" ] || { echo "Usage: ./restore.sh <backup.sql.gz> [--target-db <name>]"; exit 1; }
[ -f "$BACKUP" ] || { echo "No such file: $BACKUP"; exit 1; }

TARGET=""
[ "$2" = "--target-db" ] && TARGET="$3"

[ -f ./.env ] || { echo "deploy/.env is missing"; exit 1; }
# Only the two keys that are needed get read. Doing `. ./.env` would blow up: there are
# values with unquoted spaces (the worker's cron expression, for one).
env_get() { sed -n "s/^$1=//p" ./.env | tail -1 | tr -d '\r'; }
PGUSER="$(env_get POSTGRES_USER)"; PGUSER="${PGUSER:-cortex}"
SRCDB="$(env_get POSTGRES_DB)"; SRCDB="${SRCDB:-cortex}"
DB="${TARGET:-$SRCDB}"
psql_run() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER" "$@"; }

if [ -z "$TARGET" ]; then
  echo "⚠️  This DELETES the database \"$DB\" and replaces it with $BACKUP."
  echo "    The services will be stopped during the restore."
  printf 'Type exactly "restore" to continue: '
  read -r ANSWER < /dev/tty
  [ "$ANSWER" = "restore" ] || { echo "Cancelled."; exit 1; }
  echo "→ Stopping the services that write"
  $COMPOSE stop server web mcp worker
fi

echo "→ Recreating the \"$DB\" database"
psql_run -d postgres -c "DROP DATABASE IF EXISTS \"$DB\";"
psql_run -d postgres -c "CREATE DATABASE \"$DB\" OWNER \"$PGUSER\";"
# pgvector has to exist BEFORE loading the dump: the vector columns would fail otherwise.
psql_run -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "→ Loading the dump"
gunzip -c "$BACKUP" | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$DB" > /dev/null

if [ -n "$TARGET" ]; then
  echo "→ Drill: the \"$DB\" database is restored next to the real one."
  psql_run -d "$DB" -c "select count(*) as entries from context_entries;"
  echo "  Once you have checked it:  docker compose -f deploy/docker-compose.yml exec postgres dropdb -U $PGUSER $DB"
  exit 0
fi

echo "→ Applying migrations (the dump may come from an older version)"
$COMPOSE run --rm migrate
echo "→ Starting the services"
$COMPOSE up -d server web mcp worker
echo "✓ Restored."
