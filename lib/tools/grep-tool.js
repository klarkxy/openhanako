/**
 * grep-tool.js — grep search tool
 *
 * Search file contents across a directory tree using text or regex patterns.
 * Returns matching lines with file paths, line numbers, and context.
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "../pi-sdk/index.js";
import { toolOk, toolError } from "./tool-result.js";

export const GREP_TOOL_NAME = "grep";

const DEFAULT_MAX_RESULTS = 50;
const MAX_CONTEXT_LINES = 5;
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv", ".webm",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".pyc", ".pyo", ".class", ".o", ".obj",
]);

function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function buildRegex(pattern, { regex, ignoreCase }) {
  if (regex) {
    try {
      const flags = `gm${ignoreCase ? "i" : ""}`;
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = `gm${ignoreCase ? "i" : ""}`;
  return new RegExp(escaped, flags);
}

function collectFilePaths(dirPath, { includePattern, excludePattern, maxDepth, currentDepth }) {
  if (currentDepth > maxDepth) return [];
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const name = entry.name;
      if (name === "node_modules" || name === ".git" || name === "__pycache__" || name === ".next" || name === "dist" || name === "build") continue;
      if (excludePattern && new RegExp(excludePattern).test(fullPath)) continue;
      results.push(...collectFilePaths(fullPath, { includePattern, excludePattern, maxDepth, currentDepth: currentDepth + 1 }));
    } else if (entry.isFile()) {
      if (isBinaryFile(entry.name)) continue;
      if (includePattern) {
        try {
          if (!new RegExp(includePattern).test(entry.name)) continue;
        } catch { /* invalid pattern — skip filter */ }
      }
      if (excludePattern) {
        try {
          if (new RegExp(excludePattern).test(fullPath)) continue;
        } catch { /* invalid pattern — skip filter */ }
      }
      results.push(fullPath);
    }
  }
  return results;
}

export function createGrepTool({ getCwd } = {}) {
  return {
    name: GREP_TOOL_NAME,
    label: "grep",
    description:
      "Search file contents across a directory tree using text or regex patterns. Returns matching lines with file paths, line numbers, and optional context lines. Use this instead of running grep/rg/Select-String in bash.",
    promptSnippet: "Search file contents by text or regex pattern across a directory",
    promptGuidelines: [
      "Use grep to search for code patterns, function names, variable references, or text across the project",
      "Supports regex mode (regex:true) and case-insensitive matching (ignore_case:true)",
      "Use includePattern to filter by filename (e.g. '\\.js$' for JS files only)",
      "Use excludePattern to skip directories or files (e.g. 'test|spec')",
      "For searching within a single file, use text_file action=find instead",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description: "The search pattern (plain text or regex).",
      }),
      path: Type.Optional(Type.String({
        description: "Directory or file path to search in. Defaults to current working directory.",
      })),
      regex: Type.Optional(Type.Boolean({
        description: "Interpret pattern as a regex. Default false.",
      })),
      ignore_case: Type.Optional(Type.Boolean({
        description: "Case-insensitive matching. Default false.",
      })),
      includePattern: Type.Optional(Type.String({
        description: "Regex to filter filenames (e.g. '\\.ts$' for TypeScript files only).",
      })),
      excludePattern: Type.Optional(Type.String({
        description: "Regex to exclude paths (e.g. 'node_modules|dist').",
      })),
      context: Type.Optional(Type.Number({
        description: "Number of context lines before and after each match (0-5). Default 0.",
      })),
      max_results: Type.Optional(Type.Number({
        description: "Maximum number of match lines to return (1-500). Default 50.",
      })),
      max_depth: Type.Optional(Type.Number({
        description: "Maximum directory recursion depth (0-20). Default 10.",
      })),
    }),

    execute: async (_toolCallId, params) => {
      const pattern = params.pattern;
      if (!pattern || !pattern.trim()) {
        return toolError("Pattern must not be empty.", { errorCode: "GREP_EMPTY_PATTERN" });
      }

      const cwd = getCwd?.() || process.cwd();
      const targetPath = params.path ? (path.isAbsolute(params.path) ? params.path : path.resolve(cwd, params.path)) : cwd;
      const maxResults = params.max_results != null ? Math.max(1, Math.min(500, params.max_results)) : DEFAULT_MAX_RESULTS;
      const contextLines = params.context != null ? Math.max(0, Math.min(MAX_CONTEXT_LINES, params.context)) : 0;
      const maxDepth = params.max_depth != null ? Math.max(0, Math.min(20, params.max_depth)) : 10;

      const re = buildRegex(pattern, { regex: !!params.regex, ignoreCase: !!params.ignore_case });
      if (!re) {
        return toolError("Invalid regex pattern.", { errorCode: "GREP_INVALID_REGEX", pattern });
      }

      // Determine if target is a single file or directory
      let stat;
      try {
        stat = fs.statSync(targetPath);
      } catch {
        return toolError(`Path not found: ${targetPath}`, { errorCode: "GREP_PATH_NOT_FOUND", path: targetPath });
      }

      let files;
      if (stat.isFile()) {
        files = [targetPath];
      } else {
        files = collectFilePaths(targetPath, {
          includePattern: params.includePattern || null,
          excludePattern: params.excludePattern || null,
          maxDepth,
          currentDepth: 0,
        });
      }

      const matches = [];
      let filesSearched = 0;
      let truncated = false;

      for (const filePath of files) {
        if (truncated) break;
        let content;
        try {
          content = fs.readFileSync(filePath, "utf-8");
        } catch {
          continue;
        }
        filesSearched++;
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0;
          if (!re.test(lines[i])) continue;

          const entry = {
            file: filePath,
            line: i + 1,
            text: lines[i],
          };
          if (contextLines > 0) {
            const ctxBefore = [];
            for (let c = Math.max(0, i - contextLines); c < i; c++) {
              ctxBefore.push(lines[c]);
            }
            const ctxAfter = [];
            for (let c = i + 1; c <= Math.min(lines.length - 1, i + contextLines); c++) {
              ctxAfter.push(lines[c]);
            }
            entry.context_before = ctxBefore;
            entry.context_after = ctxAfter;
          }
          matches.push(entry);
          if (matches.length >= maxResults) {
            truncated = true;
            break;
          }
        }
      }

      // Format output
      const outputLines = [];
      if (matches.length === 0) {
        outputLines.push(`No matches found for "${pattern}" in ${filesSearched} file(s).`);
      } else {
        outputLines.push(`Found ${matches.length} match(es)${truncated ? ` (showing first ${maxResults})` : ""} in ${filesSearched} file(s):`);
        outputLines.push("");
        for (const m of matches) {
          const relPath = path.relative(targetPath, m.file);
          outputLines.push(`${relPath}:${m.line}: ${m.text}`);
          if (m.context_before?.length) {
            for (const ctx of m.context_before) {
              outputLines.push(`  ${ctx}`);
            }
          }
          if (m.context_after?.length) {
            for (const ctx of m.context_after) {
              outputLines.push(`  ${ctx}`);
            }
          }
        }
      }

      return toolOk(outputLines.join("\n"), {
        pattern,
        path: targetPath,
        regex: !!params.regex,
        ignore_case: !!params.ignore_case,
        files_searched: filesSearched,
        match_count: matches.length,
        truncated,
        matches,
      });
    },
  };
}
