import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getBridgeContactById,
  getBridgeContactSettings,
  listBridgeContacts,
  readBridgeContactStore,
  removeBridgeContact,
  resolveBridgeAudience,
  updateBridgeContactSettings,
  upsertBridgeContact,
  writeBridgeContactStore,
} from "../lib/bridge/contacts/store.js";

let rootDir;
let agent;

describe("bridge contact store — edge cases", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-contact-edge-"));
    agent = {
      id: "hana",
      agentDir: path.join(rootDir, "agent"),
      userDir: path.join(rootDir, "user"),
    };
    fs.mkdirSync(agent.agentDir, { recursive: true });
    fs.mkdirSync(agent.userDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  // ── platform filter ────────────────────────────────────

  it("filters contacts by platform", () => {
    upsertBridgeContact(agent, {
      displayName: "Alice",
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "alice-tg" }],
    });
    upsertBridgeContact(agent, {
      displayName: "Bob",
      relation: "family",
      accounts: [{ platform: "qq", userId: "bob-qq" }],
    });

    const tgContacts = listBridgeContacts(agent, { platform: "telegram" });
    expect(tgContacts).toHaveLength(1);
    expect(tgContacts[0].displayName).toBe("Alice");

    const qqContacts = listBridgeContacts(agent, { platform: "qq" });
    expect(qqContacts).toHaveLength(1);
    expect(qqContacts[0].displayName).toBe("Bob");

    const wxContacts = listBridgeContacts(agent, { platform: "wechat" });
    expect(wxContacts).toHaveLength(0);
  });

  // ── relation filter ────────────────────────────────────

  it("filters contacts by relation", () => {
    upsertBridgeContact(agent, {
      displayName: "Alice",
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "alice" }],
    });
    upsertBridgeContact(agent, {
      displayName: "Bob",
      relation: "family",
      accounts: [{ platform: "telegram", userId: "bob" }],
    });

    const friends = listBridgeContacts(agent, { relation: "friend" });
    expect(friends).toHaveLength(1);
    expect(friends[0].displayName).toBe("Alice");

    const strangers = listBridgeContacts(agent, { relation: "stranger" });
    expect(strangers).toHaveLength(0);
  });

  // ── combined filter ────────────────────────────────────

  it("supports combined relation + platform + query filter", () => {
    upsertBridgeContact(agent, {
      displayName: "Alice",
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "alice" }],
      aliases: ["Al"],
    });
    upsertBridgeContact(agent, {
      displayName: "Bob",
      relation: "friend",
      accounts: [{ platform: "qq", userId: "bob" }],
    });

    const result = listBridgeContacts(agent, { relation: "friend", platform: "telegram", query: "alice" });
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Alice");
  });

  // ── resolve with multiple accounts ─────────────────────

  it("resolves contact with multiple platform accounts", () => {
    upsertBridgeContact(agent, {
      displayName: "MultiUser",
      relation: "family",
      accounts: [
        { platform: "telegram", userId: "multi-tg" },
        { platform: "qq", userId: "multi-qq" },
        { platform: "wechat", userId: "multi-wx" },
      ],
    });

    expect(resolveBridgeAudience(agent, { platform: "telegram", userId: "multi-tg" })).toMatchObject({
      matched: true,
      relation: "family",
    });
    expect(resolveBridgeAudience(agent, { platform: "qq", userId: "multi-qq" })).toMatchObject({
      matched: true,
      relation: "family",
    });
    expect(resolveBridgeAudience(agent, { platform: "wechat", userId: "multi-wx" })).toMatchObject({
      matched: true,
      relation: "family",
    });
    expect(resolveBridgeAudience(agent, { platform: "feishu", userId: "multi-fs" })).toMatchObject({
      matched: false,
      relation: "stranger",
    });
  });

  // ── resolve by chatId only ─────────────────────────────

  it("resolves contact by chatId when userId is absent", () => {
    upsertBridgeContact(agent, {
      displayName: "ChatOnly",
      relation: "friend",
      accounts: [{ platform: "onebot", chatId: "group-123" }],
    });

    expect(resolveBridgeAudience(agent, { platform: "onebot", chatId: "group-123" })).toMatchObject({
      matched: true,
      relation: "friend",
    });
    expect(resolveBridgeAudience(agent, { platform: "onebot", userId: "someone" })).toMatchObject({
      matched: false,
    });
  });

  // ── resolve with isOwner flag ──────────────────────────

  it("resolves owner as self regardless of contact entries", () => {
    upsertBridgeContact(agent, {
      displayName: "OwnerContact",
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "owner-1" }],
    });

    const result = resolveBridgeAudience(agent, {
      platform: "telegram",
      userId: "owner-1",
      isOwner: true,
    });
    expect(result).toMatchObject({
      matched: true,
      relation: "self",
      source: "owner_policy",
    });
  });

  // ── unknown relation defaults to stranger ──────────────

  it("normalizes unknown relation to stranger", () => {
    const contact = upsertBridgeContact(agent, {
      displayName: "UnknownRelation",
      relation: "boss",
      accounts: [{ platform: "telegram", userId: "boss-1" }],
    });
    expect(contact.relation).toBe("stranger");
  });

  // ── displayName required ───────────────────────────────

  it("throws when displayName is missing", () => {
    expect(() => upsertBridgeContact(agent, {
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "x" }],
    })).toThrow("displayName is required");
  });

  // ── accounts without userId or chatId are ignored ──────

  it("skips accounts that have neither userId nor chatId", () => {
    const contact = upsertBridgeContact(agent, {
      displayName: "EmptyAccounts",
      relation: "stranger",
      accounts: [
        { platform: "telegram" },
        { platform: "qq", userId: "valid-qq" },
      ],
    });
    expect(contact.accounts).toHaveLength(1);
    expect(contact.accounts[0].userId).toBe("valid-qq");
  });

  // ── duplicate account dedup ────────────────────────────

  it("deduplicates accounts by fingerprint", () => {
    const contact = upsertBridgeContact(agent, {
      displayName: "DupAccounts",
      relation: "friend",
      accounts: [
        { platform: "telegram", userId: "dup-1" },
        { platform: "telegram", userId: "dup-1" },
        { platform: "telegram", userId: "dup-2" },
      ],
    });
    expect(contact.accounts).toHaveLength(2);
  });

  // ── update non-existent contact creates new ────────────

  it("creates new contact when id does not exist", () => {
    const contact = upsertBridgeContact(agent, {
      id: "non-existent-id",
      displayName: "NewContact",
      relation: "stranger",
      accounts: [{ platform: "telegram", userId: "new-1" }],
    });
    expect(contact.displayName).toBe("NewContact");
    expect(listBridgeContacts(agent)).toHaveLength(1);
  });

  // ── remove non-existent returns false ──────────────────

  it("returns false when removing non-existent contact", () => {
    expect(removeBridgeContact(agent, "ghost-id")).toBe(false);
  });

  // ── audience prompts settings ──────────────────────────

  it("persists and retrieves audience prompt settings", () => {
    updateBridgeContactSettings(agent, {
      audiencePrompts: {
        family: "家人提示",
        friend: "朋友提示",
        stranger: "陌生人提示",
      },
    });

    const settings = getBridgeContactSettings(agent);
    expect(settings.audiencePrompts.family).toBe("家人提示");
    expect(settings.audiencePrompts.friend).toBe("朋友提示");
    expect(settings.audiencePrompts.stranger).toBe("陌生人提示");
  });

  // ── policy hydration ───────────────────────────────────

  it("hydrates contact with audience prompt from settings", () => {
    updateBridgeContactSettings(agent, {
      audiencePrompts: { friend: "朋友专属提示" },
    });

    const contact = upsertBridgeContact(agent, {
      displayName: "PolicyTest",
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "policy-1" }],
    });

    expect(contact.policy.audiencePrompt).toBe("朋友专属提示");
    expect(contact.policy.hostPermissionMode).toBe("social_readonly");
  });

  it("contact-level policyOverrides take precedence over settings", () => {
    updateBridgeContactSettings(agent, {
      audiencePrompts: { friend: "默认朋友提示" },
    });

    const contact = upsertBridgeContact(agent, {
      displayName: "OverrideTest",
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "override-1" }],
      policyOverrides: {
        audiencePrompt: "自定义提示",
        hostPermissionMode: "operate",
      },
    });

    expect(contact.policy.audiencePrompt).toBe("自定义提示");
    expect(contact.policy.hostPermissionMode).toBe("operate");
  });

  // ── store version ──────────────────────────────────────

  it("writes store with version 2", () => {
    upsertBridgeContact(agent, {
      displayName: "VersionTest",
      relation: "stranger",
      accounts: [{ platform: "telegram", userId: "v-1" }],
    });
    const raw = JSON.parse(fs.readFileSync(path.join(agent.userDir, "bridge-contacts.json"), "utf-8"));
    expect(raw.version).toBe(2);
  });

  // ── malformed store recovery ───────────────────────────

  it("handles corrupted store file gracefully", () => {
    fs.writeFileSync(path.join(agent.userDir, "bridge-contacts.json"), "not-json!!!", "utf-8");
    const store = readBridgeContactStore(agent);
    expect(store.contacts).toHaveLength(0);
    expect(store.version).toBe(2);
  });

  // ── search across aliases, tags, notes ─────────────────

  it("searches contacts by alias, tag, and notes", () => {
    upsertBridgeContact(agent, {
      displayName: "SearchTest",
      relation: "friend",
      aliases: ["搜索别名"],
      tags: ["vip"],
      notes: "重要客户",
      accounts: [{ platform: "telegram", userId: "search-1" }],
    });

    expect(listBridgeContacts(agent, { query: "搜索别名" })).toHaveLength(1);
    expect(listBridgeContacts(agent, { query: "vip" })).toHaveLength(1);
    expect(listBridgeContacts(agent, { query: "重要客户" })).toHaveLength(1);
    expect(listBridgeContacts(agent, { query: "不存在" })).toHaveLength(0);
  });

  // ── onebot platform specific ───────────────────────────

  it("resolves OneBot contacts correctly", () => {
    upsertBridgeContact(agent, {
      displayName: "OneBotFriend",
      relation: "friend",
      accounts: [{ platform: "onebot", userId: "ob-user-1", chatId: "ob-chat-1" }],
    });

    const byUser = resolveBridgeAudience(agent, { platform: "onebot", userId: "ob-user-1" });
    expect(byUser).toMatchObject({ matched: true, relation: "friend" });

    const byChat = resolveBridgeAudience(agent, { platform: "onebot", chatId: "ob-chat-1" });
    expect(byChat).toMatchObject({ matched: true, relation: "friend" });
  });
});
