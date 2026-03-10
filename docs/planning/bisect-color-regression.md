# Bisect Color Regression Script

## Goal
Automate the commit hunt for the regression where global/per-macro color changes fail to propagate across all active Stream Deck Slot keys.

## Script
`scripts/bisect-color-regression.sh`

## What It Does
For each bisect commit:
1. Runs a build command
2. Optionally runs a restart command
3. Runs `scripts/streamdeck-live-monitor.sh` to capture screenshots + bridge snapshots
4. Classifies the commit as:
   - `good`
   - `bad`
   - `skip`
5. Advances `git bisect` until first bad commit (or ambiguous final set)

The script stores all run artifacts under:
`docs/debug/bisect-color/<timestamp>-<tag>/`

## Modes

### 1) Interactive (default)
You manually choose `good/bad/skip` after each commit run.

Example:
```bash
scripts/bisect-color-regression.sh \
  --good f25e6b0 \
  --bad da52cf0 \
  --restart-cmd "streamdeck restart com.decky.controller"
```

### 2) Oracle (optional)
Provide `--oracle-cmd` that returns:
- `0` = good
- `1` = bad
- `125` = skip

Example:
```bash
scripts/bisect-color-regression.sh \
  --good f25e6b0 \
  --bad da52cf0 \
  --oracle-cmd "./scripts/oracle-color-propagation.sh"
```

## Safety Notes
- Repo-scoped only.
- Writes artifacts to `docs/debug/bisect-color/`.
- Restores bisect state and checks out original ref on exit.
- Requires clean worktree by default (override with `--no-clean-check`).
