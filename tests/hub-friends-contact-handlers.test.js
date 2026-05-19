import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hub } from "../hub/index.js";

function createEngine(rootDir) {
  const agentId = "agent-1";
  const agent = {
    id: agentId,
    agentDir: path.join(rootDir, "agents", agentId),
    config: {},
    setDmSentHandler: vi.fn(),
  };
  fs.mkdirSync(agent.agentDir, { recursive: true });
  const agents = new Map([[agentId, agent]]);
  return {
    currentAgentId: agentId,
    agents,
    agentsDir: path.join(rootDir, "agents"),
    channelsDir: null,
    providerRegistry: {
      getCredentials: vi.fn(() => ({})),
      getModelsByType: vi.fn(() => []),
      getAllModelsByType: vi.fn(() => []),
    },
    setHubCallbacks: vi.fn(),
    setEventBus: vi.fn(),
    getAgent: vi.fn((id) => agents.get(id) || null),
    updateConfig: vi.fn(async () => {}),
    listAgents: vi.fn(() => []),
    listSessions: vi.fn(async () => []),
    isSessionStreaming: vi.fn(() => false),
    promptSession: vi.fn(async () => {}),
    abortSession: vi.fn(async () => true),
    dispose: vi.fn(async () => {}),
  };
}

describe("Hub friends contact bus handlers", () => {
  let rootDir;

  afterEach(() => {
    if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
    rootDir = null;
  });

  it("registers built-in friends contact capabilities and serves requests", async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-friends-"));
    const engine = createEngine(rootDir);
    const hub = new Hub({ engine });

    const capability = hub.eventBus.getCapability("friends:resolve-contact");
    expect(capability).toMatchObject({
      type: "friends:resolve-contact",
      permission: "contacts.read",
      owner: "system",
      available: true,
    });

    const created = await hub.eventBus.request("friends:upsert-contact", {
      displayName: "Alice",
      relation: "family",
      accounts: [{ platform: "qq", userId: "10001" }],
    });
    expect(created.contact).toMatchObject({ displayName: "Alice", relation: "family" });

    const resolved = await hub.eventBus.request("friends:resolve-contact", {
      platform: "qq",
      userId: "10001",
    });
    expect(resolved).toMatchObject({ matched: true, relation: "family" });

    const listed = await hub.eventBus.request("friends:list-contacts", {});
    expect(listed.contacts).toHaveLength(1);

    const removed = await hub.eventBus.request("friends:remove-contact", { id: created.contact.id });
    expect(removed.removed).toBe(true);
  });
});