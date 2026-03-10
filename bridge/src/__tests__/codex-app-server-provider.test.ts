import { describe, expect, it } from "vitest";
import {
  CodexAppServerSession,
  inferToolFromApprovalRequest,
  mapApprovalDecisionToResult,
  resolveDefaultCodexAppServerCommand,
  toPublicRequestId,
} from "../codex-app-server-provider.js";

describe("codex app-server provider helpers", () => {
  it("infers tool labels from approval request methods", () => {
    expect(
      inferToolFromApprovalRequest("item/commandExecution/requestApproval", {
        commandActions: [{ type: "search" }],
      }),
    ).toBe("Search");
    expect(inferToolFromApprovalRequest("item/fileChange/requestApproval", {})).toBe("Write");
    expect(inferToolFromApprovalRequest("execCommandApproval", {})).toBe("Command");
    expect(inferToolFromApprovalRequest("applyPatchApproval", {})).toBe("Write");
  });

  it("maps approve/deny/cancel to v2 approval responses", () => {
    expect(mapApprovalDecisionToResult("item/commandExecution/requestApproval", "approve")).toEqual({
      decision: "accept",
    });
    expect(mapApprovalDecisionToResult("item/commandExecution/requestApproval", "deny")).toEqual({
      decision: "decline",
    });
    expect(mapApprovalDecisionToResult("item/fileChange/requestApproval", "cancel")).toEqual({
      decision: "cancel",
    });
  });

  it("maps approve/deny/cancel to legacy approval responses", () => {
    expect(mapApprovalDecisionToResult("execCommandApproval", "approve")).toEqual({
      decision: "approved",
    });
    expect(mapApprovalDecisionToResult("execCommandApproval", "deny")).toEqual({
      decision: "denied",
    });
    expect(mapApprovalDecisionToResult("applyPatchApproval", "cancel")).toEqual({
      decision: "abort",
    });
  });

  it("prefers bundled Codex app binary path when present", () => {
    const resolved = resolveDefaultCodexAppServerCommand((path) => {
      return path === "/Applications/Codex.app/Contents/Resources/codex";
    });
    expect(resolved).toBe("/Applications/Codex.app/Contents/Resources/codex");
  });

  it("falls back to codex PATH command when bundled binary path is absent", () => {
    const resolved = resolveDefaultCodexAppServerCommand(() => false);
    expect(resolved).toBe("codex");
  });
});

describe("codex app-server session", () => {
  it("performs initialize handshake and emits initialized notification", () => {
    const outgoing: Record<string, unknown>[] = [];
    const events: Array<{ event: string; requestId: string | null }> = [];

    const session = new CodexAppServerSession({
      onOutgoingMessage: (msg) => outgoing.push(msg),
      onHookEvent: (e) => events.push({ event: e.payload.event, requestId: e.requestId }),
    });

    session.startHandshake();
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].method).toBe("initialize");

    session.ingestMessage({
      id: "decky-init",
      result: { userAgent: "test" },
    });
    expect(outgoing).toHaveLength(2);
    expect(outgoing[1]).toEqual({ method: "initialized" });
    expect(events).toHaveLength(0);
  });

  it("tracks request ids and resolves command approvals", async () => {
    const outgoing: Record<string, unknown>[] = [];
    const events: Array<{ event: string; requestId: string | null; tool?: string | undefined }> = [];

    const session = new CodexAppServerSession({
      onOutgoingMessage: (msg) => outgoing.push(msg),
      onHookEvent: (e) => events.push({ event: e.payload.event, requestId: e.requestId, tool: e.payload.tool }),
    });

    session.ingestMessage({
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: {
        itemId: "cmd-1",
        threadId: "thread-1",
        turnId: "turn-1",
        commandActions: [{ type: "search" }],
      },
    });

    const publicRequestId = toPublicRequestId(7);
    expect(events).toEqual([{ event: "PreToolUse", requestId: publicRequestId, tool: "Search" }]);
    expect(session.pendingCount()).toBe(1);

    await session.resolveApproval(publicRequestId, "approve");
    expect(outgoing[outgoing.length - 1]).toEqual({
      id: 7,
      result: { decision: "accept" },
    });

    session.ingestMessage({
      method: "serverRequest/resolved",
      params: {
        requestId: 7,
        threadId: "thread-1",
      },
    });

    expect(events[1]).toEqual({ event: "PostToolUse", requestId: publicRequestId, tool: "Search" });
    expect(session.pendingCount()).toBe(0);
  });

  it("falls back to item/completed settlement when serverRequest/resolved is missing", () => {
    const events: Array<{ event: string; requestId: string | null; tool?: string | undefined }> = [];
    const session = new CodexAppServerSession({
      onHookEvent: (e) => events.push({ event: e.payload.event, requestId: e.requestId, tool: e.payload.tool }),
    });

    session.ingestMessage({
      id: "file-approve-1",
      method: "item/fileChange/requestApproval",
      params: {
        itemId: "patch-123",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    });

    session.ingestMessage({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "patch-123",
          type: "fileChange",
          status: "completed",
        },
      },
    });

    expect(events).toEqual([
      { event: "PreToolUse", requestId: toPublicRequestId("file-approve-1"), tool: "Write" },
      { event: "PostToolUse", requestId: toPublicRequestId("file-approve-1"), tool: "Write" },
    ]);
  });
});
