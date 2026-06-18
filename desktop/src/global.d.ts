/**
 * Hana Desktop — 全局类型声明
 *
 * 集中声明 window 上的全局属性，避免散落的 `(window as any)` 和重复的 declare global。
 */

import type { DesktopNotificationOptions, PlatformApi } from './react/types';

declare global {
  interface Window {
    // ── i18n ──
    t: (path: string, vars?: Record<string, string | number>) => string;

    // ── Platform bridge（preload 注入） ──
    platform: PlatformApi;
    hana: PlatformApi;

    // ── 日志上报 ──
    __hanaLog: (level: string, module: string, message: string) => void;

    // ── Dev-only browser preview bootstrap（scripts/dev-web.js 注入） ──
    __HANA_DEV_WEB__?: {
      serverPort?: string | number;
      apiBaseUrl?: string;
    };

    // ── 主题（由 lib/theme.js ESM 入口导入 shared/theme.ts 注入） ──
    setTheme: (name: string) => void;
    // applyTheme 为 optional：ws-message-handler 运行在所有窗口中，包括不加载
    // lib/theme.js 的 viewer-window 等，这些窗口里该方法确实不存在。
    // callsite 使用 window.applyTheme?.() 是正确的防御性调用，类型须与之一致。
    applyTheme?: (name: string) => void;
    loadSavedTheme: () => void;
    setSerifFont: (enabled: boolean) => void;
    loadSavedFont: () => void;
    /**
     * 应用用户自定义字体：传入空字符串清除并回退到主题默认。
     * 阅读体（serif）与界面体（sans）独立；任一为空字符串表示该项回退。
     */
    setCustomFont: (input: { serifFamily?: string | null; uiFamily?: string | null }) => void;
    loadSavedCustomFont: () => void;
    setPaperTexture: (enabled: boolean) => void;
    loadSavedPaperTexture: () => void;

    // ── Notification bridge ──
    showNotification?: (title: string, body: string, agentId?: string | null, options?: DesktopNotificationOptions) => void;

    // ── i18n loader ──
    i18n: {
      locale: string;
      defaultName: string;
      _data: Record<string, unknown>;
      _agentOverrides: Record<string, unknown>;
      load(locale: string): Promise<void>;
      setAgentOverrides(overrides: Record<string, unknown> | null): void;
      t(path: string, vars?: Record<string, string | number>): string;
    };
  }

  // theme helpers（window.* 属性，IIFE bundle 注入后可通过全局名调用）
  // 保留 declare function 以兼容 bootstrap.ts 的 typeof loadSavedTheme === 'function' 检查
  // 覆盖 bootstrap.ts 里所有 6 个有裸调用点的函数（applyTheme 无裸调用点，不在此列）
  function loadSavedTheme(): void;
  function loadSavedFont(): void;
  function loadSavedCustomFont(): void;
  function loadSavedPaperTexture(): void;
  function setTheme(theme: string): void;
  function setSerifFont(enabled: boolean): void;
  function setCustomFont(input: { serifFamily?: string | null; uiFamily?: string | null }): void;
  function setPaperTexture(enabled: boolean): void;
}

export {};
