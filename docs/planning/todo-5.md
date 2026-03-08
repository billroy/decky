# TODO 5 Execution Notes

This file incorporates review comments and tracks implementation status.

## Comment integration and decisions

1) Restore 13-button config
- Comment integrated: prior config loss incidents were caused by test-side writes.
- Decision: implement config backup rotation + restore endpoint/script to make recovery deterministic.

2) Default config in file vs code
- Comment integrated: evaluate easier editing.
- Decision: defer extraction to separate repo file in this tranche to avoid schema drift risk during active refactors.

3) Layout brittleness + different Stream Deck dimensions
- Comment integrated: dimension-aware handling is required.
- Decision: use physical slot index mapping from Stream Deck coordinates (`row * columns + column`) to stabilize behavior across layouts.

4) Preview drag/drop swap
- Comment integrated: hold for now.
- Decision: deferred in this tranche.

5) Two PI files
- Decision: keep current runtime path and enforce synchronization with automated check in CI.

6) Untracked files
- Comment integrated: do not include logs/test artifacts.
- Decision: expand `.gitignore` for runtime/test outputs.

7) Backup rotation
- Comment integrated: use `0..9`.
- Decision: implemented as `config.json.bak.0..9`, rotated on save.
- Comment integrated: defer adding extra PI diagnostics pane.

8/9) PI clarity and naming
- Decision: apply naming/scope updates now with visual scope chips; deeper panel redesign can iterate later.

10) New themes
- Decision: implement Candy Cane, Gradient Blue, Wormhole.

11) Command dropdown audit
- Decision: keep currently supported actions and add/expand test coverage in this tranche.

12) README overhaul
- Decision: update README last in this tranche.

## Phase status

- Phase 1 safety/hygiene: completed
- Phase 2 PI clarity/naming: completed
- Phase 3 slot model hardening: completed (drag/swap preview explicitly deferred)
- Phase 4 themes + action audit: completed
- Phase 5 README + docs: completed
