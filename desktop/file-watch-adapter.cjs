const path = require("path");
const fs = require("fs");
const chokidar = require("chokidar");
const { normalizeFileWatchPath } = require("./file-watch-path.cjs");

const POLL_INTERVAL_MS = Number(process.env.HANA_FILEWATCH_POLL_MS) > 0
  ? Number(process.env.HANA_FILEWATCH_POLL_MS)
  : 750;
const TRACE = process.env.HANA_FILEWATCH_TRACE === "1";

function trace(...args) {
  if (TRACE) console.log(`[filewatch-trace]`, ...args);
}

function statKey(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${st.size}|${st.mtimeMs}`;
  } catch {
    return null;
  }
}

function createStableFileWatcher(filePath, options = {}, onChange) {
  if (typeof onChange !== "function") {
    throw new Error("createStableFileWatcher: onChange function required");
  }

  const targetPath = path.resolve(filePath);
  const targetKey = normalizeFileWatchPath(targetPath);
  const parentDir = path.dirname(targetPath);

  const watcher = chokidar.watch(parentDir, {
    ...options,
    ignoreInitial: true,
    atomic: true,
    // 等文件大小稳定后再回调，避免读到中间态。
    // 50ms 阈值在毫秒级 IDE 自动保存场景下几乎无感。
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 30 },
    ignorePermissionErrors: true,
    depth: 0,
  });
  trace(`watch start: target=${targetPath} parentDir=${parentDir}`);

  watcher.on("all", (eventType, changedPath) => {
    trace(`raw event: type=${eventType} changedPath=${changedPath} targetKey=${targetKey}`);
    if (!changedPath) return;
    if (normalizeFileWatchPath(changedPath) !== targetKey) return;
    trace(`match → notify: target=${targetPath}`);
    onChange(eventType, targetPath);
  });
  watcher.on("error", (err) => {
    trace(`watcher error: target=${targetPath} err=${err?.message || err}`);
  });

  // 兜底：跨进程 fs.writeFileSync 在 Windows ReadDirectoryChangesW 上
  // 有概率漏事件。poll mtime+size，变了就主动通知一次。
  // 这条路径与 chokidar 事件互不冲突（registry 已做 50ms debounce）。
  let lastKey = statKey(targetPath);
  const pollTimer = setInterval(() => {
    const cur = statKey(targetPath);
    if (cur == null) {
      // 文件被删：仅在之前存在时通知一次
      if (lastKey !== null) {
        trace(`poll → file vanished: target=${targetPath}`);
        lastKey = null;
        onChange("unlink", targetPath);
      }
      return;
    }
    if (cur !== lastKey) {
      trace(`poll → changed: target=${targetPath} ${lastKey} -> ${cur}`);
      lastKey = cur;
      onChange("change", targetPath);
    }
  }, POLL_INTERVAL_MS);
  pollTimer.unref?.();

  // 给外部一个清理入口：把 pollTimer 挂在 watcher 上
  watcher._hanaPollTimer = pollTimer;

  return watcher;
}

module.exports = {
  createStableFileWatcher,
  normalizeFileWatchPath,
};
