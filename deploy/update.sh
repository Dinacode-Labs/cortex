#!/usr/bin/env sh
# Update this host to a specific version of Cortex.
#
#   ./update.sh 0.2.0
#
# The backup comes FIRST because going back is not symmetric: migrations only move forward, so
# if the new version migrated the schema, dropping the image back is not enough and the backup
# is the only way home.
#
# It asks for no confirmation, unlike restore.sh: nothing here destroys anything, and this is
# the step an unattended trigger is meant to call later on.
set -e

cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.yml"
TIMEOUT="${CORTEX_UPDATE_TIMEOUT:-300}"

# A published tag is vX.Y.Z and the image's is X.Y.Z; taking both saves deploying a version
# that does not exist over a typo nobody can see.
VERSION="${1#v}"
[ -n "$VERSION" ] || { echo "Usage: ./update.sh <version>    (for example: ./update.sh 0.2.0)"; exit 1; }
case "$VERSION" in
  latest)
    echo "Refusing to deploy \"latest\": a restart would change version without anybody having decided to."
    echo "Pass the exact version:  ./update.sh 0.2.0"
    exit 1
    ;;
  [0-9]*) ;;
  *)
    echo "\"$VERSION\" does not look like a version. Pass a published one:  ./update.sh 0.2.0"
    exit 1
    ;;
esac

[ -f ./.env ] || { echo "deploy/.env is missing: this does not look like a deployed host."; exit 1; }
command -v curl > /dev/null 2>&1 || { echo "curl is missing, and the update would go unverified without it."; exit 1; }

# Only the keys that are needed get read. Doing `. ./.env` would blow up: there are values
# with unquoted spaces (the worker's cron expression, for one).
env_get() { sed -n "s/^$1=//p" ./.env | tail -1 | tr -d '\r'; }
DOMAIN="$(env_get CORTEX_DOMAIN)"
PREVIOUS="$(env_get CORTEX_VERSION)"
# With no CORTEX_VERSION the compose falls back to `latest`, which is what the host is really on.
PREVIOUS="${PREVIOUS:-latest, unpinned}"
[ -n "$DOMAIN" ] || { echo "CORTEX_DOMAIN is missing from deploy/.env"; exit 1; }

abort() {
  echo ""
  echo "✗ $1"
  echo "  The host is untouched, still on $PREVIOUS."
  exit 1
}

fail() {
  echo ""
  echo "✗ The update did NOT finish: $1"
  echo ""
  echo "  This host is somewhere between $PREVIOUS and $VERSION. To see where:"
  echo "    docker compose -f deploy/docker-compose.yml ps"
  echo "    docker compose -f deploy/docker-compose.yml logs --tail=50 server"
  echo ""
  echo "  Going back is not symmetric: putting the image back on $PREVIOUS is enough ONLY if"
  echo "  $VERSION did not migrate the schema. If it did, restore the backup from this run:"
  echo "    ./deploy/restore.sh <backup.sql.gz>"
  exit 1
}

# Rewritten through a temporary and copied BACK over the file, never moved onto it: a `mv`
# would leave the .env with the temporary's owner and permissions, and it holds the database
# password.
pin_version() {
  TMP="$(mktemp)"
  if grep -q '^CORTEX_VERSION=' ./.env; then
    awk -v v="$1" '/^CORTEX_VERSION=/ { print "CORTEX_VERSION=" v; next } { print }' ./.env > "$TMP"
  else
    { cat ./.env; echo "CORTEX_VERSION=$1"; } > "$TMP"
  fi
  cat "$TMP" > ./.env
  rm -f "$TMP"
}

service_health() {
  CID="$($COMPOSE ps -q "$1" 2>/dev/null | head -1 || true)"
  [ -n "$CID" ] || { echo "missing"; return 0; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CID" 2>/dev/null || echo "missing"
}

wait_healthy() {
  WAITED=0
  while :; do
    PENDING=""
    for SVC in $SERVICES; do
      case "$(service_health "$SVC")" in
        healthy|running) ;;
        *) PENDING="$PENDING $SVC" ;;
      esac
    done
    [ -n "$PENDING" ] || return 0
    if [ "$WAITED" -ge "$TIMEOUT" ]; then
      echo "  after ${TIMEOUT}s these are still not healthy:$PENDING"
      return 1
    fi
    sleep 5
    WAITED=$((WAITED + 5))
  done
}

# Every app answers /health, so a 200 on its own does not say whether Caddy is still routing
# each path to the service it belongs to. The name in the body does.
check_url() {
  case "$(curl -fsS --max-time 15 "$1" || true)" in
    *"$2"*) echo "  ✓ $3" ;;
    *) fail "$3 does not answer at $1" ;;
  esac
}

echo "Updating this host: $PREVIOUS → $VERSION"

echo "→ Backing up before touching anything"
./backup-now.sh || abort "The backup failed, and updating without one is how a bad migration becomes permanent."

echo "→ Pulling $VERSION"
CORTEX_VERSION="$VERSION" $COMPOSE pull || abort "The $VERSION image could not be pulled. Does that version exist? Is a 'docker login ghcr.io' needed?"

echo "→ Pinning CORTEX_VERSION=$VERSION in deploy/.env"
pin_version "$VERSION"

echo "→ Starting (the migrate service runs first and the rest wait for it)"
$COMPOSE up -d || fail "the services did not start"

# migrate is left out: it runs once and exits. Asking compose instead of hardcoding the list
# means a service added tomorrow gets waited for too.
SERVICES="$($COMPOSE config --services | grep -v '^migrate$')" || fail "the compose file could not be read"

echo "→ Waiting for every service to be healthy (up to ${TIMEOUT}s)"
wait_healthy || fail "a service never became healthy"

echo "→ Checking that the host answers at https://$DOMAIN"
check_url "https://$DOMAIN/api/health" '"service":"cortex-server"' "the API (/api/health)"
check_url "https://$DOMAIN/health" '"service":"cortex-web"' "the UI (/health)"
MCP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/mcp" || true)"
# 401 is the healthy answer: the MCP is alive and asking for authentication.
[ "$MCP_CODE" = "401" ] || fail "the MCP answers $MCP_CODE at https://$DOMAIN/mcp, where a live one answers 401"
echo "  ✓ the MCP (/mcp answers 401)"

echo ""
echo "✓ Updated: $PREVIOUS → $VERSION, and the host answers."
echo "  The backup taken before the update is in the cortex-deploy_cortex-backups volume."
