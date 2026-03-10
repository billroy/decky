# Stream Deck Live Monitor

## Purpose
Capture a synchronized artifact bundle while reproducing Stream Deck behavior:
- UI screenshots over time
- bridge `/status` snapshots
- bridge `/config` snapshots
- run metadata (`branch`, `head sha`, timing)

This script is intended as a durable debugging tool for render/propagation regressions.

## Script
`scripts/streamdeck-live-monitor.sh`

## Requirements
- macOS
- `screencapture` (built-in)
- `curl`
- `git`
- Optional: Accessibility permission if using `--window-only` capture mode

## Usage
```bash
scripts/streamdeck-live-monitor.sh --duration 120 --interval 2 --tag color-prop
```

Window-only capture (preferred for focused evidence):
```bash
scripts/streamdeck-live-monitor.sh --window-only --activate --duration 180 --interval 2 --tag window
```

## Output
By default, artifacts are stored under:
`docs/debug/streamdeck-live/<timestamp>-<tag>/`

Files include:
- `meta.json`
- `timeline.txt`
- `summary.json`
- `screens/*.png`
- `bridge/*-status.json`
- `bridge/*-config.json`

## Notes
- The script does **not** modify configuration.
- If `/status` or `/config` is unavailable, error JSON is written per tick.
- `--window-only` falls back to full-screen capture if window id lookup fails.
