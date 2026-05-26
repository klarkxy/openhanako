/**
 * session-summary.js — Session 摘要管理器
 *
 * 每个 session 一个 JSON 文件（存在 memory/summaries/ 下），
 * 包含摘要文本 + 深度记忆处理的 snapshot。
 *
 * 摘要通过 rollingSummary() 滚动更新（覆盖式，非追加），
 * 输出固定为 ### 重要事实 + ### 事情经过 两节格式。
 *
 * 同时服务：
 * - 普通记忆（compile.js 读摘要 → 递归压缩 → memory.md）
 * - 深度记忆（deep-memory.js 读 snapshot diff → 拆元事实）
 */

import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../../shared/safe-fs.js";
import { scrubPII } from "../pii-guard.js";
import { callText } from "../../core/llm-client.js";
import { getToolArgs, isToolCallBlock } from "../../core/llm-utils.js";
import { readCompiledResetAt } from "./compiled-memory-state.js";
import {
  buildSourceTimeRange,
  formatZonedDateTime,
  resolveMemoryTimeZone,
} from "./time-context.js";
import { createModuleLogger } from "../debug-log.js";

const log = createModuleLogger("session-summary");

export class SessionSummaryManager {
  /**
   * @param {string} summariesDir - summaries/ 目录的绝对路径
   */
  constructor(summariesDir) {
    this.summariesDir = summariesDir;
    fs.mkdirSync(summariesDir, { recursive: true });
    this._cache = new Map();          // sessionId → summary data
    this._cachePopulated = false;     // 是否已做过全量扫描
  }

  // ════════════════════════════
  //  读写
  // ════════════════════════════

  /**
   * 读取指定 session 的摘要
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSummary(sessionId) {
    if (this._cache.has(sessionId)) return this._cache.get(sessionId);
    const fp = this._filePath(sessionId);
    try {
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      this._cache.set(sessionId, data);
      return data;
    } catch {
      return null;
    }
  }

  /**
   * 写入摘要（原子写入）
   * @param {string} sessionId
   * @param {object} data
   */
  saveSummary(sessionId, data) {
    const fp = this._filePath(sessionId);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    atomicWriteSync(fp, JSON.stringify(data, null, 2) + "\n");
    this._cache.set(sessionId, data);
  }

  // ════════════════════════════
  //  脏 session 追踪（供深度记忆用）
  // ════════════════════════════

  /**
   * 获取所有"脏" session（summary !== snapshot）
   * @returns {Array<{ session_id, summary, snapshot, snapshot_at, updated_at }>}
   */
  getDirtySessions(opts = {}) {
    this._ensureCachePopulated();
    const since = normalizeSince(opts.since);
    const dirty = [];
    for (const data of this._cache.values()) {
      if (!data?.summary) continue;
      if (since && !isAfter(data.updated_at || data.created_at, since)) continue;
      if (data.summary !== (data.snapshot || "")) {
        dirty.push(data);
      }
    }
    return dirty;
  }

  /**
   * 标记 session 已被深度记忆处理（snapshot = summary）
   * @param {string} sessionId
   */
  markProcessed(sessionId) {
    const data = this.getSummary(sessionId);
    if (!data) return;

    data.snapshot = data.summary;
    data.snapshot_at = new Date().toISOString();
    this.saveSummary(sessionId, data);
  }

  // ════════════════════════════
  //  查询
  // ════════════════════════════

  /**
   * 获取所有摘要（按 updated_at 降序）
   * @returns {Array<object>}
   */
  getAllSummaries() {
    this._ensureCachePopulated();
    const summaries = [];
    for (const data of this._cache.values()) {
      if (data?.summary) summaries.push(data);
    }
    summaries.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return summaries;
  }

  /** 首次调用时做一次全量扫描填充缓存 */
  _ensureCachePopulated() {
    if (this._cachePopulated) return;
    const files = this._listFiles();
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (data?.session_id) this._cache.set(data.session_id, data);
      } catch {}
    }
    this._cachePopulated = true;
  }

  /**
   * 获取指定日期范围内的摘要
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Array<object>}
   */
  getSummariesInRange(startDate, endDate, opts = {}) {
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();
    const since = normalizeSince(opts.since);

    return this.getAllSummaries().filter((s) => {
      const updated = s.updated_at || s.created_at || "";
      if (updated < startISO || updated > endISO) return false;
      if (since && !isAfter(updated, since)) return false;
      return true;
    });
  }

  clearCache() {
    this._cache.clear();
    this._cachePopulated = false;
  }

  clearAll() {
    fs.mkdirSync(this.summariesDir, { recursive: true });
    for (const file of this._listFiles()) {
      try { fs.unlinkSync(file); } catch (err) {
        if (err?.code !== "ENOENT") throw err;
      }
    }
    this.clearCache();
  }

  // ════════════════════════════
  //  内部
  // ════════════════════════════

  _filePath(sessionId) {
    // session 文件名可能包含时间戳前缀（如 1234567890_uuid），
    // 直接取 uuid 部分（去掉 .jsonl 后缀和时间戳前缀）
    const cleanId = sessionId.replace(/\.jsonl$/, "");
    return path.join(this.summariesDir, `${cleanId}.json`);
  }

  _listFiles() {
    try {
      return fs.readdirSync(this.summariesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(this.summariesDir, f));
    } catch {
      return [];
    }
  }

  /**
   * 从消息列表构建带时间戳的对话文本
   * @param {Array<{role: string, content: any, timestamp?: string}>} messages
   * @returns {string}
   */
  _buildConversationText(messages, opts = {}) {
    const parts = [];
    const timeZone = resolveMemoryTimeZone(opts.timeZone);

    for (const msg of messages) {
      const segments = this._extractSummarySegments(msg);
      if (segments.length === 0) continue;

      // 时间标注
      let timePrefix = "";
      if (msg.timestamp) {
        const d = new Date(msg.timestamp);
        if (!isNaN(d.getTime())) {
          timePrefix = `[${formatZonedDateTime(d, timeZone)}] `;
        }
      }

      const speaker = msg.role === "user" ? "User" : "Assistant";
      for (const segment of segments) {
        parts.push(`${timePrefix}【${speaker}】${segment}`);
      }
    }

    return parts.join("\n\n");
  }

  _extractSummarySegments(msg) {
    if (!msg?.content) return [];

    if (typeof msg.content === "string") {
      const text = msg.content.trim();
      return text ? [text] : [];
    }

    if (!Array.isArray(msg.content)) return [];

    const segments = [];
    let textBuffer = "";
    const flushText = () => {
      const text = textBuffer.trim();
      if (text) segments.push(text);
      textBuffer = "";
    };

    for (const block of msg.content) {
      if (block?.type === "text" && block.text) {
        textBuffer += block.text;
        continue;
      }

      if (msg.role === "assistant" && isToolCallBlock(block)) {
        flushText();
        const title = this._summarizeToolCall(block);
        if (title) segments.push(title);
      }
    }

    flushText();
    return segments;
  }

  _summarizeToolCall(block) {
    const name = String(block?.name || "").trim();
    if (!name) return "";
    const args = getToolArgs(block) && typeof getToolArgs(block) === "object" ? getToolArgs(block) : {};
    const pick = (...keys) => {
      for (const key of keys) {
        const value = args[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };
    const shorten = (text, limit = 120) => {
      if (!text) return "";
      return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
    };

    switch (name) {
      case "read":
      case "read_file":
        return `Read ${pick("file_path", "path")}`;
      case "write":
        return `Wrote ${pick("file_path", "path")}`;
      case "edit":
      case "edit-diff":
        return `Edited ${pick("file_path", "path")}`;
      case "bash":
        return `Ran command ${shorten(pick("command"), 80)}`;
      case "glob":
      case "find":
        return `Searched for ${shorten(pick("pattern"), 80)}`;
      case "grep": {
        const pattern = shorten(pick("pattern"), 60);
        const target = pick("path");
        return `Searched ${pattern}${target ? ` in ${target}` : ""}`;
      }
      case "ls":
        return `Listed ${pick("path")}`;
      case "web_fetch":
        return `Fetched ${pick("url")}`;
      case "web_search":
        return `Searched ${shorten(pick("query"), 80)}`;
      case "browser": {
        const action = pick("action");
        const url = pick("url");
        const detail = url || action;
        return `Used browser${detail ? ` (${detail})` : ""}`;
      }
      case "search_memory":
        return `Searched memory ${shorten(pick("query"), 80)}`;
      case "subagent":
        return `Started subagent${pick("task", "prompt") ? `: ${shorten(pick("task", "prompt"), 80)}` : ""}`;
      case "wait":
        return `Waited ${pick("seconds") || "?"} seconds`;
      case "dm":
        return `Sent DM${pick("to") ? ` to ${pick("to")}` : ""}`;
      case "channel":
        return `Used channel ${pick("channel", "name")}`;
      case "cron":
        return `Scheduled task${pick("label", "prompt") ? `: ${shorten(pick("label", "prompt"), 80)}` : ""}`;
      case "notify":
        return `Sent notification${pick("title") ? `: ${shorten(pick("title"), 80)}` : ""}`;
      case "artifact":
        return `Generated artifact${pick("title") ? `: ${shorten(pick("title"), 80)}` : ""}`;
      case "install_skill":
        return `Installed skill ${pick("skill_name")}`;
      case "update_settings":
        return `Updated setting ${pick("key", "setting")}`;
      default: {
        const detail = shorten(
          pick("file_path", "path", "query", "url", "command", "pattern", "prompt", "label", "title"),
          80,
        );
        return `Called ${name}${detail ? `: ${detail}` : ""}`;
      }
    }
  }

  // ════════════════════════════
  //  滚动摘要
  // ════════════════════════════

  /**
   * 滚动更新 session 摘要：每 10 轮或 session 结束时触发。
   * 若有旧摘要则将旧摘要 + 新对话合并产出新摘要（覆盖，非追加）；
   * 若无旧摘要则直接从对话生成。
   * 输出格式固定为两节：### 重要事实 + ### 事情经过。
   *
   * @param {string} sessionId
   * @param {Array<{role: string, content: any, timestamp?: string}>} messages
   * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
   * @returns {Promise<string>} 更新后的摘要文本
   */
  async rollingSummary(sessionId, messages, resolvedModel, opts = {}) {
    const resetAt = latestSince(opts.resetAt, readCompiledResetAt(path.dirname(this.summariesDir)));
    const existingRaw = this.getSummary(sessionId);
    const existing = resetAt && existingRaw && !isAfter(existingRaw.updated_at || existingRaw.created_at, resetAt)
      ? null
      : existingRaw;
    const prevSummary = existing?.summary || "";

    // 增量：只取上次摘要之后的新消息，避免长 session 上下文爆炸
    const lastMessageCount = existing?.messageCount || 0;
    const newMessages = lastMessageCount > 0 && lastMessageCount < messages.length
      ? messages.slice(lastMessageCount)
      : messages; // 旧数据无 messageCount 时 fallback 到全量

    const timeZone = resolveMemoryTimeZone(opts.timeZone);
    const sourceTimeRange = buildSourceTimeRange(messages, { timeZone });
    const convText = this._buildConversationText(newMessages, { timeZone });
    if (!convText) return prevSummary;

    // 按全量用户轮数计算摘要配额（预算反映对话整体体量，输入只传增量）
    const turnCount = messages.filter((m) => m.role === "user").length;
    let newSummary = await this._callRollingLLM(convText, prevSummary, resolvedModel, turnCount, {
      memoryReflectionSnapshot: opts.memoryReflectionSnapshot,
    });
    if (!newSummary?.trim()) return prevSummary;

    const latestResetAt = latestSince(resetAt, readCompiledResetAt(path.dirname(this.summariesDir)));
    if (latestResetAt && !areMessagesAfter(messages, latestResetAt)) return prevSummary;

    // PII 脱敏
    const { cleaned: scrubbedRolling, detected: rollingDetected } = scrubPII(newSummary);
    if (rollingDetected.length > 0) {
      log.warn(`PII detected in rolling summary (${rollingDetected.join(", ")}), redacted`);
      newSummary = scrubbedRolling;
    }

    const now = new Date().toISOString();
    this.saveSummary(sessionId, {
      session_id: sessionId,
      created_at: existing?.created_at || now,
      updated_at: now,
      summary: newSummary.trim(),
      messageCount: messages.length, // 记录已覆盖的消息总数
      source_time_range: sourceTimeRange || existing?.source_time_range || null,
      snapshot: existing?.snapshot || "",
      snapshot_at: existing?.snapshot_at || null,
    });

    return newSummary.trim();
  }

  /**
   * 调用 LLM 生成滚动摘要（两节格式）
   * @param {string} convText - 本次对话文本
   * @param {string} prevSummary - 上一次摘要（可为空）
   * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
   * @returns {Promise<string>}
   */
  async _callRollingLLM(convText, prevSummary, resolvedModel, turnCount = 10, opts = {}) {
    const { model: utilityModel, api, api_key, base_url } = resolvedModel;

    // Labels and prompts are in English for LLM instruction consistency
    const hasPrev = !!prevSummary;
    const memorySnapshot = normalizeMemoryReflectionSnapshot(opts.memoryReflectionSnapshot);
    const agentName = memorySnapshot.agentName || "this agent";
    const userName = memorySnapshot.userName || "the user";
    const identityAndPersonality = memorySnapshot.identityAndPersonality || "(Not provided)";
    const userProfile = memorySnapshot.userProfile || "(Not provided)";
    const existingMemory = memorySnapshot.existingMemory || "(No existing long-term memory)";
    const roster = memorySnapshot.roster || "(No other agents)";

    // 按轮数线性缩放：每轮 40 字配额，10 轮封顶 400 字
    const totalBudget = Math.min(400, Math.max(40, turnCount * 40));
    const factsBudget = Math.max(15, Math.round(totalBudget * 0.3));
    const eventsBudget = totalBudget - factsBudget;

    // English budget estimated in words (roughly 0.6x char count)
    const factsWordBudget = Math.max(10, Math.round(factsBudget * 0.6));
    const eventsWordBudget = Math.max(20, Math.round(eventsBudget * 0.6));

    const systemPrompt = `You are ${agentName}. You are reviewing a conversation you just experienced.

Below are the identity, settings, and memories you already had at the start of this session. They are background, not new facts. Review the new conversation from your own perspective and decide what deserves long-term memory.

## Your Identity And Personality
${identityAndPersonality}

## Owner / User Settings
${userProfile}

## Your Existing Long-Term Memory
This is the memory you already had before this conversation began. Do not rewrite it merely because it appears here; record only what this conversation updates, contradicts, or reinforces.

${existingMemory}

## Roster
The roster tells you which other agents are in the same system. Use it only to understand agent names and collaboration context; do not treat the roster itself as new memory.

${roster}

## Core Principle
Memory's core job is to maintain your understanding of ${userName}: who they are, your relationship with them, their long-running projects, and shared context. Keep the summary user-centric: prioritize who the user is, what they like, what they care about, and the broad themes they are currently focused on. For your replies, only record what was done (e.g. "generated an article about X", "wrote code implementing Y"), not the actual content or transient inner thoughts.

## Output Format
The final answer must contain exactly two third-level headings, with fixed text and order:
1. The first line must be \`### Key Facts\`
2. The second heading must be \`### Timeline\`

The body under both headings must use unordered lists. Each list item must start with \`- \`.
If a section has no content, output one list item: \`- None\`.
Do not output any preamble, conclusion, XML tags, or code fences outside those headings.

## Content Requirements

**Key Facts section**
Only record user-profile information: identity attributes, personality traits, aesthetics and interests, likes and dislikes, long-term relationships, life or creative orientation, and broad current themes the user is focused on. Write \`- None\` if none.

Do NOT extract:
- Work-style preferences: how the user wants the assistant to review, plan, research, implement, test, report, commit, or push
- Collaboration-process preferences: steps, checkpoints, validation order, context-management rules
- Tool and platform preferences from a task: tools, commands, files, models, directories
- Engineering discipline and project rules: these belong in explicit project instructions, not profile memory
- One-task formats, standards, or temporary judgments

ONLY extract:
- What kind of person the user is
- What objects, styles, content, and experiences the user likes or dislikes
- Long-term themes, relationships, identity, aesthetics, and values the user cares about
- Which domain/project/theme the user is currently focused on, keeping only the broad theme and no details

Test:
- If the information answers "who is the user, what do they like, what do they care about", extract it.
- If the information answers "how should one work with the user", do not extract it.
- If the information answers "which domain/project/theme is the user focused on recently", keep only the broad theme and no details inside that theme.
- When in doubt, skip. Better miss than mis-record.

Word limit: follow the per-run summary budget. Keep it short if there's little info.

**Timeline section**
Record what happened in this session in chronological order with YYYY-MM-DD HH:MM timestamps, capturing key points. Work-related content may only be kept at the broad-theme level.
Work can be written as "the user discussed memory systems" or "the user worked on Project Hana"; do not record subproblems, proposals, files, tools, commands, tests, execution steps, validation order, or collaboration preferences.
Word limit: follow the per-run summary budget. If three sentences suffice, don't write a paragraph.

## Rules
1. When existing summary is present: merge old and new, use newer info for the same topic, no duplicates
2. Extract time annotations from message timestamps (YYYY-MM-DD HH:MM format)
3. Only record objective facts, not MOOD or assistant's inner thoughts
4. User-provided files/attachments: only record filename and purpose, ignore file contents
5. Assistant's long outputs (articles, code, analysis): only record what was produced, don't excerpt content
6. Prefer brevity: summary length should be proportional to actual information density
7. Start output directly with ### Key Facts, no preamble or conclusion`;

    const prevLabel = "## Existing Summary";
    const newLabel = "## New Conversation";
    const budgetLabel = "## This Run's Summary Budget";
    const budgetText = `Key Facts max ${factsWordBudget} words. Timeline max ${eventsWordBudget} words.`;
    const userContent = [
      hasPrev ? `${prevLabel}\n\n${prevSummary}` : "",
      `${newLabel}\n\n${convText}`,
      `${budgetLabel}\n\n${budgetText}`,
    ].filter(Boolean).join("\n\n");

    // max_tokens 跟着配额走，避免固定值引导 LLM 写满
    const maxTokens = Math.max(150, Math.min(750, Math.round(totalBudget * 1.5)));

    return callText({
      api, model: utilityModel,
      apiKey: api_key,
      baseUrl: base_url,
      systemPrompt,
      messages: [{ role: "user", content: userContent }],
      temperature: 0.3,
      maxTokens: maxTokens,
      timeoutMs: 60_000,
      usageLedger: resolvedModel.usageLedger,
      usageContext: {
        source: {
          subsystem: "memory",
          operation: "rolling_summary",
          surface: "system",
          trigger: "threshold",
        },
        attribution: {
          kind: "memory",
          agentId: resolvedModel.usageAgentId || null,
        },
      },
    });
  }

}

function normalizeSince(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function latestSince(...values) {
  let latest = null;
  for (const value of values) {
    const normalized = normalizeSince(value);
    if (!normalized) continue;
    if (!latest || Date.parse(normalized) > Date.parse(latest)) latest = normalized;
  }
  return latest;
}

function isAfter(value, since) {
  if (!value) return false;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  return ts > Date.parse(since);
}

function areMessagesAfter(messages, since) {
  if (!since) return true;
  return messages.every((message) => isAfter(message.timestamp, since));
}

function normalizeMemoryReflectionSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const pick = (key) => typeof value[key] === "string" ? value[key].trim() : "";
  return {
    agentName: pick("agentName"),
    userName: pick("userName"),
    identityAndPersonality: pick("identityAndPersonality"),
    userProfile: pick("userProfile"),
    existingMemory: pick("existingMemory"),
    roster: pick("roster"),
  };
}
