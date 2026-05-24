/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  hanaUrl: (path: string) => `http://127.0.0.1:14500${path}?token=local`,
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

const baseSummary = {
  network: {
    mode: 'loopback',
    listenHost: '127.0.0.1',
    configuredPort: 14500,
    actualPort: 14500,
    runtimeMode: 'loopback',
    runtimeHost: '127.0.0.1',
    restartRequired: false,
    lanAddresses: ['192.168.31.75'],
    localServerUrl: 'http://127.0.0.1:14500/',
    candidateLanServerUrl: 'http://192.168.31.75:14500/',
    lanServerUrl: null,
    localMobileUrl: 'http://127.0.0.1:14500/mobile/',
    candidateLanMobileUrl: 'http://192.168.31.75:14500/mobile/',
    lanMobileUrl: null,
  },
  account: {
    userId: 'user_owner',
    username: 'Owner',
    displayName: 'Owner',
    passwordSet: false,
  },
  devices: [],
  credentials: [],
};

const pairedSummary = {
  ...baseSummary,
  devices: [{
    deviceId: 'device_1',
    displayName: 'User Phone',
    deviceKind: 'mobile',
    status: 'active',
    trustState: 'lan',
    lastSeenAt: '2026-05-16T03:00:00.000Z',
  }],
  credentials: [{
    credentialId: 'cred_1',
    deviceId: 'device_1',
    status: 'active',
    scopes: ['chat', 'resources.read', 'files.read', 'files.write'],
    secretPrefix: 'hana_dev_abc',
    createdAt: '2026-05-16T02:00:00.000Z',
    lastUsedAt: '2026-05-16T03:00:00.000Z',
  }],
};

describe('AccessTab', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(key => delete mockState[key]);
    Object.assign(mockState, {
      set: vi.fn((partial: Partial<MockState>) => Object.assign(mockState, partial)),
      showToast: vi.fn(),
    });
    mockHanaFetch.mockReset();
    mockHanaFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/access/summary') return Promise.resolve(jsonResponse(baseSummary));
      if (url === '/api/access/network' && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse({
          ok: true,
          network: {
            ...baseSummary.network,
            mode: 'lan',
            listenHost: '0.0.0.0',
            configuredPort: 14500,
            lanServerUrl: 'http://192.168.31.75:14500/',
            candidateLanServerUrl: 'http://192.168.31.75:14500/',
            lanMobileUrl: 'http://192.168.31.75:14500/mobile/',
            candidateLanMobileUrl: 'http://192.168.31.75:14500/mobile/',
            restartRequired: false,
          },
        }));
      }
      if (url === '/api/access/mobile-credentials' && options?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          ok: true,
          secret: 'hana_dev_visible_once',
          accessUrl: 'http://192.168.31.75:14500/mobile/',
          device: { deviceId: 'device_1', displayName: 'iPhone', status: 'active' },
          credential: { credentialId: 'cred_1', scopes: ['chat', 'files.read', 'files.write'], status: 'active' },
        }));
      }
      if (url === '/api/access/desktop-credentials' && options?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          ok: true,
          secret: 'hana_dev_desktop_visible_once',
          accessUrl: 'http://192.168.31.75:14500/',
          device: { deviceId: 'device_desktop', displayName: 'Studio Laptop', deviceKind: 'desktop', status: 'active' },
          credential: { credentialId: 'cred_desktop', scopes: ['chat', 'files.read', 'files.write'], status: 'active' },
        }));
      }
      if (url === '/api/access/account/profile' && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse({
          ok: true,
          account: { ...baseSummary.account, username: 'hana-owner', displayName: 'Hana Owner' },
        }));
      }
      if (url === '/api/access/account/password' && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse({
          ok: true,
          account: { ...baseSummary.account, passwordSet: true },
        }));
      }
      if (url === '/api/access/account/password' && options?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({
          ok: true,
          account: { ...baseSummary.account, passwordSet: false },
        }));
      }
      if (url === '/api/devices/credentials/cred_1/revoke' && options?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => {}) },
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'http://192.168.31.75:14500/api/web-auth/login') {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      if (url === 'http://192.168.31.75:14500/api/server/identity') {
        return {
          ok: true,
          json: async () => ({
            connectionKind: 'lan',
            serverId: 'server_lan',
            serverNodeId: 'node_lan',
            userId: 'user_lan',
            studioId: 'studio_lan',
            label: 'LAN Server',
            trustState: 'lan',
            authState: 'paired',
            credentialKind: 'device_credential',
            capabilities: ['chat', 'resources', 'files'],
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch URL: ${url}`);
    }));
    Object.assign(window, {
      hana: { reloadMainWindow: vi.fn(async () => {}) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the stable mobile URL and saves LAN network settings', async () => {
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    // 多设备访问已禁用：仅显示禁用状态
    expect(await screen.findByText(/已禁用/)).toBeInTheDocument();
    // 禁用状态下不显示 LAN 开关和 URL
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/192\.168/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.access.saveNetwork' })).not.toBeInTheDocument();
  });

  it('keeps the phone URL on the runtime port and hides QR when a saved port change needs restart', async () => {
    mockHanaFetch.mockImplementation((url: string) => {
      if (url === '/api/access/summary') {
        return Promise.resolve(jsonResponse({
          ...baseSummary,
          network: {
            ...baseSummary.network,
            mode: 'lan',
            listenHost: '0.0.0.0',
            configuredPort: 14550,
            actualPort: 14500,
            runtimeMode: 'lan',
            runtimeHost: '0.0.0.0',
            restartRequired: true,
            lanServerUrl: 'http://192.168.31.75:14500/',
            candidateLanServerUrl: 'http://192.168.31.75:14550/',
            lanMobileUrl: 'http://192.168.31.75:14500/mobile/',
            candidateLanMobileUrl: 'http://192.168.31.75:14550/mobile/',
          },
        }));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    // 多设备访问已禁用：仅显示禁用状态
    expect(await screen.findByText(/已禁用/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/192\.168/)).not.toBeInTheDocument();
    expect(screen.queryByText('settings.access.restartRequired')).not.toBeInTheDocument();
  });

  it('generates a mobile access key and keeps the returned secret visible once', async () => {
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    // 多设备访问已禁用：生成密钥按钮不可见
    expect(await screen.findByText(/已禁用/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.access.generateMobileKey' })).not.toBeInTheDocument();
  });

  it('generates a desktop access key from the manual computer section', async () => {
    // 多设备访问已禁用：生成桌面密钥功能不可用
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    expect(await screen.findByText(/已禁用/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.access.generateDesktopKey' })).not.toBeInTheDocument();
  });

  it('connects to an existing LAN server from the client connection section', async () => {
    // 多设备访问已禁用：LAN 连接表单不显示
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    expect(await screen.findByText(/已禁用/)).toBeInTheDocument();
    expect(screen.queryByLabelText('settings.access.remoteServerUrl')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('settings.access.remoteServerKey')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.access.connectLanServer' })).not.toBeInTheDocument();
  });

  it('saves the local owner profile and password from the account section', async () => {
    // 多设备访问已禁用：账号表单不显示
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    expect(await screen.findByText(/已禁用/)).toBeInTheDocument();
    expect(screen.queryByLabelText('settings.access.username')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('settings.access.displayName')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.access.saveAccount' })).not.toBeInTheDocument();
  });

  it('revokes individual credentials without requiring whole-device revocation', async () => {
    // 多设备访问已禁用：凭据管理不显示
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    expect(await screen.findByText(/已禁用/)).toBeInTheDocument();
    expect(screen.queryByText('User Phone')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.access.revokeCredential' })).not.toBeInTheDocument();
  });

  it('clears the local password from the password section', async () => {
    // 多设备访问已禁用：密码管理不显示
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    expect(await screen.findByText(/已禁用/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.access.clearPassword' })).not.toBeInTheDocument();
  });
});
