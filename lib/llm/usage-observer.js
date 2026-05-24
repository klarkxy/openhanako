import { debugLog } from "../debug-log.js";
import fs from "fs";
import path from "path";

// 持久化 usage 日志目录（由 server/index.js 初始化时设置）
let _usageLogHome = null;

/**
 * 设置 usage 持久化日志的根目录。
 * 调用后，每次 logLlmUsage 会追加一行 JSON 到 <hanakoHome>/logs/llm-usage.jsonl。
 * @param {string} hanakoHome - ~/.hanako-dev 根目录
 */
export function setUsageLogHome(hanakoHome) {
  _usageLogHome = hanakoHome;
}

export const LLM_USAGE_LOG_FILE = "llm-usage.jsonl";

function usageLogPath() {
  if (!_usageLogHome) return null;
  return path.join(_usageLogHome, "logs", LLM_USAGE_LOG_FILE);
}

function appendUsageLog(record) {
  const filePath = usageLogPath();
  if (!filePath || !record) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      ...record,
    };
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // 持久化日志不应影响模型调用
  }
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return 0;
}

function maybeNumber(...values) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function cacheCreationTokens(usage) {
  const direct = maybeNumber(usage?.cacheWrite, usage?.cacheWriteTokens, usage?.cache_creation_input_tokens);
  if (direct !== null) return direct;

  const creation = usage?.cache_creation;
  if (!creation || typeof creation !== "object") return 0;
  return firstNumber(creation.ephemeral_5m_input_tokens)
    + firstNumber(creation.ephemeral_1h_input_tokens);
}

function costTotalFromUsage(usage) {
  return maybeNumber(usage?.costTotal, usage?.cost?.total);
}

function costTotalFromRates(tokens, costRates) {
  if (!costRates || typeof costRates !== "object") return null;
  const input = firstNumber(costRates.input) * tokens.inputTokens / 1_000_000;
  const output = firstNumber(costRates.output) * tokens.outputTokens / 1_000_000;
  const cacheRead = firstNumber(costRates.cacheRead) * tokens.cacheReadTokens / 1_000_000;
  const cacheWrite = firstNumber(costRates.cacheWrite) * tokens.cacheWriteTokens / 1_000_000;
  const total = input + output + cacheRead + cacheWrite;
  return Number.isFinite(total) ? total : null;
}

/**
 * Normalize provider-specific usage payloads into the Pi SDK token vocabulary.
 *
 * Supported inputs:
 * - Pi SDK: { input, output, cacheRead, cacheWrite, totalTokens, cost }
 * - Anthropic: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
 * - OpenAI-compatible: { prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details.cached_tokens }
 */
export function normalizeLlmUsage(usage, options = {}) {
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = firstNumber(usage.input, usage.inputTokens, usage.input_tokens, usage.prompt_tokens);
  const outputTokens = firstNumber(usage.output, usage.outputTokens, usage.output_tokens, usage.completion_tokens);
  const cacheMissTokens = maybeNumber(usage.cacheMiss, usage.cacheMissTokens, usage.prompt_cache_miss_tokens);
  const cacheReadTokens = firstNumber(
    usage.cacheRead,
    usage.cacheReadTokens,
    usage.cache_read_input_tokens,
    usage.prompt_cache_hit_tokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens
  );
  const cacheWriteTokens = cacheCreationTokens(usage);
  const fallbackTotal = numberOrNull(usage.prompt_tokens) !== null || numberOrNull(usage.completion_tokens) !== null
    ? inputTokens + outputTokens
    : inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalTokens = firstNumber(
    usage.totalTokens,
    usage.total_tokens,
    fallbackTotal
  );
  const tokens = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
  if (cacheMissTokens !== null) tokens.cacheMissTokens = cacheMissTokens;
  const explicitCost = costTotalFromUsage(usage);
  const costTotal = explicitCost !== null ? explicitCost : costTotalFromRates(tokens, options.costRates);

  return {
    ...tokens,
    costTotal,
    cacheHit: cacheReadTokens > 0,
    cacheCreated: cacheWriteTokens > 0,
  };
}

export function buildUsageDebugRecord({
  source,
  api = null,
  provider = null,
  modelId = null,
  usage,
  costRates = null,
} = {}) {
  const normalized = normalizeLlmUsage(usage, { costRates });
  if (!normalized) return null;

  return {
    source: source ?? null,
    api: api ?? null,
    provider: provider ?? null,
    modelId: modelId ?? null,
    ...normalized,
  };
}

export function logLlmUsage({
  logger = debugLog(),
  source,
  api = null,
  provider = null,
  modelId = null,
  usage,
  costRates = null,
} = {}) {
  const record = buildUsageDebugRecord({ source, api, provider, modelId, usage, costRates });
  if (!record || !logger || typeof logger.log !== "function") return record;

  try {
    logger.log("llm-usage", `model_usage ${JSON.stringify(record)}`);
  } catch {
    // Debug logging must never affect model calls.
  }

  // 持久化到 llm-usage.jsonl（独立于 debug 日志，便于查询分析）
  appendUsageLog(record);

  return record;
}
