# Decky

Decky is a Stream Deck plugin + local bridge for controlling AI coding workflows on macOS.

Primary workflow:
- drag `Decky Slot` actions onto Stream Deck keys
- configure behavior in the Property Inspector (PI)
- press hardware keys for approve/deny/cancel, macros, and utility actions

## Requirements

- macOS 13+
- Node.js 20+
- Elgato Stream Deck app 6.6+
- Claude Code hooks enabled (install script handles this)

## Install (Moderately Technical Path)

1. Clone and install.

```bash
git clone https://github.com/billroy/decky.git
cd decky
./install.sh
```

2. Start the bridge.

```bash
./start.sh
```

3. Restart Stream Deck app.

4. In Stream Deck app:
- add `Decky Slot` from Custom actions to the keys you want to use
- at minimum, drag it to every key you want Decky to control
- click each key to edit it in PI

Notes:
- Decky does not control keys unless `Decky Slot` is assigned to that key.
- Unconfigured slots intentionally render as `...` and are no-op until configured.

## Rebuild + Restart Workflow

When changing plugin/PI code:

```bash
cd plugin && npm run build
```

Then restart in this order:
1. Bridge (`./start.sh` if needed)
2. Stream Deck app

If PI controls appear stale, confirm PI build label and that plugin rebuild completed without errors.

## Architecture

Decky has two runtime components.

1. Bridge server (`bridge/`)
- receives Claude hook events
- stores config and state
- publishes updates over Socket.io

2. Stream Deck plugin (`plugin/`)
- renders key images/titles
- routes key presses to bridge actions
- hosts Property Inspector UI for configuration

## Property Inspector (PI) Guide

PI is split by scope:

1. `Global Behavior` (Global)
- theme selection and apply strategy
- approval timeout
- target badge toggle

2. `Global Appearance` (Global)
- page default background/text/icon colors
- reset page defaults / reset all overrides

3. `Selected Slot Settings` (Selected Slot)
- slot label, icon, text
- slot type (`macro`, `widget`, utility actions)
- slot target app override
- slot submit behavior
- slot-level color overrides

### Global vs Selected-slot precedence

Color resolution order:
1. theme
2. page defaults (global)
3. slot override (selected slot)

Target routing order:
1. slot `targetApp` when set
2. global default target

### Theme apply strategies

- `Keep overrides`: theme applies where no explicit overrides exist
- `Clear page defaults`: clears global colors, keeps slot overrides
- `Clear all`: clears global + slot color overrides before applying theme

### Built-in themes

- Light, Dark, Dracula, Monokai
- Solarized Dark, Solarized Light, Nord, GitHub Dark
- Candy Cane, Gradient Blue, Wormhole
- Rainbow, Random

## Slot Types and Actions

`Decky Slot` supports:

- `macro`: sends text to selected target app
- `widget`: bridge-status widget (`onClick` or interval refresh)
- utility actions:
  - `approve`
  - `deny`
  - `cancel`
  - `restart`
  - `openConfig`
  - `approveOnceInClaude`
  - `startDictationForClaude`

## Recovery and Backups

Config writes are now protected with rotation backups and atomic saves.

- Active config: `~/.decky/config.json` (or `$DECKY_HOME/config.json`)
- Backups: `config.json.bak.0` (newest) through `config.json.bak.9`

API:
- `GET /config/backups`
- `POST /config/restore` with JSON body `{ "index": 0 }`

Recovery script:

```bash
node scripts/recover-config.mjs --target-count 13
node scripts/recover-config.mjs --restore 0
```

No overwrite occurs unless `--restore` is provided.

## Development

```bash
# Bridge
cd bridge && npm run dev

# Plugin
cd plugin && npm run watch

# Tests
cd bridge && npm test
cd plugin && npm test
cd plugin && npm run test:pi
```

## REST API

- `POST /hook` - receives Claude hook events
- `GET /status` - current bridge state snapshot
- `GET /config` - current config
- `PUT /config` - save config
- `POST /config/reload` - reload config from disk
- `GET /config/backups` - list backup metadata
- `POST /config/restore` - restore backup by index

## Screenshots

Screenshots are not bundled in this repository yet. This environment cannot guarantee stable UI capture artifacts for every Stream Deck version, so this README uses a deterministic textual walkthrough instead.

## Config Appendix (Advanced)

`config.json` is managed by PI and bridge APIs. Direct edits are possible but not recommended during runtime.

Common fields:
- `macros[]`
- `approvalTimeout`
- `theme`, `themeSeed`
- `defaultTargetApp`, `showTargetBadge`
- `enableApproveOnce`, `enableDictation`
- `colors` (page defaults)

Prefer PI or API writes to preserve validation and backup rotation.

## License

MIT
