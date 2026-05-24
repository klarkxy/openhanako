export const SESSION_PERMISSION_MODES = Object.freeze({
  OPERATE: "operate",
  ASK: "ask",
  READ_ONLY: "read_only",
  SOCIAL_READONLY: "social_readonly",
  SOCIAL_GREETING_ONLY: "social_greeting_only",
});

export const DEFAULT_SESSION_PERMISSION_MODE = SESSION_PERMISSION_MODES.ASK;

const INFORMATION_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "web_fetch",
  "current_status",
  "search_memory",
  "recall_experience",
  "friends_list_contacts",
  "friends_resolve_contact",
]);

const SIDE_EFFECT_TOOLS = new Set([
  "bash",
  "write",
  "edit",
  "computer",
  "cron",
  "dm",
  "channel",
  "install_skill",
  "update_settings",
  "todo_write",
  // Legacy compatibility tools stay classified as side effects so restored
  // sessions keep the same permission boundary until the v0.133 cleanup window.
  "create_artifact",
  "stage_files",
  "present_files",
  "subagent",
  "notify",
  "record_experience",
  "pin_memory",
  "unpin_memory",
  "friends_upsert_contact",
  "friends_remove_contact",
]);

const BROWSER_READ_ACTIONS = new Set([
  "start",
  "navigate",
  "snapshot",
  "screenshot",
  "scroll",
  "wait",
  "show",
  "stop",
]);

const TERMINAL_READ_ACTIONS = new Set([
  "read",
  "list",
]);

const TEXT_FILE_READ_ACTIONS = new Set([
  "read",
]);

export function normalizeSessionPermissionMode(raw) {
  if (typeof raw === "string") return normalizeSessionPermissionMode({ permissionMode: raw });
  if (raw?.permissionMode === SESSION_PERMISSION_MODES.OPERATE) return SESSION_PERMISSION_MODES.OPERATE;
  if (raw?.permissionMode === SESSION_PERMISSION_MODES.ASK) return SESSION_PERMISSION_MODES.ASK;
  if (raw?.permissionMode === SESSION_PERMISSION_MODES.READ_ONLY) return SESSION_PERMISSION_MODES.READ_ONLY;
  if (raw?.permissionMode === SESSION_PERMISSION_MODES.SOCIAL_READONLY) return SESSION_PERMISSION_MODES.SOCIAL_READONLY;
  if (raw?.permissionMode === SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY) return SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY;
  if (raw?.accessMode === "operate") return SESSION_PERMISSION_MODES.OPERATE;
  if (raw?.accessMode === "read_only") return SESSION_PERMISSION_MODES.READ_ONLY;
  if (raw?.planMode === true) return SESSION_PERMISSION_MODES.READ_ONLY;
  return DEFAULT_SESSION_PERMISSION_MODE;
}

export function legacyAccessModeFromPermissionMode(mode) {
  // OPERATE 和 ASK 都属于 operate 级别访问（ASK 只是每次操作需要确认）
  // 只有真正的只读模式才映射到 read_only
  return isReadOnlyPermissionMode(mode) ? "read_only" : "operate";
}

export function isReadOnlyPermissionMode(mode) {
  const normalized = normalizeSessionPermissionMode(mode);
  return normalized === SESSION_PERMISSION_MODES.READ_ONLY
    || normalized === SESSION_PERMISSION_MODES.SOCIAL_READONLY
    || normalized === SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY;
}

function blocked(toolName, mode = SESSION_PERMISSION_MODES.READ_ONLY) {
  const normalized = normalizeSessionPermissionMode(mode);
  const modeName = normalized === SESSION_PERMISSION_MODES.SOCIAL_READONLY
    ? "social read-only"
    : normalized === SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY
    ? "greeting-only"
    : "read-only";
  return {
    action: "deny",
    code: "ACTION_BLOCKED_BY_READ_ONLY",
    message: `${toolName} is blocked in ${modeName} mode.`,
    details: { toolName },
  };
}

function prompt(toolName) {
  return {
    action: "prompt",
    kind: "tool_action_approval",
    details: { toolName },
  };
}

function classifyBrowserAction(mode, action) {
  if (mode === SESSION_PERMISSION_MODES.SOCIAL_READONLY || mode === SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY) {
    return blocked("browser", mode);
  }
  if (BROWSER_READ_ACTIONS.has(action)) return { action: "allow" };
  if (mode === SESSION_PERMISSION_MODES.READ_ONLY) {
    return blocked("browser", mode);
  }
  if (mode === SESSION_PERMISSION_MODES.ASK) return prompt("browser");
  return { action: "allow" };
}

function classifyTerminalAction(mode, action) {
  if (mode === SESSION_PERMISSION_MODES.SOCIAL_READONLY || mode === SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY) {
    return blocked("terminal", mode);
  }
  if (TERMINAL_READ_ACTIONS.has(action)) return { action: "allow" };
  if (mode === SESSION_PERMISSION_MODES.READ_ONLY) {
    return blocked("terminal", mode);
  }
  if (mode === SESSION_PERMISSION_MODES.ASK) return prompt("terminal");
  return { action: "allow" };
}

function classifyTextFileAction(mode, action) {
  if (mode === SESSION_PERMISSION_MODES.SOCIAL_READONLY || mode === SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY) {
    return blocked("text_file", mode);
  }
  if (TEXT_FILE_READ_ACTIONS.has(action)) return { action: "allow" };
  if (mode === SESSION_PERMISSION_MODES.READ_ONLY) {
    return blocked("text_file", mode);
  }
  if (mode === SESSION_PERMISSION_MODES.ASK) return prompt("text_file");
  return { action: "allow" };
}

export function classifySessionPermission({ mode, toolName, params } = {}) {
  const normalized = normalizeSessionPermissionMode(mode);
  const name = typeof toolName === "string" ? toolName : "";
  if (!name) return { action: "allow" };
  if (INFORMATION_TOOLS.has(name)) {
    if (normalized === SESSION_PERMISSION_MODES.SOCIAL_READONLY || normalized === SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY) {
      return blocked(name, normalized);
    }
    return { action: "allow" };
  }
  if (name === "browser") return classifyBrowserAction(normalized, params?.action);
  if (name === "terminal") return classifyTerminalAction(normalized, params?.action);
  if (name === "text_file") return classifyTextFileAction(normalized, params?.action);
  if (normalized === SESSION_PERMISSION_MODES.OPERATE) return { action: "allow" };
  if (normalized === SESSION_PERMISSION_MODES.READ_ONLY || normalized === SESSION_PERMISSION_MODES.SOCIAL_READONLY || normalized === SESSION_PERMISSION_MODES.SOCIAL_GREETING_ONLY) {
    return blocked(name, normalized);
  }
  if (SIDE_EFFECT_TOOLS.has(name)) return prompt(name);
  return prompt(name);
}
