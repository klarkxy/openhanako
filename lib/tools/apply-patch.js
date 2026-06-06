/**
 * apply-patch.js — Unified diff patch application tool
 *
 * Applies unified diff patches to source files or text content.
 * Supports standard unified diff format (---/+++ headers + @@ hunks),
 * automatic hunk position matching, single or multiple hunks,
 * and preview-only or write-back modes.
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "../pi-sdk/index.ts";
import { toolOk, toolError } from "./tool-result.ts";

export const APPLY_PATCH_TOOL_NAME = "apply_patch";

// ─── Patch Parsing ──────────────────────────────────────

/**
 * Parse a single hunk from unified diff
 * @param {string[]} lines - hunk lines including the @@ header
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
    // "\ No newline at end of file" — ignore
  }

  return { oldStart, oldLines, newLines };
}

/**
 * Parse the entire unified diff and extract all hunks
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
    // Skip --- / +++ / diff / index header lines
  }

  if (currentHunk !== null) {
    const parsed = parseHunk(currentHunk);
    if (parsed) hunks.push(parsed);
  }

  return { hunks };
}

// ─── Patch Application ──────────────────────────────────

/**
 * Find hunk match position in source lines (tolerates ±3 line offset)
 * @param {string[]} sourceLines
 * @param {string[]} contextLines - old lines from the hunk
 * @param {number} expectedStart - start line from @@ header (1-indexed)
 * @returns {number} matched start index (0-indexed), or -1 if not found
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
 * Apply hunks to source text
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

  // Sort by oldStart and record match positions
  const sorted = hunks.map((h, i) => ({ ...h, index: i }));

  for (const hunk of sorted) {
    const matchIdx = findMatch(sourceLines, hunk.oldLines, hunk.oldStart);
    if (matchIdx === -1) {
      failed++;
      warnings.push(`Hunk #${hunk.index + 1} (@@ -${hunk.oldStart} @@) — no matching position found, skipped`);
      hunk._appliedAt = undefined;
    } else {
      hunk._appliedAt = matchIdx;
      applied++;
    }
  }

  // Rebuild result in forward order
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

// ─── Tool Definition ──────────────────────────────────────

export function createApplyPatchTool() {
  return {
    name: APPLY_PATCH_TOOL_NAME,
    label: "apply_patch",
    description:
      "Apply unified diff patches to source files or text. Supports reading the source from a file path or inline text, and accepts standard unified diff patch content. Results can be previewed or written back to the source file.",
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
          description: "Absolute path to the source file. Alternative to text; filePath takes priority.",
        })
      ),
      text: Type.Optional(
        Type.String({
          description: "Source text content. Used when filePath is empty.",
        })
      ),
      patch: Type.String({
        description:
          "Unified diff patch content. Contains @@ hunk headers and +/- prefixed change lines. May include one or more hunks.",
      }),
      writeBack: Type.Optional(
        Type.Boolean({
          description: "Whether to write the patched result back to the source file. Only available when filePath is provided. Default false.",
        })
      ),
    }),

    execute: async (_toolCallId, params) => {
      const patchText = params.patch;
      if (!patchText || !patchText.trim()) {
        return toolError("Please provide unified diff patch content (patch).", {
          errorCode: "APPLY_PATCH_NO_PATCH",
        });
      }

      let source = "";
      let sourceLabel = "";
      let resolvedPath = null;

      // Read source text
      if (params.filePath && params.filePath.trim()) {
        const rawPath = params.filePath.trim().replace(/^['"]|['"]$/g, "");
        resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
        try {
          source = fs.readFileSync(resolvedPath, "utf-8");
          sourceLabel = path.basename(resolvedPath);
        } catch (err) {
          return toolError(`Failed to read source file: ${err.message}`, {
            errorCode: "APPLY_PATCH_READ_FAILED",
            path: resolvedPath,
          });
        }
      } else if (params.text !== undefined && params.text !== null) {
        source = params.text;
        sourceLabel = "(input text)";
      } else {
        return toolError("Please provide a source file path (filePath) or source text content (text).", {
          errorCode: "APPLY_PATCH_NO_SOURCE",
        });
      }

      // Parse patch
      const { hunks } = parsePatch(patchText);
      if (hunks.length === 0) {
        return toolError("Failed to parse any hunks from patch content. Check unified diff format.", {
          errorCode: "APPLY_PATCH_NO_HUNKS",
        });
      }

      // Apply patch
      const { result, applied, failed, warnings } = applyHunks(source, hunks);

      // Write back to file
      let writeResult = null;
      if (params.writeBack && resolvedPath) {
        try {
          fs.writeFileSync(resolvedPath, result, "utf-8");
          writeResult = { written: true, path: resolvedPath };
        } catch (err) {
          return toolError(`Failed to write back to file: ${err.message}`, {
            errorCode: "APPLY_PATCH_WRITE_FAILED",
            path: resolvedPath,
          });
        }
      }

      // Build summary
      const title = `🔧 Patch result${sourceLabel ? `: ${sourceLabel}` : ""}`;
      const lines = [
        title,
        "",
        `| Item | Count |`,
        `|------|-------|`,
        `| Total hunks | ${hunks.length} |`,
        `| Applied | ${applied} |`,
        `| Skipped (no match) | ${failed} |`,
      ];

      if (warnings.length > 0) {
        lines.push("", ...warnings.map((w) => `⚠️ ${w}`));
      }

      if (writeResult) {
        lines.push("", `✅ Written back to file: ${writeResult.path}`);
      }

      // Non-write-back mode: return full patched text
      if (!writeResult) {
        lines.push("", "--- Patched text ---", "", "```", result, "```");
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
