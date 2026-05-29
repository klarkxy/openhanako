import fs from "fs";
import os from "os";
import path from "path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createBridgeRoute } from "../server/routes/bridge.js";

let rootDir;

function makeApp(opts = {}) {
  const agentId = opts.agentId || "hana";
  const agentDir = path.join(rootDir, "agents", agentId);
  const sessionDir = path.join(agentDir, "sessions");
  const userDir = path.join(rootDir, "user");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });

  const onebotConfig = {
    enabled: opts.onebotEnabled !== false,
    apiBase: opts.apiBase || "http://127.0.0.1:3000",
    accessToken: opts.accessToken || "",
    secret: opts.secret || "",
    selfId: opts.selfId || "",
  };

  const agent = {
    id: agentId,
    agentDir,
    userDir,
    sessionDir,
    config: {
      bridge: { onebot: onebotConfig },
    },
    updateConfig: vi.fn(),
  };

  const bridgeManager = {
    getStatus: vi.fn(() => ({ onebot: { status: "connected" } })),
    startPlatformFromConfig: vi.fn(),
    ingestPlatformEvent: vi.fn(() => ({ ok: true })),
    stopPlatform: vi.fn(),
    getMessages: vi.fn(() => []),
    mediaPublisher: { resolve: vi.fn() },
  };

  const index = {};
  const engine = {
    currentAgentId: agentId,
    getAgent: (id) => (id === agentId ? agent : null),
    getBridgeIndex: () => index,
    getBridgeReadOnly: () => false,
    getBridgeReceiptEnabled: () => true,
    setBridgeReadOnly: vi.fn(),
    setBridgeReceiptEnabled: vi.fn(),
    saveBridgeIndex: vi.fn(),
  };

  const app = new Hono();
  app.route("/api", createBridgeRoute(engine, bridgeManager));
  return { app, agent, bridgeManager, engine };
}

describe("OneBot webhook event route", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "onebot-event-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  const eventUrl = "/api/bridge/onebot/event?agentId=hana";

  it("rejects request without agentId", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/bridge/onebot/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.retcode).toBe(1400);
  });

  it("rejects request for unknown agent", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/bridge/onebot/event?agentId=unknown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.retcode).toBe(1404);
  });

  it("rejects when onebot bridge is disabled", async () => {
    const { app } = makeApp({ onebotEnabled: false });
    const res = await app.request(eventUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.retcode).toBe(1503);
  });

  it("accepts valid event and forwards to bridge manager", async () => {
    const { app, bridgeManager } = makeApp();
    const event = {
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message: [{ type: "text", data: { text: "hello" } }],
      sender: { nickname: "Alice" },
    };

    const res = await app.request(eventUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.retcode).toBe(0);
    expect(bridgeManager.ingestPlatformEvent).toHaveBeenCalledWith("onebot", event, "hana");
  });

  it("rejects invalid JSON body", async () => {
    const { app } = makeApp();
    const res = await app.request(eventUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json!!!",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.retcode).toBe(1400);
    expect(body.message).toBe("invalid json");
  });

  it("validates access token when configured", async () => {
    const { app } = makeApp({ accessToken: "my-token" });

    // No auth header → rejected
    const noAuth = await app.request(eventUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(noAuth.status).toBe(403);
    const noAuthBody = await noAuth.json();
    expect(noAuthBody.retcode).toBe(1403);

    // Wrong token → rejected
    const wrongToken = await app.request(eventUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(wrongToken.status).toBe(403);

    // Correct Bearer token → accepted
    const correctBearer = await app.request(eventUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer my-token",
      },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(correctBearer.status).toBe(200);

    // Correct Token format → accepted
    const correctToken = await app.request(eventUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Token my-token",
      },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(correctToken.status).toBe(200);
  });

  it("validates HMAC-SHA1 signature when secret is configured", async () => {
    const secret = "webhook-secret-123";
    const { app } = makeApp({ secret });
    const payload = JSON.stringify({ post_type: "message" });
    const signature = crypto.createHmac("sha1", secret).update(payload, "utf8").digest("hex");

    // Valid signature → accepted
    const valid = await app.request(eventUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": `sha1=${signature}`,
      },
      body: payload,
    });
    expect(valid.status).toBe(200);

    // Missing signature → rejected
    const missing = await app.request(eventUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    expect(missing.status).toBe(403);

    // Wrong signature → rejected
    const wrong = await app.request(eventUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": "sha1=0000000000000000000000000000000000000000",
      },
      body: payload,
    });
    expect(wrong.status).toBe(403);
  });

  it("validates both access token and secret together", async () => {
    const { app } = makeApp({ accessToken: "my-token", secret: "my-secret" });
    const payload = JSON.stringify({ post_type: "message" });
    const sig = crypto.createHmac("sha1", "my-secret").update(payload, "utf8").digest("hex");

    // Both correct → accepted
    const ok = await app.request(eventUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer my-token",
        "x-signature": `sha1=${sig}`,
      },
      body: payload,
    });
    expect(ok.status).toBe(200);

    // Token correct, signature wrong → rejected
    const badSig = await app.request(eventUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer my-token",
        "x-signature": "sha1=bad",
      },
      body: payload,
    });
    expect(badSig.status).toBe(403);
  });

  it("starts onebot platform if not already started", async () => {
    const { app, bridgeManager } = makeApp();
    bridgeManager.getStatus.mockReturnValue({}); // onebot not started

    const res = await app.request(eventUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(res.status).toBe(200);
    expect(bridgeManager.startPlatformFromConfig).toHaveBeenCalledWith(
      "onebot",
      expect.objectContaining({ enabled: true }),
      "hana",
    );
  });

  it("returns 500 when ingest fails", async () => {
    const { app, bridgeManager } = makeApp();
    bridgeManager.ingestPlatformEvent.mockReturnValue({ ok: false, error: "parse error" });

    const res = await app.request(eventUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_type: "message" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.retcode).toBe(1500);
    expect(body.message).toBe("parse error");
  });
});

describe("OneBot platform test endpoint", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "onebot-test-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("returns error when apiBase is missing in credentials", async () => {
    const { app } = makeApp({ apiBase: "" });

    const res = await app.request("/api/bridge/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "onebot", credentials: { apiBase: "" } }),
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/endpoint/i);
  });
});

describe("OneBot bridge status route", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "onebot-status-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("includes onebot status in bridge status response", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/bridge/status?agentId=hana");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onebot).toBeDefined();
    expect(body.onebot.enabled).toBe(true);
    expect(body.onebot.status).toBe("connected");
    expect(body.onebot.configured).toBe(true);
  });

  it("masks secret fields in status response", async () => {
    const { app } = makeApp({ accessToken: "secret-token-12345", secret: "webhook-secret" });
    const res = await app.request("/api/bridge/status?agentId=hana");
    const body = await res.json();
    // accessToken and secret should be masked
    expect(body.onebot.accessToken).not.toBe("secret-token-12345");
    expect(body.onebot.secret).not.toBe("webhook-secret");
  });
});
