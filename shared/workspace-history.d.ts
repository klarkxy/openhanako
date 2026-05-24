export interface MergeWorkspaceHistoryOptions {
  limit?: number;
}

export interface BuildWorkspacePickerItemsInput {
  selectedFolder?: string | null;
  homeFolder?: string | null;
  cwdHistory?: (string | null)[];
}

export function normalizeWorkspacePath(value: unknown): string | null;
export function mergeWorkspaceHistory(
  existing?: (string | null)[],
  additions?: (string | null)[],
  options?: MergeWorkspaceHistoryOptions,
): string[];
export function buildWorkspacePickerItems(input?: BuildWorkspacePickerItemsInput): string[];
export function workspaceDisplayName(value: unknown, fallback?: string): string;
