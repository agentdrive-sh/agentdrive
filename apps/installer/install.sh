#!/bin/sh
# AgentDrive installer. Cross-agent artifact workspace with provenance.
# Review before piping to sh: curl -fsSL agentdrive.sh/install | less
set -eu

PKG_NAME="@adrive/cli"
BIN_NAME="adrive"
NODE_MIN_MAJOR=22
# The CLI imports zlib zstd, which landed in Node 22.15.
NODE_MIN_MINOR=15
DOCS_URL="https://agentdrive.sh/docs"

if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_RESET="$(tput sgr0)"
  C_BOLD="$(tput bold)"
  C_DIM="$(tput dim)"
  C_RED="$(tput setaf 1)"
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_BLUE="$(tput setaf 4)"
else
  C_RESET=""
  C_BOLD=""
  C_DIM=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_BLUE=""
fi

log() { printf '%s%s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
info() { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
ok() { printf '%sok%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
warn() { printf '%swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2; }
err() { printf '%serror%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }
hint() { printf '%s     %s%s\n' "$C_DIM" "$1" "$C_RESET" >&2; }

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    err "install aborted (exit $status)"
    hint "manual fallback: npm install -g $PKG_NAME && $BIN_NAME init"
    hint "docs: $DOCS_URL"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

detect_platform() {
  os_raw="$(uname -s)"
  arch_raw="$(uname -m)"
  case "$os_raw" in
    Darwin) OS="darwin" ;;
    Linux) OS="linux" ;;
    *) err "unsupported OS: $os_raw"; hint "AgentDrive CLI supports macOS and Linux"; exit 1 ;;
  esac
  case "$arch_raw" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64|amd64) ARCH="x64" ;;
    *) err "unsupported architecture: $arch_raw"; exit 1 ;;
  esac
}

node_version_ok() {
  major="${1%%.*}"
  rest="${1#*.}"
  [ "$rest" != "$1" ] || return 1
  minor="${rest%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$minor" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -gt "$NODE_MIN_MAJOR" ] || { [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]; }
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    err "Node.js is not installed"
    case "$OS" in
      darwin)
        hint "install with Homebrew: brew install node"
        hint "or download: https://nodejs.org/en/download"
        ;;
      linux)
        hint "Debian/Ubuntu: sudo apt-get install -y nodejs npm"
        hint "Fedora: sudo dnf install -y nodejs"
        hint "Arch: sudo pacman -S nodejs npm"
        hint "or use nvm: https://github.com/nvm-sh/nvm"
        ;;
    esac
    exit 1
  fi

  node_version="$(node --version 2>/dev/null | sed 's/^v//')"
  if ! node_version_ok "$node_version"; then
    err "Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer required (found ${node_version:-unknown})"
    hint "upgrade Node and re-run this installer"
    exit 1
  fi
  ok "Node.js $node_version"
}

pnpm_ready() {
  command -v pnpm >/dev/null 2>&1 || return 1
  # pnpm refuses global installs unless PNPM_HOME (or global-bin-dir) is set
  # and resolves to a real, writable directory. `pnpm bin -g` is the cheapest
  # way to check both at once.
  pnpm_bin_dir="$(pnpm bin -g 2>/dev/null || true)"
  [ -n "$pnpm_bin_dir" ] && [ -d "$pnpm_bin_dir" ]
}

pick_pm() {
  # Prefer npm — it works out of the box with every Node install. Use pnpm
  # only if the user has already configured PNPM_HOME and a global bin dir,
  # which is the case for serious pnpm users but rare otherwise.
  if command -v npm >/dev/null 2>&1; then
    PM="npm"
    PM_INSTALL="npm install -g"
  elif pnpm_ready; then
    PM="pnpm"
    PM_INSTALL="pnpm add -g"
  elif command -v yarn >/dev/null 2>&1; then
    PM="yarn"
    PM_INSTALL="yarn global add"
  elif command -v pnpm >/dev/null 2>&1; then
    err "pnpm is installed but its global bin directory is not configured"
    hint "run 'pnpm setup' then restart your shell, or install npm:"
    hint "  https://nodejs.org/en/download"
    exit 1
  else
    err "no package manager found (need npm, pnpm, or yarn)"
    hint "install npm with Node.js: https://nodejs.org/en/download"
    exit 1
  fi
  ok "package manager: $PM"
}

needs_sudo() {
  if [ "$PM" = "npm" ] && [ -z "${PREFIX:-}" ]; then
    npm_prefix="$(npm config get prefix 2>/dev/null || echo '')"
    if [ -n "$npm_prefix" ] && [ ! -w "$npm_prefix" ] && [ "$(id -u)" -ne 0 ]; then
      return 0
    fi
  fi
  return 1
}

install_cli() {
  info "installing $PKG_NAME with $PM"
  if needs_sudo; then
    warn "global npm prefix is not writable; sudo is required"
    hint "if you prefer not to use sudo, set up an npm prefix in your home dir:"
    hint "  npm config set prefix \"\$HOME/.npm-global\""
    hint "  export PATH=\"\$HOME/.npm-global/bin:\$PATH\""
    printf 'continue with sudo? [y/N] '
    read -r reply </dev/tty || reply=""
    case "$reply" in
      [yY]|[yY][eE][sS])
        sudo $PM_INSTALL "$PKG_NAME"
        ;;
      *)
        err "install canceled"
        exit 1
        ;;
    esac
  else
    $PM_INSTALL "$PKG_NAME"
  fi
  ok "$PKG_NAME installed"
}

verify_bin() {
  if ! command -v "$BIN_NAME" >/dev/null 2>&1; then
    err "$BIN_NAME was installed but is not on your PATH"
    hint "find install location: $PM root -g (or npm root -g)"
    hint "add the parent bin/ directory to PATH and re-run: $BIN_NAME init"
    exit 1
  fi
  ok "$BIN_NAME on PATH: $(command -v "$BIN_NAME")"
}

privacy_preamble() {
  printf '\n'
  log "Your agent workspace"
  printf '%sSave artifacts, provenance, and context so the next agent can pick up the work.%s\n' "$C_DIM" "$C_RESET"
  printf '%sNext, log in once in your browser; every installed agent tool is then connected. Change what gets captured with %sadrive privacy%s.%s\n' "$C_DIM" "$C_BOLD" "$C_RESET$C_DIM" "$C_RESET"
  printf '\n'
}

run_init() {
  # Under `curl | sh` stdin is the script itself, so prompts read from the
  # terminal directly. The subshell probe catches a /dev/tty node that exists
  # but cannot be opened (no controlling terminal, e.g. CI).
  if [ -r /dev/tty ] && (: </dev/tty) 2>/dev/null; then
    info "running '$BIN_NAME init'"
    privacy_preamble
    "$BIN_NAME" init </dev/tty
  else
    warn "no terminal available; skipping '$BIN_NAME init'"
    hint "finish setup later: $BIN_NAME init"
  fi
}

print_next_steps() {
  printf '\n'
  log "AgentDrive is ready"
  printf '%s  Start a session in Claude Code, Codex, OpenCode, Gemini CLI, Cursor, or Antigravity; it is captured in the background.%s\n' "$C_DIM" "$C_RESET"
  printf '%s  %s privacy%s         change what gets shared\n' "$C_DIM" "$BIN_NAME" "$C_RESET"
  printf '%s  %s watch%s           capture artifacts your agents produce\n' "$C_DIM" "$BIN_NAME" "$C_RESET"
  printf '%s  %s resume --list%s   sessions from every harness in this project\n' "$C_DIM" "$BIN_NAME" "$C_RESET"
  printf '%s  docs: %s%s\n' "$C_DIM" "$DOCS_URL" "$C_RESET"
  printf '\n'
}

main() {
  log "AgentDrive installer"
  detect_platform
  ok "platform: $OS/$ARCH"
  check_node
  pick_pm
  install_cli
  verify_bin
  run_init
  print_next_steps
}

main "$@"
