/**
 * useThinkingTranslation — 思考内容翻译 hook
 *
 * 当 thinking block sealed 且内容为英文时，自动调用翻译 API。
 * 翻译结果缓存在 translation-store 中，不进入 LLM 上下文。
 */

import { useEffect, useRef } from 'react';
import { useTranslationStore } from '../stores/translation-store';
import { useSettingsStore } from '../settings/store';
import { hanaFetch } from '../settings/api';

/**
 * 简单的英文检测：ASCII 字母占比超过 60% 视为英文
 */
function isLikelyEnglish(text: string): boolean {
  if (!text || text.length < 20) return false;
  const letters = text.replace(/[^a-zA-Z]/g, '');
  return letters.length / text.length > 0.6;
}

interface UseThinkingTranslationOptions {
  sessionPath: string;
  messageId: string;
  content: string;
  sealed: boolean;
}

export function useThinkingTranslation({
  sessionPath,
  messageId,
  content,
  sealed,
}: UseThinkingTranslationOptions): {
  translation: string | undefined;
  status: 'idle' | 'pending' | 'done' | 'error';
} {
  const globalModelsConfig = useSettingsStore(s => s.globalModelsConfig);
  const translationEnabled = globalModelsConfig?.models?.translation_enabled === true;
  const translationModel = globalModelsConfig?.models?.translation;

  const getTranslation = useTranslationStore(s => s.getTranslation);
  const setTranslation = useTranslationStore(s => s.setTranslation);
  const setError = useTranslationStore(s => s.setError);
  const isPending = useTranslationStore(s => s.isPending);
  const markPending = useTranslationStore(s => s.markPending);
  const unmarkPending = useTranslationStore(s => s.unmarkPending);

  const cached = getTranslation(sessionPath, messageId);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // 条件不满足：不翻译（翻译模型由后端自动回退到 utility 模型）
    if (!sealed || !translationEnabled || !content) return;
    // 已有缓存或正在翻译
    if (cached || isPending(sessionPath, messageId)) return;
    // 不是英文
    if (!isLikelyEnglish(content)) return;

    const controller = new AbortController();
    abortRef.current = controller;

    markPending(sessionPath, messageId);

    hanaFetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content }),
      signal: controller.signal,
    })
      .then(res => res.json())
      .then(data => {
        if (data.translation && !controller.signal.aborted) {
          setTranslation(sessionPath, messageId, data.translation);
        } else if (data.error) {
          console.warn('[translation] API error:', data.error);
          setError(sessionPath, messageId);
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.warn('[translation] request failed:', err);
          setError(sessionPath, messageId);
        }
      })
      .finally(() => {
        unmarkPending(sessionPath, messageId);
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sealed, content, translationEnabled, translationModel, sessionPath, messageId]);

  const status: 'idle' | 'pending' | 'done' | 'error' = !sealed || !translationEnabled
    ? 'idle'
    : cached?.status === 'done'
      ? 'done'
      : cached?.status === 'error'
        ? 'error'
        : isPending(sessionPath, messageId)
          ? 'pending'
          : 'idle';

  return {
    translation: cached?.status === 'done' ? cached.zh : undefined,
    status,
  };
}
