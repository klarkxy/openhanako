/**
 * llm-usage-tool.js - LLM Token 消耗查询工具
 */

import { Type, StringEnum } from "../pi-sdk/index.js";
import fs from "fs";
import path from "path";
import os from "os";

const LOG = path.join(os.homedir(), ".hanako-dev", "logs", "llm-usage.jsonl");

function loadRecs(hours) {
  if (!fs.existsSync(LOG)) return [];
  const raw = fs.readFileSync(LOG, "utf-8").trim();
  if (!raw) return [];
  const cutoff = hours ? Date.now() - hours * 3600000 : 0;
  return raw.split("\n").map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(r => r && (!cutoff || new Date(r.ts).getTime() >= cutoff));
}

function fm(n) { return n?.toLocaleString?.() ?? "0"; }

function doSummary(recs) {
  const s = (arr, k) => arr.reduce((a, r) => a + (r[k] || 0), 0);
  const ti = s(recs, "inputTokens"), to = s(recs, "outputTokens");
  const cr = s(recs, "cacheReadTokens"), cw = s(recs, "cacheWriteTokens");
  const tc = s(recs, "costTotal");
  const hr = ti + cr > 0 ? (cr / (ti + cr) * 100).toFixed(1) + "%" : "N/A";
  const byS = {}, byM = {};
  for (const r of recs) { const k = r.source || "?"; byS[k] = byS[k] || { n: 0, i: 0, c: 0, t: 0 }; byS[k].n++; byS[k].i += r.inputTokens || 0; byS[k].c += r.cacheReadTokens || 0; byS[k].t += r.costTotal || 0; }
  for (const r of recs) { const k = r.modelId || "?"; byM[k] = byM[k] || { n: 0, i: 0, c: 0, t: 0 }; byM[k].n++; byM[k].i += r.inputTokens || 0; byM[k].c += r.cacheReadTokens || 0; byM[k].t += r.costTotal || 0; }
  let t = recs.length + " records | input=" + fm(ti) + " output=" + fm(to) + " cacheR=" + fm(cr) + " cacheW=" + fm(cw) + " hitRate=" + hr + " cost=$" + tc.toFixed(4) + "\n\nBy source:\n";
  for (const [k, v] of Object.entries(byS).sort((a, b) => b[1].i - a[1].i)) t += "  " + k + ": " + v.n + "条 input=" + fm(v.i) + " cacheR=" + fm(v.c) + " cost=$" + v.t.toFixed(4) + "\n";
  t += "\nBy model:\n";
  for (const [k, v] of Object.entries(byM).sort((a, b) => b[1].i - a[1].i)) t += "  " + k + ": " + v.n + "条 input=" + fm(v.i) + " cacheR=" + fm(v.c) + " cost=$" + v.t.toFixed(4) + "\n";
  return t;
}

function doTop(recs, n) {
  const sorted = [...recs].sort((a, b) => (b.inputTokens || 0) - (a.inputTokens || 0)).slice(0, n);
  let t = "Top " + n + " by input:\n";
  for (const r of sorted) {
    const ts = (r.ts || "").replace("T", " ").slice(0, 19);
    const tot = (r.inputTokens || 0) + (r.cacheReadTokens || 0);
    const hr = tot > 0 ? ((r.cacheReadTokens || 0) / tot * 100).toFixed(1) + "%" : "N/A";
    t += ts + " | " + (r.source || "") + " | " + (r.modelId || "") + " | in=" + fm(r.inputTokens) + " out=" + fm(r.outputTokens) + " cacheR=" + fm(r.cacheReadTokens) + " hit=" + hr + "\n";
  }
  return t;
}

function doCache(recs) {
  const lo = recs.filter(r => { const tot = (r.inputTokens || 0) + (r.cacheReadTokens || 0); return tot > 10000 && (r.cacheReadTokens || 0) / tot < 0.2; });
  const hits = recs.filter(r => r.cacheHit).length;
  let t = "Cache: " + hits + " hits (" + (hits / recs.length * 100).toFixed(1) + "%) / " + (recs.length - hits) + " misses\n";
  if (lo.length) { t += "\nLow hit rate (<20%, >10K): " + lo.length + " records\n"; for (const r of lo.sort((a, b) => (b.inputTokens || 0) - (a.inputTokens || 0)).slice(0, 10)) { const ts = (r.ts || "").replace("T", " ").slice(0, 19); t += "  " + ts + " | " + (r.source || "") + " " + (r.modelId || "") + " | in=" + fm(r.inputTokens) + " cacheR=" + fm(r.cacheReadTokens) + "\n"; } }
  return t;
}

export function createLlmUsageTool() {
  return {
    name: "llm_usage",
    label: "LLM Token 消耗查询",
    description: "查询 LLM token 消耗记录和缓存命中率。用于排查费用异常、缓存失效问题。\n数据来源: ~/.hanako-dev/logs/llm-usage.jsonl\n\n用法: action=summary hours=24 | action=top | action=cache",
    parameters: Type.Object({
      action: StringEnum(["summary", "top", "cache"], {
        description: "summary=汇总统计, top=高消耗排行, cache=缓存命中率分析",
        default: "summary",
      }),
      hours: Type.Number({ description: "查询最近 N 小时的记录，默认 24", minimum: 1, maximum: 720, default: 24 }),
      top: Type.Number({ description: "action=top 时返回前 N 条，默认 10", minimum: 1, maximum: 50, default: 10 }),
      model: Type.String({ description: "可选: 只查询指定模型（如 deepseek-v4-pro）", default: "" }),
      source: Type.String({ description: "可选: 只查询指定来源（chat/utility/bridge）", default: "" }),
    }),
    execute: async (_toolCallId, params) => {
      const { action = "summary", hours = 24, top = 10, model = "", source = "" } = params;
      let recs = loadRecs(hours);
      if (!recs.length) return { content: [{ type: "text", text: "暂无 token 消耗记录。请先重启 openhanako，等待产生 LLM 请求后再查询。" }], details: { records: 0 } };
      if (model) recs = recs.filter(r => r.modelId === model);
      if (source) recs = recs.filter(r => r.source === source);
      if (!recs.length) return { content: [{ type: "text", text: "过滤后无匹配记录。" }], details: { records: 0 } };
      let text;
      switch (action) { case "top": text = doSummary(recs) + "\n\n" + doTop(recs, top); break; case "cache": text = doCache(recs); break; default: text = doSummary(recs); }
      return { content: [{ type: "text", text }], details: { records: recs.length, action, hours } };
    },
  };
}
