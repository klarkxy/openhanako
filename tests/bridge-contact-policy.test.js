import { describe, expect, it } from "vitest";
import {
  BRIDGE_RELATIONS,
  DEFAULT_BRIDGE_RELATION_POLICIES,
  normalizeBridgeRelation,
  bridgeRelationLabel,
  getDefaultBridgeRelationPolicy,
  getEffectiveBridgeRelationPolicy,
  buildBridgeAudiencePrompt,
} from "../lib/bridge/contacts/policy.js";

describe("bridge contact policy", () => {
  it("defines all four relations", () => {
    expect(BRIDGE_RELATIONS).toEqual(["self", "family", "friend", "stranger"]);
  });

  it("normalizes known relations", () => {
    expect(normalizeBridgeRelation("self")).toBe("self");
    expect(normalizeBridgeRelation("family")).toBe("family");
    expect(normalizeBridgeRelation("friend")).toBe("friend");
    expect(normalizeBridgeRelation("stranger")).toBe("stranger");
  });

  it("normalizes unknown/invalid relations to stranger", () => {
    expect(normalizeBridgeRelation("boss")).toBe("stranger");
    expect(normalizeBridgeRelation("")).toBe("stranger");
    expect(normalizeBridgeRelation(null)).toBe("stranger");
    expect(normalizeBridgeRelation(undefined)).toBe("stranger");
    expect(normalizeBridgeRelation(123)).toBe("stranger");
  });

  it("returns labels in zh and en", () => {
    expect(bridgeRelationLabel("friend", "zh")).toBe("朋友");
    expect(bridgeRelationLabel("friend", "en")).toBe("friend");
    expect(bridgeRelationLabel("family", "zh")).toBe("家人");
    expect(bridgeRelationLabel("stranger", "en")).toBe("stranger");
    expect(bridgeRelationLabel("self", "zh")).toBe("自己");
  });

  it("self policy has full access", () => {
    const policy = getDefaultBridgeRelationPolicy("self");
    expect(policy).toMatchObject({
      hostPermissionMode: "operate",
      workspaceAccess: "operate",
      infoDisclosure: "full_workspace_context",
      allowWorkspaceActions: true,
      allowWorkSummary: true,
      allowPrivateState: true,
    });
  });

  it("stranger policy has minimal access", () => {
    const policy = getDefaultBridgeRelationPolicy("stranger");
    expect(policy).toMatchObject({
      hostPermissionMode: "social_greeting_only",
      workspaceAccess: "none",
      infoDisclosure: "greeting_only",
      allowWorkspaceActions: false,
      allowWorkSummary: false,
      allowPrivateState: false,
    });
  });

  it("friend policy has limited access", () => {
    const policy = getDefaultBridgeRelationPolicy("friend");
    expect(policy.hostPermissionMode).toBe("social_readonly");
    expect(policy.workspaceAccess).toBe("none");
    expect(policy.allowWorkspaceActions).toBe(false);
    expect(policy.allowWorkSummary).toBe(true);
  });

  it("family policy has broad access", () => {
    const policy = getDefaultBridgeRelationPolicy("family");
    expect(policy.hostPermissionMode).toBe("operate");
    expect(policy.workspaceAccess).toBe("operate");
    expect(policy.allowWorkspaceActions).toBe(true);
  });

  it("getEffectiveBridgeRelationPolicy merges overrides", () => {
    const policy = getEffectiveBridgeRelationPolicy("friend", {
      hostPermissionMode: "operate",
      audiencePrompt: "custom prompt",
    });
    expect(policy.hostPermissionMode).toBe("operate");
    expect(policy.audiencePrompt).toBe("custom prompt");
    expect(policy.workspaceAccess).toBe("none"); // base value preserved
  });

  it("getEffectiveBridgeRelationPolicy ignores null/empty overrides", () => {
    const base = getDefaultBridgeRelationPolicy("friend");
    const policy = getEffectiveBridgeRelationPolicy("friend", {
      hostPermissionMode: null,
      workspaceAccess: "",
      infoDisclosure: undefined,
    });
    expect(policy.hostPermissionMode).toBe(base.hostPermissionMode);
    expect(policy.workspaceAccess).toBe(base.workspaceAccess);
  });
});

describe("buildBridgeAudiencePrompt", () => {
  it("returns empty for self relation", () => {
    const prompt = buildBridgeAudiencePrompt({ relation: "self" });
    expect(prompt).toBe("");
  });

  it("builds family prompt with warmer tone", () => {
    const prompt = buildBridgeAudiencePrompt({ relation: "family" });
    expect(prompt).toContain("family");
    expect(prompt).toContain("warmer");
  });

  it("builds friend prompt with limited disclosure", () => {
    const prompt = buildBridgeAudiencePrompt({ relation: "friend" });
    expect(prompt).toContain("friend");
    expect(prompt).toContain("Do not reveal");
  });

  it("builds stranger prompt with minimal disclosure", () => {
    const prompt = buildBridgeAudiencePrompt({ relation: "stranger" });
    expect(prompt).toContain("stranger");
    expect(prompt).toContain("greeting");
  });

  it("includes custom audience prompt", () => {
    const prompt = buildBridgeAudiencePrompt({
      relation: "friend",
      policy: { audiencePrompt: "Custom note for this friend" },
    });
    expect(prompt).toContain("Custom note for this friend");
  });

  it("includes sender name when provided", () => {
    const prompt = buildBridgeAudiencePrompt({
      relation: "stranger",
      senderName: "Alice",
    });
    expect(prompt).toContain("Alice");
  });

  it("adds group chat note for group messages", () => {
    const prompt = buildBridgeAudiencePrompt({
      relation: "friend",
      isGroup: true,
    });
    expect(prompt).toContain("group chat");
  });

  it("adds refusal hint for stranger pressing for details", () => {
    const prompt = buildBridgeAudiencePrompt({
      relation: "stranger",
      policy: { infoDisclosure: "greeting_only" },
    });
    expect(prompt).toContain("refuse");
  });
});
