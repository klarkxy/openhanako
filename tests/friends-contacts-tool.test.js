import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFriendsContactsTools } from "../lib/tools/friends-contacts-tools.js";

let rootDir;
let agent;

function getTool(tools, name) {
  return tools.find((tool) => tool.name === name);
}

describe("friends contacts built-in tools", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-tools-"));
    agent = {
      id: "hana",
      agentDir: path.join(rootDir, "agent"),
    };
    fs.mkdirSync(agent.agentDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("lists, resolves, upserts, and removes bridge contacts", async () => {
    const tools = createFriendsContactsTools({ agent });
    const upsert = getTool(tools, "friends_upsert_contact");
    const list = getTool(tools, "friends_list_contacts");
    const resolve = getTool(tools, "friends_resolve_contact");
    const remove = getTool(tools, "friends_remove_contact");

    const created = await upsert.execute("call-1", {
      displayName: "Alice",
      relation: "friend",
      aliases: ["Al"],
      tags: ["priority"],
      accounts: [{ platform: "telegram", userId: "alice-id" }],
    });
    expect(created.details.contact).toMatchObject({
      displayName: "Alice",
      relation: "friend",
      aliases: ["Al"],
      tags: ["priority"],
    });

    const listed = await list.execute("call-2", { query: "alice" });
    expect(listed.details.total).toBe(1);
    expect(listed.details.contacts[0]).toMatchObject({
      displayName: "Alice",
      relation: "friend",
    });

    const resolved = await resolve.execute("call-3", {
      platform: "telegram",
      userId: "alice-id",
    });
    expect(resolved.details).toMatchObject({ matched: true, relation: "friend", source: "address_book" });

    const removed = await remove.execute("call-4", { id: created.details.contact.id });
    expect(removed.details.removed).toBe(true);

    const finalList = await list.execute("call-5", {});
    expect(finalList.details.total).toBe(0);
  });
});