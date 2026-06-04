type FileChangeHandler = (filePath: string) => void;

const handlers = new Set<FileChangeHandler>();
const watchedFiles = new Map<string, number>();
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
  const current = watchedFiles.get(filePath) ?? 0;
  watchedFiles.set(filePath, current + 1);
  if (current > 0) return;
  void window.platform?.watchFile?.(filePath)?.catch((err: unknown) => {
    console.warn('[file-change-events] watch failed:', filePath, err);
  });
}

function releasePlatformWatch(filePath: string): void {
  const current = watchedFiles.get(filePath) ?? 0;
  if (current <= 1) {
    watchedFiles.delete(filePath);
    void window.platform?.unwatchFile?.(filePath)?.catch((err: unknown) => {
      console.warn('[file-change-events] unwatch failed:', filePath, err);
    });
    return;
  }
  watchedFiles.set(filePath, current - 1);
}

export function watchFileChanges(filePath: string, handler: FileChangeHandler): () => void {
  const normalized = normalizeFilePath(filePath);
  if (!normalized) return () => {};

  retainPlatformWatch(normalized);
  const unsubscribe = subscribeFileChanges((changedPath) => {
    if (changedPath !== normalized) return;
    handler(changedPath);
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    releasePlatformWatch(normalized);
  };
}
