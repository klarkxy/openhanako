// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from '../../components/chat/AssistantMessage';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

vi.mock('../../utils/screenshot', () => ({
  takeScreenshot: vi.fn(),
}));

function renderSuggestion(status = 'approved') {
  return render(
    <AssistantMessage
      showAvatar={false}
      sessionPath="/sessions/main.jsonl"
      message={{
        id: 'assistant-automation-1',
        role: 'assistant',
        timestamp: Date.now(),
        blocks: [{
          type: 'suggestion_card',
          kind: 'automation_draft',
          confirmId: 'confirm_1',
          status,
          title: '奶茶提醒',
          description: '提醒我喝奶茶',
          target: { type: 'agent', id: 'hanako' },
          detail: {
            kind: 'automation_draft',
            jobData: {
              type: 'cron',
              schedule: '0 12 * * *',
              label: '奶茶提醒',
              prompt: '提醒我喝奶茶',
              actorAgentId: 'hanako',
            },
          },
        }],
      } as any}
    />,
  );
}

describe('AssistantMessage automation suggestion card', () => {
  beforeEach(() => {
    window.t = ((key: string, params?: Record<string, string>) => {
      if (key === 'automation.promptPlaceholder') return `写下你想让 ${params?.agent || 'Agent'} 做什么`;
      return key;
    }) as typeof window.t;
    useStore.setState({
      agents: [{ id: 'hanako', name: 'Hanako', yuan: 'hanako', homeFolder: '/home/hanako' }],
      agentName: 'Hanako',
      agentYuan: 'hanako',
      currentAgentId: 'hanako',
      streamingSessions: [],
      selectedMessageIdsBySession: {},
    } as never);
    vi.mocked(hanaFetch).mockReset();
    vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps an approved suggestion card clickable without showing a completed status', () => {
    renderSuggestion('approved');

    expect(screen.queryByText('common.approved')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'automation.openDraft' }));

    expect(screen.getByRole('dialog', { name: 'automation.draftTitle' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('奶茶提醒')).toBeInTheDocument();
  });

  it('uses the pending confirmation once, then creates directly on later clicks', async () => {
    renderSuggestion('pending');

    fireEvent.click(screen.getByRole('button', { name: 'automation.openDraft' }));
    fireEvent.click(screen.getByRole('button', { name: 'automation.confirmCreate' }));

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/confirm/confirm_1', expect.objectContaining({
        method: 'POST',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'automation.openDraft' }));
    fireEvent.click(screen.getByRole('button', { name: 'automation.confirmCreate' }));

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/desk/cron', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  it('submits the selected Agent identity from the draft card', async () => {
    useStore.setState({
      agents: [
        { id: 'hanako', name: 'Hanako', yuan: 'hanako', homeFolder: '/home/hanako' },
        { id: 'maomao', name: '毛毛', yuan: 'maomao', homeFolder: '/home/maomao' },
      ],
      currentAgentId: 'hanako',
    } as never);

    renderSuggestion('pending');

    fireEvent.click(screen.getByRole('button', { name: 'automation.openDraft' }));
    fireEvent.click(screen.getByRole('button', { name: 'automation.field.agent' }));
    fireEvent.click(screen.getByRole('option', { name: /毛毛/ }));
    fireEvent.click(screen.getByRole('button', { name: 'automation.confirmCreate' }));

    await waitFor(() => {
      const confirmCall = vi.mocked(hanaFetch).mock.calls.find(([url]) => url === '/api/confirm/confirm_1');
      expect(confirmCall).toBeTruthy();
      const body = JSON.parse((confirmCall?.[1] as RequestInit).body as string);
      expect(body.value.jobData.actorAgentId).toBe('maomao');
      expect(body.value.jobData.executor.agentId).toBe('maomao');
      expect(body.value.jobData.executionContext.cwd).toBe('/home/maomao');
    });
  });
});
