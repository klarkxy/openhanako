/**
 * apply-patch.js — Unified diff 补丁应用工具
 *
 * 根据 unified diff 格式的补丁文本，将修改应用到源文件或源文本。
 * 支持标准 unified diff 格式（---/+++ 头部 + @@ hunk），可在源中自动定位 hunk，
 * 支持单个或多个 hunk，可选择仅预览或写回文件。
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "../pi-sdk/index.js";
import { toolOk, toolError } from "./tool-result.js";

export const APPLY_PATCH_TOOL_NAME = "apply_patch";

// ─── 补丁解析 ───────────────────────────────────────────

/**
 * 解析 unified diff 中的单个 hunk
 * @param {string[]} lines - hunk 行数组（含 @@ 头）
 * @returns {object|null}
 */
function parseHunk(lines) {
  const header = lines[0];
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;

  const oldStart = parseInt(match[1], 10);
  const oldLines = [];
  const newLines = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith(" ") || line === "") {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      oldLines.push(content);
      newLines.push(content);
    }
    // "\ No newline at end of file" — 忽略
  }

  return { oldStart, oldLines, newLines };
}

/**
 * 解析整个 unified diff，提取所有 hunk
 * @param {string} patchText
 * @returns {{ hunks: object[] }}
 */
function parsePatch(patchText) {
  const rawLines = patchText.split("\n");
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const hunks = [];
  let currentHunk = null;

  for (const line of rawLines) {
    if (line.startsWith("@@")) {
      if (currentHunk !== null) {
        const parsed = parseHunk(currentHunk);
        if (parsed) hunks.push(parsed);
      }
      currentHunk = [line];
    } else if (currentHunk !== null) {
      currentHunk.push(line);
    }
    // 跳过 --- / +++ / diff / index 等头部行
  }

  if (currentHunk !== null) {
    const parsed = parseHunk(currentHunk);
    if (parsed) hunks.push(parsed);
  }

  return { hunks };
}

// ─── 补丁应用 ───────────────────────────────────────────

/**
 * 在源行数组中查找 hunk 匹配位置（容忍 ±3 行偏移）
 * @param {string[]} sourceLines
 * @param {string[]} contextLines - hunk 中的 old 行
 * @param {number} expectedStart - @@ 中指定的起始行（1-indexed）
 * @returns {number} 匹配到的起始索引（0-indexed），-1 表示未找到
 */
function findMatch(sourceLines, contextLines, expectedStart) {
  const searchFrom = Math.max(0, expectedStart - 1);
  const tolerance = 3;

  for (let offset = -tolerance; offset <= tolerance; offset++) {
    const startIdx = searchFrom + offset;
    if (startIdx < 0) continue;
    if (startIdx + contextLines.length > sourceLines.length) continue;

    let match = true;
    for (let i = 0; i < contextLines.length; i++) {
      if (sourceLines[startIdx + i] !== contextLines[i]) {
        match = false;
        break;
      }
    }
    if (match) return startIdx;
  }

  return -1;
}

/**
 * 将 hunks 应用到源文本
 * @param {string} source
 * @param {object[]} hunks
 * @returns {{ result: string, applied: number, failed: number, warnings: string[] }}
 */
function applyHunks(source, hunks) {
  const sourceLines = source.split("\n");
  const result = [];
  let cursor = 0;
  let applied = 0;
  let failed = 0;
  const warnings = [];

  // 按 oldStart 排序，记录匹配位置
  const sorted = hunks.map((h, i) => ({ ...h, index: i }));

  for (const hunk of sorted) {
    const matchIdx = findMatch(sourceLines, hunk.oldLines, hunk.oldStart);
    if (matchIdx === -1) {
      failed++;
      warnings.push(`Hunk #${hunk.index + 1} (@@ -${hunk.oldStart} @@) 未找到匹配位置，已跳过`);
      hunk._appliedAt = undefined;
    } else {
      hunk._appliedAt = matchIdx;
      applied++;
    }
  }

  // 正序重建结果
  sorted.sort((a, b) => (a._appliedAt ?? Infinity) - (b._appliedAt ?? Infinity));
  cursor = 0;

  for (const hunk of sorted) {
    if (hunk._appliedAt === undefined) continue;

    while (cursor < hunk._appliedAt) {
      result.push(sourceLines[cursor]);
      cursor++;
    }

    for (const line of hunk.newLines) {
      result.push(line);
    }

    cursor = hunk._appliedAt + hunk.oldLines.length;
  }

  while (cursor < sourceLines.length) {
    result.push(sourceLines[cursor]);
    cursor++;
  }

  return { result: result.join("\n"), applied, failed, warnings };
}

// ─── 工具定义 ───────────────────────────────────────────

export function createApplyPatchTool() {
  return {
    name: APPLY_PATCH_TOOL_NAME,
    label: "应用补丁",
    description:
      "应用 unified diff 补丁到源文件。支持从文件路径或直接传入源文本，接受标准 unified diff 格式的补丁内容。可选择将结果写回文件或仅返回补丁后的文本。",
    promptSnippet: "Apply unified diff patches to source files or text",
    promptGuidelines: [
      "Use apply_patch to apply unified diff patches instead of running patch/diff commands in bash",
      "Provide the patch in standard unified diff format with @@ hunk headers and +/- prefixed lines",
      "Set writeBack=true to write the result back to the source file",
      "Use filePath for file-based patching, or text for inline source content",
    ],
    parameters: Type.Object({
      filePath: Type.Optional(
        Type.String({
          description: "源文件的绝对路径。与 text 二选一，优先使用 filePath。",
        })
      ),
      text: Type.Optional(
        Type.String({
          description: "源文本内容。当 filePath 为空时使用。",
        })
      ),
      patch: Type.String({
        description:
          "unified diff 格式的补丁内容。包含 @@ 标记的 hunk 头部以及 +、- 前缀的变更行。可包含一个或多个 hunk。",
      }),
      writeBack: Type.Optional(
        Type.Boolean({
          description: "是否将补丁结果写回源文件。仅当 filePath 有效时可用，默认 false。",
        })
      ),
    }),

    execute: async (_toolCallId, params) => {
      const patchText = params.patch;
      if (!patchText || !patchText.trim()) {
        return toolError("请提供 unified diff 格式的补丁内容（patch）。", {
          errorCode: "APPLY_PATCH_NO_PATCH",
        });
      }

      let source = "";
      let sourceLabel = "";
      let resolvedPath = null;

      // 读取源文本
      if (params.filePath && params.filePath.trim()) {
        const rawPath = params.filePath.trim().replace(/^['"]|['"]$/g, "");
        resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
        try {
          source = fs.readFileSync(resolvedPath, "utf-8");
          sourceLabel = path.basename(resolvedPath);
        } catch (err) {
          return toolError(`无法读取源文件：${err.message}`, {
            errorCode: "APPLY_PATCH_READ_FAILED",
            path: resolvedPath,
          });
        }
      } else if (params.text !== undefined && params.text !== null) {
        source = params.text;
        sourceLabel = "输入文本";
      } else {
        return toolError("请提供源文件路径（filePath）或源文本内容（text）。", {
          errorCode: "APPLY_PATCH_NO_SOURCE",
        });
      }

      // 解析补丁
      const { hunks } = parsePatch(patchText);
      if (hunks.length === 0) {
        return toolError("未能从补丁内容中解析出任何 hunk，请检查 unified diff 格式。", {
          errorCode: "APPLY_PATCH_NO_HUNKS",
        });
      }

      // 应用补丁
      const { result, applied, failed, warnings } = applyHunks(source, hunks);

      // 写回文件
      let writeResult = null;
      if (params.writeBack && resolvedPath) {
        try {
          fs.writeFileSync(resolvedPath, result, "utf-8");
          writeResult = { written: true, path: resolvedPath };
        } catch (err) {
          return toolError(`写回文件失败：${err.message}`, {
            errorCode: "APPLY_PATCH_WRITE_FAILED",
            path: resolvedPath,
          });
        }
      }

      // 构建摘要
      const title = `🔧 补丁应用结果${sourceLabel ? `：${sourceLabel}` : ""}`;
      const lines = [
        title,
        "",
        `| 项目 | 数量 |`,
        `|------|------|`,
        `| Hunk 总数 | ${hunks.length} |`,
        `| 成功应用 | ${applied} |`,
        `| 跳过（未匹配） | ${failed} |`,
      ];

      if (warnings.length > 0) {
        lines.push("", ...warnings.map((w) => `⚠️ ${w}`));
      }

      if (writeResult) {
        lines.push("", `✅ 已写回文件：${writeResult.path}`);
      }

      // 非写回模式：返回补丁后的完整文本
      if (!writeResult) {
        lines.push("", "--- 补丁后的文本 ---", "", "```", result, "```");
      }

      return toolOk(lines.join("\n"), {
        hunksTotal: hunks.length,
        applied,
        failed,
        warnings,
        ...(writeResult ? { written: writeResult.path } : {}),
        sourceLabel,
      });
    },
  };
}
