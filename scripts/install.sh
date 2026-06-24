#!/usr/bin/env sh
# Instalador del toolbelt + CLI de Dinacode Cortex (macOS / Linux / WSL).
#   curl -fsSL <servidor>/install.sh | sh
# Clona/actualiza el repo, instala el CLI `cortex` + hooks + toolbelt en tus agentes,
# e inicia sesión (email + OTP). Variables: CORTEX_REPO, CORTEX_HOME, CORTEX_SERVER_URL.
set -e

REPO_URL="${CORTEX_REPO:-git@github.com:Dinacode-Labs/cortex.git}"
DEST="${CORTEX_HOME:-$HOME/.dinacode-cortex}"
SERVER_URL="${CORTEX_SERVER_URL:-__CORTEX_SERVER_URL__}"

say() { printf '\033[36m→ %s\033[0m\n' "$1"; }

command -v git  >/dev/null 2>&1 || { echo "Falta 'git'."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Falta Node ≥ 20. Instálalo y reintenta."; exit 1; }
if ! command -v pnpm >/dev/null 2>&1; then
  say "Instalando pnpm (corepack)…"; corepack enable >/dev/null 2>&1 || npm i -g pnpm >/dev/null 2>&1
fi

if [ -d "$DEST/.git" ]; then
  say "Actualizando $DEST"; git -C "$DEST" pull --ff-only --quiet || true
else
  say "Clonando en $DEST"; git clone --quiet "$REPO_URL" "$DEST"
fi

cd "$DEST"
say "Instalando dependencias…"; pnpm install --silent
say "Instalando CLI + toolbelt + hooks en tus agentes…"; CORTEX_SERVER_URL="$SERVER_URL" pnpm cortex:sync --apply >/dev/null

CORTEX="$HOME/.local/bin/cortex"
if [ -e /dev/tty ] && [ -x "$CORTEX" ]; then
  say "Inicia sesión (email corporativo + código):"
  CORTEX_SERVER_URL="$SERVER_URL" "$CORTEX" auth login < /dev/tty || true
fi

printf '\033[32m✓ Cortex instalado.\033[0m\n'
echo "  cortex link --create \"Mi Proyecto\"   vincular esta carpeta"
echo "  cortex ui                             abrir la UI"
echo "  cortex --help                         todos los comandos"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "  ⚠ añade ~/.local/bin al PATH: export PATH=\"\$HOME/.local/bin:\$PATH\"";; esac
