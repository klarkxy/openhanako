#!/usr/bin/env node
/**
 * Cross-platform dev launcher
 * 解决 POSIX `VAR=val cmd` 语法和 `~` 在 Windows 上不工作的问题
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { ensureWindowsUtf8Console } from "../shared/windows-console.js";

const require = createRequire(import.meta.url);
ensureWindowsUtf8Console();
process.env.HANA_HOME = join(homedir(), ".hanako-dev");
// 本地 Electron 再拉起 server 时，显式把当前 Node runtime 传下去。
// 这样开发模式的 server/source 进程就不会误用 Electron 自带 Node，避免 native addon ABI 漂移。
process.env.HANA_DEV_NODE_BIN = process.execPath;

const mode = process.argv[2];
const extra = process.argv.slice(3);

let bin, args;
switch (mode) {
  case "electron":
    bin = require("electron");
    args = [".", ...extra];
    break;
  case "electron-dev":
    bin = require("electron");
    args = [".", "--dev", ...extra];
    break;
  case "electron-vite":
    process.env.VITE_DEV_URL = "http://localhost:5173";
    bin = require("electron");
    args = [".", "--dev", ...extra];
    break;
  case "cli":
    bin = process.execPath;
    args = ["cli/entry.js", ...extra];
    break;
  case "server":
    bin = process.execPath;
    args = ["server/index.js", ...extra];
    break;
  default:
    console.error("Usage: node scripts/launch.js <electron|electron-dev|electron-vite|cli|server>");
    process.exit(1);
}

// Electron 以子进程运行时（如 VS Code / Claude Code 终端），
// 父进程可能设了 ELECTRON_RUN_AS_NODE=1，会让 Electron 以纯 Node 模式启动，
// 导致 require('electron') 拿不到内置 API。spawn 前清掉。
delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(bin, args, { stdio: "inherit", env: process.env });

function cleanupAndExit(code) {
  if (child.exitCode === null && child.signalCode === null) {
    // 通知 Electron 优雅退出（before-quit → shutdownServer → kill server）
    if (process.platform === "win32") {
      try { child.kill(); } catch {} // Windows: 传 console CTRL 事件不可靠，直接 kill
    } else {
      child.kill("SIGTERM");
    }
    // 给 Electron 最多 5s 清理 server，超时则强杀
    const forceTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
    child.on("exit", () => clearTimeout(forceTimer));
  }
  process.exit(code ?? 1);
}

process.on("SIGINT", () => cleanupAndExit(0));
process.on("SIGTERM", () => cleanupAndExit(0));
child.on("exit", (code) => process.exit(code ?? 1));
