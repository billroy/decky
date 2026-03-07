/**
 * Macro executor — injects text into Claude.app via AppleScript.
 *
 * Strategy: copy text to clipboard, activate Claude, paste with Cmd+V.
 * This is more reliable than keystroke-by-keystroke injection and works
 * regardless of special characters in the macro text.
 */

import { execFile } from "node:child_process";

/**
 * Inject text into Claude.app by copying to clipboard and pasting.
 * Returns a promise that resolves when the AppleScript completes.
 */
export function executeMacro(text: string): Promise<void> {
  // Use pbcopy + AppleScript for reliable injection:
  // 1. Copy text to clipboard via pbcopy (handles all characters safely)
  // 2. Activate Claude.app
  // 3. Paste with Cmd+V
  // 4. Press Return to send
  const script = `
    tell application "Claude" to activate
    delay 0.2
    tell application "System Events"
      keystroke "v" using command down
      delay 0.1
      keystroke return
    end tell
  `;

  return new Promise((resolve, reject) => {
    // First, copy text to clipboard
    const pbcopy = execFile("pbcopy", (err) => {
      if (err) {
        console.error("[macro] pbcopy failed:", err.message);
        reject(err);
        return;
      }

      // Then run AppleScript to paste
      execFile("osascript", ["-e", script], (asErr) => {
        if (asErr) {
          console.error("[macro] AppleScript failed:", asErr.message);
          reject(asErr);
          return;
        }
        console.log(`[macro] injected: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`);
        resolve();
      });
    });

    pbcopy.stdin?.write(text);
    pbcopy.stdin?.end();
  });
}
