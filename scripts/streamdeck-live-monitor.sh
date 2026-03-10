#!/usr/bin/env bash
set -euo pipefail

# Stream Deck live monitor for Decky debugging.
# Captures synchronized screenshots + bridge snapshots over time.
#
# Scope/safety:
# - Writes only inside this repo (default: docs/debug/streamdeck-live/<timestamp>)
# - Does not search arbitrary filesystem paths
# - Uses optional UI automation only when explicitly enabled

SCRIPT_NAME="$(basename "$0")"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DURATION_SEC=120
INTERVAL_SEC=2
OUT_BASE="${ROOT_DIR}/docs/debug/streamdeck-live"
BRIDGE_URL="http://localhost:9130"
WINDOW_ONLY=0
ACTIVATE_STREAMDECK=0
TAG=""

print_help() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [options]

Capture Stream Deck screenshots and bridge snapshots in a timestamped run folder.

Options:
  --duration <sec>      Total monitor duration (default: ${DURATION_SEC})
  --interval <sec>      Capture interval (default: ${INTERVAL_SEC})
  --out-base <dir>      Base output dir (default: ${OUT_BASE})
  --bridge-url <url>    Bridge URL (default: ${BRIDGE_URL})
  --window-only         Capture Stream Deck window only (requires Accessibility)
  --activate            Bring Stream Deck to front before capture
  --tag <name>          Optional tag appended to run directory name
  -h, --help            Show this help

Examples:
  ${SCRIPT_NAME} --duration 90 --interval 2
  ${SCRIPT_NAME} --window-only --activate --duration 180 --tag color-propagation
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 2
  fi
}

get_streamdeck_window_id() {
  # Returns empty string on failure.
  osascript <<'APPLESCRIPT' 2>/dev/null || true
tell application "System Events"
  if not (exists process "Stream Deck") then
    return ""
  end if
  tell process "Stream Deck"
    if (count of windows) is 0 then
      return ""
    end if
    set winRef to front window
    try
      return (value of attribute "AXWindowNumber" of winRef) as string
    on error
      return ""
    end try
  end tell
end tell
APPLESCRIPT
}

capture_screen() {
  local out_png="$1"
  local mode="$2" # "full" or "window"

  if [[ "$mode" == "window" ]]; then
    local win_id
    win_id="$(get_streamdeck_window_id | tr -d '[:space:]')"
    if [[ -n "$win_id" ]]; then
      if screencapture -x -l "$win_id" "$out_png"; then
        return 0
      fi
    fi
    # Fall back to full-screen if window capture unavailable.
  fi
  screencapture -x "$out_png"
}

capture_bridge() {
  local out_json="$1"
  local endpoint="$2"
  local url="${BRIDGE_URL}${endpoint}"
  local tmp
  tmp="$(mktemp)"
  if curl -sS "$url" >"$tmp" 2>"${tmp}.err"; then
    mv "$tmp" "$out_json"
    rm -f "${tmp}.err"
  else
    {
      echo "{"
      echo "  \"error\": \"curl failed\","
      echo "  \"url\": \"${url}\","
      echo "  \"stderr\": \"$(tr '\n' ' ' <"${tmp}.err" | sed 's/"/\\"/g')\""
      echo "}"
    } >"$out_json"
    rm -f "$tmp" "${tmp}.err"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration)
      DURATION_SEC="$2"; shift 2 ;;
    --interval)
      INTERVAL_SEC="$2"; shift 2 ;;
    --out-base)
      OUT_BASE="$2"; shift 2 ;;
    --bridge-url)
      BRIDGE_URL="$2"; shift 2 ;;
    --window-only)
      WINDOW_ONLY=1; shift ;;
    --activate)
      ACTIVATE_STREAMDECK=1; shift ;;
    --tag)
      TAG="$2"; shift 2 ;;
    -h|--help)
      print_help; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      print_help
      exit 2 ;;
  esac
done

require_cmd date
require_cmd mkdir
require_cmd screencapture
require_cmd curl
require_cmd git

if ! [[ "$DURATION_SEC" =~ ^[0-9]+$ ]] || ! [[ "$INTERVAL_SEC" =~ ^[0-9]+$ ]]; then
  echo "--duration and --interval must be integers" >&2
  exit 2
fi
if (( DURATION_SEC <= 0 || INTERVAL_SEC <= 0 )); then
  echo "--duration and --interval must be > 0" >&2
  exit 2
fi

STAMP="$(date '+%Y%m%d-%H%M%S')"
RUN_NAME="${STAMP}"
if [[ -n "$TAG" ]]; then
  RUN_NAME="${RUN_NAME}-${TAG}"
fi
RUN_DIR="${OUT_BASE}/${RUN_NAME}"
mkdir -p "${RUN_DIR}/screens" "${RUN_DIR}/bridge"

if (( ACTIVATE_STREAMDECK == 1 )); then
  log "Activating Stream Deck app"
  osascript -e 'tell application "Stream Deck" to activate' || true
  sleep 1
fi

BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
HEAD_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
{
  echo "{"
  echo "  \"startedAt\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\","
  echo "  \"root\": \"${ROOT_DIR}\","
  echo "  \"branch\": \"${BRANCH}\","
  echo "  \"head\": \"${HEAD_SHA}\","
  echo "  \"durationSec\": ${DURATION_SEC},"
  echo "  \"intervalSec\": ${INTERVAL_SEC},"
  echo "  \"bridgeUrl\": \"${BRIDGE_URL}\","
  echo "  \"windowOnly\": $([[ "$WINDOW_ONLY" -eq 1 ]] && echo "true" || echo "false"),"
  echo "  \"tag\": \"${TAG}\""
  echo "}"
} > "${RUN_DIR}/meta.json"

MODE="full"
if (( WINDOW_ONLY == 1 )); then
  MODE="window"
fi

log "Starting monitor run"
log "Run dir: ${RUN_DIR}"
log "Mode: ${MODE}, duration=${DURATION_SEC}s, interval=${INTERVAL_SEC}s"

START_EPOCH="$(date +%s)"
ITER=0
while true; do
  NOW_EPOCH="$(date +%s)"
  ELAPSED=$((NOW_EPOCH - START_EPOCH))
  if (( ELAPSED > DURATION_SEC )); then
    break
  fi

  ITER=$((ITER + 1))
  TICK="$(printf '%04d' "${ITER}")"
  TS_HUMAN="$(date '+%Y-%m-%d %H:%M:%S')"

  SCREEN_PNG="${RUN_DIR}/screens/${TICK}.png"
  STATUS_JSON="${RUN_DIR}/bridge/${TICK}-status.json"
  CONFIG_JSON="${RUN_DIR}/bridge/${TICK}-config.json"

  if ! capture_screen "${SCREEN_PNG}" "${MODE}" 2>"${RUN_DIR}/screens/${TICK}.err"; then
    rm -f "${SCREEN_PNG}" || true
    {
      echo "{"
      echo "  \"error\": \"screencapture failed\","
      echo "  \"tick\": \"${TICK}\","
      echo "  \"mode\": \"${MODE}\","
      echo "  \"stderr\": \"$(tr '\n' ' ' <"${RUN_DIR}/screens/${TICK}.err" | sed 's/"/\\"/g')\""
      echo "}"
    } > "${RUN_DIR}/screens/${TICK}.json"
  fi
  capture_bridge "${STATUS_JSON}" "/status"
  capture_bridge "${CONFIG_JSON}" "/config"

  echo "${TICK} ${TS_HUMAN} ${ELAPSED}s" >> "${RUN_DIR}/timeline.txt"
  log "Captured tick=${TICK} elapsed=${ELAPSED}s"

  sleep "${INTERVAL_SEC}"
done

{
  echo "{"
  echo "  \"finishedAt\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\","
  echo "  \"ticks\": ${ITER}"
  echo "}"
} > "${RUN_DIR}/summary.json"

log "Monitor run complete. Artifacts at: ${RUN_DIR}"
