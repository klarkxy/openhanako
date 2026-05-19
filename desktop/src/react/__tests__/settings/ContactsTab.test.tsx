/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockState extends Record<string, unknown> {
  agents?: { id: string; name: string; yuan: string }[];
  currentAgentId?: string | null;
  showToast?: (message: string, type: 'success' | 'error') => void;
}

const mockState: MockState = {};
const mockHanaFetch = vi.fn();

vi.mock('../../settings/store', () => {
  const hook: any = (selector?: (s: MockState) => unknown) => selector ? selector(mockState) : mockState;
  hook.getState = () => mockState;
  return { useSettingsStore: hook };
});

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

function resetState() {
  Object.keys(mockState).forEach(key => delete mockState[key]);
  Object.assign(mockState, {
    agents: [{ id: 'hana', name: 'Hana', yuan: 'hanako' }],
    currentAgentId: 'hana',
    showToast: vi.fn(),
  });
}

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

function createContactStore() {
  const contacts: any[] = [];
  const settings = {
    audiencePrompts: {
      family: '',
      friend: '',
      stranger: '',
    },
  };
  const status = {
    knownUsers: {
      telegram: [{ userId: 'alice-id', name: 'Alice' }],
      feishu: [{ userId: 'lark-id', name: 'Lark' }],
    },
    owner: {
      telegram: 'owner-id',
    },
  };

  mockHanaFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/bridge/contacts/settings')) {
      if (!init?.method || init.method === 'GET') {
        return jsonResponse({ settings });
      }
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}'));
        Object.assign(settings.audiencePrompts, body.audiencePrompts || {});
        return jsonResponse({ ok: true, settings });
      }
    }

    if (url.startsWith('/api/bridge/contacts')) {
      if (!init?.method || init.method === 'GET') {
        return jsonResponse({ contacts, settings });
      }
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}'));
        contacts.splice(0, contacts.length, {
          id: `c${contacts.length + 1}`,
          ...body,
          policy: {
            hostPermissionMode: 'social_greeting_only',
            infoDisclosure: 'greeting_only',
            toneProfile: body.relation || 'stranger',
          },
        });
        return jsonResponse({ ok: true, contact: contacts[0] });
      }
    }

    if (url.startsWith('/api/bridge/status')) {
      return jsonResponse(status);
    }

    throw new Error(`unexpected request: ${url}`);
  });

  return { contacts, settings, status };
}

describe('ContactsTab', () => {
  beforeEach(() => {
    resetState();
    mockHanaFetch.mockReset();
    window.i18n = { locale: 'zh-CN' } as typeof window.i18n;
  });

  afterEach(() => {
    cleanup();
  });

  it('loads the shared contacts and hides self from the relation selector', async () => {
    const store = createContactStore();
    store.contacts.push({
      id: 'c1',
      displayName: 'Alice',
      relation: 'friend',
      accounts: [{ platform: 'telegram', userId: 'alice-id' }],
      policy: { hostPermissionMode: 'social_readonly', infoDisclosure: 'limited_work_summary', toneProfile: 'friend' },
    });

    const { ContactsTab } = await import('../../settings/tabs/ContactsTab');
    render(<ContactsTab />);

    expect(await screen.findByText((_, element) => element?.tagName.toLowerCase() === 'strong' && element?.textContent === 'Alice')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '自己' })).not.toBeInTheDocument();
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/bridge/contacts?agentId=hana');
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/bridge/contacts/settings?agentId=hana');
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/bridge/status?agentId=hana');
  });

  it('prefills a known user into the form and saves a contact', async () => {
    const store = createContactStore();

    const { ContactsTab } = await import('../../settings/tabs/ContactsTab');
    render(<ContactsTab />);

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/bridge/status?agentId=hana');
    });

    fireEvent.click(screen.getByRole('button', { name: '候选接入' }));
    fireEvent.click(screen.getByRole('button', { name: /Alice/ }));

    expect(screen.getByLabelText('联系人名称')).toHaveValue('Alice');
    expect(screen.getByLabelText('账号映射')).toHaveValue('telegram, alice-id, , Alice');

    fireEvent.click(screen.getByRole('button', { name: '创建联系人' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/bridge/contacts?agentId=hana', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText((_, element) => element?.tagName.toLowerCase() === 'strong' && element?.textContent === 'Alice')).toBeInTheDocument();
    expect(store.contacts).toHaveLength(1);
  });

  it('saves relation-specific outward awareness prompts', async () => {
    createContactStore();

    const { ContactsTab } = await import('../../settings/tabs/ContactsTab');
    render(<ContactsTab />);

    fireEvent.click(screen.getByRole('button', { name: '对外意识' }));
    fireEvent.change(screen.getByLabelText('家人'), { target: { value: '更亲近一些' } });
    fireEvent.change(screen.getByLabelText('朋友'), { target: { value: '只给概括' } });
    fireEvent.change(screen.getByLabelText('陌生人'), { target: { value: '简短礼貌' } });
    fireEvent.click(screen.getByRole('button', { name: '保存对外意识' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/bridge/contacts/settings?agentId=hana', expect.objectContaining({ method: 'PUT' }));
    });

    const calls = mockHanaFetch.mock.calls.filter(call => String(call[0]).startsWith('/api/bridge/contacts/settings'));
    const saveCall = calls.find(call => call[1]?.method === 'PUT');
    expect(saveCall).toBeTruthy();
    const savedBody = JSON.parse(String(saveCall?.[1]?.body || '{}'));
    expect(savedBody.audiencePrompts.family).toBe('更亲近一些');
    expect(savedBody.audiencePrompts.friend).toBe('只给概括');
    expect(savedBody.audiencePrompts.stranger).toBe('简短礼貌');
  });
});