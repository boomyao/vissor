#!/usr/bin/env bash
set -uo pipefail

# Probes the running vissor and restarts it if the app is wedged.
# Restart=always only catches a process that exits; this catches the
# case the process is alive but /api/health reports a dead dependency
# or stops answering entirely.
#
# Set VISSOR_ALERT_WEBHOOK to POST a JSON alert somewhere. Left unset,
# it only writes to the journal, which is still greppable after the
# fact.

PORT="${PORT:-9999}"
UNIT="${VISSOR_UNIT:-vissor.service}"
STATE="${XDG_RUNTIME_DIR:-/tmp}/vissor-health.state"
URL="http://127.0.0.1:$PORT/api/health"

notify() {
  local status="$1" detail="$2"
  logger -t vissor-health "$status: $detail" 2>/dev/null || true
  echo "[vissor-health] $status: $detail"
  if [[ -n "${VISSOR_ALERT_WEBHOOK:-}" ]]; then
    curl -fsS -m 10 -X POST "$VISSOR_ALERT_WEBHOOK" \
      -H 'Content-Type: application/json' \
      -d "$(printf '{"service":"vissor","status":"%s","detail":"%s","host":"%s"}' \
            "$status" "${detail//\"/\\\"}" "$(hostname)")" >/dev/null || true
  fi
}

BODY="$(curl -fsS -m 10 "$URL" 2>/dev/null)"
RC=$?
PREV="$(cat "$STATE" 2>/dev/null || echo ok)"

if [[ $RC -eq 0 && "$BODY" == *'"ok":true'* ]]; then
  [[ "$PREV" != "ok" ]] && notify recovered "health is green again"
  echo ok > "$STATE"
  exit 0
fi

DETAIL="${BODY:-no response from $URL (curl rc=$RC)}"

if [[ "$PREV" == "restarted" ]]; then
  # Already restarted once for this outage and it did not help — stop
  # bouncing the service and leave it for a human.
  notify still-down "$DETAIL"
  exit 1
fi

notify down "$DETAIL — restarting $UNIT"
echo restarted > "$STATE"
systemctl --user restart "$UNIT"

sleep 15
BODY2="$(curl -fsS -m 10 "$URL" 2>/dev/null)"
if [[ "$BODY2" == *'"ok":true'* ]]; then
  notify recovered "restart fixed it"
  echo ok > "$STATE"
  exit 0
fi

notify still-down "restart did not help: ${BODY2:-no response}"
exit 1
