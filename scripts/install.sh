#!/usr/bin/env sh
# Instalador de Cortex (macOS / Linux / WSL):
#
#   curl -fsSL <servidor>/install.sh | sh
#
# Instala el CLI desde npm, inicia sesión (email + código) y configura tus agentes.
# No clona nada ni deja claves en tu equipo: la destilación corre en el servidor.
#
# Variables: CORTEX_SERVER_URL (a qué servidor), CORTEX_NPM_PACKAGE (paquete a instalar),
# CORTEX_SKIP_SETUP=1 (no tocar la configuración de los agentes).
set -e

SERVER_URL="${CORTEX_SERVER_URL:-__CORTEX_SERVER_URL__}"
# Se usa tal cual: así CORTEX_NPM_PACKAGE puede ser otra versión, un tag o un tarball local.
PKG="${CORTEX_NPM_PACKAGE:-@dinacodelabs/cortex@latest}"

say()  { printf '\033[36m→ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- Node --------------------------------------------------------------------
# No lo instalamos por ti: meter una versión de Node en el equipo de alguien por detrás es
# la clase de cosa que rompe otros proyectos suyos.
need_node() {
  printf '\033[31m✗ Cortex necesita Node.js 20 o superior.\033[0m\n' >&2
  echo "  Instálalo de una de estas formas y vuelve a ejecutar esto:" >&2
  echo "    brew install node          (macOS)" >&2
  echo "    fnm install --lts          (o nvm, si ya lo usas)" >&2
  echo "    https://nodejs.org/" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || need_node
MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$MAJOR" -ge 20 ] 2>/dev/null || need_node
command -v npm >/dev/null 2>&1 || fail "Tienes Node pero no npm. Reinstala Node e inténtalo otra vez."

# --- CLI ---------------------------------------------------------------------
say "Instalando $PKG"
if ! npm install -g "$PKG" >/dev/null 2>&1; then
  printf '\033[31m✗ npm no ha podido instalarlo.\033[0m\n' >&2
  echo "  Si es por permisos, lo habitual es instalar en tu carpeta y no en el sistema:" >&2
  echo "    npm config set prefix ~/.npm-global" >&2
  echo '    export PATH="$HOME/.npm-global/bin:$PATH"   # añádelo a tu ~/.zshrc o ~/.bashrc' >&2
  echo "  Y repite este mismo comando." >&2
  exit 1
fi

if ! command -v cortex >/dev/null 2>&1; then
  BIN="$(npm prefix -g 2>/dev/null)/bin"
  printf '\033[31m✗ `cortex` no está en tu PATH.\033[0m\n' >&2
  echo "  Se ha instalado en $BIN. Añádelo:" >&2
  echo "    export PATH=\"$BIN:\$PATH\"   # añádelo a tu ~/.zshrc o ~/.bashrc" >&2
  exit 1
fi
say "CLI: $(cortex --version)"

# --- Sesión ------------------------------------------------------------------
# `curl | sh` no deja stdin libre para escribir el código: se lee de la terminal. Que
# /dev/tty exista no basta (en CI y en contenedores está pero no se puede abrir), así que se
# intenta abrir de verdad antes de pedirle nada al usuario.
if (exec 3</dev/tty) 2>/dev/null; then
  say "Inicia sesión (email de trabajo + código que te llegará por correo)"
  cortex auth login --server "$SERVER_URL" < /dev/tty || true
else
  say "Sin terminal interactiva: inicia sesión luego con  cortex auth login --server $SERVER_URL"
fi

# --- Agentes -----------------------------------------------------------------
if [ "${CORTEX_SKIP_SETUP:-}" = "1" ]; then
  say "Configuración de agentes omitida (CORTEX_SKIP_SETUP=1)"
else
  say "Configurando tus agentes"
  cortex setup --all || true
fi

printf '\033[32m✓ Cortex instalado.\033[0m\n'
echo "  cortex link --create \"Mi Proyecto\"  vincular esta carpeta a un proyecto"
echo "  cortex doctor                       comprobar que todo está en su sitio"
echo "  cortex --help                       todos los comandos"
