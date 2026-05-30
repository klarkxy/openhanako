/**
 * LLM Utilities — 轻量 LLM 调用（标题摘要、翻译、ID 生成等）
 *
 * 纯函数模块，不持有状态。调用方传入 utilConfig（model/api_key/base_url）。
 * 从 Engine 提取，消除 5 处重复的 fetch 模式。
 */
import fs from "fs";
import path from "path";
import { callText } from "./llm-client.js";
import { getLocale } from "../server/i18n.js";
import { normalizePlainDescription } from "../lib/text/internal-narration.js";
import { createModuleLogger } from "../lib/debug-log.js";

const log = createModuleLogger("llm-utils");

/**
 * 格式化错误消息，透传 err.cause 的根因信息。
 * 当 fetch 失败时（如代理 ECONNREFUSED），顶层 message 是 "fetch failed"，
 * 真正的根因在 err.cause 里；不展开 cause 会让诊断日志没有任何价值。
 */
function formatError(err) {
  const top = err?.message || String(err);
  if (!err?.cause) return top;
  const cause = err.cause;
  const causeMsg = cause?.message || String(cause);
  const causeCode = cause?.code ? ` [${cause.code}]` : "";
  return `${top} — caused by: ${causeMsg}${causeCode}`;
}

/** Pi SDK content block 是否为工具调用（兼容 tool_use / toolCall 两种格式） */
export const isToolCallBlock = (b) => (b.type === "tool_use" || b.type === "toolCall") && !!b.name;

/** 取工具调用参数（兼容 input / arguments） */
export const getToolArgs = (b) => b.input || b.arguments;

/**
 * 统一的 utility LLM 调用
 * @param {object} opts
 * @param {string} opts.model
 * @param {string} opts.api_key
 * @param {string} opts.base_url
 * @param {Array} opts.messages
 * @param {number} [opts.temperature=0.3]
 * @param {number} [opts.max_tokens] 任务级输出预算；未传时不写 output cap
 * @param {"user"|"system"|"sdk-default"} [opts.outputBudgetSource=system]
 * @returns {Promise<string|null>} 回复文本
 */
async function callLlm({
  model,
  api,
  api_key,
  base_url,
  messages,
  temperature = 0.3,
  max_tokens,
  outputBudgetSource = "system",
  timeoutMs,
  signal,
  quirks,
  usageLedger,
  usageContext,
}) {
  return callText({
    api, model,
    apiKey: api_key,
    baseUrl: base_url,
    messages, temperature,
    ...(max_tokens != null && { maxTokens: max_tokens, outputBudgetSource }),
    ...(timeoutMs != null && { timeoutMs }),
    ...(signal != null && { signal }),
    ...(quirks != null && { quirks }),
    ...(usageLedger != null && { usageLedger }),
    ...(usageContext != null && { usageContext }),
  });
}

function utilityUsageContext(utilConfig, operation, trigger = "tool") {
  const agentId = utilConfig?.usageAgentId || null;
  const sessionPath = utilConfig?.usageSessionPath || null;
  return {
    source: {
      subsystem: "utility",
      operation,
      surface: "system",
      trigger,
    },
    attribution: sessionPath
      ? { kind: "session", agentId, sessionPath }
      : { kind: "utility", agentId },
  };
}

/**
 * 从 .jsonl session 文件提取 user/assistant 文本和工具调用
 */
function parseSessionContent(sessionPath, { userLimit = 1000, assistantLimit = 1000 } = {}) {
  const raw = fs.readFileSync(sessionPath, "utf-8");
  const lines = raw.trim().split("\n").map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  let userText = "";
  let assistantText = "";
  const toolCalls = [];
  for (const line of lines) {
    if (line.type !== "message" || !line.message) continue;
    const msg = line.message;
    if (msg.role === "user" && !userText) {
      const textParts = (msg.content || []).filter(c => c.type === "text");
      userText = textParts.map(c => c.text).join("\n").slice(0, userLimit);
    }
    if (msg.role === "assistant") {
      const textParts = (msg.content || []).filter(c => c.type === "text");
      assistantText = textParts.map(c => c.text).join("\n").slice(0, assistantLimit);
      const toolParts = (msg.content || []).filter(isToolCallBlock);
      for (const t of toolParts) toolCalls.push(t.name || "unknown_tool");
    }
  }
  return { userText, assistantText, toolCalls };
}

/**
 * 从 session 内容生成本地兜底摘要（不依赖外部 API）
 */
export function buildLocalSummary(assistantText, toolCalls) {
  const isZh = getLocale().startsWith("zh");
  const uniqueTools = [...new Set(toolCalls)];
  if (uniqueTools.length > 0) {
    if (isZh) {
      return `执行了 ${uniqueTools.slice(0, 3).join("、")}${uniqueTools.length > 3 ? " 等" : ""}`;
    }
    return `Ran ${uniqueTools.slice(0, 3).join(", ")}${uniqueTools.length > 3 ? ", etc." : ""}`;
  }
  if (assistantText) {
    const clean = assistantText.replace(/[#*_`>\-[\]()]/g, "").trim();
    if (clean.length <= 50) return clean;
    return clean.slice(0, 47) + "...";
  }
  return null;
}

/**
 * 生成对话标题
 * @param {object} utilConfig - resolveUtilityConfig() 结果
 * @param {string} userText
 * @param {string} assistantText
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function summarizeTitle(utilConfig, userText, assistantText, opts = {}) {
  try {
    const { utility: model, api_key, base_url, api } = utilConfig;
    if (!api_key || !base_url || !api) return null;

    const systemContent = `You are a conversation title generator. Based on the first exchange between user and assistant, summarize the topic in a very short phrase.

Rules:
1. Keep the title under 5 words (English) or 10 characters (Chinese)
2. The title language must match the user's first message
3. No quotes, periods, or other punctuation
4. Output the title directly, no explanation`;

    const userLabel = "User";
    const assistantLabel = "Assistant";

    return await callLlm({
      model, api, api_key, base_url,
      messages: [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: `${userLabel}：${(userText || "").slice(0, 500)}\n${assistantLabel}：${(assistantText || "").slice(0, 500)}`,
        },
      ],
      max_tokens: 50,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "title", "user"),
    });
  } catch (err) {
    // AbortError（超时）不算失败，静默返回 null 让调用方走 fallback
    if (err.name === "AbortError" || err.name === "TimeoutError" || err.code === "LLM_TIMEOUT") return null;
    log.error(`summarizeTitle failed: ${formatError(err)}`);
    return null;
  }
}

/**
 * 批量翻译技能名称
 */
export async function translateSkillNames(utilConfig, names, lang) {
  if (!names.length) return {};
  const LANG_LABEL = { zh: "中文", ja: "日本語", ko: "한국어" };
  const label = LANG_LABEL[lang] || lang;
  try {
    const { utility: model, api_key, base_url, api } = utilConfig;
    if (!api_key || !base_url || !api) return {};
    const text = await callLlm({
      model, api, api_key, base_url,
      messages: [
        {
          role: "system",
          content: `Translate the following kebab-case English skill names into short ${label} names (2-4 characters). Output a JSON object directly, key = original name, value = translation. No explanation.`,
        },
        { role: "user", content: JSON.stringify(names) },
      ],
      temperature: 0,
      max_tokens: 200,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "translate_skill_names", "startup"),
    });
    if (!text) return {};
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch (err) {
    log.error(`translateSkillNames 失败: ${formatError(err)}`);
    return {};
  }
}

/**
 * 根据技能描述自动生成分类
 * @param {object} utilConfig - resolveUtilityConfig() 结果
 * @param {Array<{name: string, description: string, category?: string}>} skills
 * @param {string} [lang] - 目标语言（默认 zh）
 * @returns {Promise<{[skillName: string]: string}>}
 */
export async function autoCategorizeSkills(utilConfig, skills, lang = "zh") {
  if (!skills.length) return {};
  const LANG_LABEL = { zh: "中文", ja: "日本語", ko: "한국어", en: "English" };
  const label = LANG_LABEL[lang] || lang;
  try {
    const { utility: model, api_key, base_url, api } = utilConfig;
    if (!api_key || !base_url || !api) return {};

    // 构建技能列表，包含已有分类信息
    const skillList = skills.map(s => {
      const item = { name: s.name, description: s.description || "(无描述)" };
      if (s.category) item.currentCategory = s.category;
      return item;
    });

    const text = await callLlm({
      model, api, api_key, base_url,
      messages: [
        {
          role: "system",
          content: `You are a skill categorization assistant. Given a list of skills with names and descriptions, assign each skill to exactly one category from the following list:
- 信息搜索 (Information Search)
- 文本处理 (Text Processing)
- 代码开发 (Code Development)
- 创意写作 (Creative Writing)
- 数据分析 (Data Analysis)
- 系统工具 (System Tools)
- 通信协作 (Communication)
- 学习教育 (Learning & Education)
- 多媒体 (Multimedia)
- 生活助手 (Life Assistant)
- 角色扮演 (Roleplay)
- 其他 (Other)

Output a JSON object directly where key = skill name, value = category name (in ${label}). No explanation.`,
        },
        { role: "user", content: JSON.stringify(skillList, null, 2) },
      ],
      temperature: 0.1,
      max_tokens: 2000,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "auto_categorize_skills", "tool"),
    });
    if (!text) return {};
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch (err) {
    log.error(`autoCategorizeSkills 失败: ${err.message}`);
    return {};
  }
}

/**
 * 为活动 session 生成摘要（用 utility_large 模型）
 * @param {object} utilConfig - resolveUtilityConfig() 结果
 * @param {string} sessionPath
 * @param {(text: string, level?: string) => void} [emitDevLog]
 */
export async function summarizeActivity(utilConfig, sessionPath, emitDevLog, preloaded) {
  const log = emitDevLog || (() => {});
  try {
    let userText, assistantText, toolCalls;
    if (preloaded) {
      userText = preloaded.userText || "";
      assistantText = preloaded.assistantText || "";
      toolCalls = preloaded.toolCalls || [];
    } else {
      ({ userText, assistantText, toolCalls } = parseSessionContent(sessionPath));
    }
    if (!userText && !assistantText) {
      log("[summarize] session empty, skipping");
      return null;
    }

    const toolInfo = toolCalls.length > 0
      ? `\n\nTools used: ${[...new Set(toolCalls)].join(", ")}`
      : "";
    const { utility_large: model, large_api_key: api_key, large_base_url: base_url, large_api: api } = utilConfig;
    if (!api_key || !base_url || !api) {
      log("[summarize] utility_large config incomplete, skipping");
      return null;
    }

    const systemContent = `You are an execution summary generator. Based on the Agent's patrol context, execution results, and tools used, summarize what it did.

Rules:
1. Under 30 words, in the same language as the input
2. Output the summary directly, no prefix or explanation
3. Be specific about what actions were taken (broke down tasks, searched info, marked complete, read files, etc.)
4. If tools were called, mention the tool names and what they did
5. If the Agent reported "all clear" or took no action, say "Patrol complete, all clear"`;

    const text = await callText({
      api, model,
      apiKey: api_key,
      baseUrl: base_url,
      messages: [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: `Patrol context:\n${userText.slice(0, 600)}\n\nAgent reply:\n${assistantText.slice(0, 600)}${toolInfo}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 150,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "activity_summary", "scheduled"),
    });

    return text;
  } catch (err) {
    log(`[summarize] error: ${formatError(err)}`);
    log.error(`summarizeActivity failed: ${formatError(err)}`);
    return null;
  }
}

/**
 * 快速摘要（用 utility 小模型）
 * @param {object} utilConfig
 * @param {string} sessionPath - activity session 文件绝对路径
 */
export async function summarizeActivityQuick(utilConfig, sessionPath) {
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const { userText, assistantText } = parseSessionContent(sessionPath, {
      userLimit: 800, assistantLimit: 800,
    });
    if (!userText && !assistantText) return null;

    const { utility: model, api_key, base_url, api } = utilConfig;
    if (!api_key || !base_url || !api) return null;

    const systemContent = `Based on the Agent's patrol context and execution results, summarize what it did in one or two sentences. Under 15 words, in the same language as the input, output directly.`;

    return await callText({
      api, model,
      apiKey: api_key,
      baseUrl: base_url,
      messages: [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: `Patrol context:\n${userText.slice(0, 400)}\n\nAgent reply:\n${assistantText.slice(0, 400)}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 80,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "activity_summary_quick", "scheduled"),
    });
  } catch (err) {
    log.error(`summarizeActivityQuick failed: ${formatError(err)}`);
    return null;
  }
}

/**
 * 规整为合法 agent id 的 slug：小写字母/数字/连字符，首尾去横线、合并连续横线、截断 12 字符。
 * 返回空字符串表示洗完啥也不剩（如纯 emoji 输入）。
 */
function sanitizeAgentId(raw) {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 12)
    .replace(/-+$/g, ""); // 截断后可能留下尾部横线
}

/**
 * 在 agentsDir 下为 base 找一个不冲突的 id：base → base-2 → base-3 → ...
 * 超上限返回 null，交给调用方走时间戳兜底。
 */
function findAvailableAgentId(base, agentsDir, max = 99) {
  if (!base) return null;
  if (!fs.existsSync(path.join(agentsDir, base))) return base;
  for (let i = 2; i <= max; i++) {
    // 候选可能超 12 字符（如 "hanakohanako-12"），做截断后再试
    const suffix = `-${i}`;
    const trimmedBase = base.slice(0, Math.max(2, 12 - suffix.length));
    const candidate = `${trimmedBase}${suffix}`;
    if (!fs.existsSync(path.join(agentsDir, candidate))) return candidate;
  }
  return null;
}

/**
 * 用 LLM 根据显示名生成 agent ID（语义化优先，冲突加序号而非直接丢弃）。
 *
 * 策略三段式：
 *   1. LLM 音译 → sanitize → 作为 base
 *   2. LLM 失败 / 洗完无效 → 用 name 自己 sanitize 做 base（兜底仍保留语义）
 *   3. base 拿到后探测 base / base-2 / ... / base-99，找到空位就用
 *   4. 上述全失败 → 时间戳兜底 `agent-xxxxxx`（几乎不可能冲突，再兜底一次防万一）
 *
 * @param {object} utilConfig
 * @param {string} name - 显示名
 * @param {string} agentsDir - agents 根目录（检查冲突）
 */
export async function generateAgentId(utilConfig, name, agentsDir) {
  let base = "";

  try {
    const { utility: model, api_key, base_url, api } = utilConfig;
    const text = await callLlm({
      model, api, api_key, base_url,
      messages: [
        {
          role: "system",
          content: `Given an assistant's display name, generate a short lowercase English ID (for use as a folder name).
Rules:
1. Lowercase English letters only, hyphens allowed
2. 2–12 characters
3. Prefer a transliteration or abbreviation of the name
4. Output the ID directly, no explanation

Examples:
- "花子" → "hanako"
- "ミク" → "miku"
- "Helper" → "helper"
- "Alice" → "alice"`,
        },
        { role: "user", content: name },
      ],
      max_tokens: 20,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "generate_agent_id", "manual"),
    });

    base = sanitizeAgentId(text);
  } catch (err) {
    log.error(`generateAgentId LLM failed: ${formatError(err)}`);
  }

  // LLM 失败或洗完太短 → 用 name 自己做 slug（比时间戳兜底更有语义）
  if (base.length < 2) {
    base = sanitizeAgentId(name);
  }

  if (base.length >= 2) {
    const available = findAvailableAgentId(base, agentsDir);
    if (available) return available;
  }

  // 最终兜底：时间戳 id（几乎不可能冲突，再兜一次防御极端时序）
  let ts = `agent-${Date.now().toString(36)}`;
  while (fs.existsSync(path.join(agentsDir, ts))) {
    ts = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
  }
  return ts;
}

/**
 * 为 agent 生成能力描述摘要
 * @param {object} utilConfig - resolveUtilityConfig() 返回值
 * @param {string} personality - Agent.descriptionSource 全文（identity + ishiki，不含 yuan 运行协议）
 * @param {string} locale - agent 的 config.locale（"zh" / "en" 等）
 * @returns {Promise<string|null>}
 */
export async function generateDescription(utilConfig, personality, locale) {
  try {
    const { utility: model, api_key, base_url, api } = utilConfig;
    if (!api_key || !base_url || !api) return null;

    const langInstruction = String(locale || "").startsWith("zh")
      ? "Write the description in Chinese, under 100 characters."
      : "Write the description in English, under 100 characters.";
    const systemContent = `You are a third-person product roster editor. Based on the public persona material below, write a public-facing description of this AI agent. Describe the assistant from the outside, not in first person. Cover personality traits, expertise, communication style, and suitable tasks. Do not output <mood>, Vibe, Sparks, Pulse, Reflect, or any internal tags. Plain text, no markdown. ${langInstruction} Output the description directly, no explanation.`;

    const raw = await callLlm({
      model, api, api_key, base_url,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: personality.slice(0, 3000) },
      ],
      temperature: 0.3,
      max_tokens: 200,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "generate_description", "manual"),
    });
    if (!raw) return null;

    const text = normalizePlainDescription(raw, 100);
    return text || null;
  } catch (err) {
    log.error(`generateDescription failed: ${formatError(err)}`);
    return null;
  }
}
