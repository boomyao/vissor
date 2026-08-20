#!/usr/bin/env bash
set -euo pipefail

# Deploys vissor on the host it runs on (boomyao-iron). Order matters:
# the systemd unit only runs the server, and @fastify/static registers
# one route per file at boot, so the web bundle must be rebuilt BEFORE
# the restart or the freshly hashed assets 404 until the next one.

cd "$(dirname "$0")/.."
REPO="$(pwd)"
UNIT="${VISSOR_UNIT:-vissor.service}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mdeploy failed:\033[0m %s\n' "$*" >&2; exit 1; }

DIRTY="$(git status --porcelain --untracked-files=no 2>/dev/null || true)"
if [[ -n "$DIRTY" ]]; then
  printf '%s\n' "$DIRTY"
  die "tracked files are modified. Commit or stash them first — a pull would clobber the changes."
fi

log "pulling"
git pull --ff-only

log "installing dependencies"
bun install --frozen-lockfile

log "typechecking"
bun run typecheck || die "typecheck failed; not restarting the running service"

log "building web bundle"
bun run build:web || die "web build failed; not restarting the running service"
[[ -f "$REPO/apps/web/dist/index.html" ]] || die "apps/web/dist/index.html missing after build"

log "restarting $UNIT"
systemctl --user restart "$UNIT"

log "waiting for health"
PORT="${PORT:-9999}"
for i in $(seq 1 30); do
  BODY="$(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  if [[ "$BODY" == *'"ok":true'* ]]; then
    log "healthy: $BODY"
    log "deployed $(git log --oneline -1)"
    exit 0
  fi
  sleep 1
done

printf '\033[1;31mservice did not report healthy within 30s\033[0m\n' >&2
[[ -n "${BODY:-}" ]] && printf 'last health response: %s\n' "$BODY" >&2
systemctl --user status "$UNIT" --no-pager | head -20 >&2
exit 1
