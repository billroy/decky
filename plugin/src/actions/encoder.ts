/**
 * Encoder action — Stream Deck+ dial/touch-strip support.
 *
 * Each dial shows:
 *  - Touch strip: state label + pending count (awaiting-approval) or rate-limit % (idle)
 *  - Indicator bar: approval countdown progress or rate-limit fill
 *  - Dial press: approve (when awaiting-approval)
 *  - Dial rotation: cycle queue preview (when pending > 1)
 */

import {
  action,
  SingletonAction,
  type DialDownEvent,
  type DialRotateEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { DialAction, FeedbackPayload } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { BridgeClient, StateSnapshot } from "../bridge-client.js";


let bridgeRef: BridgeClient | null = null;
let lastSnapshot: StateSnapshot | null = null;
let previewOffset = 0; // rotation-driven queue preview index

export function setEncoderClient(client: BridgeClient): void {
  bridgeRef = client;
}

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

function rateLimitColor(percent: number): string {
  if (percent >= 85) return "#ef4444"; // red
  if (percent >= 60) return "#f59e0b"; // amber
  return "#22c55e"; // green
}

function buildFeedback(snapshot: StateSnapshot, previewIdx: number): FeedbackPayload {
  const approval = snapshot.approval;
  const pending = approval?.pending ?? 0;

  // Value line: tool name + count, or rate-limit info, or empty
  let value = "";
  let indicator = 0;

  if (snapshot.state === "awaiting-approval" && approval) {
    const displayIdx = previewIdx % Math.max(pending, 1);
    const countLabel = pending > 1 ? ` (${displayIdx + 1}/${pending})` : "";
    value = `${snapshot.tool ?? "Tool"}${countLabel}`;
    // Indicator: no timing data available — show half-filled as default
    indicator = 50;
  } else {
    const rl = snapshot.rateLimit;
    if (rl && rl.percentUsed != null) {
      value = `${Math.round(rl.percentUsed)}% used`;
      indicator = Math.round(rl.percentUsed);
    }
  }

  return {
    title: stateLabel(snapshot),
    value,
    indicator,
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

let encoderInstance: EncoderAction | null = null;

@action({ UUID: "com.decky.controller.encoder" })
export class EncoderAction extends SingletonAction {
  constructor() {
    super();
    encoderInstance = this;
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

  override onDialDown(ev: DialDownEvent): void {
    if (lastSnapshot?.state === "awaiting-approval") {
      bridgeRef?.sendAction("approve");
      previewOffset = 0;
    }
    void ev; // suppress unused warning
  }

  override onDialRotate(ev: DialRotateEvent): void {
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
export { buildFeedback, stateLabel, rateLimitColor };
