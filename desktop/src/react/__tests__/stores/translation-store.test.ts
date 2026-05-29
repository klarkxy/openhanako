/**
 * translation-store 行为测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTranslationStore } from '../../stores/translation-store';

const SESSION_A = '/test/session-a.jsonl';
const SESSION_B = '/test/session-b.jsonl';
const MSG_1 = 'msg-1';
const MSG_2 = 'msg-2';

describe('useTranslationStore', () => {
  beforeEach(() => {
    useTranslationStore.setState({ cache: {}, pending: new Set() });
  });

  it('初始状态返回 undefined', () => {
    expect(useTranslationStore.getState().getTranslation(SESSION_A, MSG_1)).toBeUndefined();
  });

  it('setTranslation 后 getTranslation 返回结果', () => {
    useTranslationStore.getState().setTranslation(SESSION_A, MSG_1, '你好世界');
    const entry = useTranslationStore.getState().getTranslation(SESSION_A, MSG_1);
    expect(entry).toEqual({ zh: '你好世界', status: 'done' });
  });

  it('setError 后 getTranslation 返回 error 状态', () => {
    useTranslationStore.getState().setError(SESSION_A, MSG_1);
    const entry = useTranslationStore.getState().getTranslation(SESSION_A, MSG_1);
    expect(entry).toEqual({ zh: '', status: 'error' });
  });

  it('pending 标记和查询', () => {
    expect(useTranslationStore.getState().isPending(SESSION_A, MSG_1)).toBe(false);

    useTranslationStore.getState().markPending(SESSION_A, MSG_1);
    expect(useTranslationStore.getState().isPending(SESSION_A, MSG_1)).toBe(true);

    useTranslationStore.getState().unmarkPending(SESSION_A, MSG_1);
    expect(useTranslationStore.getState().isPending(SESSION_A, MSG_1)).toBe(false);
  });

  it('不同 session 和 messageId 互不干扰', () => {
    useTranslationStore.getState().setTranslation(SESSION_A, MSG_1, 'A1');
    useTranslationStore.getState().setTranslation(SESSION_A, MSG_2, 'A2');
    useTranslationStore.getState().setTranslation(SESSION_B, MSG_1, 'B1');

    expect(useTranslationStore.getState().getTranslation(SESSION_A, MSG_1)?.zh).toBe('A1');
    expect(useTranslationStore.getState().getTranslation(SESSION_A, MSG_2)?.zh).toBe('A2');
    expect(useTranslationStore.getState().getTranslation(SESSION_B, MSG_1)?.zh).toBe('B1');
  });

  it('clearSession 只清除指定 session 的缓存', () => {
    useTranslationStore.getState().setTranslation(SESSION_A, MSG_1, 'A1');
    useTranslationStore.getState().setTranslation(SESSION_B, MSG_1, 'B1');

    useTranslationStore.getState().clearSession(SESSION_A);

    expect(useTranslationStore.getState().getTranslation(SESSION_A, MSG_1)).toBeUndefined();
    expect(useTranslationStore.getState().getTranslation(SESSION_B, MSG_1)?.zh).toBe('B1');
  });

  it('clearAll 清除所有缓存', () => {
    useTranslationStore.getState().setTranslation(SESSION_A, MSG_1, 'A1');
    useTranslationStore.getState().setTranslation(SESSION_B, MSG_1, 'B1');

    useTranslationStore.getState().clearAll();

    expect(useTranslationStore.getState().getTranslation(SESSION_A, MSG_1)).toBeUndefined();
    expect(useTranslationStore.getState().getTranslation(SESSION_B, MSG_1)).toBeUndefined();
  });

  it('重复 setTranslation 覆盖旧值', () => {
    useTranslationStore.getState().setTranslation(SESSION_A, MSG_1, '第一版');
    useTranslationStore.getState().setTranslation(SESSION_A, MSG_1, '第二版');

    expect(useTranslationStore.getState().getTranslation(SESSION_A, MSG_1)?.zh).toBe('第二版');
  });

  it('markPending 不影响不同 key 的 pending 状态', () => {
    useTranslationStore.getState().markPending(SESSION_A, MSG_1);

    expect(useTranslationStore.getState().isPending(SESSION_A, MSG_1)).toBe(true);
    expect(useTranslationStore.getState().isPending(SESSION_A, MSG_2)).toBe(false);
    expect(useTranslationStore.getState().isPending(SESSION_B, MSG_1)).toBe(false);
  });
});
