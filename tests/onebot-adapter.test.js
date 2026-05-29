import { describe, expect, it, vi, beforeEach } from "vitest";
import { createOneBotAdapter, ONEBOT_MEDIA_CAPABILITIES, ONEBOT_STREAMING_CAPABILITIES } from "../lib/bridge/onebot-adapter.js";

// ── helpers ──────────────────────────────────────────────

function makeAdapter(overrides = {}) {
  const onMessage = vi.fn();
  const onStatus = vi.fn();
  const adapter = createOneBotAdapter({
    apiBase: "http://127.0.0.1:3000",
    accessToken: "test-token",
    selfId: "10000",
    requireAtInGroup: true,
    agentId: "test-agent",
    onMessage,
    onStatus,
    ...overrides,
  });
  return { adapter, onMessage, onStatus };
}

function stubFetch(status = 200, body = { status: "ok", retcode: 0, data: {} }) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

// ── capabilities ─────────────────────────────────────────

describe("OneBot capabilities", () => {
  it("exports valid media capabilities", () => {
    expect(ONEBOT_MEDIA_CAPABILITIES.platform).toBe("onebot");
    expect(ONEBOT_MEDIA_CAPABILITIES.inputModes).toContain("remote_url");
    expect(ONEBOT_MEDIA_CAPABILITIES.supportedKinds).toContain("image");
    expect(ONEBOT_MEDIA_CAPABILITIES.supportedKinds).toContain("video");
    expect(ONEBOT_MEDIA_CAPABILITIES.supportedKinds).toContain("audio");
    expect(ONEBOT_MEDIA_CAPABILITIES.supportedKinds).toContain("document");
  });

  it("exports valid streaming capabilities", () => {
    expect(ONEBOT_STREAMING_CAPABILITIES.platform).toBe("onebot");
    expect(ONEBOT_STREAMING_CAPABILITIES.mode).toBe("batch_pulse");
    expect(ONEBOT_STREAMING_CAPABILITIES.scopes).toContain("dm");
    expect(ONEBOT_STREAMING_CAPABILITIES.pulseIntervalMs).toBe(20_000);
  });
});

// ── adapter creation ─────────────────────────────────────

describe("createOneBotAdapter", () => {
  it("throws if apiBase is empty", () => {
    expect(() => createOneBotAdapter({
      apiBase: "",
      onMessage: vi.fn(),
      onStatus: vi.fn(),
    })).toThrow("OneBot API endpoint is required");
  });

  it("creates adapter with valid config", () => {
    const { adapter } = makeAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.sendReply).toBe("function");
    expect(typeof adapter.sendMedia).toBe("function");
    expect(typeof adapter.ingestEvent).toBe("function");
    expect(typeof adapter.getMe).toBe("function");
    expect(typeof adapter.stop).toBe("function");
  });

  it("calls startup health check and reports connected", async () => {
    stubFetch(200, { status: "ok", retcode: 0, data: { user_id: "10000", nickname: "Bot" } });
    const { onStatus } = makeAdapter();
    // Give the async health check time to complete
    await new Promise((r) => setTimeout(r, 50));
    expect(onStatus).toHaveBeenCalledWith("connected");
  });

  it("reports error on failed health check", async () => {
    stubFetch(200, { status: "failed", retcode: 100, data: null });
    const { onStatus } = makeAdapter();
    await new Promise((r) => setTimeout(r, 50));
    expect(onStatus).toHaveBeenCalledWith("error", expect.any(String));
  });
});

// ── ingestEvent ──────────────────────────────────────────

describe("OneBot ingestEvent", () => {
  it("ignores non-message events", () => {
    const { adapter, onMessage } = makeAdapter();
    adapter.ingestEvent({ post_type: "notice" });
    adapter.ingestEvent({ post_type: "request" });
    adapter.ingestEvent(null);
    adapter.ingestEvent(undefined);
    adapter.ingestEvent("not-an-object");
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("ignores messages from self", () => {
    const { adapter, onMessage } = makeAdapter({ selfId: "10000" });
    adapter.ingestEvent({
      post_type: "message",
      message_type: "private",
      user_id: 10000,
      message: [{ type: "text", data: { text: "hello" } }],
      sender: { nickname: "Bot" },
    });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("processes private text messages", () => {
    const { adapter, onMessage } = makeAdapter();
    adapter.ingestEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message: [{ type: "text", data: { text: "hello world" } }],
      sender: { nickname: "Alice" },
      message_id: 1001,
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    const msg = onMessage.mock.calls[0][0];
    expect(msg.platform).toBe("onebot");
    expect(msg.text).toBe("hello world");
    expect(msg.userId).toBe("12345");
    expect(msg.senderName).toBe("Alice");
    expect(msg.isGroup).toBe(false);
    expect(msg.sessionKey).toBe("ob_dm_12345@test-agent");
    expect(msg.replyTargetType).toBe("user");
  });

  it("processes group messages with @mention", () => {
    const { adapter, onMessage } = makeAdapter({ selfId: "10000", requireAtInGroup: true });
    adapter.ingestEvent({
      post_type: "message",
      message_type: "group",
      user_id: 12345,
      group_id: 99999,
      message: [
        { type: "at", data: { qq: "10000" } },
        { type: "text", data: { text: " help me" } },
      ],
      sender: { card: "Bob", nickname: "Bob" },
      message_id: 1002,
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    const msg = onMessage.mock.calls[0][0];
    expect(msg.text).toBe("help me");
    expect(msg.isGroup).toBe(true);
    expect(msg.chatId).toBe("99999");
    expect(msg.sessionKey).toBe("ob_group_99999@test-agent");
    expect(msg.replyTargetType).toBe("group");
  });

  it("drops group messages without @mention when requireAtInGroup is true", () => {
    const { adapter, onMessage } = makeAdapter({ selfId: "10000", requireAtInGroup: true });
    adapter.ingestEvent({
      post_type: "message",
      message_type: "group",
      user_id: 12345,
      group_id: 99999,
      message: [{ type: "text", data: { text: "random message" } }],
      sender: { nickname: "Charlie" },
    });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("accepts group messages without @mention when requireAtInGroup is false", () => {
    const { adapter, onMessage } = makeAdapter({ selfId: "10000", requireAtInGroup: false });
    adapter.ingestEvent({
      post_type: "message",
      message_type: "group",
      user_id: 12345,
      group_id: 99999,
      message: [{ type: "text", data: { text: "random message" } }],
      sender: { nickname: "Charlie" },
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("parses CQ code messages", () => {
    const { adapter, onMessage } = makeAdapter();
    adapter.ingestEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message: "[CQ:image,file=http://example.com/img.png]look at this",
      sender: { nickname: "Dave" },
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    const msg = onMessage.mock.calls[0][0];
    expect(msg.text).toBe("look at this");
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].type).toBe("image");
    expect(msg.attachments[0].url).toBe("http://example.com/img.png");
  });

  it("handles attachments in messages", () => {
    const { adapter, onMessage } = makeAdapter();
    adapter.ingestEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message: [
        { type: "text", data: { text: "check this" } },
        { type: "image", data: { url: "http://example.com/photo.jpg" } },
        { type: "video", data: { file: "http://example.com/vid.mp4" } },
        { type: "record", data: { file: "http://example.com/voice.ogg" } },
        { type: "file", data: { file: "http://example.com/doc.pdf", name: "doc.pdf" } },
      ],
      sender: { nickname: "Eve" },
    });
    const msg = onMessage.mock.calls[0][0];
    expect(msg.attachments).toHaveLength(4);
    expect(msg.attachments[0]).toMatchObject({ type: "image", url: "http://example.com/photo.jpg" });
    expect(msg.attachments[1]).toMatchObject({ type: "video", url: "http://example.com/vid.mp4" });
    expect(msg.attachments[2]).toMatchObject({ type: "audio", url: "http://example.com/voice.ogg" });
    expect(msg.attachments[3]).toMatchObject({ type: "file", url: "http://example.com/doc.pdf" });
  });

  it("ignores empty messages (no text and no attachments)", () => {
    const { adapter, onMessage } = makeAdapter();
    adapter.ingestEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message: [],
      sender: { nickname: "Ghost" },
    });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("uses sender.card over nickname", () => {
    const { adapter, onMessage } = makeAdapter();
    adapter.ingestEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message: [{ type: "text", data: { text: "hi" } }],
      sender: { card: "CardName", nickname: "NickName" },
    });
    expect(onMessage.mock.calls[0][0].senderName).toBe("CardName");
  });

  it("handles at mentions for non-self users", () => {
    const { adapter, onMessage } = makeAdapter({ selfId: "10000" });
    adapter.ingestEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message: [
        { type: "at", data: { qq: "99999" } },
        { type: "text", data: { text: " check this" } },
      ],
      sender: { nickname: "User" },
    });
    const msg = onMessage.mock.calls[0][0];
    expect(msg.text).toBe("@99999 check this");
  });
});

// ── sendReply ────────────────────────────────────────────

describe("OneBot sendReply", () => {
  it("sends text message to private chat", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter();

    await adapter.sendReply("12345", "hello!", { targetType: "user" });

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 for health check, 1 for send
    const sendCall = fetchMock.mock.calls[1];
    expect(sendCall[0]).toBe("http://127.0.0.1:3000/send_msg");
    const body = JSON.parse(sendCall[1].body);
    expect(body.message_type).toBe("private");
    expect(body.user_id).toBe("12345");
    expect(body.message[0].data.text).toBe("hello!");
  });

  it("sends text message to group chat", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter();

    await adapter.sendReply("99999", "group msg", { targetType: "group" });

    const sendCall = fetchMock.mock.calls[1];
    const body = JSON.parse(sendCall[1].body);
    expect(body.message_type).toBe("group");
    expect(body.group_id).toBe("99999");
  });

  it("chunks long messages", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter();
    const longText = "A".repeat(5000);

    await adapter.sendReply("12345", longText, { targetType: "user" });

    // health check + 3 chunks (5000 / 2000 = 3)
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const chunk1 = JSON.parse(fetchMock.mock.calls[1][1].body);
    const chunk2 = JSON.parse(fetchMock.mock.calls[2][1].body);
    const chunk3 = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(chunk1.message[0].data.text).toHaveLength(2000);
    expect(chunk2.message[0].data.text).toHaveLength(2000);
    expect(chunk3.message[0].data.text).toHaveLength(1000);
  });

  it("throws on HTTP error", async () => {
    stubFetch(500, "Internal Server Error");
    const { adapter } = makeAdapter();
    await expect(adapter.sendReply("12345", "hi")).rejects.toThrow();
  });
});

// ── sendMedia ────────────────────────────────────────────

describe("OneBot sendMedia", () => {
  it("sends image by default", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter();

    await adapter.sendMedia("12345", "http://example.com/img.png");

    const sendCall = fetchMock.mock.calls[1];
    const body = JSON.parse(sendCall[1].body);
    expect(body.message[0].type).toBe("image");
    expect(body.message[0].data.file).toBe("http://example.com/img.png");
  });

  it("sends video segment", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter();

    await adapter.sendMedia("12345", "http://example.com/vid.mp4", { kind: "video" });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.message[0].type).toBe("video");
  });

  it("sends audio segment (record)", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter();

    await adapter.sendMedia("12345", "http://example.com/voice.ogg", { kind: "audio" });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.message[0].type).toBe("record");
  });

  it("sends file segment (document)", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter();

    await adapter.sendMedia("12345", "http://example.com/doc.pdf", { kind: "document" });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.message[0].type).toBe("file");
  });

  it("sendMediaFile throws not supported error", async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.sendMediaFile("12345", "/tmp/photo.jpg")).rejects.toThrow("not supported yet");
  });

  it("sendMediaBuffer throws not supported error", async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.sendMediaBuffer("12345", Buffer.from("data"))).rejects.toThrow("not supported yet");
  });
});

// ── getMe / resolveOwnerChatId / stop ────────────────────

describe("OneBot utility methods", () => {
  it("getMe calls get_login_info", async () => {
    const fetchMock = stubFetch(200, {
      status: "ok",
      retcode: 0,
      data: { user_id: "10000", nickname: "MyBot" },
    });
    const { adapter } = makeAdapter();
    const info = await adapter.getMe();
    expect(info.user_id).toBe("10000");
    expect(info.nickname).toBe("MyBot");
  });

  it("resolveOwnerChatId returns userId", () => {
    const { adapter } = makeAdapter();
    expect(adapter.resolveOwnerChatId("12345")).toBe("12345");
  });

  it("stop reports disconnected", () => {
    const { adapter, onStatus } = makeAdapter();
    adapter.stop();
    expect(onStatus).toHaveBeenCalledWith("disconnected");
  });
});

// ── Authorization header ─────────────────────────────────

describe("OneBot Authorization header", () => {
  it("sends Bearer token in Authorization header", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter({ accessToken: "my-secret-token" });

    // Wait for health check
    await new Promise((r) => setTimeout(r, 50));

    await adapter.sendReply("12345", "hi");
    const sendCall = fetchMock.mock.calls[1];
    expect(sendCall[1].headers.Authorization).toBe("Bearer my-secret-token");
  });

  it("does not send Authorization header when token is empty", async () => {
    const fetchMock = stubFetch(200, { status: "ok", retcode: 0, data: {} });
    const { adapter } = makeAdapter({ accessToken: "" });

    await new Promise((r) => setTimeout(r, 50));

    await adapter.sendReply("12345", "hi");
    const sendCall = fetchMock.mock.calls[1];
    expect(sendCall[1].headers.Authorization).toBeUndefined();
  });
});
