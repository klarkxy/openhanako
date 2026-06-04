/**
 * ask-user-parser.js — Bridge 编号协议纯函数
 *
 * 桌面用结构化表单数据，绕开本解析器；
 * Bridge / CLI 收到纯文本消息时走本解析器得到统一的 { mode, selected, custom }。
 *
 * 协议（基于 AI 提出的 options 数组 + 自动追加的"其他"= 0 号位）：
 *   - 单选：回复 "1" → selected = options[0].label
 *   - 多选：回复 "1,3" → selected = [options[0].label, options[2].label]
 *   - 其他：回复 "0" → 标记 pending-other，bot 回追问，下一条消息作为 custom
 *   - 自由输入：非数字开头且 ≤ 500 字 → custom = 原文
 *
 * 解析失败统一返回 null（调用方应放行到普通消息流）。
 */

const MAX_CUSTOM_LEN = 500;

export const ASK_USER_OTHER_INDEX = 0;
export const ASK_USER_OTHER_LABEL = "__other__";

/**
 * 把 AI 提的 options 包装成带"其他"占位的全量列表（含编号）。
 * 编号从 1 开始，0 永远代表"其他"。
 */
export function buildNumberedOptions(options) {
  const real = Array.isArray(options) ? options : [];
  return [
    { n: 0, label: ASK_USER_OTHER_LABEL, description: "其他（自由输入）" },
    ...real.map((o, i) => ({ n: i + 1, label: o.label, description: o.description || null })),
  ];
}

/**
 * 解析用户对 ask_user 消息的纯文本回复。
 * @param {string} text - 用户原始文本（未 trim）
 * @param {object} payload - ask_user 创建 confirmation 时存的 payload
 * @param {"single"|"multi"} payload.mode
 * @param {Array<{label:string, description?:string}>} payload.options
 * @returns {null | { mode: "single"|"multi", selected: string|string[]|null, custom: string|null, pendingOther: boolean }}
 */
export function parseUserReply(text, payload) {
  if (!text || typeof text !== "string" || !payload) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const mode = payload.mode === "multi" ? "multi" : "single";
  const options = Array.isArray(payload.options) ? payload.options : [];
  if (!options.length) return null;

  const maxN = options.length; // 1..N 是真实选项，0 是"其他"
  const isNumbered = /^[0-9]+(?:[,\s、，]+[0-9]+)*$/.test(trimmed);
  if (isNumbered) {
    const nums = trimmed
      .split(/[,\s、，]+/)
      .map(s => Number(s))
      .filter(Number.isFinite);
    if (!nums.length) return null;
    const valid = nums.filter(n => Number.isInteger(n) && n >= 0 && n <= maxN);
    if (valid.length !== nums.length) return null;

    const wantsOther = valid.includes(0);
    const realNums = valid.filter(n => n !== 0);
    const realLabels = realNums.map(n => options[n - 1]?.label).filter(Boolean);

    if (wantsOther && realLabels.length) {
      // 同时选了 0 和具体项 → 拒绝
      return null;
    }

    if (wantsOther) {
      // 命中"其他"：标记 pendingOther，由 caller 追问一次后再回
      return { mode, selected: null, custom: null, pendingOther: true };
    }

    if (mode === "multi") {
      const dedup = Array.from(new Set(realLabels));
      return { mode: "multi", selected: dedup, custom: null, pendingOther: false };
    }
    if (realLabels.length > 1) return null;
    return { mode: "single", selected: realLabels[0], custom: null, pendingOther: false };
  }

  // 非数字开头 → 当作"其他"的自由输入
  if (trimmed.length > MAX_CUSTOM_LEN) return null;
  return { mode, selected: null, custom: trimmed, pendingOther: false };
}

/**
 * 把 ask_user payload 渲染成 Bridge 友好的纯文本（编号 + 说明）。
 * @param {object} payload
 * @param {object} [i18n] - 简单 i18n 字符串表：{ otherLabel?, replyHintSingle?, replyHintMulti? }
 *   也兼容旧调用：传 t 函数时仍能取到 askUser.* / common.* 键。
 */
export function renderAskUserText(payload, i18n = {}) {
  const header = payload.header ? `【${payload.header}】\n` : "";
  const lines = [];
  lines.push(`${payload.question}`);
  lines.push("");
  const real = Array.isArray(payload.options) ? payload.options : [];
  real.forEach((o, i) => {
    const n = i + 1;
    lines.push(`${n}. ${o.label}`);
    if (o.description) lines.push(`   ${o.description}`);
  });
  lines.push("");
  // 兼容 i18n 是函数 / 对象 / null
  const pick = (key, fallback) => {
    if (typeof i18n === "function") return i18n(key) || fallback;
    if (i18n && typeof i18n === "object") {
      if (key === "askUser.otherLabel") return i18n.otherLabel || fallback;
      if (key === "askUser.replyHintSingle") return i18n.replyHintSingle || fallback;
      if (key === "askUser.replyHintMulti") return i18n.replyHintMulti || fallback;
    }
    return fallback;
  };
  lines.push(`0. ${pick("askUser.otherLabel", "其他（直接回复内容）")}`);
  lines.push("");
  if (payload.mode === "multi") {
    lines.push(pick("askUser.replyHintMulti", "请回复编号（多选用逗号分隔，如 1,3）"));
  } else {
    lines.push(pick("askUser.replyHintSingle", "请回复选项编号"));
  }
  return header + lines.join("\n");
}

/**
 * 把 parseUserReply 的结果序列化成给 AI 看的文本（写入 tool result）。
 */
export function formatAnswerForAi(parsed, payload) {
  if (!parsed) return "(解析失败)";
  const mode = payload?.mode === "multi" ? "multi" : "single";
  if (parsed.custom != null) {
    return mode === "multi"
      ? `用户选择（多选 + 自由补充）：其他 = "${parsed.custom}"`
      : `用户选择（其他/自由回答）："${parsed.custom}"`;
  }
  const sel = parsed.selected;
  if (mode === "multi") {
    if (Array.isArray(sel) && sel.length) {
      return `用户选择（多选）：${sel.join("、")}`;
    }
    return "用户选择（多选）：（未选）";
  }
  return `用户选择（单选）：${sel || "（未选）"}`;
}
