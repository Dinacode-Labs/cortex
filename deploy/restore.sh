#!/usr/bin/env sh
# Restaurar una copia de seguridad de Cortex.
#
#   ./restore.sh <backup.sql.gz>                       ← DESTRUCTIVO: reemplaza la base real
#   ./restore.sh <backup.sql.gz> --target-db <nombre>  ← simulacro: restaura a otra base
#
# El simulacro es el que hay que ejecutar todos los meses. Una copia que nunca se ha
# restaurado no es una copia, es un fichero.
set -e

cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.yml"
BACKUP="$1"
[ -n "$BACKUP" ] || { echo "Uso: ./restore.sh <backup.sql.gz> [--target-db <nombre>]"; exit 1; }
[ -f "$BACKUP" ] || { echo "No existe el fichero: $BACKUP"; exit 1; }

TARGET=""
[ "$2" = "--target-db" ] && TARGET="$3"

[ -f ./.env ] || { echo "Falta deploy/.env"; exit 1; }
# Se leen solo las dos claves que hacen falta. Hacer `. ./.env` reventaría: hay valores con
# espacios sin comillas (la expresión cron del worker, sin ir más lejos).
env_get() { sed -n "s/^$1=//p" ./.env | tail -1 | tr -d '\r'; }
PGUSER="$(env_get POSTGRES_USER)"; PGUSER="${PGUSER:-cortex}"
SRCDB="$(env_get POSTGRES_DB)"; SRCDB="${SRCDB:-cortex}"
DB="${TARGET:-$SRCDB}"
psql_run() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER" "$@"; }

if [ -z "$TARGET" ]; then
  echo "⚠️  Esto BORRA la base de datos \"$DB\" y la reemplaza por $BACKUP."
  echo "    Los servicios se pararán durante la restauración."
  printf 'Escribe exactamente "restore" para continuar: '
  read -r ANSWER < /dev/tty
  [ "$ANSWER" = "restore" ] || { echo "Cancelado."; exit 1; }
  echo "→ Parando los servicios que escriben"
  $COMPOSE stop server web mcp worker
fi

echo "→ Recreando la base \"$DB\""
psql_run -d postgres -c "DROP DATABASE IF EXISTS \"$DB\";"
psql_run -d postgres -c "CREATE DATABASE \"$DB\" OWNER \"$PGUSER\";"
# pgvector tiene que existir ANTES de cargar el volcado: las columnas vector fallarían.
psql_run -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "→ Cargando el volcado"
gunzip -c "$BACKUP" | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$DB" > /dev/null

if [ -n "$TARGET" ]; then
  echo "→ Simulacro: la base \"$DB\" queda restaurada al lado de la real."
  psql_run -d "$DB" -c "select count(*) as entradas from context_entries;"
  echo "  Cuando lo hayas comprobado:  docker compose -f deploy/docker-compose.yml exec postgres dropdb -U $PGUSER $DB"
  exit 0
fi

echo "→ Aplicando migraciones (el volcado puede ser de una versión anterior)"
$COMPOSE run --rm migrate
echo "→ Arrancando los servicios"
$COMPOSE up -d server web mcp worker
echo "✓ Restaurado."
