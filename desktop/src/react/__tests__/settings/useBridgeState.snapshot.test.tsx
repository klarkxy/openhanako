/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBridgeState } from '../../settings/tabs/bridge/useBridgeState';

type MockState = Record<string, any>;

const mockState: MockState = {};
const mockHanaFetch = vi.fn();

vi.mock('../../settings/store', () => {
  const hook: any = (selector?: (s: MockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  hook.getState = () => mockState;
  hook.setState = (partial: Partial<MockState>) => Object.assign(mockState, partial);
  return { useSettingsStore: hook };
});

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

vi.mock('../../settings/actions', () => ({
  loadSettingsConfig: vi.fn(async () => {}),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
}));

function BridgeProbe() {
  const { status, tgToken, publicIshiki } = useBridgeState();
  return (
    <div>
      <span data-testid="telegram-enabled">{String(status?.telegram?.enabled)}</span>
      <span data-testid="permission-mode">{status?.permissionMode || 'none'}</span>
      <span data-testid="telegram-token">{tgToken}</span>
      <span data-testid="public-ishiki">{publicIshiki}</span>
    </div>
  );
}

describe('useBridgeState snapshot hydration', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(key => delete mockState[key]);
    Object.assign(mockState, {
      currentAgentId: 'hana',
      showToast: vi.fn(),
      settingsSnapshot: {
        key: 'local:snapshot:hana',
        status: 'ready',
        data: {
          agentId: 'hana',
          publicIshiki: 'snapshot-public-ishiki',
          bridgeStatus: {
            agentId: 'hana',
            telegram: {
              enabled: true,
              configured: true,
              status: 'connected',
              token: 'masked-token',
              agentId: 'hana',
            },
            feishu: { enabled: false, status: 'disconnected', agentId: 'hana' },
            whatsapp: { enabled: false, status: 'disconnected', agentId: 'hana' },
            qq: { enabled: false, status: 'disconnected', agentId: 'hana' },
            wechat: { enabled: false, status: 'disconnected', token: '', agentId: 'hana' },
            permissionMode: 'operate',
            readOnly: false,
            receiptEnabled: true,
            knownUsers: {},
            owner: {},
          },
        },
        error: null,
        requestId: 1,
        updatedAt: Date.now(),
      },
    });
    mockHanaFetch.mockReset();
    mockHanaFetch.mockImplementation((url: string) => {
      if (url === '/api/bridge/status?agentId=hana') {
        return new Promise<Response>(() => {});
      }
      throw new Error(`unexpected request: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses snapshot bridge status before the status refresh request settles', () => {
    render(<BridgeProbe />);

    expect(screen.getByTestId('telegram-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('permission-mode')).toHaveTextContent('operate');
    expect(screen.getByTestId('telegram-token')).toHaveTextContent('masked-token');
    expect(screen.getByTestId('public-ishiki')).toHaveTextContent('snapshot-public-ishiki');
    expect(mockHanaFetch).toHaveBeenCalledWith(
      '/api/bridge/status?agentId=hana',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
