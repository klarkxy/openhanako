import { describe, expect, it } from "vitest";
import { createHostApi } from "../lib/workflow/host-api.js";
import { createLimiter } from "../lib/workflow/concurrency.js";

export function makeDeps(over = {}) {
  return {
    executeIsolated: over.executeIsolated || (async () => ({ replyText: "ok", error: null })),
    baseIsoOpts: over.baseIsoOpts || { agentId: "a1", parentSessionPath: "/s.jsonl", cwd: "/w" },
    limiter: over.limiter || createLimiter({ maxConcurrent: 4, maxTotal: 100 }),
    signal: over.signal,
    onProgress: over.onProgress || (() => {}),
    budget: over.budget || { total: null, spent: () => 0, remaining: () => Infinity },
    args: over.args,
    resolveAgentId: over.resolveAgentId,
  };
}

describe("host api - agent()", () => {
  it("调 executeIsolated 并返回 replyText", async () => {
    const calls = [];
    const api = createHostApi(makeDeps({
      executeIsolated: async (p, o) => { calls.push({ p, o }); return { replyText: "hello", error: null }; },
    }));
    const r = await api.agent("do it");
    expect(r).toBe("hello");
    expect(calls[0].o.agentId).toBe("a1");
    expect(calls[0].p).toBe("do it");
  });

  it("opts.model / opts.agentType 透传与解析", async () => {
    const calls = [];
    const api = createHostApi(makeDeps({
      executeIsolated: async (p, o) => { calls.push(o); return { replyText: "x", error: null }; },
      resolveAgentId: (t) => (t === "Explore" ? "explore-agent" : undefined),
    }));
    await api.agent("p", { model: "claude-haiku-4-5-20251001", agentType: "Explore" });
    expect(calls[0].model).toBe("claude-haiku-4-5-20251001");
    expect(calls[0].agentId).toBe("explore-agent");
  });

  it("executeIsolated 返回 error 时抛错", async () => {
    const api = createHostApi(makeDeps({ executeIsolated: async () => ({ replyText: "", error: "模型挂了" }) }));
    await expect(api.agent("x")).rejects.toThrow(/模型挂了/);
  });

  it("带 schema：注入 structured_output 并返回结构化对象", async () => {
    const api = createHostApi(makeDeps({
      executeIsolated: async (p, o) => {
        const tool = o.extraCustomTools.find((t) => t.name === "structured_output");
        await tool.execute("c", { n: 7 });
        return { replyText: "", error: null };
      },
    }));
    const out = await api.agent("count", { schema: { type: "object", properties: { n: { type: "number" } } } });
    expect(out).toEqual({ n: 7 });
  });

  it("带 schema 但子 agent 没调工具时抛错", async () => {
    const api = createHostApi(makeDeps({ executeIsolated: async () => ({ replyText: "forgot", error: null }) }));
    await expect(api.agent("x", { schema: { type: "object" } })).rejects.toThrow(/未调用 structured_output/);
  });

  it("signal 已 abort 时 agent() 抛错", async () => {
    const ac = new AbortController(); ac.abort();
    const api = createHostApi(makeDeps({ signal: ac.signal }));
    await expect(api.agent("x")).rejects.toThrow(/中止/);
  });
});
