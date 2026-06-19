import { useStore } from '../stores';
import type { PreviewItem, RemoteWorkbenchContentRef } from '../types';
import {
  PREVIEW_FILE_CATCH_UP_REFRESH_OPTIONS,
  PREVIEW_FILE_CHANGE_REFRESH_OPTIONS,
  refreshPreviewItemsFromFile,
  type PreviewFileRefreshOptions,
} from './preview-file-refresh';
import {
  isRemoteWorkbenchContentRef,
  normalizeWorkbenchContentRef,
  refreshPreviewItemsFromRemoteWorkbenchTarget,
} from './remote-file-preview';

export type PreviewDocumentTarget =
  | { kind: 'local-file'; filePath: string }
  | { kind: 'workbench-file'; target: RemoteWorkbenchContentRef };

export type PreviewDocumentRefreshOptions = PreviewFileRefreshOptions;

interface PreviewDocumentRefreshControl {
  fallbackOpenDocuments?: boolean;
}

export const PREVIEW_DOCUMENT_CHANGE_REFRESH_OPTIONS: PreviewDocumentRefreshOptions = PREVIEW_FILE_CHANGE_REFRESH_OPTIONS;
export const PREVIEW_DOCUMENT_CATCH_UP_REFRESH_OPTIONS: PreviewDocumentRefreshOptions = PREVIEW_FILE_CATCH_UP_REFRESH_OPTIONS;

function normalizeComparablePath(value: string): string {
  const slashed = String(value || '').trim().replace(/\\/g, '/');
  const trimmed = slashed.length > 1 ? slashed.replace(/\/+$/g, '') : slashed;
  return /^[A-Za-z]:/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function normalizeSubdir(value: string | undefined | null): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function joinWorkspaceFilePath(basePath: string, subdir: string | undefined | null, name: string): string {
  const separator = /^[A-Za-z]:\\/.test(basePath) || (basePath.includes('\\') && !basePath.includes('/')) ? '\\' : '/';
  const parts = [normalizeSubdir(subdir), name.replace(/^[/\\]+/g, '')]
    .filter(Boolean)
    .join('/');
  if (!parts) return basePath;
  return `${basePath.replace(/[\\/]+$/g, '')}${separator}${parts.replace(/\//g, separator)}`;
}

function previewDocumentTargetKey(target: PreviewDocumentTarget): string {
  if (target.kind === 'local-file') return `local:${target.filePath}`;
  const normalized = normalizeWorkbenchContentRef(target.target);
  return [
    'workbench',
    normalized.mountId || normalized.rootId || 'default',
    normalized.subdir || '',
    normalized.name,
  ].join(':');
}

function previewDocumentTargetFromItem(item: PreviewItem | undefined | null): PreviewDocumentTarget | null {
  if (!item) return null;
  if (isRemoteWorkbenchContentRef(item.remoteContentRef)) {
    return { kind: 'workbench-file', target: item.remoteContentRef };
  }
  if (item.filePath && item.storageKind !== 'remote-content') {
    return { kind: 'local-file', filePath: item.filePath };
  }
  return null;
}

function previewDocumentTargetsEqual(left: PreviewDocumentTarget, right: PreviewDocumentTarget): boolean {
  return previewDocumentTargetKey(left) === previewDocumentTargetKey(right);
}

function openPreviewDocumentTargetMatches(target: PreviewDocumentTarget): boolean {
  const state = useStore.getState();
  const itemsById = new Map((state.previewItems || []).map(item => [item.id, item]));
  for (const id of state.openTabs || []) {
    const openTarget = previewDocumentTargetFromItem(itemsById.get(id));
    if (openTarget && previewDocumentTargetsEqual(openTarget, target)) return true;
  }
  return false;
}

function openPreviewDocumentTargets(): PreviewDocumentTarget[] {
  const state = useStore.getState();
  const itemsById = new Map((state.previewItems || []).map(item => [item.id, item]));
  const targets: PreviewDocumentTarget[] = [];
  const seen = new Set<string>();

  for (const id of state.openTabs || []) {
    const target = previewDocumentTargetFromItem(itemsById.get(id));
    if (!target) continue;
    const key = previewDocumentTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }

  return targets;
}

function filePathForPreviewDocumentTarget(target: PreviewDocumentTarget, state: ReturnType<typeof useStore.getState>): string | null {
  if (target.kind === 'local-file') return target.filePath;
  const basePath = typeof state.deskBasePath === 'string' ? state.deskBasePath : '';
  if (!basePath) return null;

  const normalized = normalizeWorkbenchContentRef(target.target);
  const targetMountId = normalized.mountId || normalized.rootId || 'default';
  const activeMountId = typeof state.deskWorkspaceMountId === 'string' && state.deskWorkspaceMountId.trim()
    ? state.deskWorkspaceMountId.trim()
    : 'default';
  if (targetMountId !== activeMountId) return null;

  return joinWorkspaceFilePath(basePath, normalized.subdir || '', normalized.name);
}

function openPreviewDocumentTargetsForFilePath(filePath: string): PreviewDocumentTarget[] {
  const state = useStore.getState();
  const changedKey = normalizeComparablePath(filePath);
  if (!changedKey) return [];

  const itemsById = new Map((state.previewItems || []).map(item => [item.id, item]));
  const targets: PreviewDocumentTarget[] = [];
  const seen = new Set<string>();
  for (const id of state.openTabs || []) {
    const target = previewDocumentTargetFromItem(itemsById.get(id));
    if (!target) continue;
    const targetFilePath = filePathForPreviewDocumentTarget(target, state);
    if (!targetFilePath || normalizeComparablePath(targetFilePath) !== changedKey) continue;
    const key = previewDocumentTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

export async function refreshPreviewDocumentTarget(
  target: PreviewDocumentTarget,
  options: PreviewDocumentRefreshOptions = PREVIEW_DOCUMENT_CHANGE_REFRESH_OPTIONS,
  control: PreviewDocumentRefreshControl = {},
): Promise<void> {
  const shouldFallbackOpenDocuments = control.fallbackOpenDocuments !== false
    && !openPreviewDocumentTargetMatches(target);
  if (target.kind === 'local-file') {
    await refreshPreviewItemsFromFile(target.filePath, options);
  } else {
    await refreshPreviewItemsFromRemoteWorkbenchTarget(target.target, options);
  }
  if (shouldFallbackOpenDocuments) {
    await refreshOpenPreviewDocuments(options);
  }
}

export async function refreshOpenPreviewDocuments(
  options: PreviewDocumentRefreshOptions = PREVIEW_DOCUMENT_CATCH_UP_REFRESH_OPTIONS,
): Promise<void> {
  const targets = openPreviewDocumentTargets();
  if (targets.length === 0) return;
  await Promise.all(targets.map(target => refreshPreviewDocumentTarget(
    target,
    options,
    { fallbackOpenDocuments: false },
  )));
}

export async function refreshOpenPreviewDocumentsForFilePath(
  filePath: string,
  options: PreviewDocumentRefreshOptions = PREVIEW_DOCUMENT_CHANGE_REFRESH_OPTIONS,
): Promise<void> {
  const targets = openPreviewDocumentTargetsForFilePath(filePath);
  if (targets.length === 0) return;
  await Promise.all(targets.map(target => refreshPreviewDocumentTarget(
    target,
    options,
    { fallbackOpenDocuments: false },
  )));
}
