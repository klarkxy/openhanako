/**
 * GuestHandler — Guest 留言机处理
 *
 * 所有非主人的消息都经过这里。
 * A: 消息前缀标注发送者身份
 * B: system prompt 注入对话上下文（不暴露任何主人隐私）
 */

import {
  buildBridgeAudiencePrompt,
  bridgeRelationLabel,
  getEffectiveBridgeRelationPolicy,
  normalizeBridgeRelation,
} from "../lib/bridge/contacts/policy.js";

function formatSenderTag({ relation, senderName, text }) {
  const safeSenderName = typeof senderName === "string" ? senderName.trim() : "";
  const alreadyNamed = safeSenderName && (text.startsWith(`${safeSenderName}: `) || text.startsWith(`${safeSenderName}：`));
  const label = bridgeRelationLabel(relation, "en") || "guest";
  if (alreadyNamed) {
    return relation === "stranger" ? "guest" : label;
  }
  if (!safeSenderName) return relation === "stranger" ? "guest" : label;
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
    const relation = normalizeBridgeRelation(opts.bridgeAudience?.relation || "stranger");
    const policy = getEffectiveBridgeRelationPolicy(relation, opts.bridgeAudience || null);
    const senderName = meta?.name || opts.bridgeAudience?.contactName || "Guest";
    const isGroup = opts.isGroup || false;

    // A: message prefix (behavior instruction context → English)
    const senderTag = formatSenderTag({ relation, senderName, text });
    const prefixed = `[From ${senderTag}] ${text}`;

    // B: context tag injected into system prompt (→ English)
    const contextTag = buildBridgeAudiencePrompt({ relation, policy, senderName, isGroup });

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
