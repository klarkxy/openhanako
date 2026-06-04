/**
 * ask-user-tool.js — 向用户提一个可选项问题
 *
 * 单选 / 多选，2-4 个真实选项 + 自动追加的"其他"= 0 号位。
 * 通过 ConfirmStore 阻塞 turn，桌面渲染单选/多选卡片，Bridge 发编号消息让用户回复。
 *
 * 桌面：用户操作结构化表单 → POST /confirm/:id value = { mode, selected, custom }
 * Bridge：用户回纯文本 → bridge-manager 拦截后调 parser → 调 ConfirmStore.resolve
 *
 * 工具 result 给 AI 的文本：
 *   - confirmed + selected：列出用户选的标签
 *   - confirmed + custom：用户自由输入的文本
 *   - rejected / timeout：告知用户取消 / 超时，AI 自决
 */

import { Type, StringEnum } from "../pi-sdk/index.js";
import { t } from "../../server/i18n.js";
import { getToolSessionPath } from "./tool-session.js";
import { formatAnswerForAi, buildNumberedOptions, renderAskUserText } from "./ask-user-parser.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

/**
 * @param {{
 *   getConfirmStore: () => import("../confirm-store.js").ConfirmStore | null,
 *   getSessionPath: () => string | null,
 *   emitEvent: (event: object, sessionPath: string|null) => void,
 *   bridgeContextResolver?: (sessionPath: string) => { isBridgeSession: boolean, platform: string, chatId: string, agentId: string|null, sessionKey: string|null } | null,
 *   bridgeSender?: (payload: { sessionPath: string, text: string, platforms?: string[] }) => Promise<void>,
 *   bridgeAckSender?: (payload: { sessionPath: string, parsed: object, mode: string, options: object[] }) => Promise<void>,
 *   timeoutMs?: number,
 * }} opts
 */
export function createAskUserTool(opts) {
  const {
    getConfirmStore,
    getSessionPath,
    emitEvent,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  return {
    name: "ask_user",
    label: t("toolDef.ask_user.label"),
    description: t("toolDef.ask_user.description"),
    parameters: Type.Object({
      question: Type.String({ description: t("toolDef.ask_user.questionDesc") }),
      header: Type.Optional(Type.String({
        description: t("toolDef.ask_user.headerDesc"),
        maxLength: 12,
      })),
      mode: Type.Optional(StringEnum(["single", "multi"], {
        description: t("toolDef.ask_user.modeDesc"),
        default: "single",
      })),
      options: Type.Array(Type.Object({
        label: Type.String({ description: t("toolDef.ask_user.optionLabelDesc") }),
        description: Type.Optional(Type.String({ description: t("toolDef.ask_user.optionDescriptionDesc") })),
      }), {
        minItems: 2,
        maxItems: 4,
        description: t("toolDef.ask_user.optionsDesc"),
      }),
      multiMin: Type.Optional(Type.Number({
        description: t("toolDef.ask_user.multiMinDesc"),
        minimum: 0,
      })),
      multiMax: Type.Optional(Type.Number({
        description: t("toolDef.ask_user.multiMaxDesc"),
        minimum: 1,
      })),
    }),

    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const sessionPath = getToolSessionPath(ctx) || getSessionPath?.() || null;
      const store = getConfirmStore?.() || null;
      if (!store) {
        throw new Error("ask_user requires ConfirmStore to be available");
      }
      if (!sessionPath) {
        throw new Error("ask_user requires an active sessionPath");
      }

      const mode = params.mode === "multi" ? "multi" : "single";
      const realOptions = (params.options || []).map(o => ({
        label: String(o.label || "").trim(),
        description: o.description ? String(o.description) : null,
      })).filter(o => o.label);

      if (realOptions.length < 2) {
        throw new Error("ask_user requires at least 2 real options");
      }
      if (mode === "multi" && params.multiMin != null && params.multiMax != null
          && params.multiMin > params.multiMax) {
        throw new Error("ask_user multiMin must be <= multiMax");
      }

      // 1. 注册 confirmation（生成 confirmId + 阻塞 Promise）
      const numbered = buildNumberedOptions(realOptions);
      const payload = {
        question: String(params.question || "").trim(),
        header: params.header ? String(params.header).trim().slice(0, 12) : null,
        mode,
        options: realOptions,
        multiMin: params.multiMin ?? null,
        multiMax: params.multiMax ?? null,
        // 附带"编号视图"，给 bridge 渲染 + 解析使用；不参与桌面结构化表单
        numbered: numbered.map(({ label, description }) => ({ label, description })),
      };
      const { confirmId, promise } = store.create("ask_user", payload, sessionPath, timeoutMs);

      // 2. 通知 session stream 插入 ask_user_confirm block（桌面渲染）
      //    emitEvent 由 caller 注入，第二参数是 sessionPath 用于路由 stream
      try {
        emitEvent?.({
          type: "ask_user_confirmation",
          confirmId,
          sessionPath,
          question: payload.question,
          header: payload.header,
          mode: payload.mode,
          options: payload.options,
          multiMin: payload.multiMin,
          multiMax: payload.multiMax,
        }, sessionPath);
      } catch (err) {
        // 通知失败不阻塞 turn，桌面可能不渲染但 ConfirmStore 仍可 resolve
        // eslint-disable-next-line no-console
        console.warn(`[ask_user] emit ask_user_confirmation failed: ${err?.message}`);
      }

      // 3. 阻塞等待用户响应
      const result = await promise;

      // 4. 翻译成给 AI 看的文本
      if (result?.action === "confirmed") {
        const value = result.value || {};
        const normalized = {
          mode: value.mode || mode,
          selected: value.selected ?? null,
          custom: value.custom ?? null,
          pendingOther: false,
        };
        const text = formatAnswerForAi(normalized, payload);
        return {
          content: [{ type: "text", text }],
          details: {
            confirmId,
            status: "confirmed",
            question: payload.question,
            mode: payload.mode,
            selected: normalized.selected,
            custom: normalized.custom,
          },
        };
      }

      if (result?.action === "rejected") {
        return {
          content: [{ type: "text", text: t("error.askUserRejected") }],
          details: {
            confirmId,
            status: "rejected",
            question: payload.question,
            mode: payload.mode,
          },
        };
      }

      // action === "timeout" | "aborted" | 其它
      return {
        content: [{ type: "text", text: t("error.askUserTimeout") }],
        details: {
          confirmId,
          status: result?.action || "timeout",
          question: payload.question,
          mode: payload.mode,
        },
      };
    },
  };
}

export { renderAskUserText, buildNumberedOptions };
