1. Setup
- Pull latest `codex/todo34-stability` changes.
- Rebuild plugin: `cd /Users/bill/aistuff/decky/plugin && npm run build`.
- Restart Stream Deck app, then restart bridge (`./start.sh` or your usual bridge command).
- Open a Decky Slot PI and confirm PI build stamp is visible.
COMMENT: confirmed PI build: 2026-03-08.0845

2. Widget Macro Support
- In PI, select a macro and set `Type = Widget`.
- Set `Widget = Bridge status`.
- Set `Refresh = On click`, Apply changes.
- Expected: key renders widget-style status card; pressing key refreshes widget.
- Change to `Refresh = Interval` and set minutes (for example `1`), Apply.
- Expected: widget refreshes automatically on interval.
COMMENT: working

3. Command Macro `Submit` Flag
- Select a command macro.
- Toggle `Submit` off, set text to `/help`, Apply.
- Press key.
- Expected: text is pasted into target app input but Return is not pressed.
- Toggle `Submit` on, Apply, press key again.
- Expected: text is pasted and Return is pressed.
COMMENT: working

4. Claude Utility Actions
- Add `Approve Once (Claude)` to a key from the Stream Deck **Actions list** (not by editing a Decky Slot macro).
COMMENT: this is where I made my mistake testing first time
UPDATE: Dragging an Approve Once(Claude) item from the button list to a button results in a button with Approve Once in a white type with black outline (perhaps the setTitle issue again).  There is a big round green circle in it.  Clicking it does not bring up the PI; the PI area remains blank.  Same behavior for Talk to Claude and Bridge Status and Approve.  All the new button types seem to have an issue loading on drag/drop.

- Put bridge in `awaiting-approval` state (tool request pending), press key.
- Expected: approval is sent and state transitions like approve.
COMMENT: This is not working as expected.  clicking a button with "approve once action" checked and "talk to claude action" unchecked with the name set to APPROVE and nothing in the command text.  The submit box is checked.
Bridge log: [io] action received: {"action":"macro","text":"[redacted:0]","targetApp":"claude","submit":true}
The app switch to claude does not happen.  Nothing happens.
COMMENT: I think we have a major disconnect on the intended appearance and PI functionality for these new item types.  I expected they would be stylable in exactly the same way as the other widgets.  Full PI for all the attributes.  Maybe even an integrated/unified PI.  Instead these widgets are not stylable at all.  the entire proposition of the app is to make nice looking things by customizing to personal taste.  This breaks that principle.  Instead they do not even participate in theme based styling, they have no PI to adjust the style, and the default appearance is at complete odds with the rest of the buttons. Review how this happened and propose a functional and implentation plan to address the disconnect.
- Add `Talk to Claude` to a key from the Stream Deck **Actions list** (not by editing a Decky Slot macro), press it.
- Expected: Claude activates and dictation command is triggered from app menu.
COMMENT: Similar failure to Approve Once.  Approve Once unchecked, Talk to Claude Action checked, nothing in prompt text box.  Click the button does nothing.

5. Utility Action Guardrails (PI Settings)
- In PI Settings, uncheck `Approve once action`, Apply.
- Press `Approve Once (Claude)` key during awaiting-approval.
- Expected: action is blocked (no approval effect).
- Uncheck `Talk to Claude action`, Apply.
- Press `Talk to Claude` key.
- Expected: no dictation action is sent.
- Re-enable both toggles and verify actions work again.
COMMENT: Blocked pending resolution of 4

6. Theme Stability Regression Checks
- Set theme to `Random`, apply with a strategy.
- Change only icon/label on one macro, click `Apply now`.
- Expected: random distribution does not reseed.
- Repeat with `Rainbow`.
- Expected: same behavior, no reseed on normal apply.
COMMENT: working

7. Badge/Provider Behavior
- For non-default provider macros, enable `Target badge`, Apply.
- Expected: badge appears on those macros.
- Set provider back to default (Claude), Apply.
- Expected: badge disappears for default-provider macros.
COMMENT: working

8. PI Save/Apply Basics
- Change any editable field and confirm `Apply now` enables.
- Apply and verify status transitions to applied.
- Reopen PI on another key and confirm edited values persist.
COMMENT: working
