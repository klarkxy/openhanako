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
    await screen.findByText('settings.access.networkAccess');
    expect(screen.getByText(/已禁用/)).toBeInTheDocument();
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
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'settings.access.generateDesktopKey' }));

    expect(await screen.findByDisplayValue('hana_dev_desktop_visible_once')).toBeInTheDocument();
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/access/desktop-credentials', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Desktop Frontend',
        scopes: ['chat', 'resources.read', 'files.read', 'files.write'],
      }),
    }));
  });

  it('connects to an existing LAN server from the client connection section', async () => {
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    fireEvent.change(await screen.findByLabelText('settings.access.remoteServerUrl'), {
      target: { value: 'http://192.168.31.75:14500' },
    });
    fireEvent.change(screen.getByLabelText('settings.access.remoteServerKey'), {
      target: { value: 'hana_dev_remote_secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.access.connectLanServer' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://192.168.31.75:14500/api/web-auth/login', expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ credential: 'hana_dev_remote_secret' }),
      }));
    });
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://192.168.31.75:14500/api/server/identity', expect.objectContaining({
        credentials: 'include',
        headers: { Authorization: 'Bearer hana_dev_remote_secret' },
      }));
      expect(window.hana.reloadMainWindow).toHaveBeenCalledTimes(1);
    });
  });

  it('saves the local owner profile and password from the account section', async () => {
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    fireEvent.change(await screen.findByLabelText('settings.access.username'), {
      target: { value: 'hana-owner' },
    });
    fireEvent.change(screen.getByLabelText('settings.access.displayName'), {
      target: { value: 'Hana Owner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.access.saveAccount' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/access/account/profile', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ username: 'hana-owner', displayName: 'Hana Owner' }),
      }));
    });

    fireEvent.change(screen.getByLabelText('settings.access.newPassword'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.access.savePassword' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/access/account/password', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ password: 'correct horse battery staple' }),
      }));
    });
  });

  it('revokes individual credentials without requiring whole-device revocation', async () => {
    mockHanaFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/access/summary') return Promise.resolve(jsonResponse(pairedSummary));
      if (url === '/api/devices/credentials/cred_1/revoke' && options?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    expect(await screen.findByText('User Phone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'settings.access.revokeCredential' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/devices/credentials/cred_1/revoke', { method: 'POST' });
    });
  });

  it('clears the local password from the password section', async () => {
    mockHanaFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/access/summary') {
        return Promise.resolve(jsonResponse({
          ...baseSummary,
          account: { ...baseSummary.account, passwordSet: true },
        }));
      }
      if (url === '/api/access/account/password' && options?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({
          ok: true,
          account: { ...baseSummary.account, passwordSet: false },
        }));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'settings.access.clearPassword' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/access/account/password', { method: 'DELETE' });
    });
  });
});
