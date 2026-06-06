/**
 * output-file-tool.js — 文件暂存工具（stage_files）
 *
 * agent 声明持有文件，框架按上下文投递（桌面渲染 / bridge 发送）。
 * 服务端拦截 tool_execution_end 事件，通过 WebSocket 推送 file_output 事件给前端。
 *
 * 参数：{ filepaths: string[] }
 * 同时向下兼容旧的单文件调用：{ filePath: string, label?: string }
 */
import fs from "fs";
import path from "path";
import { Type } from "../pi-sdk/index.ts";
import { t } from "../i18n.ts";
import { getToolSessionPath } from "./tool-session.ts";

/** 修正 LLM 常见的路径问题：转义空格、URL 编码、多余引号 */
function sanitizePath(p: any) {
  p = p.trim().replace(/^["']|["']$/g, "");
  p = p.replace(/\\ /g, " ");
  if (p.includes("%20")) {
    try { p = decodeURIComponent(p); } catch {}
  }
  return p;
}

export function createStageFilesTool({ registerSessionFile, getSessionPath }: { registerSessionFile?: any; getSessionPath?: any } = {}) {
  return {
    name: "stage_files",
    label: "Stage Files",
    description: "Call this tool when you need to hand one or more local files to the user, present them on desktop, or send them through Bridge/remote platforms. Use it after creating a file, finding a requested local file, receiving a browser screenshot, installer/package source, or file contribution from a plugin or sub-agent. Only call it when the file really exists and the path is a local absolute path. Do not merely mention file paths in text, and do not decide how the target platform should render or send the file; consumers choose the platform-specific delivery.",
    parameters: Type.Object({
      filepaths: Type.Optional(Type.Array(Type.String(), {
        minItems: 1,
        description: "Local absolute file paths to deliver. After locating files, pass them here so StageFile can register them for desktop, Bridge, or future mobile consumers.",
      })),
      // 向下兼容旧接口
      filePath: Type.Optional(Type.String({ description: "(Compat) Single local absolute file path. Prefer filepaths for new calls." })),
      label: Type.Optional(Type.String({ description: "(Compat) File name shown to the user. Usually omit this; the filename is used by default." })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      // 统一为路径数组：优先使用 filepaths，兼容 filePath
      let paths = params.filepaths;
      if (!paths || paths.length === 0) {
        if (params.filePath) {
          paths = [params.filePath];
        } else {
          return {
            content: [{ type: "text", text: t("error.outputFileNeedPaths") }],
            details: {},
          };
        }
      }

      const results = [];
      const errors = [];
      const sessionPath = registerSessionFile
        ? getToolSessionPath(ctx) || ctx?.sessionPath || getSessionPath?.() || null
        : null;

      for (const raw of paths) {
        const fp = sanitizePath(raw);

        if (!path.isAbsolute(fp)) {
          errors.push(t("error.outputFileNotAbsolute", { path: fp }));
          continue;
        }
        if (!fs.existsSync(fp)) {
          errors.push(t("error.outputFileNotFound", { path: fp }));
          continue;
        }

        const displayLabel = path.basename(fp);
        const ext = path.extname(fp).toLowerCase().replace(".", "");
        const label = params.label || displayLabel;
        if (registerSessionFile) {
          if (!sessionPath) {
            errors.push("stage_files requires an active sessionPath to register files");
            continue;
          }
          try {
            const sessionFile = await registerSessionFile({
              sessionPath,
              filePath: fp,
              label,
              origin: "stage_files",
            });
            results.push(toStageFileResult(sessionFile, { filePath: fp, label, ext }));
          } catch (err) {
            errors.push(err?.message || String(err));
          }
        } else {
          results.push({ filePath: fp, label, ext });
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: errors.join("\n") }],
          details: {},
        };
      }

      const summary = results.map(r => r.label).join(", ");
      return {
        content: [{ type: "text", text: t("error.outputFilePresented", { summary }) }],
        details: {
          files: results,
          media: {
            ...(results.some(r => r.fileId) ? { items: results.map(toMediaItem).filter(Boolean) } : {}),
            mediaUrls: results.map(r => r.filePath),
          },
        },
      };
    },
  };
}

function toStageFileResult(sessionFile: any, legacy: any) {
  const fileId = sessionFile?.id || sessionFile?.fileId || null;
  return {
    ...(fileId ? { id: fileId, fileId } : {}),
    filePath: sessionFile?.filePath || legacy.filePath,
    label: legacy.label || sessionFile?.displayName || sessionFile?.label,
    ext: sessionFile?.ext || legacy.ext || "",
    ...(sessionFile?.mime ? { mime: sessionFile.mime } : {}),
    ...(sessionFile?.size !== undefined ? { size: sessionFile.size } : {}),
    ...(sessionFile?.kind ? { kind: sessionFile.kind } : {}),
    ...(sessionFile?.sessionPath ? { sessionPath: sessionFile.sessionPath } : {}),
    ...(sessionFile?.origin ? { origin: sessionFile.origin } : {}),
    ...(sessionFile?.storageKind ? { storageKind: sessionFile.storageKind } : {}),
    ...(sessionFile?.status ? { status: sessionFile.status } : {}),
    ...(sessionFile?.missingAt !== undefined ? { missingAt: sessionFile.missingAt } : {}),
    ...(sessionFile?.resource ? { resource: sessionFile.resource } : {}),
  };
}

function toMediaItem(file: any) {
  if (!file?.fileId) return null;
  return {
    type: "session_file",
    fileId: file.fileId,
    sessionPath: file.sessionPath,
    filePath: file.filePath,
    filename: path.basename(file.filePath),
    label: file.label,
    mime: file.mime,
    size: file.size,
    kind: file.kind,
  };
}
