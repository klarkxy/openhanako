import { useStore } from '../stores';
import { upsertPreviewItem } from '../stores/preview-actions';
import type { PreviewItem } from '../types';
import { readFileForPreviewType } from './preview-file-content';

const refreshGenerations = new Map<string, number>();

function beginRefresh(filePath: string): number {
  const next = (refreshGenerations.get(filePath) ?? 0) + 1;
  refreshGenerations.set(filePath, next);
  return next;
}

function isLatestRefresh(filePath: string, generation: number): boolean {
  return refreshGenerations.get(filePath) === generation;
}

function showMissingFileNotice(item: PreviewItem, filePath: string): void {
  if (typeof window === 'undefined') return;
  const fallback = `File is no longer available: ${item.title || filePath}`;
  const translated = window.t?.('preview.fileMissing', { title: item.title || filePath });
  const text = translated && translated !== 'preview.fileMissing' ? translated : fallback;
  window.dispatchEvent(new CustomEvent('hana-inline-notice', {
    detail: { text, type: 'error' },
  }));
}

export function __resetPreviewFileRefreshStateForTests(): void {
  refreshGenerations.clear();
}

export async function refreshPreviewItemsFromFile(filePath: string): Promise<void> {
  const generation = beginRefresh(filePath);
  const state = useStore.getState();
  const DIAG = (typeof window !== 'undefined' && (window as any).__HANA_DIAG__ === true);
  const t0 = performance.now();
  let matchCount = 0;
  for (const item of state.previewItems || []) {
    if (item.filePath !== filePath) continue;
    matchCount += 1;
    const read = await readFileForPreviewType(filePath, item.type);
    if (!isLatestRefresh(filePath, generation)) {
      if (DIAG) console.log(`[preview-refresh] stale after read, abort path=${filePath}`);
      return;
    }
    if (!read) {
      showMissingFileNotice(item, filePath);
      upsertPreviewItem({
        ...item,
        status: 'missing',
        missingAt: Date.now(),
      });
      continue;
    }
    const upsertT0 = performance.now();
    upsertPreviewItem({
      ...item,
      content: read.content,
      fileVersion: read.fileVersion ?? item.fileVersion,
      status: 'available',
      missingAt: null,
    });
    if (DIAG) console.log(`[preview-refresh] upsert item=${item.id} elapsed=${(performance.now() - upsertT0).toFixed(2)}ms contentLen=${read.content.length}`);
  }
  if (DIAG) console.log(`[preview-refresh] done path=${filePath} matched=${matchCount} totalElapsed=${(performance.now() - t0).toFixed(1)}ms`);
}
