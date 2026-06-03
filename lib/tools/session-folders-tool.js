import path from "path";
import { StringEnum, Type } from "../pi-sdk/index.js";
import { getToolSessionPath } from "./tool-session.js";
import { toolError, toolOk } from "./tool-result.js";

function toStatus(action) {
  if (action === "confirmed") return "confirmed";
  if (action === "timeout") return "timeout";
  if (action === "aborted") return "aborted";
  return "rejected";
}

function folderScopeText(scope) {
  return JSON.stringify({
    session_folders: {
      sessionPath: scope?.sessionPath || null,
      cwd: scope?.cwd || null,
      workspaceFolders: Array.isArray(scope?.workspaceFolders) ? scope.workspaceFolders : [],
      authorizedFolders: Array.isArray(scope?.authorizedFolders) ? scope.authorizedFolders : [],
      sandboxFolders: Array.isArray(scope?.sandboxFolders) ? scope.sandboxFolders : [],
    },
  }, null, 2);
}

function buildFolderApprovalRequest(confirmId, action, folder) {
  const normalizedAction = action === "remove" ? "remove" : "add";
  return {
    type: "session_confirmation",
    confirmId,
    kind: "session_folders",
    surface: "input",
    status: "pending",
    title: "允许 Hana 修改本对话的文件夹授权",
    body: "确认后，这个文件夹会成为当前对话的额外沙盒目录；不会改变工作目录，也不会写入提示词。",
    subject: {
      label: normalizedAction === "add" ? "添加授权目录" : "移除授权目录",
      detail: folder,
    },
    severity: "elevated",
    actions: {
      confirmLabel: "同意",
      rejectLabel: "拒绝",
    },
    payload: { action: normalizedAction, folder },
  };
}

async function askForFolderApproval(action, folder, sessionPath, deps) {
  const confirmStore = deps.getConfirmStore?.() || deps.confirmStore || null;
  if (!confirmStore || !sessionPath) {
    return { allowed: false, status: "rejected", confirmId: "", reason: "confirmation-unavailable" };
  }
  const { confirmId, promise } = confirmStore.create(
    "session_folders",
    { action, folder },
    sessionPath,
  );
  deps.emitEvent?.({
    type: "session_confirmation",
    request: buildFolderApprovalRequest(confirmId, action, folder),
  }, sessionPath);
  const decision = await promise;
  const status = toStatus(decision?.action);
  return {
    allowed: status === "confirmed",
    status,
    confirmId,
  };
}

function normalizeFolderParam(folder) {
  if (typeof folder !== "string" || !folder.trim()) return null;
  return path.resolve(folder.trim());
}

export function createSessionFoldersTool(deps = {}) {
  return {
    name: "session_folders",
    label: "Session folders",
    description: "List or request changes to the current session's extra authorized sandbox folders. Use action=list to inspect cwd, prompt-visible workspace folders, user-authorized folders, and effective sandbox roots. Use add/remove only after the user wants this session to gain or drop folder access; changes require user confirmation and do not modify CWD or prompt text.",
    parameters: Type.Object({
      action: StringEnum(["list", "add", "remove"], {
        description: "list returns the current folder scope. add/remove asks the user to confirm changing the current session's extra authorized folders.",
      }),
      folder: Type.Optional(Type.String({
        description: "Absolute or resolvable folder path for add/remove.",
      })),
    }),
    execute: async (_toolCallId, params = {}, _signal, _onUpdate, ctx) => {
      const engine = deps.getEngine?.();
      const sessionPath = getToolSessionPath(ctx) || deps.getSessionPath?.() || null;
      if (!engine) {
        return toolError("session_folders requires the engine runtime.", { errorCode: "ENGINE_UNAVAILABLE" });
      }
      if (!sessionPath) {
        return toolError("session_folders requires a current session.", { errorCode: "SESSION_REQUIRED" });
      }

      const action = params.action || "list";
      if (action === "list") {
        return toolOk(folderScopeText(engine.getSessionFolderScope?.(sessionPath)), { action, sessionPath });
      }

      const folder = normalizeFolderParam(params.folder);
      if (!folder) {
        return toolError("session_folders add/remove requires folder.", {
          errorCode: "FOLDER_REQUIRED",
          action,
          sessionPath,
        });
      }

      const approval = await askForFolderApproval(action, folder, sessionPath, deps);
      if (!approval.allowed) {
        return toolOk("Session folder authorization was not approved.", {
          action,
          confirmed: false,
          confirmation: {
            kind: "session_folders",
            status: approval.status,
            confirmId: approval.confirmId,
            reason: approval.reason,
          },
        });
      }

      const scope = action === "remove"
        ? await engine.removeSessionAuthorizedFolder?.(sessionPath, folder)
        : await engine.addSessionAuthorizedFolder?.(sessionPath, folder);
      return toolOk(folderScopeText(scope || engine.getSessionFolderScope?.(sessionPath)), {
        action,
        confirmed: true,
        sessionPath,
        folder,
      });
    },
  };
}
