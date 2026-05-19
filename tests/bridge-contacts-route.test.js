import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createBridgeRoute } from "../server/routes/bridge.js";

let rootDir;

function makeApp() {
  const agentId = "hana";
  const agentDir = path.join(rootDir, "agents", agentId);
  const sessionDir = path.join(agentDir, "sessions");
  const userDir = path.join(rootDir, "user");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });

  const agent = {
    id: agentId,
    agentDir,
    userDir,
    sessionDir,
    config: { bridge: {} },
    updateConfig: () => {},
  };
  const engine = {
    currentAgentId: agentId,
    getAgent: (id) => (id === agentId ? agent : null),
    getBridgeIndex: () => ({}),
    getBridgeReadOnly: () => false,
    getBridgeReceiptEnabled: () => true,
  };
  const app = new Hono();
  app.route("/api", createBridgeRoute(engine, null));
  return { app };
}

describe("bridge contacts route", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-contacts-route-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("supports CRUD and resolve operations for address-book contacts", async () => {
    const { app } = makeApp();

    const createRes = await app.request("/api/bridge/contacts?agentId=hana", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Alice",
        relation: "friend",
        accounts: [{ platform: "telegram", userId: "friend-1" }],
      }),
    });
    const createBody = await createRes.json();
    expect(createRes.status).toBe(200);
    expect(createBody.contact.relation).toBe("friend");

    const listRes = await app.request("/api/bridge/contacts?agentId=hana");
    const listBody = await listRes.json();
    expect(listBody.contacts).toHaveLength(1);
    expect(listBody.settings.audiencePrompts.family).toBe("");
    expect(listBody.relationPolicies.friend.hostPermissionMode).toBe("social_readonly");

    const settingsRes = await app.request("/api/bridge/contacts/settings?agentId=hana");
    const settingsBody = await settingsRes.json();
    expect(settingsBody.settings.audiencePrompts.friend).toBe("");

    const saveSettingsRes = await app.request("/api/bridge/contacts/settings?agentId=hana", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audiencePrompts: {
          family: "更亲近一些",
          friend: "更概括一些",
          stranger: "只做礼貌寒暄",
        },
      }),
    });
    const saveSettingsBody = await saveSettingsRes.json();
    expect(saveSettingsRes.status).toBe(200);
    expect(saveSettingsBody.settings.audiencePrompts.friend).toBe("更概括一些");

    const updatedSettingsRes = await app.request("/api/bridge/contacts/settings?agentId=hana");
    const updatedSettingsBody = await updatedSettingsRes.json();
    expect(updatedSettingsBody.settings.audiencePrompts.stranger).toBe("只做礼貌寒暄");

    const queryRes = await app.request("/api/bridge/contacts?agentId=hana&q=friend-1");
    const queryBody = await queryRes.json();
    expect(queryBody.contacts).toHaveLength(1);

    const resolveRes = await app.request("/api/bridge/contacts/resolve?agentId=hana", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "telegram", userId: "friend-1" }),
    });
    const resolveBody = await resolveRes.json();
    expect(resolveBody).toMatchObject({ matched: true, relation: "friend" });

    const updateRes = await app.request(`/api/bridge/contacts/${createBody.contact.id}?agentId=hana`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Alice Zhang",
        relation: "family",
        accounts: [{ platform: "telegram", userId: "friend-1" }],
      }),
    });
    const updateBody = await updateRes.json();
    expect(updateBody.contact.displayName).toBe("Alice Zhang");
    expect(updateBody.contact.relation).toBe("family");

    const deleteRes = await app.request(`/api/bridge/contacts/${createBody.contact.id}?agentId=hana`, {
      method: "DELETE",
    });
    const deleteBody = await deleteRes.json();
    expect(deleteBody.ok).toBe(true);

    const finalListRes = await app.request("/api/bridge/contacts?agentId=hana");
    const finalListBody = await finalListRes.json();
    expect(finalListBody.contacts).toHaveLength(0);
  });
});