/**
 * lib/token-stats/index.js
 *
 * Token 用量统计内置模块。
 *
 * 替代原 token-stats 插件，直接嵌入 openhanako 核心。
 * 自动记录每次 LLM 调用的 token 消耗，提供查询与重置工具。
 *
 * 用法：
 *   import { recordTokenUsage, createQueryUsageTool, createResetStatsTool } from "../lib/token-stats/index.js";
 *
 *   // 在 token_usage 产生处调用
 *   recordTokenUsage(dataDir, usage, modelId, modelProvider);
 *
 *   // 在 agent 工具列表中注册
 *   this._queryUsageTool = createQueryUsageTool(dataDir);
 *   this._resetStatsTool = createResetStatsTool(dataDir);
 */

import fs from "node:fs";
import path from "node:path";

// ─── 数值辅助 ───────────────────────────────────────

function firstNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function maybeNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ─── usage 归一化（兼容 Pi SDK / OpenAI / Anthropic） ──

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = firstNumber(
    usage.input, usage.inputTokens, usage.input_tokens, usage.prompt_tokens,
  );
  const outputTokens = firstNumber(
    usage.output, usage.outputTokens, usage.output_tokens, usage.completion_tokens,
  );
  const cacheReadTokens = firstNumber(
    usage.cacheRead, usage.cacheReadTokens, usage.cache_read_input_tokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens,
  );
  const cacheWriteTokens = firstNumber(
    usage.cacheWrite, usage.cacheWriteTokens, usage.cache_creation_input_tokens,
    usage.cache_creation?.ephemeral_5m_input_tokens,
    usage.cache_creation?.ephemeral_1h_input_tokens,
  );
  const totalTokens = firstNumber(
    usage.totalTokens, usage.total_tokens,
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
  );
  const costTotal = maybeNumber(usage.costTotal, usage.cost?.total);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    costTotal,
    cacheHit: cacheReadTokens > 0,
    cacheCreated: cacheWriteTokens > 0,
  };
}

// ─── 日期辅助 ───────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── 持久化 ─────────────────────────────────────────

function appendRecord(dataDir, record) {
  const filePath = path.join(dataDir, "records.jsonl");
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
  } catch (e) {
    console.error("[token-stats] appendRecord error:", e.message);
  }
}

function updateDaily(dataDir, date, modelId, modelProvider, norm) {
  const filePath = path.join(dataDir, "daily.json");

  let daily = {};
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(filePath)) {
      daily = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // 文件损坏则重新开始
  }

  if (!daily[date]) {
    daily[date] = {
      date,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCost: 0,
      callCount: 0,
      models: {},
    };
  }

  const day = daily[date];
  day.totalTokens += norm.totalTokens;
  day.totalInputTokens += norm.inputTokens;
  day.totalOutputTokens += norm.outputTokens;
  day.totalCacheReadTokens += norm.cacheReadTokens;
  day.totalCacheWriteTokens += norm.cacheWriteTokens;
  if (norm.costTotal !== null) day.totalCost += norm.costTotal;
  day.callCount += 1;

  if (!day.models[modelId]) {
    day.models[modelId] = {
      modelId,
      modelProvider: modelProvider || "",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
      callCount: 0,
    };
  }
  const m = day.models[modelId];
  m.inputTokens += norm.inputTokens;
  m.outputTokens += norm.outputTokens;
  m.cacheReadTokens += norm.cacheReadTokens;
  m.cacheWriteTokens += norm.cacheWriteTokens;
  m.totalTokens += norm.totalTokens;
  if (norm.costTotal !== null) m.cost += norm.costTotal;
  m.callCount += 1;

  // 保留最近 90 天
  const cutoff = daysAgoStr(90);
  for (const d of Object.keys(daily)) {
    if (d < cutoff && d !== date) delete daily[d];
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(daily, null, 2), "utf-8");
  } catch (e) {
    console.error("[token-stats] updateDaily error:", e.message);
  }
}

// ─── 公开 API ──────────────────────────────────────

/**
 * 记录一次 token 用量。
 *
 * @param {string} [dataDir]       - 数据目录（如 ${hanakoHome}/plugin-data/token-stats）。省略时尝试 HANA_HOME 环境变量。
 * @param {object} usage           - 原始 usage 对象（兼容 Pi SDK / OpenAI / Anthropic）
 * @param {string} [modelId]       - 模型 ID
 * @param {string} [modelProvider] - 模型提供商
 */
export function recordTokenUsage(dataDir, usage, modelId, modelProvider) {
  if (!dataDir) {
    const home = process.env.HANA_HOME || process.env.HANAKO_HOME;
    if (home) dataDir = path.join(home, "plugin-data", "token-stats");
  }
  if (!dataDir || !usage) return;

  const normalized = normalizeUsage(usage);
  if (!normalized) return;

  const date = todayStr();
  const now = new Date();
  const record = {
    ts: now.getTime(),
    date,
    hour: now.getHours(),
    modelId: modelId ?? "unknown",
    modelProvider: modelProvider ?? "",
    ...normalized,
  };

  appendRecord(dataDir, record);
  updateDaily(dataDir, date, modelId ?? "unknown", modelProvider ?? "", normalized);
}

/**
 * 创建 query_token_usage 工具定义。
 *
 * @param {string} dataDir - 数据目录
 * @returns {import('../pi-sdk/index.js').ToolDefinition}
 */
export function createQueryUsageTool(dataDir) {
  return {
    name: "query_token_usage",
    label: "query_token_usage",
    description: "查询 LLM Token 消耗统计，支持按日/周/月/自定义时间段和按模型筛选",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "custom"],
          description: "查询的时间范围。默认为 today",
        },
        startDate: {
          type: "string",
          description: "自定义起始日期，格式 YYYY-MM-DD。当 period=custom 时必填",
        },
        endDate: {
          type: "string",
          description: "自定义结束日期，格式 YYYY-MM-DD。默认为 startDate 当天",
        },
        modelId: {
          type: "string",
          description: "可选，按模型 ID 筛选（支持部分匹配，如 'deepseek'）",
        },
        format: {
          type: "string",
          enum: ["text", "json"],
          description: "返回格式。text 返回人类可读文本，json 返回结构化数据。默认为 text",
        },
      },
    },
    execute: async (_toolCallId, input) => {
      return executeQuery(dataDir, input);
    },
  };
}

/**
 * 创建 reset_token_stats 工具定义。
 *
 * @param {string} dataDir - 数据目录
 * @returns {import('../pi-sdk/index.js').ToolDefinition}
 */
export function createResetStatsTool(dataDir) {
  return {
    name: "reset_token_stats",
    label: "reset_token_stats",
    description: "⚠️ 重置所有 Token 用量统计数据，清空原始记录和汇总。此操作不可撤销！",
    parameters: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          description: "必须设为 true 才能执行重置操作，防止误触",
        },
      },
      required: ["confirm"],
    },
    execute: async (_toolCallId, input) => {
      if (input.confirm !== true) {
        return "⚠️ 操作已取消。如需重置请设置 confirm=true。";
      }

      const recordsPath = path.join(dataDir, "records.jsonl");
      const dailyPath = path.join(dataDir, "daily.json");

      let removed = 0;

      if (fs.existsSync(recordsPath)) {
        fs.unlinkSync(recordsPath);
        removed++;
      }
      if (fs.existsSync(dailyPath)) {
        fs.unlinkSync(dailyPath);
        removed++;
      }

      return `✅ 已清空 Token 用量数据（移除了 ${removed} 个文件）。从现在开始重新统计。`;
    },
  };
}

// ─── 查询实现 ───────────────────────────────────────

async function executeQuery(dataDir, input) {
  const period = input.period || "today";
  let startDate, endDate;

  // ── 计算日期范围 ──
  const now = new Date();
  const today = dateStr(now);

  switch (period) {
    case "today":
      startDate = endDate = today;
      break;
    case "yesterday":
      startDate = endDate = dateStr(new Date(now.getTime() - 86400000));
      break;
    case "this_week": {
      const dow = now.getDay();
      const diff = dow === 0 ? 6 : dow - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diff);
      startDate = dateStr(monday);
      endDate = today;
      break;
    }
    case "last_week": {
      const dow = now.getDay();
      const diff = dow === 0 ? 6 : dow - 1;
      const thisMonday = new Date(now);
      thisMonday.setDate(now.getDate() - diff);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const lastSunday = new Date(thisMonday);
      lastSunday.setDate(thisMonday.getDate() - 1);
      startDate = dateStr(lastMonday);
      endDate = dateStr(lastSunday);
      break;
    }
    case "this_month":
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      endDate = today;
      break;
    case "last_month": {
      const y = now.getFullYear();
      const m = now.getMonth();
      const firstOfLast = new Date(y, m - 1, 1);
      const firstOfThis = new Date(y, m, 1);
      const lastOfLast = new Date(firstOfThis.getTime() - 86400000);
      startDate = dateStr(firstOfLast);
      endDate = dateStr(lastOfLast);
      break;
    }
    case "custom":
      startDate = input.startDate;
      endDate = input.endDate || startDate;
      if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return "❌ custom 模式下需要提供有效的 startDate（格式 YYYY-MM-DD）";
      }
      break;
    default:
      return `❌ 未知的时间范围: ${period}`;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return "❌ 日期格式无效，请使用 YYYY-MM-DD";
  }

  // ── 读取汇总数据 ──
  const dailyPath = path.join(dataDir, "daily.json");
  if (!fs.existsSync(dailyPath)) {
    return "📊 尚无 Token 用量数据。开始对话后数据会自动记录。";
  }

  let daily;
  try {
    daily = JSON.parse(fs.readFileSync(dailyPath, "utf-8"));
  } catch {
    return "❌ 汇总数据文件损坏，请尝试重置。";
  }

  // ── 筛选日期范围 ──
  const matchedDates = Object.keys(daily)
    .filter((d) => d >= startDate && d <= endDate)
    .sort();

  if (matchedDates.length === 0) {
    return `📊 ${periodLabel(period, startDate, endDate)} 没有 Token 用量记录。`;
  }

  // ── 聚合 ──
  const modelFilter = input.modelId ? input.modelId.toLowerCase() : null;

  const agg = {
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    callCount: 0,
    activeDays: matchedDates.length,
    models: {},
  };

  for (const d of matchedDates) {
    const day = daily[d];
    if (!day) continue;
    agg.totalTokens += day.totalTokens || 0;
    agg.totalInputTokens += day.totalInputTokens || 0;
    agg.totalOutputTokens += day.totalOutputTokens || 0;
    agg.totalCacheReadTokens += day.totalCacheReadTokens || 0;
    agg.totalCacheWriteTokens += day.totalCacheWriteTokens || 0;
    agg.totalCost += day.totalCost || 0;
    agg.callCount += day.callCount || 0;

    for (const [mid, m] of Object.entries(day.models || {})) {
      if (modelFilter && !mid.toLowerCase().includes(modelFilter)) continue;
      if (!agg.models[mid]) {
        agg.models[mid] = { ...m };
      } else {
        agg.models[mid].inputTokens += m.inputTokens;
        agg.models[mid].outputTokens += m.outputTokens;
        agg.models[mid].cacheReadTokens += m.cacheReadTokens;
        agg.models[mid].cacheWriteTokens += m.cacheWriteTokens;
        agg.models[mid].totalTokens += m.totalTokens;
        agg.models[mid].cost += m.cost;
        agg.models[mid].callCount += m.callCount;
      }
    }
  }

  const modelCount = Object.keys(agg.models).length;

  if (input.format === "json") {
    return formatJson(agg, startDate, endDate, period);
  }

  return formatText(agg, startDate, endDate, period, modelFilter);
}

// ─── 格式化 ────────────────────────────────────────

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodLabel(period, start, end) {
  const labels = {
    today: "📅 今日",
    yesterday: "📅 昨日",
    this_week: "📅 本周",
    last_week: "📅 上周",
    this_month: "📅 本月",
    last_month: "📅 上月",
  };
  if (labels[period]) return labels[period];
  return `📅 ${start} ~ ${end}`;
}

function fmt(n) {
  if (n == null) return "—";
  return n.toLocaleString("zh-CN");
}

function fmtCost(n) {
  if (n == null || n === 0) return "—";
  return `¥${n.toFixed(4)}`;
}

function formatText(agg, start, end, period, modelFilter) {
  const lines = [];
  const title = periodLabel(period, start, end);
  const rangeNote = start === end ? `（${start}）` : `（${start} ~ ${end}）`;
  lines.push(`📊 **Token 用量统计 ${title}** ${rangeNote}`);
  lines.push("");
  lines.push(`| 指标 | 数值 |`);
  lines.push(`| --- | --- |`);
  if (agg.callCount > 0) lines.push(`| 🤖 调用次数 | ${fmt(agg.callCount)} |`);
  lines.push(`| 📥 输入 Token | ${fmt(agg.totalInputTokens)} |`);
  lines.push(`| 📤 输出 Token | ${fmt(agg.totalOutputTokens)} |`);
  lines.push(`| 💾 缓存命中 Token | ${fmt(agg.totalCacheReadTokens)} |`);
  lines.push(`| 📝 缓存写入 Token | ${fmt(agg.totalCacheWriteTokens)} |`);
  lines.push(`| 🔢 **合计 Token** | **${fmt(agg.totalTokens)}** |`);
  lines.push(`| 💰 估算费用 | ${fmtCost(agg.totalCost)} |`);
  lines.push(`| 📆 活跃天数 | ${agg.activeDays} |`);

  const models = Object.values(agg.models).sort((a, b) => b.totalTokens - a.totalTokens);
  if (models.length > 0) {
    lines.push("");
    lines.push(`**按模型细分**${modelFilter ? `（筛选: ${modelFilter}）` : ""}:`);
    lines.push("");
    lines.push(`| 模型 | 调用次数 | 合计 Token | 费用 |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const m of models) {
      lines.push(`| ${m.modelId} | ${fmt(m.callCount)} | ${fmt(m.totalTokens)} | ${fmtCost(m.cost)} |`);
    }
  }

  if (modelFilter && modelCount === 0) {
    lines.push("");
    lines.push(`⚠️ 未找到匹配 "${modelFilter}" 的模型数据。`);
  }

  return lines.join("\n");
}

function formatJson(agg, start, end, period) {
  return JSON.stringify({
    period,
    startDate: start,
    endDate: end,
    stats: {
      callCount: agg.callCount,
      inputTokens: agg.totalInputTokens,
      outputTokens: agg.totalOutputTokens,
      cacheReadTokens: agg.totalCacheReadTokens,
      cacheWriteTokens: agg.totalCacheWriteTokens,
      totalTokens: agg.totalTokens,
      costTotal: agg.totalCost,
      activeDays: agg.activeDays,
    },
    models: Object.values(agg.models).sort((a, b) => b.totalTokens - a.totalTokens),
  }, null, 2);
}
