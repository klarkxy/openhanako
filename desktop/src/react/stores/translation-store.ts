/**
 * translation-store — 思考翻译缓存
 *
 * 缓存 thinking block 的中文翻译，按 sessionPath + messageId 索引。
 * 翻译不进入 LLM 上下文，仅用于前端显示。
 * 会话切换或归档时清除对应 session 的缓存。
 */

import { create } from 'zustand';

interface TranslationEntry {
  zh: string;
  status: 'done' | 'error';
}

interface TranslationState {
  /** sessionPath → (messageId → TranslationEntry) */
  cache: Record<string, Record<string, TranslationEntry>>;
  /** 正在翻译的 key（防止重复请求） */
  pending: Set<string>;

  getTranslation: (sessionPath: string, messageId: string) => TranslationEntry | undefined;
  setTranslation: (sessionPath: string, messageId: string, zh: string) => void;
  setError: (sessionPath: string, messageId: string) => void;
  isPending: (sessionPath: string, messageId: string) => boolean;
  markPending: (sessionPath: string, messageId: string) => void;
  unmarkPending: (sessionPath: string, messageId: string) => void;
  clearSession: (sessionPath: string) => void;
  clearAll: () => void;
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  cache: {},
  pending: new Set(),

  getTranslation: (sessionPath, messageId) => {
    return get().cache[sessionPath]?.[messageId];
  },

  setTranslation: (sessionPath, messageId, zh) => {
    set((state) => ({
      cache: {
        ...state.cache,
        [sessionPath]: {
          ...(state.cache[sessionPath] || {}),
          [messageId]: { zh, status: 'done' },
        },
      },
    }));
  },

  setError: (sessionPath, messageId) => {
    set((state) => ({
      cache: {
        ...state.cache,
        [sessionPath]: {
          ...(state.cache[sessionPath] || {}),
          [messageId]: { zh: '', status: 'error' },
        },
      },
    }));
  },

  isPending: (sessionPath, messageId) => {
    return get().pending.has(`${sessionPath}:${messageId}`);
  },

  markPending: (sessionPath, messageId) => {
    set((state) => {
      const next = new Set(state.pending);
      next.add(`${sessionPath}:${messageId}`);
      return { pending: next };
    });
  },

  unmarkPending: (sessionPath, messageId) => {
    set((state) => {
      const next = new Set(state.pending);
      next.delete(`${sessionPath}:${messageId}`);
      return { pending: next };
    });
  },

  clearSession: (sessionPath) => {
    set((state) => {
      const next = { ...state.cache };
      delete next[sessionPath];
      return { cache: next };
    });
  },

  clearAll: () => {
    set({ cache: {} });
  },
}));
