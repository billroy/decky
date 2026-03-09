import { describe, expect, it } from "vitest";
import {
  CodexMonitor,
  inferToolLabelFromToolCallMessage,
  parseCodexAppServerEvent,
  type CodexLogRow,
} from "../codex-monitor.js";
import type { HookPayload } from "../state-machine.js";

function row(id: number, target: string, message: string): CodexLogRow {
  return { id, target, message };
}

describe("codex monitor parsing", () => {
  it("parses codex app-server event names", () => {
    expect(parseCodexAppServerEvent("app-server event: codex/event/exec_approval_request")).toBe(
      "codex/event/exec_approval_request",
    );
    expect(parseCodexAppServerEvent("bad message")).toBeNull();
  });

  it("infers user-facing tool labels from tool-call logs", () => {
    expect(inferToolLabelFromToolCallMessage("ToolCall: exec_command {\"cmd\":\"ls\"}")).toBe(
      "Command",
    );
    expect(inferToolLabelFromToolCallMessage("ToolCall: apply_patch *** Begin Patch")).toBe(
      "Write",
    );
    expect(inferToolLabelFromToolCallMessage("ToolCall: startDictationForClaude {}")).toBe(
      "StartDictationForClaude",
    );
    expect(inferToolLabelFromToolCallMessage("nope")).toBeNull();
  });
});

describe("codex monitor event mapping", () => {
  it("maps approval request and command end to hook payloads", () => {
    const emitted: HookPayload[] = [];
    const monitor = new CodexMonitor({
      dbPath: "/does/not/matter.sqlite",
      onHookEvent: (payload) => emitted.push(payload),
    });

    monitor.ingestLogRow(row(1, "codex_core::stream_events_utils", "ToolCall: exec_command {\"cmd\":\"ls\"}"));
    monitor.ingestLogRow(row(2, "codex_app_server::codex_message_processor", "app-server event: codex/event/exec_approval_request"));
    monitor.ingestLogRow(row(3, "codex_app_server::codex_message_processor", "app-server event: codex/event/exec_command_end"));

    expect(emitted).toEqual([
      { event: "PreToolUse", tool: "Command" },
      { event: "PostToolUse", tool: "Command" },
    ]);
  });

  it("deduplicates repeated approval requests while pending", () => {
    const emitted: HookPayload[] = [];
    const monitor = new CodexMonitor({
      dbPath: "/does/not/matter.sqlite",
      onHookEvent: (payload) => emitted.push(payload),
    });

    monitor.ingestLogRow(row(1, "codex_core::stream_events_utils", "ToolCall: apply_patch *** Begin Patch"));
    monitor.ingestLogRow(row(2, "codex_app_server::codex_message_processor", "app-server event: codex/event/apply_patch_approval_request"));
    monitor.ingestLogRow(row(3, "codex_app_server::codex_message_processor", "app-server event: codex/event/apply_patch_approval_request"));
    monitor.ingestLogRow(row(4, "codex_app_server::codex_message_processor", "app-server event: codex/event/item_completed"));

    expect(emitted).toEqual([
      { event: "PreToolUse", tool: "Write" },
      { event: "PostToolUse", tool: "Write" },
    ]);
  });

  it("maps task completion to stop", () => {
    const emitted: HookPayload[] = [];
    const monitor = new CodexMonitor({
      dbPath: "/does/not/matter.sqlite",
      onHookEvent: (payload) => emitted.push(payload),
    });

    monitor.ingestLogRow(row(1, "codex_app_server::codex_message_processor", "app-server event: codex/event/task_complete"));

    expect(emitted).toEqual([{ event: "Stop" }]);
  });
});
