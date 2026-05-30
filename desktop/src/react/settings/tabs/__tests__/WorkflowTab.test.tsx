/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WorkflowTab } from '../WorkflowTab';
import { hanaFetch } from '../../api';

vi.mock('../../api', () => ({ hanaFetch: vi.fn() }));
const hanaFetchMock = hanaFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  hanaFetchMock.mockReset();
});

describe('WorkflowTab', () => {
  it('加载时读取设置并渲染 toggle', async () => {
    hanaFetchMock.mockResolvedValueOnce({ json: async () => ({ ok: true, settings: { enabled: false } }) });
    render(<WorkflowTab />);
    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/workflow'));
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  });

  it('点击 toggle 发 PUT 打开', async () => {
    hanaFetchMock
      .mockResolvedValueOnce({ json: async () => ({ ok: true, settings: { enabled: false } }) })
      .mockResolvedValueOnce({ json: async () => ({ ok: true, settings: { enabled: true } }) });
    render(<WorkflowTab />);
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/workflow', expect.objectContaining({ method: 'PUT' })));
  });
});
