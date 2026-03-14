/**
 * Encoder action — Stream Deck+ dial/touch-strip support.
 *
 * Each dial shows:
 *  - Touch strip: state label + pending count (awaiting-approval)
 *  - Indicator bar: approval countdown progress
 *  - Dial press: approve (when awaiting-approval)
 *  - Dial rotation: cycle queue preview (when pending > 1)
 *  - Press+rotate: cycle through themes (saved on release)
 */

import {
  action,
  SingletonAction,
  type DialDownEvent,
  type DialRotateEvent,
  type DialUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { DialAction, FeedbackPayload } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { BridgeClient, StateSnapshot } from "../bridge-client.js";
import { THEME_LIST } from "../layouts.js";


let bridgeRef: BridgeClient | null = null;
let lastSnapshot: StateSnapshot | null = null;
let previewOffset = 0; // rotation-driven queue preview index

// Theme cycling state (press+rotate)
let pendingTheme: string | null = null;  // non-null while press-rotating
let originalTheme: string | null = null; // theme when press started

function stateLabel(snapshot: StateSnapshot): string {
  switch (snapshot.state) {
    case "idle":          return "Idle";
    case "thinking":      return "Thinking…";
    case "tool-executing": return "Executing";
    case "awaiting-approval": return "Approve?";
    case "asking":        return "Question";
    case "done":          return "Done ✓";
    case "stopped":       return "Stopped";
    default:              return snapshot.state;
  }
}

function buildFeedback(snapshot: StateSnapshot, previewIdx: number): FeedbackPayload {
  const approval = snapshot.approval;
  const pending = approval?.pending ?? 0;

  // Value line: tool name + count, or empty
  let value = "";
  let indicator = 0;

  if (snapshot.state === "awaiting-approval" && approval) {
    const displayIdx = previewIdx % Math.max(pending, 1);
    const countLabel = pending > 1 ? ` (${displayIdx + 1}/${pending})` : "";
    value = `${snapshot.tool ?? "Tool"}${countLabel}`;
    // Indicator: no timing data available — show half-filled as default
    indicator = 50;
  }

  return {
    title: stateLabel(snapshot),
    value,
    indicator,
  };
}

function buildThemeFeedback(themeName: string): FeedbackPayload {
  return {
    title: themeName,
    value: "Theme",
    indicator: 0,
  };
}

async function refreshAllDials(snapshot: StateSnapshot): Promise<void> {
  const acts = [...(encoderInstance?.actions ?? [])];
  for (const act of acts) {
    const dialAct = act as DialAction<JsonObject>;
    try {
      await dialAct.setFeedbackLayout("layouts/encoder.json");
      await dialAct.setFeedback(buildFeedback(snapshot, previewOffset));
    } catch {
      // SDK may throw if the dial disappeared mid-render; safe to ignore.
    }
  }
}

async function showThemeOnDials(themeName: string): Promise<void> {
  const acts = [...(encoderInstance?.actions ?? [])];
  for (const act of acts) {
    const dialAct = act as DialAction<JsonObject>;
    try {
      await dialAct.setFeedback(buildThemeFeedback(themeName));
    } catch {
      // SDK may throw if the dial disappeared mid-render; safe to ignore.
    }
  }
}

let encoderInstance: EncoderAction | null = null;

@action({ UUID: "com.decky.controller.encoder" })
export class EncoderAction extends SingletonAction {
  constructor() {
    super();
    encoderInstance = this; // eslint-disable-line @typescript-eslint/no-this-alias
  }

  override onWillAppear(ev: WillAppearEvent): void {
    if (lastSnapshot) {
      const dial = ev.action as DialAction<JsonObject>;
      dial.setFeedbackLayout("layouts/encoder.json")
        .then(() => dial.setFeedback(buildFeedback(lastSnapshot!, previewOffset)))
        .catch(() => {});
    }
  }

  override onWillDisappear(_ev: WillDisappearEvent): void {
    // Nothing to clean up per-dial
  }

  override onDialDown(_ev: DialDownEvent): void {
    if (lastSnapshot?.state === "awaiting-approval") {
      bridgeRef?.sendAction("approve");
      previewOffset = 0;
    }
  }

  override onDialUp(_ev: DialUpEvent): void {
    if (pendingTheme != null && pendingTheme !== originalTheme) {
      // Single save: send final theme to bridge
      bridgeRef?.sendAction("updateConfig", { theme: pendingTheme });
    }
    if (pendingTheme != null && lastSnapshot) {
      // Restore normal encoder feedback after theme cycling
      void refreshAllDials(lastSnapshot);
    }
    pendingTheme = null;
    originalTheme = null;
  }

  override onDialRotate(ev: DialRotateEvent): void {
    if (ev.payload.pressed) {
      // Press+rotate: cycle themes locally (saved on dial up)
      this.cycleThemePreview(ev.payload.ticks);
      return;
    }

    // Plain rotate: existing queue preview logic
    const pending = lastSnapshot?.approval?.pending ?? 0;
    if (pending > 1) {
      previewOffset = Math.min(
        Math.max(0, previewOffset + ev.payload.ticks),
        pending - 1,
      );
      if (lastSnapshot) {
        void refreshAllDials(lastSnapshot);
      }
    }
  }

  private cycleThemePreview(ticks: number): void {
    // Determine current theme to cycle from
    const currentTheme = pendingTheme
      ?? bridgeRef?.getLastConfig()?.theme
      ?? "dark";

    // Record original theme on first tick of a press+rotate gesture
    if (originalTheme == null) {
      originalTheme = currentTheme;
    }

    const currentIdx = THEME_LIST.indexOf(currentTheme as typeof THEME_LIST[number]);
    const idx = currentIdx < 0 ? 0 : currentIdx;
    const next = ((idx + ticks) % THEME_LIST.length + THEME_LIST.length) % THEME_LIST.length;
    const newTheme = THEME_LIST[next];

    pendingTheme = newTheme;

    // Patch the cached config and fire config listeners — this triggers
    // SlotAction.renderAll() through the existing onConfigChange pipeline,
    // giving instant visual feedback on all key buttons without a bridge round-trip.
    bridgeRef?.patchLocalConfig({ theme: newTheme });

    // Show theme name on encoder touch strip
    void showThemeOnDials(newTheme);
  }
}

/** Called from plugin.ts after bridge is connected. */
export function initEncoderStateListener(client: BridgeClient): void {
  bridgeRef = client;
  client.onStateChange((snapshot) => {
    lastSnapshot = snapshot;
    previewOffset = 0; // reset preview on state change
    void refreshAllDials(snapshot);
  });
}

// Re-export for testing
export { buildFeedback, stateLabel, buildThemeFeedback };
