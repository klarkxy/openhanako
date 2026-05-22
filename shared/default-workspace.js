import fs from "fs";
import os from "os";
import path from "path";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  DEFAULT_WORKSPACE_DIRNAME,
} from "./default-workspace-constants.js";

export {
  DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  DEFAULT_WORKSPACE_DIRNAME,
};

/** 全局默认工作区路径（无 agentId 时使用，保持向后兼容） */
export function resolveDefaultWorkspacePath(homeDir = os.homedir()) {
  return path.join(homeDir, "Desktop", DEFAULT_WORKSPACE_DIRNAME);
}

/** 全局默认工作区（无 agentId 时使用，保持向后兼容） */
export function ensureDefaultWorkspace(homeDir = os.homedir()) {
  const workspacePath = resolveDefaultWorkspacePath(homeDir);
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

/**
 * 按角色生成默认工作区路径
 * - Windows:  %USERPROFILE%/Documents/Agents/<agentId>
 * - 其他平台:  ~/Agents/<agentId>
 */
export function resolveAgentDefaultWorkspacePath(agentId, homeDir = os.homedir()) {
  if (process.platform === "win32") {
    return path.join(homeDir, "Documents", "Agents", agentId);
  }
  return path.join(homeDir, "Agents", agentId);
}

/**
 * 确保角色默认工作区目录存在并返回路径
 */
export function ensureAgentDefaultWorkspace(agentId, homeDir = os.homedir()) {
  const workspacePath = resolveAgentDefaultWorkspacePath(agentId, homeDir);
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}
