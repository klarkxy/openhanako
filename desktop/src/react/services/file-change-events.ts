type FileChangeHandler = (filePath: string) => void;

const handlers = new Set<FileChangeHandler>();
const WATCH_RETRY_DELAYS_MS = [250, 750, 1500, 3000] as const;

interface WatchedFileEntry {
  refCount: number;
  active: boolean;
  attempt: number;
  token: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const watchedFiles = new Map<string, WatchedFileEntry>();
let attachedApi: typeof window.platform | null = null;

function normalizeFilePath(filePath: string): string {
  return String(filePath || '').trim();
}

function ensureBridgeAttached(): void {
  if (typeof window === 'undefined') return;
  const api = window.platform;
  if (!api?.onFileChanged) return;
  if (attachedApi === api) return;

  attachedApi = api;
  api.onFileChanged((filePath: string) => {
    const DIAG = (typeof window !== 'undefined' && (window as any).__HANA_DIAG__ === true);
    if (DIAG) {
      const t0 = performance.now();
      console.log(`[file-change] received path=${filePath} subscribers=${handlers.size}`);
      for (const handler of [...handlers]) {
        try {
          handler(filePath);
        } catch (err) {
          console.warn('[file-change] handler threw', err);
        }
      }
      console.log(`[file-change] dispatch done elapsed=${(performance.now() - t0).toFixed(1)}ms`);
      return;
    }
    for (const handler of [...handlers]) {
      handler(filePath);
    }
  });
}

export function subscribeFileChanges(handler: FileChangeHandler): () => void {
  ensureBridgeAttached();
  handlers.add(handler);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    handlers.delete(handler);
  };
}

function retainPlatformWatch(filePath: string): void {
  const current = watchedFiles.get(filePath);
  if (current) {
    current.refCount += 1;
    return;
  }
  const entry: WatchedFileEntry = {
    refCount: 1,
    active: false,
    attempt: 0,
    token: 0,
    retryTimer: null,
  };
  watchedFiles.set(filePath, entry);
  void startPlatformWatch(filePath, entry);
}

function releasePlatformWatch(filePath: string): void {
  const current = watchedFiles.get(filePath);
  if (!current) return;
  if (current.refCount <= 1) {
    watchedFiles.delete(filePath);
    if (current.retryTimer) clearTimeout(current.retryTimer);
    if (current.active) void window.platform?.unwatchFile?.(filePath)?.catch((err: unknown) => {
      console.warn('[file-change-events] unwatch failed:', filePath, err);
    });
    return;
  }
  current.refCount -= 1;
}

async function startPlatformWatch(filePath: string, entry: WatchedFileEntry): Promise<void> {
  const api = window.platform;
  if (!api?.watchFile) return;
  const token = ++entry.token;
  let ok = false;
  try {
    ok = (await api.watchFile(filePath)) !== false;
  } catch (err) {
    console.warn('[file-change-events] watch failed:', filePath, err);
  }

  if (watchedFiles.get(filePath) !== entry || entry.token !== token) {
    if (ok) void api.unwatchFile?.(filePath)?.catch((err: unknown) => {
      console.warn('[file-change-events] unwatch failed:', filePath, err);
    });
    return;
  }

  if (ok) {
    entry.active = true;
    entry.attempt = 0;
    return;
  }

  schedulePlatformWatchRetry(filePath, entry);
}

function schedulePlatformWatchRetry(filePath: string, entry: WatchedFileEntry): void {
  if (watchedFiles.get(filePath) !== entry) return;
  if (entry.retryTimer) clearTimeout(entry.retryTimer);
  const delayMs = WATCH_RETRY_DELAYS_MS[Math.min(entry.attempt, WATCH_RETRY_DELAYS_MS.length - 1)];
  entry.attempt += 1;
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    if (watchedFiles.get(filePath) !== entry) return;
    void startPlatformWatch(filePath, entry);
  }, delayMs);
}

export function watchFileChanges(filePath: string, handler: FileChangeHandler): () => void {
  const normalized = normalizeFilePath(filePath);
  if (!normalized) return () => {};

  retainPlatformWatch(normalized);
  const unsubscribe = subscribeFileChanges((changedPath) => {
    const changed = normalizeFilePath(changedPath);
    if (changed !== normalized) return;
    handler(changed);
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    releasePlatformWatch(normalized);
  };
}
