/**
 * @vitest-environment jsdom
 *
 * useThinkingTranslation hook 测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useThinkingTranslation } from '../../hooks/use-thinking-translation';
import { useTranslationStore } from '../../stores/translation-store';
import { useSettingsStore } from '../../settings/store';

const SESSION = '/test/session.jsonl';
const MSG_BASE = 'useThinkingTranslation-';

// 英文思考内容（> 20 字符，ASCII 字母占比 > 60%）
const ENGLISH_THINKING = 'I need to analyze the user request carefully and break it down into smaller steps for implementation.';
// 中文思考内容
const CHINESE_THINKING = '我需要仔细分析用户的请求，然后将其拆分为更小的实现步骤来进行处理。';

const mocks = vi.hoisted(() => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mocks.hanaFetch(...args),
}));

/** 每次测试使用唯一 messageId 避免缓存跨测试污染 */
let msgCounter = 0;
function uniqueMsgId(): string {
  return `${MSG_BASE}${++msgCounter}`;
}

describe('useThinkingTranslation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTranslationStore.setState({ cache: {}, pending: new Set() });
    useSettingsStore.setState({
      globalModelsConfig: {
        models: {
          translation: { id: 'gpt-4o-mini', provider: 'openai' },
          translation_enabled: true,
        },
        search: {},
      },
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('未 sealed 时不触发翻译', () => {
    mocks.hanaFetch.mockResolvedValue({ json: () => Promise.resolve({ translation: '你好' }) });
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: ENGLISH_THINKING, sealed: false,
    }));

    expect(mocks.hanaFetch).not.toHaveBeenCalled();
  });

  it('translation_enabled 为 false 时不触发翻译', () => {
    useSettingsStore.setState({
      globalModelsConfig: {
        models: { translation: { id: 'gpt-4o-mini', provider: 'openai' }, translation_enabled: false },
        search: {},
      },
    } as never);
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: ENGLISH_THINKING, sealed: true,
    }));

    expect(mocks.hanaFetch).not.toHaveBeenCalled();
  });

  it('未配置翻译模型时不触发翻译', () => {
    useSettingsStore.setState({
      globalModelsConfig: {
        models: { translation: null, translation_enabled: true },
        search: {},
      },
    } as never);
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: ENGLISH_THINKING, sealed: true,
    }));

    expect(mocks.hanaFetch).not.toHaveBeenCalled();
  });

  it('中文内容不触发翻译', () => {
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: CHINESE_THINKING, sealed: true,
    }));

    expect(mocks.hanaFetch).not.toHaveBeenCalled();
  });

  it('短文本不触发翻译（< 20 字符）', () => {
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: 'Short text', sealed: true,
    }));

    expect(mocks.hanaFetch).not.toHaveBeenCalled();
  });

  it('sealed + 英文内容触发翻译 API 调用', async () => {
    mocks.hanaFetch.mockResolvedValue({
      json: () => Promise.resolve({ translation: '翻译结果' }),
    });
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: ENGLISH_THINKING, sealed: true,
    }));

    await waitFor(() => {
      expect(mocks.hanaFetch).toHaveBeenCalledWith('/api/translate', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: ENGLISH_THINKING }),
      }));
    });
  });

  it('翻译成功后状态变为 done 并返回翻译结果', async () => {
    const translation = '翻译成功内容';
    mocks.hanaFetch.mockResolvedValue({
      json: () => Promise.resolve({ translation }),
    });
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: ENGLISH_THINKING, sealed: true,
    }));

    // 等待 store 更新（API 调用完成 + 写入缓存）
    await waitFor(() => {
      const entry = useTranslationStore.getState().getTranslation(SESSION, mid);
      expect(entry?.status).toBe('done');
      expect(entry?.zh).toBe(translation);
    });
  });

  it('翻译失败后状态变为 error', async () => {
    mocks.hanaFetch.mockResolvedValue({
      json: () => Promise.resolve({ error: 'model not found' }),
    });
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: ENGLISH_THINKING, sealed: true,
    }));

    await waitFor(() => {
      const entry = useTranslationStore.getState().getTranslation(SESSION, mid);
      expect(entry?.status).toBe('error');
    });
  });

  it('已有缓存时不重复请求', () => {
    const mid = uniqueMsgId();
    useTranslationStore.getState().setTranslation(SESSION, mid, '已缓存翻译');

    const { result } = renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: ENGLISH_THINKING, sealed: true,
    }));

    expect(result.current.status).toBe('done');
    expect(result.current.translation).toBe('已缓存翻译');
    expect(mocks.hanaFetch).not.toHaveBeenCalled();
  });

  it('空内容不触发翻译', () => {
    const mid = uniqueMsgId();

    renderHook(() => useThinkingTranslation({
      sessionPath: SESSION, messageId: mid, content: '', sealed: true,
    }));

    expect(mocks.hanaFetch).not.toHaveBeenCalled();
  });
});
