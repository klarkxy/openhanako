// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionQuoteActionSurface } from '../../components/selection/SelectionQuoteActionSurface';
import { useStore } from '../../stores';

describe('SelectionQuoteActionSurface', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().clearQuoteCandidate();
    useStore.getState().clearQuotedSelections();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('adds the current selection candidate as an independent quote chip source', () => {
    useStore.getState().setQuoteCandidate({
      text: '第一段引用',
      sourceTitle: 'Assistant message',
      sourceKind: 'chat',
      sourceSessionPath: '/session/a.jsonl',
      sourceMessageId: 'assistant-1',
      sourceRole: 'assistant',
      charCount: 5,
      anchorRect: { left: 100, right: 180, top: 120, bottom: 140, width: 80, height: 20 },
    });
    render(<SelectionQuoteActionSurface />);

    fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));

    expect(useStore.getState().quotedSelections).toHaveLength(1);
    expect(useStore.getState().quotedSelections[0]).toMatchObject({ text: '第一段引用' });
    expect(useStore.getState().quoteCandidate).toBeNull();
  });

  it('delays the tooltip for 500ms', () => {
    useStore.getState().setQuoteCandidate({
      text: '第一段引用',
      sourceTitle: 'Assistant message',
      sourceKind: 'chat',
      charCount: 5,
      anchorRect: { left: 100, right: 180, top: 120, bottom: 140, width: 80, height: 20 },
    });
    render(<SelectionQuoteActionSurface />);

    const button = screen.getByRole('button', { name: '引用到对话' });
    fireEvent.mouseEnter(button);
    act(() => { vi.advanceTimersByTime(499); });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('tooltip').textContent).toBe('引用到对话');
  });
});
