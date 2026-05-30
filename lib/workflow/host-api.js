import { createStructuredOutputTool } from "./structured-output.js";

/**
 * 组装注入沙箱的宿主 API。引擎层不认识 agent 名字，agentType→agentId 的解析由调用方注入 resolveAgentId。
 * @param {{
 *   executeIsolated: (prompt: string, isoOpts: object) => Promise<{ replyText?: string, error?: string|null }>,
 *   baseIsoOpts: object,
 *   limiter: { run: (thunk: () => Promise<any>) => Promise<any> },
 *   signal?: AbortSignal,
 *   onProgress?: (evt: object) => void,
 *   budget?: { total: number|null, spent: () => number, remaining: () => number },
 *   args?: any,
 *   resolveAgentId?: (agentType?: string) => string|undefined,
 * }} deps
 * @returns {{ agent: Function, budget: any, args: any }}
 */
export function createHostApi(deps) {
  const { executeIsolated, baseIsoOpts, limiter, signal, budget, args, resolveAgentId } = deps;

  async function agent(prompt, opts = {}) {
    return limiter.run(async () => {
      if (signal?.aborted) throw new Error("workflow 已中止");
      const isoOpts = { ...baseIsoOpts, signal };
      if (opts.model) isoOpts.model = opts.model;
      if (opts.agentType && typeof resolveAgentId === "function") {
        const id = resolveAgentId(opts.agentType);
        if (id) isoOpts.agentId = id;
      }
      if (opts.toolFilter) isoOpts.toolFilter = opts.toolFilter;

      let structured = null;
      let finalPrompt = prompt;
      if (opts.schema) {
        structured = createStructuredOutputTool(opts.schema);
        isoOpts.extraCustomTools = [...(isoOpts.extraCustomTools || []), structured.tool];
        finalPrompt = prompt + "\n\n完成后必须调用一次 structured_output 工具，返回严格符合所需 schema 的结果。";
      }

      const res = await executeIsolated(finalPrompt, isoOpts);
      if (res?.error) throw new Error(`agent 失败: ${res.error}`);
      if (structured) {
        const out = structured.getResult();
        if (out === undefined) throw new Error("agent 未调用 structured_output 返回结构化结果");
        return out;
      }
      return res?.replyText ?? "";
    });
  }

  return { agent, budget, args };
}
