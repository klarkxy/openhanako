/**
 * GuestHandler — Guest 留言机处理
 *
 * 所有非主人的消息都经过这里。
 * A: 消息前缀标注发送者身份
 * B: system prompt 注入对话上下文（不暴露任何主人隐私）
 */

import { getLocale } from "../server/i18n.js";
import {
  buildBridgeAudiencePrompt,
  bridgeRelationLabel,
  getEffectiveBridgeRelationPolicy,
  normalizeBridgeRelation,
} from "../lib/bridge/contacts/policy.js";

function formatSenderTag({ relation, senderName, text, locale }) {
  const isZh = String(locale || "").startsWith("zh");
  const safeSenderName = typeof senderName === "string" ? senderName.trim() : "";
  const alreadyNamed = safeSenderName && (text.startsWith(`${safeSenderName}: `) || text.startsWith(`${safeSenderName}：`));
  const label = bridgeRelationLabel(relation, locale) || (isZh ? "访客" : "guest");
  if (alreadyNamed) {
    return relation === "stranger" ? (isZh ? "访客" : "guest") : label;
  }
  if (!safeSenderName) return relation === "stranger" ? (isZh ? "访客" : "guest") : label;
  if (relation === "stranger") return safeSenderName;
  return `${label} ${safeSenderName}`;
}

export class GuestHandler {
  /**
   * @param {object} opts
   * @param {import('./index.js').Hub} opts.hub
   */
  constructor({ hub }) {
    this._hub = hub;
  }

  /**
   * 处理 guest 消息
   * @param {string} text
   * @param {string} sessionKey
   * @param {object} [meta]  { name, avatarUrl, userId }
   * @param {object} [opts]  { isGroup }
   * @returns {Promise<string|null>}
   */
  async handle(text, sessionKey, meta, opts = {}) {
    const locale = getLocale();
    const isZh = locale.startsWith("zh");
    const relation = normalizeBridgeRelation(opts.bridgeAudience?.relation || "stranger");
    const policy = getEffectiveBridgeRelationPolicy(relation, opts.bridgeAudience || null);
    const senderName = meta?.name || opts.bridgeAudience?.contactName || (isZh ? "访客" : "Guest");
    const isGroup = opts.isGroup || false;

    // A: 消息前缀
    const senderTag = formatSenderTag({ relation, senderName, text, locale });
    const prefixed = isZh
      ? `[来自${senderTag}] ${text}`
      : `[From ${senderTag}] ${text}`;

    // B: 上下文标签（注入到 system prompt 末尾）
    const contextTag = buildBridgeAudiencePrompt({ relation, policy, senderName, isGroup, locale });

    return this._hub.engine.executeExternalMessage(prefixed, sessionKey, meta, {
      guest: true,
      agentId: opts.agentId,
      bridgeAudience: opts.bridgeAudience,
      contextTag,
      onDelta: opts.onDelta,
      images: opts.images,
      imageAttachmentPaths: opts.imageAttachmentPaths,
      inboundFiles: opts.inboundFiles,
      displayMessage: opts.displayMessage,
    });
  }
}
