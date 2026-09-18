#!/usr/bin/env sh
# Cortex installer (macOS / Linux / WSL):
#
#   curl -fsSL <server>/install.sh | sh
#
# It installs the CLI from npm, signs you in (email + code) and configures your agents.
# It clones nothing and leaves no keys on your machine: distillation runs on the server.
#
# Variables: CORTEX_SERVER_URL (which server), CORTEX_NPM_PACKAGE (package to install),
# CORTEX_SKIP_SETUP=1 (do not touch the agents' configuration).
set -e

SERVER_URL="${CORTEX_SERVER_URL:-__CORTEX_SERVER_URL__}"
# Used as is: that way CORTEX_NPM_PACKAGE can be another version, a tag or a local tarball.
PKG="${CORTEX_NPM_PACKAGE:-@dinacodelabs/cortex@latest}"

say()  { printf '\033[36m→ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- Node --------------------------------------------------------------------
# We do not install it for you: putting a version of Node on somebody's machine behind their
# back is the kind of thing that breaks their other projects.
need_node() {
  printf '\033[31m✗ Cortex needs Node.js 20 or newer.\033[0m\n' >&2
  echo "  Install it one of these ways and run this again:" >&2
  echo "    brew install node          (macOS)" >&2
  echo "    fnm install --lts          (or nvm, if that is what you use)" >&2
  echo "    https://nodejs.org/" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || need_node
MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$MAJOR" -ge 20 ] 2>/dev/null || need_node
command -v npm >/dev/null 2>&1 || fail "You have Node but not npm. Reinstall Node and try again."

# --- CLI ---------------------------------------------------------------------
say "Installing $PKG"
# npm's output is kept rather than thrown away: it used to be silenced and permissions always
# blamed, so a non-existent package or a registry outage sent people off to reconfigure their
# npm for nothing. npm's error says which of the three it is.
LOG_NPM="$(mktemp)"
if ! npm install -g "$PKG" >"$LOG_NPM" 2>&1; then
  printf '\033[31m✗ npm could not install %s.\033[0m\n' "$PKG" >&2
  if grep -qE "E404|404 Not Found" "$LOG_NPM"; then
    echo "  The registry says that package does not exist." >&2
    echo "  If Cortex is not published yet, ask whoever runs the server how to install it" >&2
    echo "  in the meantime. If you are testing another package, pass it in CORTEX_NPM_PACKAGE." >&2
  elif grep -qE "EACCES|EPERM|permission denied" "$LOG_NPM"; then
    echo "  This is a permissions problem. The usual fix is installing into your own folder" >&2
    echo "  rather than the system:" >&2
    echo "    npm config set prefix ~/.npm-global" >&2
    echo '    export PATH="$HOME/.npm-global/bin:$PATH"   # add it to your ~/.zshrc or ~/.bashrc' >&2
    echo "  Then run this same command again." >&2
  elif grep -qE "ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network" "$LOG_NPM"; then
    echo "  The npm registry could not be reached. Are you online? Is there a proxy in the way?" >&2
  else
    echo "  This is what npm said:" >&2
    tail -n 6 "$LOG_NPM" | sed 's/^/    /' >&2
  fi
  rm -f "$LOG_NPM"
  exit 1
fi
rm -f "$LOG_NPM"

if ! command -v cortex >/dev/null 2>&1; then
  BIN="$(npm prefix -g 2>/dev/null)/bin"
  printf '\033[31m✗ `cortex` is not on your PATH.\033[0m\n' >&2
  echo "  It was installed in $BIN. Add it:" >&2
  echo "    export PATH=\"$BIN:\$PATH\"   # add it to your ~/.zshrc or ~/.bashrc" >&2
  exit 1
fi
say "CLI: $(cortex --version)"

# --- Session -----------------------------------------------------------------
# `curl | sh` leaves no free stdin for typing the code: it is read from the terminal. /dev/tty
# existing is not enough (in CI and in containers it is there but cannot be opened), so we
# really try to open it before asking the user for anything.
if (exec 3</dev/tty) 2>/dev/null; then
  say "Sign in (work email + the code you will get by email)"
  cortex auth login --server "$SERVER_URL" < /dev/tty || true
else
  say "No interactive terminal: sign in later with  cortex auth login --server $SERVER_URL"
fi

# --- Agents ------------------------------------------------------------------
if [ "${CORTEX_SKIP_SETUP:-}" = "1" ]; then
  say "Agent configuration skipped (CORTEX_SKIP_SETUP=1)"
else
  say "Configuring your agents"
  cortex setup --all || true
fi

printf '\033[32m✓ Cortex installed.\033[0m\n'
echo "  cortex link --create \"My Project\"   link this folder to a project"
echo "  cortex doctor                       check that everything is in place"
echo "  cortex --help                       every command"
