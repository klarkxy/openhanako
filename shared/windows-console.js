import { spawnSync } from "node:child_process";

export function ensureWindowsUtf8Console() {
  if (process.platform !== "win32") return false;
  if (!process.stdout.isTTY && !process.stderr.isTTY) return false;

  const comspec = process.env.ComSpec || "cmd.exe";
  const result = spawnSync(comspec, ["/d", "/s", "/c", "chcp 65001 >nul"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}