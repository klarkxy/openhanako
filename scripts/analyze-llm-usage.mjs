#!/usr/bin/env node
/**
 * LLM Usage 日志分析工具
 * 用法：
 *   node scripts/analyze-llm-usage.mjs                          # 汇总统计 + Top 10
 *   node scripts/analyze-llm-usage.mjs --top 20                 # Top 20 高消耗
 *   node scripts/analyze-llm-usage.mjs --source chat            # 只看 chat 请求
 *   node scripts/analyze-llm-usage.mjs --model deepseek-v4-pro  # 看指定模型
 *   node scripts/analyze-llm-usage.mjs --today                  # 只看今天
 *   node scripts/analyze-llm-usage.mjs --cache                  # 缓存命中率分析
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const USAGE_LOG = join(homedir(), ".hanako-dev", "logs", "llm-usage.jsonl");
const args = process.argv.slice(2);

function parseArgs() {
  const opts = { top: 10, source: null, model: null, today: false, cache: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--top": opts.top = parseInt(args[++i], 10); break;
      case "--source": opts.source = args[++i]; break;
      case "--model": opts.model = args[++i]; break;
      case "--today": opts.today = true; break;
      case "--cache": opts.cache = true; break;
      case "--help": printHelp(); process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
LLM Usage 日志分析工具
─────────────────────
  --top N       显示前 N 条（默认 10，按 inputTokens 降序）
  --source S    过滤 source（如 chat, utility）
  --model M     过滤 modelId（如 deepseek-v4-pro）
  --today       只看今天的记录
  --cache       缓存命中率分析模式
  --help        显示帮助

日志文件：${USAGE_LOG}
`);
}

function loadRecords() {
  if (!existsSync(USAGE_LOG)) {
    console.error(`日志文件不存在：${USAGE_LOG}`);
    console.error("请先启动 openhanako 生成一些 LLM 请求后重试。");
    process.exit(1);
  }
  const raw = readFileSync(USAGE_LOG, "utf-8").trim();
  if (!raw) { console.log("日志为空。"); process.exit(0); }
  return raw.split("\n").map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function filterRecords(records, opts) {
  let result = records;
  if (opts.source) result = result.filter(r => r.source === opts.source);
  if (opts.model) result = result.filter(r => r.modelId === opts.model);
  if (opts.today) {
    const today = new Date().toISOString().slice(0, 10);
    result = result.filter(r => r.ts.startsWith(today));
  }
  return result;
}

function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function fmtNum(n) { return n?.toLocaleString?.() ?? String(n ?? 0); }
function fmtCost(n) { return n != null ? `$${Number(n).toFixed(4)}` : "N/A"; }
function fmtPct(a, b) { return b > 0 ? `${(a / b * 100).toFixed(1)}%` : "N/A"; }

function printSummary(records) {
  console.log(`\n📊 汇总统计（${records.length} 条记录）`);
  console.log("═".repeat(75));

  const totalInput = sum(records.map(r => r.inputTokens || 0));
  const totalOutput = sum(records.map(r => r.outputTokens || 0));
  const totalCacheRead = sum(records.map(r => r.cacheReadTokens || 0));
  const totalCacheWrite = sum(records.map(r => r.cacheWriteTokens || 0));
  const totalCost = sum(records.map(r => r.costTotal || 0));

  console.log(`  总请求数        ${records.length}`);
  console.log(`  总 inputTokens   ${fmtNum(totalInput)}`);
  console.log(`  总 outputTokens  ${fmtNum(totalOutput)}`);
  console.log(`  总 cacheRead     ${fmtNum(totalCacheRead)}`);
  console.log(`  总 cacheWrite    ${fmtNum(totalCacheWrite)}`);
  console.log(`  总费用           ${fmtCost(totalCost)}`);
  console.log(`  缓存命中率       ${fmtPct(totalCacheRead, totalInput + totalCacheRead)}`);

  // 按 source 分组
  console.log(`\n  按 source 分组：`);
  const bySource = {};
  for (const r of records) {
    const s = r.source || "unknown";
    bySource[s] = bySource[s] || { count: 0, input: 0, output: 0, cacheR: 0, cost: 0 };
    bySource[s].count++;
    bySource[s].input += r.inputTokens || 0;
    bySource[s].output += r.outputTokens || 0;
    bySource[s].cacheR += r.cacheReadTokens || 0;
    bySource[s].cost += r.costTotal || 0;
  }
  for (const [src, s] of Object.entries(bySource).sort((a, b) => b[1].input - a[1].input)) {
    console.log(`    ${src.padEnd(12)} | ${String(s.count).padStart(4)} 条 | input=${fmtNum(s.input).padStart(10)} | cacheR=${fmtNum(s.cacheR).padStart(10)} | cost=${fmtCost(s.cost)}`);
  }

  // 按模型分组
  console.log(`\n  按 modelId 分组：`);
  const byModel = {};
  for (const r of records) {
    const m = r.modelId || "unknown";
    byModel[m] = byModel[m] || { count: 0, input: 0, output: 0, cacheR: 0, cost: 0 };
    byModel[m].count++;
    byModel[m].input += r.inputTokens || 0;
    byModel[m].output += r.outputTokens || 0;
    byModel[m].cacheR += r.cacheReadTokens || 0;
    byModel[m].cost += r.costTotal || 0;
  }
  for (const [m, s] of Object.entries(byModel).sort((a, b) => b[1].input - a[1].input)) {
    console.log(`    ${m.padEnd(25)} | ${String(s.count).padStart(4)} 条 | input=${fmtNum(s.input).padStart(10)} | cacheR=${fmtNum(s.cacheR).padStart(10)} | cost=${fmtCost(s.cost)}`);
  }
}

function printTop(records, n) {
  console.log(`\n🔥 Top ${n} 按 input 消耗降序`);
  console.log("═".repeat(120));
  console.log(`${"时间".padEnd(24)} ${"source".padEnd(10)} ${"model".padEnd(22)} ${"input".padStart(10)} ${"output".padStart(8)} ${"cacheR".padStart(10)} ${"cacheW".padStart(8)} ${"hit%".padStart(7)} ${"cost".padStart(10)}`);
  console.log("─".repeat(120));

  const sorted = [...records].sort((a, b) => (b.inputTokens || 0) - (a.inputTokens || 0)).slice(0, n);
  for (const r of sorted) {
    const ts = (r.ts || "").replace("T", " ").slice(0, 19);
    const total = (r.inputTokens || 0) + (r.cacheReadTokens || 0);
    const hitRate = total > 0
      ? ((r.cacheReadTokens || 0) / total * 100).toFixed(1) + "%"
      : "N/A";
    console.log(
      `${ts.padEnd(24)} ${(r.source || "").padEnd(10)} ${(r.modelId || "").padEnd(22)} ` +
      `${fmtNum(r.inputTokens).padStart(10)} ${fmtNum(r.outputTokens).padStart(8)} ` +
      `${fmtNum(r.cacheReadTokens).padStart(10)} ${fmtNum(r.cacheWriteTokens).padStart(8)} ` +
      `${hitRate.padStart(7)} ${fmtCost(r.costTotal).padStart(10)}`
    );
  }
}

function printCacheAnalysis(records) {
  console.log(`\n🔍 缓存命中率分析`);
  console.log("═".repeat(80));

  const cacheHits = records.filter(r => r.cacheHit);
  const cacheMisses = records.filter(r => !r.cacheHit);
  console.log(`  缓存命中: ${cacheHits.length} 条 (${(cacheHits.length / records.length * 100).toFixed(1)}%)`);
  console.log(`  缓存未命中: ${cacheMisses.length} 条`);

  // 低缓存命中率请求（总量 > 10K token）
  const lowHit = records.filter(r => {
    const total = (r.inputTokens || 0) + (r.cacheReadTokens || 0);
    return total > 10000 && (r.cacheReadTokens || 0) / total < 0.2;
  });
  if (lowHit.length > 0) {
    console.log(`\n  ⚠️  低缓存命中率请求（<20% 且 totalTokens>10K）：${lowHit.length} 条`);
    for (const r of lowHit.sort((a, b) => (b.inputTokens || 0) - (a.inputTokens || 0)).slice(0, 20)) {
      const ts = (r.ts || "").replace("T", " ").slice(0, 19);
      const total = (r.inputTokens || 0) + (r.cacheReadTokens || 0);
      const rate = total > 0 ? ((r.cacheReadTokens || 0) / total * 100).toFixed(1) : "0";
      console.log(`    ${ts} | ${(r.source||"").padEnd(8)} ${(r.modelId||"").padEnd(22)} | in=${fmtNum(r.inputTokens)} cacheR=${fmtNum(r.cacheReadTokens)} hitRate=${rate}%`);
    }
  }

  // 按小时统计缓存命中率趋势
  console.log(`\n  按小时缓存命中率趋势：`);
  const byHour = {};
  for (const r of records) {
    const hour = r.ts.slice(0, 13); // YYYY-MM-DDTHH
    byHour[hour] = byHour[hour] || { count: 0, input: 0, cacheR: 0 };
    byHour[hour].count++;
    byHour[hour].input += r.inputTokens || 0;
    byHour[hour].cacheR += r.cacheReadTokens || 0;
  }
  const hours = Object.keys(byHour).sort();
  for (const h of hours.slice(-24)) { // 最近 24 小时
    const s = byHour[h];
    const total = s.input + s.cacheR;
    const rate = total > 0 ? (s.cacheR / total * 100).toFixed(1) : "0";
    const bar = "█".repeat(Math.min(50, Math.round(s.cacheR / Math.max(1, total) * 50)));
    console.log(`    ${h} | ${String(s.count).padStart(3)}条 | hitRate=${rate.padStart(5)}% | ${bar}`);
  }
}

// ── Main ──
const opts = parseArgs();
const records = loadRecords();
const filtered = filterRecords(records, opts);

if (filtered.length === 0) {
  console.log("没有匹配的记录。");
  process.exit(0);
}

printSummary(filtered);

if (opts.cache) {
  printCacheAnalysis(filtered);
} else {
  printTop(filtered, opts.top);
}
