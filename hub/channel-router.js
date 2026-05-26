/**
 * ChannelRouter — 频道调度（从 engine.js 搬出）
 *
 * 频道 = 内部 Channel，和 Telegram/飞书一样通过 Hub 路由。
 * 包装 channel-ticker（不改 ticker，只提供回调）。
 *
 * 搬出的方法：
 *   _getChannelAgentOrder  → getAgentOrder()
 *   _executeChannelCheck   → _executeCheck()
 *   _executeChannelReply   → _executeReply()
 *   _channelMemorySummarize → _memorySummarize()
 *   _setupChannelPostHandler → setupPostHandler()
 *   toggleChannels          → toggle()
 */

import fs from "fs";
import path from "path";
import { createChannelTicker } from "../lib/channels/channel-ticker.js";
import { Type } from "../lib/pi-sdk/index.js";
import { appendMessage, formatMessagesForLLM, getChannelMembers, getChannelMeta, getRecentMessages } from "../lib/channels/channel-store.js";
import { extractMentionedAgentIds } from "../lib/channels/channel-mentions.js";
import { loadConfig } from "../lib/memory/config-loader.js";
import { callText } from "../core/llm-client.js";
import { runAgentPhoneSession } from "./agent-executor.js";
import { debugLog, createModuleLogger } from "../lib/debug-log.js";
import { getLocale } from "../server/i18n.js";
import {
  recordAgentPhoneActivity,
} from "../lib/conversations/agent-phone-projection.js";
import {
  readAgentPhoneRuntime,
  resolveAgentPhoneRuntimeSessionPath,
} from "../lib/conversations/agent-phone-runtime.js";
import { normalizeAgentPhoneToolMode } from "../lib/conversations/agent-phone-session.js";
import {
  DEFAULT_AGENT_PHONE_SETTINGS,
  formatAgentPhonePromptGuidance,
  normalizeAgentPhoneModelOverride,
  positiveIntegerOrDefault,
  positiveIntegerOrNull,
} from "../lib/conversations/agent-phone-prompt.js";

const log = createModuleLogger("channel");

export class ChannelRouter {
  /**
   * @param {object} opts
   * @param {import('./index.js').Hub} opts.hub
   */
  static _AGENT_ORDER_TTL = 30_000; // 30 秒

  constructor({ hub }) {
    this._hub = hub;
    this._ticker = null;
    this._agentOrderCache = null; // { list: string[], ts: number }
  }

  /** @returns {import('../core/engine.js').HanaEngine} */
  get _engine() { return this._hub.engine; }

  _getAgentInstance(agentId) {
    return this._engine.getAgent?.(agentId)
      || this._engine.agents?.get?.(agentId)
      || null;
  }

  _resolveMemoryMasterEnabled(agentId, { agentInstance = null, cfg = null } = {}) {
    if (agentInstance) return agentInstance.memoryMasterEnabled !== false;
    const resolvedCfg = cfg || loadConfig(path.join(this._engine.agentsDir, agentId, "config.yaml"));
    return resolvedCfg?.memory?.enabled !== false;
  }

  async _recordPhoneActivity(agentId, channelName, state, summary, details = {}) {
    try {
      const agent = this._getAgentInstance(agentId);
      const agentDir = agent?.agentDir || path.join(this._engine.agentsDir, agentId);
      const activity = {
        conversationId: channelName,
        conversationType: "channel",
        agentId,
        state,
        summary,
        details,
      };
      this._hub.agentPhoneActivities?.record?.(activity);
      await recordAgentPhoneActivity({
        agentDir,
        ...activity,
      });
    } catch (err) {
      debugLog()?.warn?.("channel", `phone activity record failed (${agentId}/#${channelName}): ${err.message}`);
    }
  }

  _resolvePhoneToolMode(channelName) {
    try {
      const filePath = path.join(this._engine.channelsDir, `${channelName}.md`);
      if (!fs.existsSync(filePath)) return "read_only";
      return normalizeAgentPhoneToolMode(getChannelMeta(filePath).agentPhoneToolMode);
    } catch {
      return "read_only";
    }
  }

  _resolveChannelPhoneSettings(channelName) {
    try {
      const filePath = path.join(this._engine.channelsDir, `${channelName}.md`);
      if (!fs.existsSync(filePath)) {
        return DEFAULT_AGENT_PHONE_SETTINGS;
      }
      const meta = getChannelMeta(filePath);
      const override = normalizeAgentPhoneModelOverride({
        enabled: meta.agentPhoneModelOverrideEnabled,
        id: meta.agentPhoneModelOverrideId,
        provider: meta.agentPhoneModelOverrideProvider,
      });
      return {
        toolMode: normalizeAgentPhoneToolMode(meta.agentPhoneToolMode),
        replyMinChars: positiveIntegerOrNull(meta.agentPhoneReplyMinChars),
        replyMaxChars: positiveIntegerOrNull(meta.agentPhoneReplyMaxChars),
        reminderIntervalMinutes: positiveIntegerOrDefault(
          meta.agentPhoneReminderIntervalMinutes,
          DEFAULT_AGENT_PHONE_SETTINGS.reminderIntervalMinutes,
        ),
        modelOverrideEnabled: override.enabled,
        modelOverrideModel: override.model,
      };
    } catch {
      return DEFAULT_AGENT_PHONE_SETTINGS;
    }
  }

  _formatPhonePromptGuidance(agentId, settings) {
    return formatAgentPhonePromptGuidance({
      agentId,
      agent: this._getAgentInstance(agentId),
      agentsDir: this._engine.agentsDir,
      settings,
      conversationName: "channel",
    });
  }

  _resolvePhoneSessionPath(agentId, channelName) {
    try {
      const agent = this._getAgentInstance(agentId);
      const agentDir = agent?.agentDir || path.join(this._engine.agentsDir, agentId);
      return resolveAgentPhoneRuntimeSessionPath(agentDir, readAgentPhoneRuntime(agentDir, channelName));
    } catch {
      return null;
    }
  }

  _createChannelPhoneTools(agentId, channelName, { setDecision } = {}) {
    const engine = this._engine;
    const channelFile = path.join(engine.channelsDir || "", `${channelName}.md`);
    let decided = false;

    const markDecision = (decision) => {
      if (decided) return false;
      decided = true;
      setDecision?.(decision);
      return true;
    };
    const isCurrentMember = () => {
      if (!fs.existsSync(channelFile)) return false;
      return getChannelMembers(channelFile).includes(agentId);
    };
    const notMemberResult = (action) => ({
      content: [{
        type: "text",
        text: "Action failed: you are no longer a member of this channel.",
      }],
      details: { action, error: "not a channel member" },
    });

    return [
      {
        name: "channel_read_context",
        label: "Read channel context",
        description: "Read recent messages from the current phone channel. The source is the channel transcript Truth, not your phone session.",
        parameters: Type.Object({
          count: Type.Optional(Type.Number({
            description: "Number of recent messages to read, defaults to 20, max 50.",
          })),
        }),
        execute: async (_toolCallId, params = {}) => {
          if (!fs.existsSync(channelFile)) {
            return {
              content: [{ type: "text", text: "Channel not found." }],
              details: { action: "read_context", error: "channel not found" },
            };
          }
          if (!isCurrentMember()) return notMemberResult("read_context");
          const count = Math.max(1, Math.min(50, Number(params.count) || 20));
          const messages = getRecentMessages(channelFile, count);
          return {
            content: [{
              type: "text",
              text: messages.length > 0 ? formatMessagesForLLM(messages) : "No channel messages.",
            }],
            details: { action: "read_context", channel: channelName, messageCount: messages.length },
          };
        },
      },
      {
        name: "channel_reply",
        label: "Send channel message",
        description: "Send this turn's reply to the current channel. Only this tool's content is posted; ordinary generated text stays in your phone activity.",
        parameters: Type.Object({
          content: Type.String({
            description: "Message body to post. Do not include mood, explanations, or tool-call notes.",
          }),
          mood: Type.Optional(Type.String({
            description: "Optional private mood summary. Stored in tool details, not posted.",
          })),
        }),
        execute: async (_toolCallId, params = {}) => {
          const content = String(params.content || "").trim();
          if (!content) {
            return {
              content: [{ type: "text", text: "Send failed: content is empty." }],
              details: { action: "reply", error: "empty content" },
            };
          }
          if (decided) {
            return {
              content: [{ type: "text", text: "This phone turn already made a channel decision." }],
              details: { action: "reply", error: "already decided" },
            };
          }
          if (engine.isChannelsEnabled && !engine.isChannelsEnabled()) {
            return {
              content: [{ type: "text", text: "Send failed: channels are disabled." }],
              details: { action: "reply", error: "channels disabled" },
            };
          }
          if (!fs.existsSync(channelFile)) {
            return {
              content: [{ type: "text", text: "Send failed: channel not found." }],
              details: { action: "reply", error: "channel not found" },
            };
          }
          if (!isCurrentMember()) return notMemberResult("reply");

          const { timestamp } = await appendMessage(channelFile, agentId, content);
          const decision = {
            type: "reply",
            replied: true,
            replyContent: content,
            timestamp,
            mood: typeof params.mood === "string" ? params.mood : null,
          };
          markDecision(decision);

          this._hub.eventBus.emit({
            type: "channel_new_message",
            channelName,
            sender: agentId,
            message: { sender: agentId, timestamp, body: content },
          }, null);

          return {
            content: [{ type: "text", text: `Posted to #${channelName}` }],
            details: { action: "reply", channel: channelName, timestamp, mood: decision.mood },
          };
        },
      },
      {
        name: "channel_pass",
        label: "Pass this turn",
        description: "Mark these phone channel messages as seen while choosing not to post this turn.",
        parameters: Type.Object({
          reason: Type.Optional(Type.String({
            description: "Brief reason for not posting this turn.",
          })),
          mood: Type.Optional(Type.String({
            description: "Optional private mood summary for this decision.",
          })),
        }),
        execute: async (_toolCallId, params = {}) => {
          if (decided) {
            return {
              content: [{ type: "text", text: "This phone turn already made a channel decision." }],
              details: { action: "pass", error: "already decided" },
            };
          }
          if (!isCurrentMember()) return notMemberResult("pass");
          const decision = {
            type: "pass",
            replied: false,
            passed: true,
            reason: typeof params.reason === "string" ? params.reason : "",
            mood: typeof params.mood === "string" ? params.mood : null,
          };
          markDecision(decision);
          return {
            content: [{ type: "text", text: "Marked as pass for this turn." }],
            details: { action: "pass", channel: channelName, reason: decision.reason, mood: decision.mood },
          };
        },
      },
    ];
  }

  // ──────────── 生命周期 ────────────

  start() {
    const engine = this._engine;
    if (!engine.channelsDir) return;
    if (this._ticker) return;

    this._ticker = createChannelTicker({
      channelsDir: engine.channelsDir,
      agentsDir: engine.agentsDir,
      getAgentOrder: () => this.getAgentOrder(),
      executeCheck: (agentId, channelName, newMessages, allUpdates, opts) =>
        this._executeCheck(agentId, channelName, newMessages, allUpdates, opts),
      onMemorySummarize: (agentId, channelName, contextText) =>
        this._memorySummarize(agentId, channelName, contextText),
      onEvent: (event, data) => {
        this._hub.eventBus.emit({ type: event, ...data }, null);
      },
      isEnabled: () => engine.isChannelsEnabled?.() !== false,
    });
    this._ticker.start();
  }

  ensureStarted() {
    if (this._ticker) return true;
    if (!this._engine.isChannelsEnabled?.()) return false;
    this.start();
    this.setupPostHandler();
    return !!this._ticker;
  }

  async stop() {
    if (this._ticker) {
      await this._ticker.stop();
      this._ticker = null;
    }
  }

  async toggle(enabled) {
    if (enabled) {
      if (this._ticker) return;
      this.start();
      this.setupPostHandler();
    } else {
      await this.stop();
    }
  }

  triggerImmediate(channelName, opts) {
    this.ensureStarted();
    return this._ticker?.triggerImmediate(channelName, opts) || Promise.resolve();
  }

  refreshProactiveSchedule() {
    if (!this.ensureStarted()) return;
    this._ticker?.refreshSchedule?.();
  }

  _listMentionableAgents() {
    if (typeof this._engine.listAgents === "function") {
      return this._engine.listAgents();
    }
    return this.getAgentOrder().map((id) => {
      const agent = this._getAgentInstance(id);
      if (agent?.agentName) return { id, name: agent.agentName, agentName: agent.agentName };
      try {
        const cfg = loadConfig(path.join(this._engine.agentsDir, id, "config.yaml"));
        return { id, name: cfg?.agent?.name || id };
      } catch {
        return { id, name: id };
      }
    });
  }

  _extractMentionedAgents(channelName, message) {
    const text = typeof message === "string" ? message : message?.body;
    if (!text) return [];
    const channelFile = path.join(this._engine.channelsDir || "", `${channelName}.md`);
    const meta = getChannelMeta(channelFile);
    return extractMentionedAgentIds(text, {
      channelMembers: Array.isArray(meta.members) ? meta.members : [],
      agents: this._listMentionableAgents(),
    });
  }

  /**
   * 注入频道 post 回调到当前 agent
   * agent 用 channel tool 发消息后，触发其他 agent 的手机送达
   */
  setupPostHandler() {
    for (const [, agent] of this._engine.agents || []) {
      agent.setChannelPostHandler((channelName, senderId, message) => {
        debugLog()?.log("channel", `agent ${senderId} posted to #${channelName}, triggering phone delivery`);
        if (message) {
          this._hub.eventBus.emit({
            type: "channel_new_message",
            channelName,
            sender: senderId,
            message,
          }, null);
        }
        const mentionedAgents = this._extractMentionedAgents(channelName, message);
        const opts = mentionedAgents.length > 0 ? { mentionedAgents } : undefined;
        this.triggerImmediate(channelName, opts)?.catch(err =>
          log.error(`agent post delivery 失败: ${err.message}`)
        );
      });
    }
  }

  // ──────────── 频道 Agent 顺序 ────────────

  /** 获取频道轮转候选 agent 列表；具体频道 membership 由 channel frontmatter 决定 */
  getAgentOrder() {
    const now = Date.now();
    if (this._agentOrderCache && now - this._agentOrderCache.ts < ChannelRouter._AGENT_ORDER_TTL) {
      return this._agentOrderCache.list;
    }
    try {
      const entries = fs.readdirSync(this._engine.agentsDir, { withFileTypes: true });
      const list = entries
        .filter(e => e.isDirectory())
        .filter(e => {
          const configPath = path.join(this._engine.agentsDir, e.name, "config.yaml");
          return fs.existsSync(configPath);
        })
        .map(e => e.name);
      this._agentOrderCache = { list, ts: now };
      return list;
    } catch {
      return [];
    }
  }

  // ──────────── Phone Delivery + Reply ────────────

  /**
   * 频道检查回调：未读消息送达 → Agent Phone Session → 频道工具写入或 pass
   * 从 engine._executeChannelCheck 搬入
   */
  async _executeCheck(agentId, channelName, newMessages, _allChannelUpdates, {
    signal,
    proactive = false,
    mentionedAgents = [],
    mentionTargeted = false,
    deliveryWindow = null,
  } = {}) {
    const msgText = formatMessagesForLLM(newMessages);
    const isZh = getLocale().startsWith("zh");
    const lastNewMessage = newMessages[newMessages.length - 1] || null;
    await this._recordPhoneActivity(
      agentId,
      channelName,
      "viewed",
      isZh ? `已查看 ${newMessages.length} 条新消息` : `Viewed ${newMessages.length} new message(s)`,
      {
        messageCount: newMessages.length,
        totalUnreadCount: deliveryWindow?.totalUnreadCount ?? newMessages.length,
        droppedUnreadCount: deliveryWindow?.droppedUnreadCount ?? 0,
        bookmarkState: deliveryWindow?.bookmarkState ?? null,
        lastMessageTimestamp: lastNewMessage?.timestamp || null,
      },
    );

    // ── 手机送达：不做 utility 预判，Agent 必须用频道专属工具完成本轮 ──
    try {
      await this._recordPhoneActivity(
        agentId,
        channelName,
        "replying",
        proactive
          ? (isZh ? "收到频道提醒，正在看群聊" : "Received channel reminder and is reading")
          : (isZh ? "正在查看手机群聊" : "Reading phone channel messages"),
        {
          messageCount: newMessages.length,
          proactive,
          totalUnreadCount: deliveryWindow?.totalUnreadCount ?? newMessages.length,
          droppedUnreadCount: deliveryWindow?.droppedUnreadCount ?? 0,
        },
      );
      const decision = await this._executeReply(agentId, channelName, msgText, {
        signal,
        messageCount: newMessages.length,
        deliveryWindow,
        proactive,
        mentionedAgents,
        mentionTargeted,
      });

      if (decision?.replied) {
        log.log(`${agentId} replied #${channelName} (${decision.replyContent.length} chars)`);
        await this._recordPhoneActivity(
          agentId,
          channelName,
          "idle",
          isZh ? "已回复" : "Replied",
          {
            replyTimestamp: decision.timestamp,
            ...(decision.mood ? { mood: decision.mood } : {}),
            ...(this._resolvePhoneSessionPath(agentId, channelName)
              ? { sessionPath: this._resolvePhoneSessionPath(agentId, channelName) }
              : {}),
          },
        );
        return { replied: true, replyContent: decision.replyContent };
      }

      if (decision?.passed) {
        await this._recordPhoneActivity(
          agentId,
          channelName,
          "no_reply",
          isZh ? "已查看，选择不发言" : "Viewed and chose not to post",
          {
            messageCount: newMessages.length,
            ...(decision.reason ? { reason: decision.reason } : {}),
            ...(decision.mood ? { mood: decision.mood } : {}),
            ...(this._resolvePhoneSessionPath(agentId, channelName)
              ? { sessionPath: this._resolvePhoneSessionPath(agentId, channelName) }
              : {}),
          },
        );
        return { replied: false, passed: true };
      }

      await this._recordPhoneActivity(
        agentId,
        channelName,
        "error",
        isZh ? "没有调用频道回复工具" : "Did not call a channel decision tool",
        {
          messageCount: newMessages.length,
          ...(this._resolvePhoneSessionPath(agentId, channelName)
            ? { sessionPath: this._resolvePhoneSessionPath(agentId, channelName) }
            : {}),
        },
      );
      return { replied: false, missingDecision: true };
    } catch (err) {
      log.error(`回复失败 (${agentId}/#${channelName}): ${err.message}`);
      await this._recordPhoneActivity(
        agentId,
        channelName,
        "error",
        isZh ? "处理消息失败" : "Failed to process message",
        { error: err.message },
      );
      return { replied: false };
    }
  }

  /**
   * 将未读群聊消息送入 Agent Phone session。频道写入只能由 channel_reply 工具完成。
   */
  _formatMentionGuidance(agentId, mentionedAgents, mentionTargeted) {
    const ids = Array.from(new Set(
      Array.isArray(mentionedAgents)
        ? mentionedAgents.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
        : [],
    ));
    if (ids.length === 0) return "";

    const names = ids
      .map((id) => this._resolveChannelMemorySenderName(id))
      .filter(Boolean)
      .join(", ");
    if (mentionTargeted || ids.includes(agentId)) {
      return [
        `- This turn explicitly @mentioned you (${names || agentId}); you were prioritized for this phone check`,
        "- Decide whether a reply is useful; if there is nothing to add, call channel_pass",
      ].join("\n");
    }

    return [
      `- This turn explicitly @mentioned ${names || ids.join(", ")}. You can still see this channel Truth, but do not steal the reply`,
      "- Unless you truly need to add context, correct something, or move the topic forward, call channel_pass",
    ].join("\n");
  }

  _formatChannelBehaviorGuidance(agentId, mentionedAgents, mentionTargeted) {
    const mentionGuidance = this._formatMentionGuidance(agentId, mentionedAgents, mentionTargeted);
    if (mentionGuidance) return mentionGuidance;
    return [
      "- You may post because you were asked, mentioned, have something useful to add, want to move the topic, want to start a topic, or feel it is worth saying",
      "- You do not need the topic to be directly about you",
    ].join("\n");
  }

  _formatDeliveryWindowGuidance(deliveryWindow) {
    const dropped = Number(deliveryWindow?.droppedUnreadCount || 0);
    if (dropped <= 0) return "";
    return [
      `Note: ${dropped} older unread message(s) were not included in this delivery window.`,
      "Use channel_read_context to read the channel Truth when you need older context, and interpret this window together with the prior Phone Session content.",
    ].join("\n");
  }

  async _executeReply(agentId, channelName, msgText, {
    signal,
    messageCount = null,
    deliveryWindow = null,
    proactive = false,
    mentionedAgents = [],
    mentionTargeted = false,
  } = {}) {
    const isZh = getLocale().startsWith("zh"); // kept for UI-display activity recording
    const phoneSettings = this._resolveChannelPhoneSettings(channelName);
    const promptGuidance = this._formatPhonePromptGuidance(agentId, phoneSettings);
    const behaviorGuidance = this._formatChannelBehaviorGuidance(agentId, mentionedAgents, mentionTargeted);
    const deliveryWindowGuidance = this._formatDeliveryWindowGuidance(deliveryWindow);
    const intro = proactive
      ? `Your phone received a channel reminder for #${channelName}.\n\n`
        + `Here is recent channel content. The source is the channel transcript Truth, not a direct user request, and it may not be new:\n\n`
      : `Your phone received new messages in #${channelName}.\n\n`
        + `These are the unprocessed new messages inside this delivery window, not the channel's full history. The source is the channel transcript Truth, not a direct user request:\n\n`;
    let activeSessionPath = null;
    let decision = null;
    await runAgentPhoneSession(
      agentId,
      [
        {
          text: intro
            + `${msgText || "(No new messages)"}\n\n`
            + `${deliveryWindowGuidance ? `${deliveryWindowGuidance}\n\n` : ""}`
            + `Read and act like a group chat member:\n`
            + `${behaviorGuidance}\n`
            + `- Use channel_read_context for older channel Truth; use search_memory for facts and long-term background\n`
            + `- Interpret this batch together with the prior Phone Session content; this delivery window is not the channel's full history\n`
            + `${promptGuidance}\n`
            + `- End this turn by calling exactly one of channel_reply or channel_pass\n`
            + `- Do not write the final channel reply as ordinary text; only channel_reply.content enters the channel`,
          capture: true,
        },
      ],
      {
        engine: this._engine,
        signal,
        conversationId: channelName,
        conversationType: "channel",
        toolMode: phoneSettings.toolMode,
        modelOverride: phoneSettings.modelOverrideEnabled ? phoneSettings.modelOverrideModel : null,
        emitEvents: true,
        extraCustomTools: this._createChannelPhoneTools(agentId, channelName, {
          setDecision: (next) => { if (!decision) decision = next; },
        }),
        onSessionReady: (sessionPath) => {
          activeSessionPath = sessionPath;
          return this._recordPhoneActivity(
            agentId,
            channelName,
            "replying",
            isZh ? "正在查看手机群聊" : "Reading phone channel messages",
            {
              ...(messageCount != null ? { messageCount } : {}),
              sessionPath,
            },
          );
        },
        onActivity: (state, summary, details) =>
          this._recordPhoneActivity(
            agentId,
            channelName,
            state,
            summary,
            {
              ...(details || {}),
              ...(activeSessionPath ? { sessionPath: activeSessionPath } : {}),
            },
        ),
      },
    );

    return decision || { replied: false, missingDecision: true };
  }

  _resolveChannelMemorySenderName(sender) {
    const rawSender = String(sender || "").trim();
    if (!rawSender) return "Unknown";
    if (rawSender === "system") return "System";

    const engine = this._engine;
    if (rawSender === "user" || rawSender === engine.userName) {
      return engine.userName || "User";
    }

    const agent = this._getAgentInstance(rawSender);
    if (agent?.agentName) return agent.agentName;

    try {
      const cfg = loadConfig(path.join(engine.agentsDir, rawSender, "config.yaml"));
      const name = cfg?.agent?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
      // Best effort for legacy channel logs whose sender no longer exists.
    }

    return rawSender;
  }

  _formatChannelMemoryContext(agentId, payload) {
    if (typeof payload === "string") return payload;

    const lines = [];
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    for (const message of messages) {
      const speaker = this._resolveChannelMemorySenderName(message?.sender);
      const body = String(message?.body || "").trim();
      if (!body) continue;
      const timestamp = String(message?.timestamp || "").trim();
      lines.push(timestamp ? `[${timestamp}] ${speaker}: ${body}` : `${speaker}: ${body}`);
    }

    const replyContent = String(payload?.replyContent || "").trim();
    if (replyContent) {
      const replyLabel = "[My reply]";
      const agentName = this._resolveChannelMemorySenderName(agentId);
      lines.push(`${replyLabel} ${agentName}: ${replyContent}`);
    }

    const legacyText = String(payload?.contextText || "").trim();
    if (legacyText) lines.push(legacyText);
    return lines.join("\n\n");
  }

  _channelMemorySystemPrompt() {
    return [
      "Compress the channel transcript Truth into searchable long-term memory.",
      "Output 1 to 3 clean short facts separated by semicolons; each fact must state who did what, what was decided, or what state changed.",
      "If existing channel memory is provided, merge and rewrite it with the current channel content, cleaning old ids, vague subjects, and messy summaries.",
      "Use the display names from the input. Do not keep sender ids, chat logs, headings, bullets, mood, vague subjects, or generic group references.",
      "If there is no durable searchable value, output NO_MEMORY.",
    ].join("\n");
  }

  _normalizeChannelMemorySummary(rawSummary) {
    return String(rawSummary || "")
      .trim()
      .replace(/^```(?:\w+)?\s*/u, "")
      .replace(/\s*```$/u, "")
      .trim();
  }

  _isEmptyChannelMemorySummary(summaryText) {
    const normalized = String(summaryText || "").trim().toUpperCase();
    return !normalized || normalized === "NO_MEMORY" || normalized === "无记忆";
  }

  _getPreviousChannelMemoryFacts(factStore, sessionId) {
    if (typeof factStore?.getBySession !== "function") {
      return [];
    }
    return factStore.getBySession(sessionId) || [];
  }

  _clearPreviousChannelMemoryFacts(factStore, sessionId, previousFacts = null) {
    if (typeof factStore?.delete !== "function") {
      return;
    }
    const facts = Array.isArray(previousFacts)
      ? previousFacts
      : this._getPreviousChannelMemoryFacts(factStore, sessionId);
    for (const fact of facts) {
      if (fact?.id != null) factStore.delete(fact.id);
    }
  }

  _formatChannelMemoryPromptContent(channelName, contextText, previousFacts) {
    const previousText = previousFacts
      .map(fact => String(fact?.fact || "").trim())
      .filter(Boolean)
      .join("\n");
    const clippedContext = contextText.slice(0, 3000);
    const clippedPrevious = previousText.slice(0, 2000);
    return [
      `Channel #${channelName}`,
      "Existing channel memory (may contain old ids or messy summaries; clean and merge it):",
      clippedPrevious || "(none)",
      "Current channel content:",
      clippedContext,
    ].join("\n");
  }

  /**
   * 频道记忆摘要
   * 从 engine._channelMemorySummarize 搬入
   */
  async _memorySummarize(agentId, channelName, payload, { signal } = {}) {
    const engine = this._engine;
    let factStore = null;
    let needClose = false;
    try {
      // 记忆 master 关闭时不写入新记忆（频道摘要是写侧操作）
      const agentInstance = this._getAgentInstance(agentId);
      const memoryMasterOn = this._resolveMemoryMasterEnabled(agentId, { agentInstance });
      if (!memoryMasterOn) {
        log.log(`${agentId} memory master 已关闭，跳过频道记忆摘要`);
        return;
      }

      const utilCfg = engine.resolveUtilityConfig({ agentId }) || {};
      const { utility: model, api_key, base_url, api } = utilCfg;
      if (!api_key || !base_url || !api) {
        log.log(`${agentId} 无 API 配置，跳过记忆摘要`);
        return;
      }

      // 被中断时跳过摘要，避免关闭时孤儿请求报错
      if (signal?.aborted) {
        log.log(`${agentId} 已中断，跳过记忆摘要`);
        return;
      }

      const contextText = this._formatChannelMemoryContext(agentId, payload);
      if (!contextText.trim()) return;

      // 写入 agent 的 fact store
      const sessionId = `channel-${channelName}`;

      if (agentInstance?.factStore) {
        factStore = agentInstance.factStore;
      } else {
        const { FactStore } = await import("../lib/memory/fact-store.js");
        const dbPath = path.join(engine.agentsDir, agentId, "memory", "facts.db");
        factStore = new FactStore(dbPath);
        needClose = true;
      }

      const previousFacts = this._getPreviousChannelMemoryFacts(factStore, sessionId);
      const rawSummary = await callText({
        api, model,
        apiKey: api_key,
        baseUrl: base_url,
        systemPrompt: this._channelMemorySystemPrompt(),
        messages: [{
          role: "user",
          content: this._formatChannelMemoryPromptContent(channelName, contextText, previousFacts),
        }],
        temperature: 0.3,
        maxTokens: 200,
        signal,
        usageLedger: engine.usageLedger,
        usageContext: {
          source: {
            subsystem: "memory",
            operation: "channel_memory_summary",
            surface: "channel",
            trigger: "scheduled",
          },
          attribution: {
            kind: "memory",
            agentId,
          },
        },
      });
      const summaryText = this._normalizeChannelMemorySummary(rawSummary);

      const now = new Date();
      this._clearPreviousChannelMemoryFacts(factStore, sessionId, previousFacts);
      if (this._isEmptyChannelMemorySummary(summaryText)) {
        log.log(`${agentId} memory cleared/no durable summary (#${channelName})`);
        return;
      }
      factStore.add({
        fact: `[#${channelName}] ${summaryText}`,
        tags: ["channel", channelName],
        time: now.toISOString().slice(0, 16),
        session_id: sessionId,
      });

      log.log(`${agentId} memory saved (#${channelName}, ${summaryText.length} chars)`);
    } catch (err) {
      // abort / timeout 属于正常中断，不报错
      if (err?.name === "AbortError" || err?.code === "LLM_TIMEOUT" || err?.code === "LLM_EMPTY_RESPONSE") {
        log.log(`记忆摘要跳过 (${agentId}/#${channelName}): ${err.message || err.code}`);
      } else {
        log.error(`记忆摘要失败 (${agentId}/#${channelName}): ${err.message}`);
      }
    } finally {
      if (needClose) factStore?.close?.();
    }
  }
}
