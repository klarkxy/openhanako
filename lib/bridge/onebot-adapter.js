/**
 * onebot-adapter.js — OneBot v11 adapter (NapCat-friendly)
 *
 * Inbound: reverse HTTP callback posts events to openhanako.
 * Outbound: call OneBot action HTTP API, e.g. /send_msg and /get_login_info.
 */

import { createMediaCapabilities } from "./media-capabilities.js";
import { createStreamingCapabilities } from "./streaming-capabilities.js";

const MAX_MSG_SIZE = 100_000;

export const ONEBOT_MEDIA_CAPABILITIES = createMediaCapabilities({
  platform: "onebot",
  inputModes: ["remote_url", "public_url"],
  supportedKinds: ["image", "video", "audio", "document"],
  requiresReplyContext: false,
  deliveryByKind: {
    image: "native_image",
    video: "native_video",
    audio: "native_audio",
    document: "native_file",
  },
  source: "https://onebot.dev/",
});

export const ONEBOT_STREAMING_CAPABILITIES = createStreamingCapabilities({
  platform: "onebot",
  mode: "block",
  scopes: ["dm"],
  source: "https://onebot.dev/",
});

function normalizeApiBase(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function parseCQCodeMessage(text) {
  const segments = [];
  const source = String(text || "");
  const regex = /\[CQ:([^,\]]+)([^\]]*)\]/g;
  let last = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    if (match.index > last) {
      segments.push({ type: "text", data: { text: source.slice(last, match.index) } });
    }
    const type = String(match[1] || "").trim();
    const rawArgs = String(match[2] || "");
    const data = {};
    if (rawArgs) {
      const body = rawArgs.startsWith(",") ? rawArgs.slice(1) : rawArgs;
      for (const pair of body.split(",")) {
        const idx = pair.indexOf("=");
        if (idx <= 0) continue;
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (key) data[key] = value;
      }
    }
    segments.push({ type, data });
    last = regex.lastIndex;
  }
  if (last < source.length) {
    segments.push({ type: "text", data: { text: source.slice(last) } });
  }
  return segments;
}

function normalizeSegments(message) {
  if (Array.isArray(message)) {
    return message
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const type = String(item.type || "").trim();
        if (!type) return null;
        return { type, data: item.data && typeof item.data === "object" ? item.data : {} };
      })
      .filter(Boolean);
  }
  if (typeof message === "string") {
    return parseCQCodeMessage(message);
  }
  return [];
}

function normalizeMessagePayload(message, selfId, requireAtInGroup, isGroup) {
  const segments = normalizeSegments(message);
  const textParts = [];
  const attachments = [];
  let hasSelfMention = false;

  for (const seg of segments) {
    const type = String(seg.type || "").toLowerCase();
    const data = seg.data || {};
    if (type === "text") {
      const text = String(data.text || "");
      if (text) textParts.push(text);
      continue;
    }
    if (type === "at") {
      const qq = data.qq != null ? String(data.qq) : "";
      if (selfId && qq && qq === String(selfId)) {
        hasSelfMention = true;
        continue;
      }
      if (qq && qq !== "all") textParts.push(`@${qq}`);
      continue;
    }
    if (type === "image" || type === "video" || type === "record" || type === "file") {
      const file = data.url || data.file || "";
      const attachmentType = type === "record" ? "audio" : type === "file" ? "file" : type;
      attachments.push({
        type: attachmentType,
        url: file ? String(file) : undefined,
        filename: data.name ? String(data.name) : undefined,
      });
      continue;
    }
  }

  const text = textParts.join("").trim().slice(0, MAX_MSG_SIZE);
  const shouldDropByMention = isGroup && requireAtInGroup && selfId && !hasSelfMention;
  return {
    text,
    attachments,
    hasSelfMention,
    shouldDropByMention,
  };
}

function normalizeReplyContext(replyContext = null) {
  if (!replyContext || typeof replyContext !== "object") return {};
  return { ...replyContext };
}

function resolveMessageTarget(chatId, metadata = {}) {
  const ctx = metadata.replyContext || metadata;
  const targetType = String(ctx.targetType || "").trim();
  if (targetType === "group") return { message_type: "group", group_id: chatId };
  if (targetType === "user" || targetType === "private") return { message_type: "private", user_id: chatId };
  if (ctx.isGroup === true || ctx.targetScope === "group") return { message_type: "group", group_id: chatId };
  if (ctx.isGroup === false || ctx.targetScope === "dm") return { message_type: "private", user_id: chatId };
  return { message_type: "private", user_id: chatId };
}

function chunkText(text, max = 2000) {
  const value = String(text || "");
  if (!value) return [""];
  const chunks = [];
  for (let i = 0; i < value.length; i += max) {
    chunks.push(value.slice(i, i + max));
  }
  return chunks;
}

export function createOneBotAdapter({
  apiBase,
  accessToken,
  selfId,
  requireAtInGroup,
  agentId,
  onMessage,
  onStatus,
}) {
  const endpoint = normalizeApiBase(apiBase);
  if (!endpoint) {
    throw new Error("OneBot API endpoint is required");
  }

  const token = String(accessToken || "").trim();
  const botSelfId = selfId != null && String(selfId).trim() ? String(selfId).trim() : null;
  const requireAt = requireAtInGroup !== false;

  async function callAction(action, params = {}) {
    const path = action.startsWith("/") ? action : `/${action}`;
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`OneBot action ${action} failed: HTTP ${response.status} ${raw.slice(0, 200)}`);
    }

    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`OneBot action ${action} returned invalid JSON`);
    }

    const retcode = Number(payload?.retcode ?? 0);
    const status = String(payload?.status || "ok");
    if (status !== "ok" || retcode !== 0) {
      throw new Error(`OneBot action ${action} failed: ${status}(${retcode})`);
    }
    return payload?.data;
  }

  async function startupHealthCheck() {
    try {
      await callAction("get_login_info", {});
      onStatus?.("connected");
    } catch (err) {
      onStatus?.("error", err.message);
    }
  }

  function ingestEvent(event) {
    if (!event || typeof event !== "object") return;
    if (String(event.post_type || "") !== "message") return;

    const messageType = String(event.message_type || "");
    const isGroup = messageType === "group";
    const isPrivate = messageType === "private";
    if (!isGroup && !isPrivate) return;

    const senderId = event.user_id != null ? String(event.user_id) : "";
    if (!senderId) return;
    if (botSelfId && senderId === botSelfId) return;

    const normalized = normalizeMessagePayload(event.message, botSelfId, requireAt, isGroup);
    if (normalized.shouldDropByMention) return;
    if (!normalized.text && normalized.attachments.length === 0) return;

    const chatId = isGroup ? event.group_id : event.user_id;
    if (chatId == null) return;

    const sender = event.sender && typeof event.sender === "object" ? event.sender : {};
    const senderName = String(sender.card || sender.nickname || senderId || "User");

    onMessage({
      platform: "onebot",
      agentId,
      chatId,
      userId: senderId,
      sessionKey: `${isGroup ? "ob_group_" : "ob_dm_"}${String(chatId)}@${agentId}`,
      text: normalized.text,
      senderName,
      isGroup,
      _msgId: event.message_id != null ? String(event.message_id) : undefined,
      replyTargetType: isGroup ? "group" : "user",
      attachments: normalized.attachments.length ? normalized.attachments : undefined,
    });
  }

  function mediaSegmentFor(metadata = {}, url = "") {
    const kind = String(metadata.kind || "").toLowerCase();
    if (kind === "video") return { type: "video", data: { file: url } };
    if (kind === "audio") return { type: "record", data: { file: url } };
    if (kind === "document") return { type: "file", data: { file: url } };
    return { type: "image", data: { file: url } };
  }

  void startupHealthCheck();

  return {
    mediaCapabilities: ONEBOT_MEDIA_CAPABILITIES,
    streamingCapabilities: ONEBOT_STREAMING_CAPABILITIES,

    ingestEvent,

    async sendReply(chatId, text, replyContext = null) {
      const context = normalizeReplyContext(replyContext);
      const target = resolveMessageTarget(chatId, context);
      const chunks = chunkText(text, 2000);
      for (const chunk of chunks) {
        const message = [{ type: "text", data: { text: chunk } }];
        await callAction("send_msg", { ...target, message, auto_escape: false });
      }
    },

    async sendBlockReply(chatId, text, replyContext = null) {
      await this.sendReply(chatId, text, replyContext);
    },

    async sendMedia(chatId, url, metadata = {}) {
      const target = resolveMessageTarget(chatId, metadata);
      const message = [mediaSegmentFor(metadata, String(url || ""))];
      await callAction("send_msg", { ...target, message, auto_escape: false });
    },

    async sendMediaFile(_chatId, _filePath, _metadata = {}) {
      throw new Error("OneBot local file send is not supported yet; use public URL delivery");
    },

    async sendMediaBuffer(_chatId, _buffer, _metadata = {}) {
      throw new Error("OneBot buffer send is not supported yet; use public URL delivery");
    },

    async getMe() {
      return callAction("get_login_info", {});
    },

    resolveOwnerChatId(userId) {
      return userId;
    },

    stop() {
      onStatus?.("disconnected");
    },
  };
}
