import { useStore } from '../stores';
import type { ContentBlock } from '../stores/chat-types';

/**
 * 提取选中消息的文本。
 * - 单条消息：只返回纯文本内容（保持简洁）。
 * - 多条消息：每条前冠以【说话人】，消息之间用 `───` 分隔，
 *   方便在批量复制时辨认每条消息的归属。
 */
export function extractSelectedTexts(sessionPath: string, selectedIds: readonly string[]): string {
  const state = useStore.getState();
  const session = state.chatSessions[sessionPath];
  if (!session) return '';

  const selectedSet = new Set(selectedIds);

  // 收集选中的消息文本（保持原始顺序）
  const messages: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const item of session.items) {
    if (item.type !== 'message') continue;
    if (!selectedSet.has(item.data.id)) continue;

    let text: string;
    if (item.data.role === 'user') {
      text = (item.data.text || '').trim();
    } else {
      const textBlocks = (item.data.blocks || []).filter(
        (b): b is ContentBlock & { type: 'text' } => b.type === 'text'
      );
      if (textBlocks.length === 0) continue;
      const tmp = document.createElement('div');
      tmp.innerHTML = textBlocks.map(b => b.html).join('\n');
      text = tmp.innerText.trim();
    }
    if (!text) continue;
    messages.push({ role: item.data.role, text });
  }

  if (messages.length === 0) return '';

  // 单条消息：只返回内容（与旧行为一致）
  if (messages.length === 1) {
    return messages[0].text;
  }

  // 多条消息：每条前加说话人标记，消息之间用分隔线
  const userName = state.userName || '我';
  const agentName = state.agentName || 'Hanako';

  const parts = messages.map(m => {
    const speaker = m.role === 'user' ? userName : agentName;
    return `【${speaker}】\n${m.text}`;
  });

  return parts.join('\n\n───\n\n');
}
