const path = require("path");
const chokidar = require("chokidar");
const { normalizeFileWatchPath } = require("./file-watch-path.cjs");

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
    awaitWriteFinish: false,
    ignorePermissionErrors: true,
    depth: 0,
  });
  if (process.env.HANA_FILEWATCH_TRACE === '1') {
    console.log(`[filewatch-trace] watch start: target=${targetPath} parentDir=${parentDir}`);
  }

  watcher.on("all", (eventType, changedPath) => {
    if (process.env.HANA_FILEWATCH_TRACE === '1') {
      console.log(`[filewatch-trace] raw event: type=${eventType} changedPath=${changedPath} targetKey=${targetKey}`);
    }
    if (!changedPath) return;
    if (normalizeFileWatchPath(changedPath) !== targetKey) return;
    if (process.env.HANA_FILEWATCH_TRACE === '1') {
      console.log(`[filewatch-trace] match → notify: target=${targetPath}`);
    }
    onChange(eventType, targetPath);
  });
  watcher.on("error", (err) => {
    if (process.env.HANA_FILEWATCH_TRACE === '1') {
      console.warn(`[filewatch-trace] watcher error: target=${targetPath} err=${err?.message || err}`);
    }
  });

  return watcher;
}

module.exports = {
  createStableFileWatcher,
  normalizeFileWatchPath,
};
