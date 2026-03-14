# Stream Deck: Interesting GitHub Projects

*Surveyed March 14, 2026 — covering the `stream-deck`, `streamdeck`, and `streamdeck-plugin` GitHub topics (452+ public repos)*

---

## Overview

The Stream Deck ecosystem on GitHub is rich and active, spanning broadcasting software, Linux drivers, smart-home integrations, flight simulation, developer tooling, and more. What follows is a curated survey of the most notable projects, organized by category.

---

## Platform Alternatives & Drivers

### [bitfocus/companion](https://github.com/bitfocus/companion) ⭐ 2.1k
**Language:** TypeScript | **Updated:** Mar 11, 2026

The crown jewel of the ecosystem. Companion turns a Stream Deck (and 100+ other compatible controllers) into a professional broadcast control surface. It supports over **700 device/software integrations** including OBS, vMix, BMD ATEM switchers, CasparCG, Panasonic cameras, PTZ heads, and HTTP/OSC endpoints. With 557 forks, 97 contributors, and 9,000+ commits, this is a mature, production-grade project used in live events and broadcast facilities worldwide. Latest release: v4.2.5.

### [nekename/OpenDeck](https://github.com/nekename/OpenDeck) ⭐ 1.4k
**Language:** Rust + Svelte | **Updated:** Mar 14, 2026

A cross-platform open-source replacement for the official Elgato software, notable for supporting **the majority of existing Elgato SDK plugins** natively. Wine integration lets macOS/Linux users run Windows-only plugins. Written in Rust for performance, with a Svelte frontend. Actively maintained with 39 releases and v2.10.0 just shipped. GPL-3.0 licensed.

### [timothycrosley/streamdeck-ui](https://github.com/timothycrosley/streamdeck-ui) ⭐ 1.3k
**Language:** Python | **Updated:** Active

The go-to Linux UI for Stream Deck. Supports Original, MK2, Mini, XL, and Pedal models. Features drag-and-drop button configuration, animated GIF icons, auto-dim, systemd integration, and import/export of settings. Fills a critical gap since Elgato provides no official Linux support.

### [muesli/deckmaster](https://github.com/muesli/deckmaster) ⭐ 291
**Language:** Go | **Updated:** May 2024

A lean, config-driven (TOML) Linux Stream Deck controller. Built-in widgets display CPU/memory usage, weather, system time, and recent X11 window titles. Actions support command execution, key emulation, clipboard pasting, and DBus calls. Good choice for tiling WM / power-user Linux setups.

### [willianrod/ODeck](https://github.com/willianrod/ODeck) ⭐ 433
**Language:** TypeScript (Electron + React) | **Updated:** Feb 2024

Turns **a smartphone into a Stream Deck** — no hardware required. Android and iOS apps pair over Wi-Fi via QR code + Socket.io. Supports shortcuts, media controls, app launching, and custom images. Cross-platform desktop component runs on Windows and macOS. MIT licensed.

---

## Core Libraries & SDKs

### [abcminiuser/python-elgato-streamdeck](https://github.com/abcminiuser/python-elgato-streamdeck) ⭐ 1.1k
**Language:** Python | **Updated:** Dec 2025

The foundational Python library for programmatic Stream Deck control — no Elgato app required. Supports all current hardware generations (Original, Mini, XL, Plus, Studio, Neo, Pedal, and modular units). MIT licensed with published protocol docs. The right starting point for any Python-based custom integration.

### [elgatosf/streamdeck](https://github.com/elgatosf/streamdeck) ⭐ 218
**Language:** TypeScript | **Updated:** Mar 13, 2026

The **official Elgato Stream Deck SDK**. Node.js/TypeScript-based plugin framework with a CLI for scaffolding, bundling, and hot-reload debugging. 243 dependents on npm, 166 commits, actively maintained by Elgato. The authoritative starting point for anyone building a plugin for the official store.

### [BarRaider/streamdeck-tools](https://github.com/BarRaider/streamdeck-tools) ⭐ 532
**Language:** C# | **Updated:** Mar 7, 2026

The de-facto .NET/C# wrapper for Stream Deck plugin development. Abstracts the WebSocket communication layer so developers focus on plugin logic rather than protocol details. Widely used across the C# plugin ecosystem and actively maintained.

### [nicowillis/node-elgato-stream-deck](https://github.com/nicowillis/node-elgato-stream-deck) ⭐ 193
**Language:** TypeScript | **Updated:** Mar 10, 2026

Node.js library for direct hardware access, independent of the Elgato app. Good companion to the official SDK when you want lower-level device control in JavaScript.

---

## Smart Home & Automation

### [cgiesche/streamdeck-homeassistant](https://github.com/cgiesche/streamdeck-homeassistant) ⭐ 1k
**Language:** Vue + JavaScript | **Updated:** Mar 13, 2026

The most-starred Home Assistant integration. Supports generic entity control via Jinja2/nunjucks templating, service calls on press/long-press, and entity-specific icons for lights, sensors, weather, vacuum robots, and more. Available on the official Stream Deck store. 41 releases, 11 contributors.

### [ChrisRegado/streamdeck-googlemeet](https://github.com/ChrisRegado/streamdeck-googlemeet) ⭐ 386
**Language:** Python + JavaScript | **Updated:** Mar 1, 2026

Control Google Meet mic and camera from a Stream Deck button, with **real-time bidirectional state sync** — the button reflects the actual mute status. Works via a paired Chrome/Firefox browser extension communicating over WebSocket. Actively maintained with v1.6.2 just released. Practical for anyone on frequent video calls.

---

## Flight Simulation & Gaming

### [nguyenquyhy/Flight-Tracker-StreamDeck](https://github.com/nguyenquyhy/Flight-Tracker-StreamDeck) ⭐ 416
**Language:** C# | **Updated:** Jan 2025

Stream Deck plugin for Microsoft Flight Simulator 2020. Read and write simulator variables (LVAR, AVAR, KVAR), trigger commands, display instrument values on buttons. One of the most comprehensive MSFS integrations available.

### [Fragtality/PilotsDeck](https://github.com/Fragtality/PilotsDeck) ⭐ 173
**Language:** C# | **Updated:** Mar 12, 2026

An advanced alternative to Flight-Tracker-StreamDeck, supporting MSFS 2020/2024, X-Plane 11/12, and Prepar3D v5. Standout features include a built-in Lua scripting engine, dynamic display of gauges and COM radios, automatic profile switching per aircraft, and shareable `.ppp` profile packages. Targets power users and complex add-on aircraft (PMDG, Fenix, FSLabs).

### [SeriousOldMan/Simulator-Controller](https://github.com/SeriousOldMan/Simulator-Controller) ⭐ 386
**Language:** AutoHotkey + C# | **Updated:** Mar 14, 2026

The most ambitious project in the gaming space. An AI-powered sim racing suite with four named virtual crew members (Race Engineer, Strategist, Spotter, Driving Coach) backed by a hybrid rule engine and optional GPT integration. Supports ACC, Assetto Corsa, iRacing, rFactor 2, Le Mans Ultimate, and more. Stream Deck is one of several supported control surfaces. 13,000+ commits, 500+ pages of documentation, 40+ video tutorials.

### [OpenMacroBoard/StreamDeckSharp](https://github.com/OpenMacroBoard/StreamDeckSharp) ⭐ 392
**Language:** C# | **Updated:** Dec 2025

Low-level .NET library for direct Stream Deck hardware access without the Elgato app. Part of the OpenMacroBoard suite — useful when building custom C# tooling.

---

## Developer Tooling

### [nicollasricas/decks-vscode](https://github.com/nicollasricas/decks-vscode) ⭐ 163
**Language:** CSS/TypeScript | **Updated:** Dec 2022

Visual Studio Code integration — trigger VS Code commands, run tasks, and navigate editor state from Stream Deck keys. Useful for developers who want hardware shortcuts for IDE actions.

### [Aha-DEVOPS/devops-streamdeck](https://github.com/Aha-DEVOPS/devops-streamdeck) ⭐ 104
**Language:** CSS | **Updated:** Nov 2024

CI/CD status monitoring on your Stream Deck. Displays pipeline health indicators directly on buttons so build state is always visible without switching windows.

### [Corcules/KMlink](https://github.com/Corcules/KMlink) ⭐ 138
**Language:** N/A | **Updated:** 2021

Plugin to drive Keyboard Maestro macros from Stream Deck (macOS). A useful bridge for KM power users who want physical buttons triggering their automation library.

---

## Broadcast & Production

### [SuperFlyTV/SuperConductor](https://github.com/SuperFlyTV/SuperConductor) ⭐ 327
**Language:** TypeScript | **Updated:** Sep 2025

A playout client for Windows/Linux/macOS that controls CasparCG, BMD ATEM, OBS, vMix, and OSC/HTTP devices, with Stream Deck as a control surface. A lighter-weight alternative to Companion for simpler broadcast setups.

---

## Resources & Icons

### [lovely-streamdeck-icons](https://github.com/MikeBull94/lovely-streamdeck-icons) ⭐ 95
**Updated:** May 2025

Curated icon collection popular in the sim racing community, but broadly useful. Easy starting point for customizing button appearance.

---

## Summary Table

| Repo | Stars | Category | Language | Activity |
|---|---|---|---|---|
| bitfocus/companion | 2.1k | Platform | TypeScript | 🟢 Active |
| nekename/OpenDeck | 1.4k | Platform | Rust | 🟢 Active |
| timothycrosley/streamdeck-ui | 1.3k | Linux Driver | Python | 🟡 Maintained |
| abcminiuser/python-elgato-streamdeck | 1.1k | Library | Python | 🟡 Maintained |
| cgiesche/streamdeck-homeassistant | 1k | Smart Home | Vue | 🟢 Active |
| evilC/AutoHotInterception | 907 | Input | C# | 🟡 Maintained |
| BarRaider/streamdeck-tools | 532 | Library | C# | 🟢 Active |
| willianrod/ODeck | 433 | Platform | TypeScript | 🟡 Maintained |
| nguyenquyhy/Flight-Tracker-StreamDeck | 416 | Flight Sim | C# | 🟡 Maintained |
| OpenMacroBoard/StreamDeckSharp | 392 | Library | C# | 🟡 Maintained |
| ChrisRegado/streamdeck-googlemeet | 386 | Automation | Python | 🟢 Active |
| SeriousOldMan/Simulator-Controller | 386 | Gaming/AI | AutoHotkey | 🟢 Active |
| SuperFlyTV/SuperConductor | 327 | Broadcast | TypeScript | 🟡 Maintained |
| Fragtality/PilotsDeck | 173 | Flight Sim | C# | 🟢 Active |
| muesli/deckmaster | 291 | Linux Driver | Go | 🟡 Maintained |
| elgatosf/streamdeck (SDK) | 218 | SDK | TypeScript | 🟢 Active |
| node-elgato-stream-deck | 193 | Library | TypeScript | 🟢 Active |
| nicollasricas/decks-vscode | 163 | Dev Tools | TypeScript | 🔴 Archived |
| Corcules/KMlink | 138 | Automation | — | 🔴 Archived |
| devops-streamdeck | 104 | Dev Tools | CSS | 🟡 Maintained |

---

## Recommendations for Exploration

**If building a new plugin:** Start with the official [elgatosf/streamdeck](https://github.com/elgatosf/streamdeck) SDK (TypeScript) or [BarRaider/streamdeck-tools](https://github.com/BarRaider/streamdeck-tools) (C#).

**If running Linux:** [OpenDeck](https://github.com/nekename/OpenDeck) for plugin compatibility, [streamdeck-ui](https://github.com/timothycrosley/streamdeck-ui) for the simplest setup, or [deckmaster](https://github.com/muesli/deckmaster) for a config-file approach.

**If integrating with Home Assistant:** [cgiesche/streamdeck-homeassistant](https://github.com/cgiesche/streamdeck-homeassistant) is the clear choice.

**If in broadcast/live production:** [Companion](https://github.com/bitfocus/companion) is industry-standard for anything beyond basic use.

**If building custom Python automation:** [python-elgato-streamdeck](https://github.com/abcminiuser/python-elgato-streamdeck) provides the lowest-level access.

**If no hardware available:** [ODeck](https://github.com/willianrod/ODeck) converts a smartphone into a functional deck.

---

*Sources: [github.com/topics/stream-deck](https://github.com/topics/stream-deck) · [github.com/topics/streamdeck](https://github.com/topics/streamdeck) · [github.com/topics/streamdeck-plugin](https://github.com/topics/streamdeck-plugin)*
