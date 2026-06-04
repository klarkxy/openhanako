import registry from '../../shared/theme-registry';
import { isPaperTextureEnabled } from '../../shared/appearance-preferences';
import { hanaFetch } from '../hooks/use-hana-fetch';

export interface SyncedAppearancePreferences {
  theme?: string;
  serif?: boolean;
  paperTexture?: boolean;
  leavesOverlay?: boolean;
  /** 阅读体（衬线）覆盖。空串表示清除。缺省表示不动。 */
  customFontFamily?: string | null;
  /** 界面体（无衬线）覆盖。空串表示清除。缺省表示不动。 */
  customUiFontFamily?: string | null;
}

export function readBrowserAppearancePreferences(): Required<SyncedAppearancePreferences> {
  return {
    theme: registry.migrateSavedTheme(window.localStorage.getItem(registry.STORAGE_KEY)),
    serif: window.localStorage.getItem('hana-font-serif') !== '0',
    paperTexture: isPaperTextureEnabled(window.localStorage),
    leavesOverlay: window.localStorage.getItem('hana-leaves-overlay') === '1',
    customFontFamily: readCustomFontStorage().serifFamily ?? '',
    customUiFontFamily: readCustomFontStorage().uiFamily ?? '',
  };
}

function readCustomFontStorage(): { serifFamily: string | null; uiFamily: string | null } {
  try {
    const raw = window.localStorage.getItem('hana-custom-font');
    if (!raw) return { serifFamily: null, uiFamily: null };
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return { serifFamily: null, uiFamily: null };
    return {
      serifFamily: typeof obj.serifFamily === 'string' && obj.serifFamily.trim() ? obj.serifFamily : null,
      uiFamily: typeof obj.uiFamily === 'string' && obj.uiFamily.trim() ? obj.uiFamily : null,
    };
  } catch {
    return { serifFamily: null, uiFamily: null };
  }
}

export function applySyncedAppearancePreferences(preferences?: SyncedAppearancePreferences | null): void {
  if (!preferences || typeof preferences !== 'object') return;
  if (preferences.theme) window.setTheme?.(preferences.theme);
  if (typeof preferences.serif === 'boolean') window.setSerifFont?.(preferences.serif);
  if (preferences.customFontFamily !== undefined || preferences.customUiFontFamily !== undefined) {
    // 任意一个键被显式提供（包含空串）就整体覆盖本地存储。
    const current = readCustomFontStorage();
    const nextSerif = preferences.customFontFamily !== undefined
      ? (typeof preferences.customFontFamily === 'string' && preferences.customFontFamily.trim() ? preferences.customFontFamily : null)
      : current.serifFamily;
    const nextUi = preferences.customUiFontFamily !== undefined
      ? (typeof preferences.customUiFontFamily === 'string' && preferences.customUiFontFamily.trim() ? preferences.customUiFontFamily : null)
      : current.uiFamily;
    window.setCustomFont?.({ serifFamily: nextSerif, uiFamily: nextUi });
  }
  if (typeof preferences.paperTexture === 'boolean') window.setPaperTexture?.(preferences.paperTexture);
  if (typeof preferences.leavesOverlay === 'boolean') {
    window.localStorage.setItem('hana-leaves-overlay', preferences.leavesOverlay ? '1' : '0');
    window.dispatchEvent(new CustomEvent('hana-settings', {
      detail: { type: 'leaves-overlay-changed', enabled: preferences.leavesOverlay },
    }));
  }
}

export async function persistAppearancePreferences(
  preferences: SyncedAppearancePreferences = readBrowserAppearancePreferences(),
): Promise<void> {
  await hanaFetch('/api/preferences/appearance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });
}
