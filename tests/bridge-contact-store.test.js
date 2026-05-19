import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getBridgeContactById,
  getBridgeContactSettings,
  listBridgeContacts,
  removeBridgeContact,
  resolveBridgeAudience,
  updateBridgeContactSettings,
  upsertBridgeContact,
} from "../lib/bridge/contacts/store.js";

let rootDir;
let agent;

describe("bridge contact store", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-contact-store-"));
    const userDir = path.join(rootDir, "user");
    agent = {
      id: "hana",
      agentDir: path.join(rootDir, "agent"),
      userDir,
    };
    fs.mkdirSync(agent.agentDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("creates, updates, resolves, lists, and removes contacts", () => {
    const otherAgent = {
      id: "hana-2",
      agentDir: path.join(rootDir, "other-agent"),
      userDir: agent.userDir,
    };
    fs.mkdirSync(otherAgent.agentDir, { recursive: true });

    const created = upsertBridgeContact(agent, {
      displayName: "Alice",
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "friend-1", chatId: "friend-1" }],
      aliases: ["Al"],
    });

    expect(created.relation).toBe("friend");
    expect(created.policy.hostPermissionMode).toBe("social_readonly");
    expect(listBridgeContacts(agent)).toHaveLength(1);
    expect(listBridgeContacts(otherAgent)).toHaveLength(1);

    const resolved = resolveBridgeAudience(agent, { platform: "telegram", userId: "friend-1" });
    expect(resolved).toMatchObject({ matched: true, relation: "friend", source: "address_book" });

    const updated = upsertBridgeContact(agent, {
      id: created.id,
      displayName: "Alice Zhang",
      relation: "family",
      accounts: [{ platform: "telegram", userId: "friend-1", chatId: "friend-1" }],
    });
    expect(updated.displayName).toBe("Alice Zhang");
    expect(updated.relation).toBe("family");
    expect(getBridgeContactById(agent, created.id)?.displayName).toBe("Alice Zhang");

    expect(removeBridgeContact(agent, created.id)).toBe(true);
    expect(listBridgeContacts(agent)).toHaveLength(0);
    expect(resolveBridgeAudience(agent, { platform: "telegram", userId: "friend-1" })).toMatchObject({
      matched: false,
      relation: "stranger",
    });
  });

  it("shares audience prompts across agents through the user-level store", () => {
    const otherAgent = {
      id: "hana-2",
      agentDir: path.join(rootDir, "other-agent"),
      userDir: agent.userDir,
    };
    fs.mkdirSync(otherAgent.agentDir, { recursive: true });

    const settings = updateBridgeContactSettings(agent, {
      audiencePrompts: {
        family: "更亲近一些",
        friend: "保持概括",
        stranger: "简短礼貌",
      },
    });

    expect(settings.audiencePrompts.family).toBe("更亲近一些");
    expect(getBridgeContactSettings(otherAgent).audiencePrompts.friend).toBe("保持概括");

    upsertBridgeContact(otherAgent, {
      displayName: "Alice",
      relation: "friend",
      accounts: [{ platform: "telegram", userId: "friend-1" }],
    });

    const resolved = resolveBridgeAudience(agent, { platform: "telegram", userId: "friend-1" });
    expect(resolved.policy.audiencePrompt).toBe("保持概括");
  });

  it("treats the configured owner as self even without an address-book entry", () => {
    const resolved = resolveBridgeAudience(agent, { platform: "telegram", userId: "owner-1", isOwner: true });
    expect(resolved).toMatchObject({ matched: true, relation: "self", source: "owner_policy" });
  });
});