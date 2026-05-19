import path from "path";
import { TEXT_FILE_TOOL_NAME, collectTextFileMutationPaths } from "./tools/text-file-tool.js";

export function wrapWithCheckpoint(tools, { store, maxFileSizeKb, cwd, getSessionPath }) {
  return tools.map((tool) => {
    if (tool.name === "write" || tool.name === "edit") {
      return wrapPathTool(tool, store, maxFileSizeKb, cwd, getSessionPath);
    }
    if (tool.name === "bash") {
      return wrapBashTool(tool, store, maxFileSizeKb, cwd, getSessionPath);
    }
    if (tool.name === TEXT_FILE_TOOL_NAME) {
      return wrapTextFileTool(tool, store, maxFileSizeKb, cwd, getSessionPath);
    }
    return tool;
  });
}

function resolvePath(rawPath, cwd) {
  if (!rawPath) return null;
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

function wrapPathTool(tool, store, maxFileSizeKb, cwd, getSessionPath) {
  return {
    ...tool,
    execute: async (toolCallId, params, ...rest) => {
      const filePath = resolvePath(params.path, cwd);
      if (filePath) {
        try {
          await store.save({
            sessionPath: getSessionPath(),
            tool: tool.name,
            source: "llm",
            reason: `tool-${tool.name}`,
            filePath,
            maxSizeKb: maxFileSizeKb,
          });
        } catch {
          // Backup failure must not block tool execution
        }
      }
      return tool.execute(toolCallId, params, ...rest);
    },
  };
}

const RM_PATTERN = /\brm\s+(?:-[^\s]*\s+)*([^\s|;&]+)/;
const MV_PATTERN = /\bmv\s+(?:-[^\s]*\s+)*([^\s|;&]+)\s+[^\s|;&]+/;

function wrapBashTool(tool, store, maxFileSizeKb, cwd, getSessionPath) {
  return {
    ...tool,
    execute: async (toolCallId, params, ...rest) => {
      const cmd = params.command || "";

      let match;
      if ((match = RM_PATTERN.exec(cmd))) {
        const filePath = resolvePath(match[1], cwd);
        if (filePath) {
          try {
            await store.save({
              sessionPath: getSessionPath(),
              tool: "bash:rm",
              source: "llm",
              reason: "tool-bash-rm",
              filePath,
              maxSizeKb: maxFileSizeKb,
            });
          } catch {}
        }
      } else if ((match = MV_PATTERN.exec(cmd))) {
        const filePath = resolvePath(match[1], cwd);
        if (filePath) {
          try {
            await store.save({
              sessionPath: getSessionPath(),
              tool: "bash:mv",
              source: "llm",
              reason: "tool-bash-mv",
              filePath,
              maxSizeKb: maxFileSizeKb,
            });
          } catch {}
        }
      }

      return tool.execute(toolCallId, params, ...rest);
    },
  };
}

function wrapTextFileTool(tool, store, maxFileSizeKb, cwd, getSessionPath) {
  return {
    ...tool,
    execute: async (toolCallId, params, ...rest) => {
      for (const entry of collectTextFileMutationPaths(params, cwd)) {
        try {
          await store.save({
            sessionPath: getSessionPath(),
            tool: tool.name,
            source: "llm",
            reason: `tool-${tool.name}`,
            filePath: entry.path,
            maxSizeKb: maxFileSizeKb,
          });
        } catch {}
      }
      return tool.execute(toolCallId, params, ...rest);
    },
  };
}
