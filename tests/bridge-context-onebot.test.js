import { describe, expect, it } from "vitest";
import {
  buildBridgeContext,
  buildBridgePromptLine,
  appendBridgePromptLine,
  normalizeBridgePlatforms,
  bridgePlatformLabel,
  bridgeContextIndexMeta,
  BRIDGE_NOTIFY_PLATFORMS,
} from "../lib/bridge/bridge-context.js";

describe("bridge-context — OneBot integration", () => {
  it("includes onebot in BRIDGE_NOTIFY_PLATFORMS", () => {
    expect(BRIDGE_NOTIFY_PLATFORMS).toContain("onebot");
  });

  it("builds bridge context for OneBot DM session", () => {
    const ctx = buildBridgeContext({
      sessionKey: "ob_dm_12345@hana",
      platform: "onebot",
      role: "guest",
      userId: "12345",
      chatId: "12345",
      agentId: "hana",
    });

    expect(ctx).toMatchObject({
      isBridgeSession: true,
      platform: "onebot",
      platformLabel: "OneBot",
      chatType: "dm",
      role: "guest",
      relation: "stranger",
      relationLabel: "陌生人",
      userId: "12345",
      chatId: "12345",
      agentId: "hana",
    });
  });

  it("builds bridge context for OneBot group session", () => {
    const ctx = buildBridgeContext({
      sessionKey: "ob_group_99999@hana",
      platform: "onebot",
      role: "guest",
      chatType: "group",
    });

    expect(ctx.isBridgeSession).toBe(true);
    expect(ctx.chatType).toBe("group");
  });

  it("builds context for owner role with relation self", () => {
    const ctx = buildBridgeContext({
      platform: "onebot",
      role: "owner",
      userId: "owner-1",
    });

    expect(ctx.relation).toBe("self");
    expect(ctx.relationLabel).toBe("自己");
    expect(ctx.notificationHint).toMatchObject({
      channels: ["bridge_owner"],
      bridgePlatforms: ["onebot"],
    });
  });

  it("returns platform label for onebot", () => {
    expect(bridgePlatformLabel("onebot")).toBe("OneBot");
    expect(bridgePlatformLabel("onebot", "en")).toBe("OneBot");
    expect(bridgePlatformLabel("onebot", "zh")).toBe("OneBot");
  });

  it("normalizes bridge platforms including onebot", () => {
    const result = normalizeBridgePlatforms(["onebot", "telegram", "invalid"]);
    expect(result.bridgePlatforms).toEqual(["onebot", "telegram"]);
    expect(result.invalidBridgePlatforms).toEqual(["invalid"]);
  });

  it("builds prompt line for OneBot", () => {
    const ctx = buildBridgeContext({ platform: "onebot", role: "guest" });
    const line = buildBridgePromptLine(ctx);
    expect(line).toContain("OneBot");
    expect(line).toContain("platform");
  });

  it("appendBridgePromptLine adds OneBot info to prompt", () => {
    const ctx = buildBridgeContext({ platform: "onebot", role: "guest" });
    const result = appendBridgePromptLine("You are a helpful assistant.", ctx);
    expect(result).toContain("OneBot");
    expect(result).toContain("You are a helpful assistant.");
  });

  it("does not duplicate prompt line", () => {
    const ctx = buildBridgeContext({ platform: "onebot", role: "guest" });
    const line = buildBridgePromptLine(ctx);
    const result = appendBridgePromptLine(line, ctx);
    // Should not contain the line twice
    const count = result.split(line).length - 1;
    expect(count).toBe(1);
  });

  it("builds index meta for OneBot session", () => {
    const ctx = buildBridgeContext({
      platform: "onebot",
      role: "guest",
      relation: "friend",
      userId: "u1",
      chatId: "c1",
    });
    const meta = bridgeContextIndexMeta(ctx, { extra: "data" });
    expect(meta).toMatchObject({
      platform: "onebot",
      chatType: "dm",
      role: "guest",
      relation: "friend",
      userId: "u1",
      chatId: "c1",
      extra: "data",
    });
  });
});

describe("bridge-context — all platforms", () => {
  it("returns non-bridge session for unknown platform", () => {
    const ctx = buildBridgeContext({ platform: "slack" });
    expect(ctx.isBridgeSession).toBe(false);
  });

  it("returns non-bridge session when platform is missing", () => {
    const ctx = buildBridgeContext({});
    expect(ctx.isBridgeSession).toBe(false);
  });

  it("builds context from sessionKey alone", () => {
    const ctx = buildBridgeContext({ sessionKey: "tg_dm_123@hana" });
    expect(ctx).toMatchObject({
      isBridgeSession: true,
      platform: "telegram",
      chatType: "dm",
    });
  });

  it("all platforms have labels", () => {
    for (const platform of BRIDGE_NOTIFY_PLATFORMS) {
      expect(bridgePlatformLabel(platform)).toBeTruthy();
      expect(bridgePlatformLabel(platform, "en")).toBeTruthy();
    }
  });
});
