/**
 * check-deferred-tool.js — Check async task status for the current session
 *
 * Generic tool covering all background tasks registered via DeferredResultStore:
 * 图片/视频生成、subagent、后台终端等。
 * 按当前 sessionPath 隔离，不跨 session。
 */

import { Type } from "../pi-sdk/index.js";
import { getToolSessionPath } from "./tool-session.js";

/**
 * @param {{
 *   getDeferredStore: () => import("../deferred-result-store.js").DeferredResultStore | null,
 *   getSessionPath: () => string | null,
 * }} opts
 */
export function createCheckDeferredTool({ getDeferredStore, getSessionPath }) {
  return {
    name: "check_pending_tasks",
    description:
      "Check the status of all background async tasks in the current session (image/video generation, subagent, etc.). Only returns tasks from this session.",
    parameters: Type.Object({
      status: Type.Optional(
        Type.String({ description: "Filter by status: pending / resolved / failed. Omit to return all." }),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const store = getDeferredStore();
      if (!store) {
        return { content: [{ type: "text", text: "Deferred task store not initialized." }] };
      }

      const sessionPath = getToolSessionPath(ctx);
      if (!sessionPath) {
        return { content: [{ type: "text", text: "当前无活跃 session。" }] };
      }

      const all = store.listBySession(sessionPath);
      const filtered = params.status
        ? all.filter((t) => t.status === params.status)
        : all;

      if (!filtered.length) {
        const qualifier = params.status ? `（状态: ${params.status}）` : "";
        return { content: [{ type: "text", text: `当前对话没有后台任务${qualifier}。` }] };
      }

      const summary = filtered.map((t) => ({
        taskId: t.taskId,
        status: t.status,
        type: t.meta?.type || "unknown",
        deferredAt: new Date(t.deferredAt).toISOString(),
        ...(t.result != null && { result: t.result }),
        ...(t.reason != null && { reason: t.reason }),
        ...(t.meta && Object.keys(t.meta).length > 1 && { meta: t.meta }),
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    },
  };
}
