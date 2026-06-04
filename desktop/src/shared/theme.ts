/**
 * theme.ts — 共享主题系统（ESM 入口）
 *
 * 被 desktop/src/lib/theme.js 以 `import "../shared/theme.ts"` 形式
 * 重新导出，HTML 入口 <script type="module" src="lib/theme.js"> 由
 * Vite 一次性 bundle 进主模块图（取代旧的 IIFE bundle + build:theme 步骤）。
 *
 * 所有主题元信息来自 theme-registry ESM adapter，这里不再镜像任何常量表。
 */
import registry, { type ThemeId } from './theme-registry';
import {
  loadPaperTexturePreference,
  setPaperTexturePreference,
} from './appearance-preferences';

const themeSheet = document.getElementById('themeSheet') as HTMLLinkElement | null;

export const CUSTOM_FONT_STORAGE_KEY = 'hana-custom-font' as const;

interface CustomFontStorage {
  /** 阅读体（衬线）家族。null → 不覆盖。 */
  serifFamily: string | null;
  /** 界面体（无衬线）家族。null → 不覆盖。 */
  uiFamily: string | null;
}

/** 渲染入口：把 `family` 安全塞进 CSS 变量。
 *  允许字符：字母、数字、空格、逗号、引号、`-` `_` `/` `&` `:` `()` 等；
 *  其余字符（含 `;` `{}` `<>` `\\` `\n`）一律替换为空。
 *  这个守门员与 core/preferences-manager.js 的 sanitizeFontFamily 行为一致，
 *  即便绕过 IPC 写入 localStorage，渲染端也兜底一次。 */
function safeFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F;{}<>\\]/g, '')
    .trim();
  if (!cleaned || cleaned.length > 200) return null;
  return cleaned;
}

function setFontUserVar(name: '--font-user-serif' | '--font-user-ui', value: string | null) {
  const root = document.documentElement;
  if (!value) {
    root.style.removeProperty(name);
  } else {
    // 整体置入 CSS 字符串，不直接拼接选择器；浏览器仍按 identifier 处理。
    root.style.setProperty(name, value);
  }
}

function systemIsDark(): boolean {
  return safeMatchMedia('(prefers-color-scheme: dark)').matches;
}

/** `matchMedia` 在 jsdom 等极简测试环境下可能不存在；这里统一兜底成"未匹配"。
 *  生产环境不会触发。 */
function safeMatchMedia(query: string): MediaQueryList {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }
  return window.matchMedia(query);
}

function applyConcreteTheme(concrete: string): void {
  const entry = registry.THEMES[concrete as ThemeId];
  if (!entry) return;
  document.documentElement.setAttribute('data-theme', concrete);
  if (themeSheet) themeSheet.href = entry.cssPath;
  loadPaperTexturePreference();
  (window as unknown as { hana?: { syncWindowTheme?: (theme: string) => void } }).hana?.syncWindowTheme?.(concrete);
}

let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

function setTheme(name: string): void {
  const mql = safeMatchMedia('(prefers-color-scheme: dark)');
  if (systemThemeListener) {
    mql.removeEventListener('change', systemThemeListener);
    systemThemeListener = null;
  }

  const { stored, concrete } = registry.resolveSavedTheme(name, systemIsDark());
  applyConcreteTheme(concrete);

  if (stored === 'auto') {
    systemThemeListener = () => {
      applyConcreteTheme(registry.resolveSavedTheme('auto', systemIsDark()).concrete);
    };
    mql.addEventListener('change', systemThemeListener);
  }

  localStorage.setItem(registry.STORAGE_KEY, stored);
}

function loadSavedTheme(): void {
  const raw = localStorage.getItem(registry.STORAGE_KEY);
  setTheme(registry.migrateSavedTheme(raw));
}

/* ── 衬线体 / 无衬线体切换 ── */
function setSerifFont(enabled: boolean): void {
  document.body.classList.toggle('font-sans', !enabled);
  localStorage.setItem('hana-font-serif', enabled ? '1' : '0');
}

function loadSavedFont(): void {
  const saved = localStorage.getItem('hana-font-serif');
  // 默认开启衬线体（saved === null → 首次使用）
  const enabled = saved !== '0';
  document.body.classList.toggle('font-sans', !enabled);
}

/* ── 用户自定义字体 ── */

/** 应用用户自定义字体到 :root CSS 变量。空串清除。
 *  注意：函数语义上"空串/null → 该通道回退到主题默认"，因此调用方传 "" 与不传该键同义。 */
function setCustomFont(input: { serifFamily?: string | null; uiFamily?: string | null } = {}): void {
  const next: CustomFontStorage = {
    serifFamily: safeFamily(input.serifFamily),
    uiFamily: safeFamily(input.uiFamily),
  };
  setFontUserVar('--font-user-serif', next.serifFamily);
  setFontUserVar('--font-user-ui', next.uiFamily);

  // 至少有一项非空才落盘，避免在「只是切到「默认」」时残留一个全空对象
  const hasAny = !!(next.serifFamily || next.uiFamily);
  if (hasAny) {
    localStorage.setItem(CUSTOM_FONT_STORAGE_KEY, JSON.stringify(next));
  } else {
    localStorage.removeItem(CUSTOM_FONT_STORAGE_KEY);
  }
}

function loadSavedCustomFont(): void {
  let parsed: CustomFontStorage | null = null;
  try {
    const raw = localStorage.getItem(CUSTOM_FONT_STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') parsed = obj as CustomFontStorage;
  } catch {
    localStorage.removeItem(CUSTOM_FONT_STORAGE_KEY);
    return;
  }
  if (!parsed) return;
  setFontUserVar('--font-user-serif', safeFamily(parsed.serifFamily));
  setFontUserVar('--font-user-ui', safeFamily(parsed.uiFamily));
}

/* ── 纸质纹理开关 ── */
function setPaperTexture(enabled: boolean): void {
  setPaperTexturePreference(enabled);
}

function loadSavedPaperTexture(): void {
  loadPaperTexturePreference();
}

// 暴露给 WS 事件处理器（设置工具远程切换主题用）
window.setTheme = setTheme;
window.applyTheme = setTheme;
window.loadSavedTheme = loadSavedTheme;
window.setSerifFont = setSerifFont;
window.loadSavedFont = loadSavedFont;
window.setCustomFont = setCustomFont;
window.loadSavedCustomFont = loadSavedCustomFont;
window.setPaperTexture = setPaperTexture;
window.loadSavedPaperTexture = loadSavedPaperTexture;

// 首屏自动加载
loadSavedTheme();
loadSavedFont();
loadSavedCustomFont();
loadSavedPaperTexture();
