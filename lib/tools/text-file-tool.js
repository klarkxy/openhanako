import fs from "fs";
import path from "path";
import { Type } from "../pi-sdk/index.ts";
import { toolError, toolOk } from "./tool-result.ts";
import { getToolSessionPath } from "./tool-session.ts";
import { serializeSessionFile } from "../session-files/session-file-response.ts";

const DIAG_ENABLED = process.env.HANA_DIAG === "1";
function diag(...args) {
  if (!DIAG_ENABLED) return;
  // 单行 + 用 \t 分隔方便 grep
  // eslint-disable-next-line no-console
  console.log(`[text-file]`, ...args);
}

export const TEXT_FILE_TOOL_NAME = "text_file";

const TEXT_FILE_ACTIONS = new Set([
  "read",
  "create",
  "write",
  "append",
  "replace",
  "insert",
  "line_insert",
  "line_delete",
  "delete",
  "batch",
  "find",
]);

const TEXT_FILE_READ_ACTIONS = new Set(["read"]);
const TEXT_FILE_WRITE_ACTIONS = new Set([
  "create",
  "write",
  "append",
  "replace",
  "insert",
  "line_insert",
  "line_delete",
]);
const TEXT_FILE_DELETE_ACTIONS = new Set(["delete"]);
const TEXT_FILE_LINE_ACTIONS = new Set(["line_insert", "line_delete"]);
const TEXT_FILE_BATCH_BLOCKED_ACTIONS = new Set(["batch", "line_insert", "line_delete"]);

function textFileOperationShape() {
  return Type.Object({
    action: Type.String({ description: "One of: create, write, append, replace, insert, delete." }),
    path: Type.String({ description: "Target file path for this batch item." }),
    text: Type.Optional(Type.String({ description: "Literal text payload." })),
    find: Type.Optional(Type.String({ description: "Find text for replace." })),
    replace: Type.Optional(Type.String({ description: "Replacement text for replace." })),
    anchor: Type.Optional(Type.String({ description: "Anchor text for insert." })),
    after: Type.Optional(Type.Boolean({ description: "For insert: place text after the anchor." })),
    last: Type.Optional(Type.Boolean({ description: "For insert: target the last anchor match." })),
    regex: Type.Optional(Type.Boolean({ description: "Interpret find/anchor as a regex." })),
    ignore_case: Type.Optional(Type.Boolean({ description: "Case-insensitive matching for replace/insert." })),
    count: Type.Optional(Type.Number({ description: "Maximum replacements to apply. Omit or 0 for all." })),
    encoding: Type.Optional(Type.String({ description: "Text encoding. Defaults to utf8." })),
    overwrite: Type.Optional(Type.Boolean({ description: "Allow create to overwrite an existing file." })),
    force: Type.Optional(Type.Boolean({ description: "Ignore missing file on delete." })),
  });
}

function normalizePathInput(value) {
  let text = String(value || "").trim();
  text = text.replace(/^['"]|['"]$/g, "");
  if (text.includes("%20")) {
    try {
      text = decodeURIComponent(text);
    } catch {}
  }
  return text;
}

export function normalizeTextFileAction(action) {
  const normalized = typeof action === "string" ? action.trim().toLowerCase() : "";
  return TEXT_FILE_ACTIONS.has(normalized) ? normalized : "";
}

export function isTextFileReadAction(action) {
  return TEXT_FILE_READ_ACTIONS.has(normalizeTextFileAction(action));
}

export function isTextFileDeleteAction(action) {
  return TEXT_FILE_DELETE_ACTIONS.has(normalizeTextFileAction(action));
}

export function isTextFileMutationAction(action) {
  const normalized = normalizeTextFileAction(action);
  return TEXT_FILE_WRITE_ACTIONS.has(normalized) || TEXT_FILE_DELETE_ACTIONS.has(normalized) || normalized === "batch";
}

export function resolveTextFilePath(rawPath, cwd) {
  const value = normalizePathInput(rawPath);
  if (!value) return null;
  // Handle Windows absolute paths (e.g. C:\outside\note.md) even on non-Windows platforms
  if (/^[A-Za-z]:[/\\]/.test(value)) return value;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(cwd || process.cwd(), value);
}

export function collectTextFilePathChecks(params = {}, cwd = process.cwd()) {
  const checks = new Map();

  function remember(filePath, operation) {
    const resolved = resolveTextFilePath(filePath, cwd);
    if (!resolved || !operation) return;
    checks.set(`${operation}:${resolved}`, { path: resolved, operation });
  }

  function collectOne(input) {
    const action = normalizeTextFileAction(input?.action);
    if (!action) return;
    if (action === "batch") {
      for (const operation of Array.isArray(input.operations) ? input.operations : []) {
        collectOne(operation);
      }
      return;
    }
    if (isTextFileReadAction(action)) {
      remember(input.path, "read");
      return;
    }
    if (isTextFileDeleteAction(action)) {
      remember(input.path, "delete");
      return;
    }
    if (isTextFileMutationAction(action)) {
      remember(input.path, "write");
    }
  }

  collectOne(params);
  return [...checks.values()];
}

export function collectTextFileMutationPaths(params = {}, cwd = process.cwd()) {
  const unique = new Map();
  for (const check of collectTextFilePathChecks(params, cwd)) {
    if (check.operation === "read") continue;
    if (!unique.has(check.path) || check.operation === "delete") {
      unique.set(check.path, { path: check.path, operation: check.operation });
    }
  }
  return [...unique.values()];
}

function statIfExists(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function ensureFilePath(filePath) {
  const stat = statIfExists(filePath);
  if (!stat) {
    return { ok: false, text: `File not found: ${filePath}`, details: { errorCode: "TEXT_FILE_NOT_FOUND", path: filePath } };
  }
  if (!stat.isFile()) {
    return { ok: false, text: `Path is not a file: ${filePath}`, details: { errorCode: "TEXT_FILE_NOT_A_FILE", path: filePath } };
  }
  return { ok: true, stat };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readText(filePath, encoding) {
  const t0 = Date.now();
  try {
    const text = fs.readFileSync(filePath, { encoding });
    diag(`readText path=${filePath} bytes=${Buffer.byteLength(text, encoding)} elapsed=${Date.now() - t0}ms`);
    return text;
  } catch (err) {
    diag(`readText FAIL path=${filePath} elapsed=${Date.now() - t0}ms err=${err?.code || err?.message || err}`);
    throw err;
  }
}

function writeText(filePath, content, encoding) {
  ensureParentDir(filePath);
  const t0 = Date.now();
  try {
    fs.writeFileSync(filePath, content, { encoding });
    diag(`writeText path=${filePath} bytes=${Buffer.byteLength(content, encoding)} elapsed=${Date.now() - t0}ms`);
  } catch (err) {
    diag(`writeText FAIL path=${filePath} elapsed=${Date.now() - t0}ms err=${err?.code || err?.message || err}`);
    throw err;
  }
}

function splitLinesKeepEnds(content) {
  if (content.length === 0) return [];
  const lines = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\n") {
      lines.push(content.slice(start, index + 1));
      start = index + 1;
      continue;
    }
    if (char === "\r") {
      if (content[index + 1] === "\n") {
        lines.push(content.slice(start, index + 2));
        index += 1;
      } else {
        lines.push(content.slice(start, index + 1));
      }
      start = index + 1;
    }
  }
  if (start < content.length) {
    lines.push(content.slice(start));
  }
  return lines;
}

function applyMaxChars(content, maxChars) {
  if (!Number.isInteger(maxChars) || maxChars <= 0 || content.length <= maxChars) {
    return { content, truncated: false };
  }
  let snippet = content.slice(0, maxChars);
  if (snippet && !snippet.endsWith("\n")) {
    snippet += "\n";
  }
  snippet += "[truncated]\n";
  return { content: snippet, truncated: true };
}

function numberLines(content, startLine) {
  return splitLinesKeepEnds(content)
    .map((line, index) => `${String(startLine + index).padStart(6)}: ${line}`)
    .join("");
}

function readRange(content, startLine, endLine) {
  const lines = splitLinesKeepEnds(content);
  if (startLine == null && endLine == null) {
    return { content, startLine: 1, endLine: lines.length, totalLines: lines.length };
  }
  if (lines.length === 0) {
    return { content: "", startLine: 1, endLine: 0, totalLines: 0 };
  }
  const start = startLine == null ? 1 : startLine;
  const end = endLine == null ? lines.length : endLine;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    return { error: "Line numbers must be positive integers.", errorCode: "TEXT_FILE_INVALID_RANGE" };
  }
  if (start > end) {
    return { error: "Start line must not be greater than end line.", errorCode: "TEXT_FILE_INVALID_RANGE" };
  }
  if (start > lines.length) {
    return {
      error: `Start line ${start} is out of range for a file with ${lines.length} line(s).`,
      errorCode: "TEXT_FILE_LINE_OUT_OF_RANGE",
    };
  }
  const clippedEnd = Math.min(end, lines.length);
  return {
    content: lines.slice(start - 1, clippedEnd).join(""),
    startLine: start,
    endLine: clippedEnd,
    totalLines: lines.length,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchRegex(find, { regex, ignoreCase }) {
  const pattern = regex ? find : escapeRegExp(find);
  const flags = `gm${ignoreCase ? "i" : ""}`;
  return new RegExp(pattern, flags);
}

function collectMatches(content, find, options) {
  return Array.from(content.matchAll(buildSearchRegex(find, options)));
}

function replaceText(content, find, replacement, options) {
  if (!find) {
    return { error: "The find text must not be empty.", errorCode: "TEXT_FILE_INVALID_ARGUMENT" };
  }
  const matches = collectMatches(content, find, options);
  if (matches.length === 0) {
    return { error: "No matches found for replacement.", errorCode: "TEXT_FILE_NO_MATCH" };
  }
  const limit = options.count == null || options.count <= 0 ? matches.length : Math.min(options.count, matches.length);
  let result = "";
  let lastIndex = 0;
  let replaced = 0;
  for (const match of matches) {
    if (replaced >= limit) break;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    result += content.slice(lastIndex, start) + replacement;
    lastIndex = end;
    replaced += 1;
  }
  result += content.slice(lastIndex);
  return { content: result, matches: replaced };
}

function insertAtAnchor(content, anchor, insertion, options) {
  if (!anchor) {
    return { error: "The anchor text must not be empty.", errorCode: "TEXT_FILE_INVALID_ARGUMENT" };
  }
  const matches = collectMatches(content, anchor, options);
  if (matches.length === 0) {
    return { error: "The anchor text was not found.", errorCode: "TEXT_FILE_NO_MATCH" };
  }
  const match = options.last ? matches[matches.length - 1] : matches[0];
  const position = options.after
    ? (match.index ?? 0) + match[0].length
    : (match.index ?? 0);
  return {
    content: content.slice(0, position) + insertion + content.slice(position),
    matches: 1,
  };
}

function insertAtLine(content, line, insertion, after) {
  if (!Number.isInteger(line) || line < 1) {
    return { error: "line must be a positive integer.", errorCode: "TEXT_FILE_INVALID_RANGE" };
  }
  const lines = splitLinesKeepEnds(content);
  if (lines.length === 0) {
    if (line !== 1) {
      return { error: "Empty files only support line 1 for line_insert.", errorCode: "TEXT_FILE_LINE_OUT_OF_RANGE" };
    }
    return { content: insertion, insertedAt: 1 };
  }

  if (after) {
    if (line > lines.length) {
      return { error: `Line ${line} is out of range for a file with ${lines.length} line(s).`, errorCode: "TEXT_FILE_LINE_OUT_OF_RANGE" };
    }
    const index = line;
    return {
      content: lines.slice(0, index).join("") + insertion + lines.slice(index).join(""),
      insertedAt: line + 1,
    };
  }

  if (line > lines.length + 1) {
    return { error: `Line ${line} is out of range for a file with ${lines.length} line(s).`, errorCode: "TEXT_FILE_LINE_OUT_OF_RANGE" };
  }
  const index = line - 1;
  return {
    content: lines.slice(0, index).join("") + insertion + lines.slice(index).join(""),
    insertedAt: line,
  };
}

function deleteLineRange(content, startLine, endLine) {
  const lines = splitLinesKeepEnds(content);
  if (lines.length === 0) {
    return { error: "The file is empty.", errorCode: "TEXT_FILE_EMPTY_FILE" };
  }
  const start = startLine == null ? null : startLine;
  const end = endLine == null ? start : endLine;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    return { error: "start_line and end_line must be positive integers.", errorCode: "TEXT_FILE_INVALID_RANGE" };
  }
  if (start > end) {
    return { error: "start_line must not be greater than end_line.", errorCode: "TEXT_FILE_INVALID_RANGE" };
  }
  if (start > lines.length) {
    return { error: `Line ${start} is out of range for a file with ${lines.length} line(s).`, errorCode: "TEXT_FILE_LINE_OUT_OF_RANGE" };
  }
  const clippedEnd = Math.min(end, lines.length);
  return {
    content: lines.slice(0, start - 1).join("") + lines.slice(clippedEnd).join(""),
    deletedStartLine: start,
    deletedEndLine: clippedEnd,
    deletedLineCount: clippedEnd - start + 1,
  };
}

function success(text, details = {}, touchedFiles = []) {
  return { ok: true, text, details, touchedFiles };
}

function failure(text, details = {}) {
  return { ok: false, text, details };
}

function countLines(content) {
  return content.length === 0 ? 0 : splitLinesKeepEnds(content).length;
}

function mergeTouchedFiles(entries = []) {
  const merged = new Map();
  for (const entry of entries) {
    if (!entry?.path) continue;
    const previous = merged.get(entry.path);
    if (!previous) {
      merged.set(entry.path, { ...entry });
      continue;
    }
    if (entry.operation === "deleted") {
      merged.set(entry.path, { ...entry });
      continue;
    }
    if (previous.operation === "created") {
      merged.set(entry.path, { ...entry, operation: "created" });
      continue;
    }
    merged.set(entry.path, { ...entry });
  }
  return [...merged.values()];
}

async function registerTouchedFiles(touchedFiles, { sessionPath, registerSessionFile }) {
  if (!sessionPath || typeof registerSessionFile !== "function") return [];
  const results = [];
  for (const entry of mergeTouchedFiles(touchedFiles)) {
    if (!entry?.path || entry.operation === "deleted") continue;
    const stat = statIfExists(entry.path);
    if (!stat || !stat.isFile()) continue;
    const sessionFile = await registerSessionFile({
      sessionPath,
      filePath: entry.path,
      label: path.basename(entry.path),
      origin: "agent_text_file",
      operation: entry.operation,
    });
    const serialized = serializeSessionFile(sessionFile);
    if (serialized) results.push(serialized);
  }
  return results;
}

async function executeSingleAction(params, context) {
  const action = normalizeTextFileAction(params.action);
  const cwd = context.cwd || process.cwd();
  const encoding = params.encoding || "utf8";
  // Aliases: oldText ↔ find, newText ↔ replace (Pi SDK edit compatibility)
  if (params.oldText !== undefined && params.find === undefined) params.find = params.oldText;
  if (params.newText !== undefined && params.replace === undefined) params.replace = params.newText;
  const filePath = resolveTextFilePath(params.path, cwd);

  if (!action) {
    return failure("text_file action must be one of: read, create, write, append, replace, insert, line_insert, line_delete, delete, batch.", {
      errorCode: "TEXT_FILE_INVALID_ACTION",
    });
  }
  if (action === "batch") {
    return failure("batch must be handled by the top-level text_file executor.", {
      errorCode: "TEXT_FILE_INVALID_ACTION",
    });
  }
  // find can operate on inline text without requiring a file path
  if (!filePath && action !== "find") {
    return failure("path is required.", { errorCode: "TEXT_FILE_PATH_REQUIRED" });
  }

  try {
    if (action === "read") {
      const fileCheck = ensureFilePath(filePath);
      if (!fileCheck.ok) return failure(fileCheck.text, fileCheck.details);
      const content = readText(filePath, encoding);
      const range = readRange(content, params.start_line, params.end_line);
      if (range.error) {
        return failure(range.error, { errorCode: range.errorCode, path: filePath });
      }
      let output = range.content;
      if (params.number_lines) {
        output = numberLines(output, range.startLine);
      }
      const rendered = applyMaxChars(output, params.max_chars);
      return success(rendered.content || "(empty file)", {
        action,
        path: filePath,
        encoding,
        content: rendered.content,
        truncated: rendered.truncated,
        start_line: range.startLine,
        end_line: range.endLine,
        total_lines: range.totalLines,
        line_count: countLines(rendered.content),
        character_count: rendered.content.length,
        number_lines: !!params.number_lines,
      });
    }

    if (action === "create") {
      const existing = statIfExists(filePath);
      if (existing && !existing.isFile()) {
        return failure(`Path is not a file: ${filePath}`, { errorCode: "TEXT_FILE_NOT_A_FILE", path: filePath });
      }
      if (existing && !params.overwrite) {
        return failure(`File already exists: ${filePath}`, { errorCode: "TEXT_FILE_ALREADY_EXISTS", path: filePath });
      }
      const content = typeof params.text === "string" ? params.text : "";
      writeText(filePath, content, encoding);
      return success(`Created ${filePath}.`, {
        action,
        path: filePath,
        encoding,
        created: !existing,
        overwritten: !!existing,
        characters_written: content.length,
      }, [{ path: filePath, operation: existing ? "modified" : "created" }]);
    }

    if (action === "write") {
      const existing = statIfExists(filePath);
      if (existing && !existing.isFile()) {
        return failure(`Path is not a file: ${filePath}`, { errorCode: "TEXT_FILE_NOT_A_FILE", path: filePath });
      }
      const content = typeof params.text === "string" ? params.text : "";
      writeText(filePath, content, encoding);
      return success(`Wrote ${content.length} character(s) to ${filePath}.`, {
        action,
        path: filePath,
        encoding,
        created: !existing,
        overwritten: !!existing,
        characters_written: content.length,
      }, [{ path: filePath, operation: existing ? "modified" : "created" }]);
    }

    if (action === "append") {
      const existing = statIfExists(filePath);
      if (existing && !existing.isFile()) {
        return failure(`Path is not a file: ${filePath}`, { errorCode: "TEXT_FILE_NOT_A_FILE", path: filePath });
      }
      const addition = typeof params.text === "string" ? params.text : "";
      const current = existing ? readText(filePath, encoding) : "";
      writeText(filePath, current + addition, encoding);
      return success(`Appended ${addition.length} character(s) to ${filePath}.`, {
        action,
        path: filePath,
        encoding,
        created: !existing,
        characters_appended: addition.length,
      }, [{ path: filePath, operation: existing ? "modified" : "created" }]);
    }

    if (action === "replace") {
      const fileCheck = ensureFilePath(filePath);
      if (!fileCheck.ok) return failure(fileCheck.text, fileCheck.details);
      if (params.count != null && (!Number.isInteger(params.count) || params.count < 0)) {
        return failure("count must be a non-negative integer.", { errorCode: "TEXT_FILE_INVALID_ARGUMENT", path: filePath });
      }
      const content = readText(filePath, encoding);
      const updated = replaceText(content, params.find || "", params.replace || "", {
        count: params.count,
        regex: !!params.regex,
        ignoreCase: !!params.ignore_case,
      });
      if (updated.error) {
        return failure(updated.error, { errorCode: updated.errorCode, path: filePath });
      }
      writeText(filePath, updated.content, encoding);
      return success(`Replaced ${updated.matches} match(es) in ${filePath}.`, {
        action,
        path: filePath,
        encoding,
        matches: updated.matches,
        regex: !!params.regex,
        ignore_case: !!params.ignore_case,
        count: params.count == null || params.count === 0 ? "all" : params.count,
        characters_before: content.length,
        characters_after: updated.content.length,
      }, [{ path: filePath, operation: "modified" }]);
    }

    if (action === "insert") {
      const fileCheck = ensureFilePath(filePath);
      if (!fileCheck.ok) return failure(fileCheck.text, fileCheck.details);
      const content = readText(filePath, encoding);
      const updated = insertAtAnchor(content, params.anchor || "", typeof params.text === "string" ? params.text : "", {
        after: !!params.after,
        last: !!params.last,
        regex: !!params.regex,
        ignoreCase: !!params.ignore_case,
      });
      if (updated.error) {
        return failure(updated.error, { errorCode: updated.errorCode, path: filePath });
      }
      writeText(filePath, updated.content, encoding);
      return success(`Inserted text into ${filePath}.`, {
        action,
        path: filePath,
        encoding,
        matches: updated.matches,
        after: !!params.after,
        last: !!params.last,
        regex: !!params.regex,
        ignore_case: !!params.ignore_case,
        inserted_characters: String(params.text || "").length,
      }, [{ path: filePath, operation: "modified" }]);
    }

    if (action === "line_insert") {
      const fileCheck = ensureFilePath(filePath);
      if (!fileCheck.ok) return failure(fileCheck.text, fileCheck.details);
      const content = readText(filePath, encoding);
      const updated = insertAtLine(content, params.line, typeof params.text === "string" ? params.text : "", !!params.after);
      if (updated.error) {
        return failure(updated.error, { errorCode: updated.errorCode, path: filePath });
      }
      writeText(filePath, updated.content, encoding);
      return success(`Inserted text at line ${updated.insertedAt} in ${filePath}.`, {
        action,
        path: filePath,
        encoding,
        line: params.line,
        after: !!params.after,
        inserted_at: updated.insertedAt,
        inserted_characters: String(params.text || "").length,
      }, [{ path: filePath, operation: "modified" }]);
    }

    if (action === "line_delete") {
      const fileCheck = ensureFilePath(filePath);
      if (!fileCheck.ok) return failure(fileCheck.text, fileCheck.details);
      const content = readText(filePath, encoding);
      const updated = deleteLineRange(content, params.start_line, params.end_line);
      if (updated.error) {
        return failure(updated.error, { errorCode: updated.errorCode, path: filePath });
      }
      writeText(filePath, updated.content, encoding);
      return success(`Deleted ${updated.deletedLineCount} line(s) from ${filePath}.`, {
        action,
        path: filePath,
        encoding,
        start_line: updated.deletedStartLine,
        end_line: updated.deletedEndLine,
        deleted_line_count: updated.deletedLineCount,
      }, [{ path: filePath, operation: "modified" }]);
    }

    if (action === "delete") {
      const existing = statIfExists(filePath);
      if (!existing) {
        if (params.force) {
          return success(`File already missing: ${filePath}.`, {
            action,
            path: filePath,
            deleted: false,
            missing: true,
            force: true,
          });
        }
        return failure(`File not found: ${filePath}`, { errorCode: "TEXT_FILE_NOT_FOUND", path: filePath });
      }
      if (!existing.isFile()) {
        return failure(`Path is not a file: ${filePath}`, { errorCode: "TEXT_FILE_NOT_A_FILE", path: filePath });
      }
      fs.unlinkSync(filePath);
      return success(`Deleted ${filePath}.`, {
        action,
        path: filePath,
        deleted: true,
      }, [{ path: filePath, operation: "deleted" }]);
    }

    if (action === "find") {
      const find = params.find || "";
      if (!find) {
        return failure("The find text must not be empty.", { errorCode: "TEXT_FILE_INVALID_ARGUMENT", path: filePath });
      }
      // Two modes: read from file or use inline text parameter
      let source = "";
      let sourceLabel = "";
      if (filePath) {
        const fileCheck = ensureFilePath(filePath);
        if (!fileCheck.ok) return failure(fileCheck.text, fileCheck.details);
        source = readText(filePath, encoding);
        sourceLabel = filePath;
      } else if (params.text !== undefined && params.text !== null) {
        source = params.text;
        sourceLabel = "(input text)";
      } else {
        return failure("Either path or text is required for find.", { errorCode: "TEXT_FILE_PATH_REQUIRED" });
      }
      const matches = collectMatches(source, find, {
        regex: !!params.regex,
        ignoreCase: !!params.ignore_case,
      });
      if (matches.length === 0) {
        return success(`No matches found for "${find}" in ${sourceLabel}.`, {
          action,
          path: filePath,
          find,
          regex: !!params.regex,
          ignore_case: !!params.ignore_case,
          match_count: 0,
          matches: [],
        });
      }
      const lines = splitLinesKeepEnds(source);
      // Build line offset index for line number lookup
      const lineStarts = [];
      let offset = 0;
      for (const line of lines) {
        lineStarts.push(offset);
        offset += line.length;
      }
      // Compute line numbers and context for each match
      const contextLines = params.context != null ? Math.max(0, Math.min(10, params.context)) : 1;
      const matchDetails = [];
      for (const match of matches) {
        const matchStart = match.index ?? 0;
        const matchEnd = matchStart + match[0].length;
        // Find line number
        let lineNo = 0;
        for (let i = lineStarts.length - 1; i >= 0; i--) {
          if (lineStarts[i] <= matchStart) { lineNo = i; break; }
        }
        const contextStart = Math.max(0, lineNo - contextLines);
        const contextEnd = Math.min(lines.length, lineNo + contextLines + 1);
        const contextSnippet = lines.slice(contextStart, contextEnd).join("").replace(/\n$/, "");
        matchDetails.push({
          line: lineNo + 1,  // 1-based
          column: matchStart - lineStarts[lineNo] + 1,  // 1-based
          matched_text: match[0],
          context: contextSnippet,
        });
      }
      const limit = params.max_results != null ? Math.max(1, Math.min(200, params.max_results)) : 50;
      const truncated = matchDetails.length > limit;
      const returned = truncated ? matchDetails.slice(0, limit) : matchDetails;
      const summaryLines = [
        `🔍 Found ${matches.length} match(es)${truncated ? ` (showing first ${limit})` : ""} in ${sourceLabel}`,
        "",
        ...returned.map((m) => `  Line ${m.line} Col ${m.column}: \`${m.matched_text}\``),
      ];
      return success(summaryLines.join("\n"), {
        action,
        path: filePath,
        find,
        regex: !!params.regex,
        ignore_case: !!params.ignore_case,
        match_count: matches.length,
        truncated,
        matches: returned,
      });
    }

    return failure(`Unsupported action: ${action}`, { errorCode: "TEXT_FILE_INVALID_ACTION" });
  } catch (error) {
    return failure(error?.message || String(error), {
      errorCode: "TEXT_FILE_EXECUTION_FAILED",
      path: filePath,
      action,
    });
  }
}

export function createTextFileTool({ getCwd, getSessionPath, registerSessionFile } = {}) {
  return {
    name: TEXT_FILE_TOOL_NAME,
    label: "text_file",
    description: "Read, write, replace, insert, delete, find, and batch-edit plain text files. This is the PRIMARY tool for all text file operations — prefer it over bash/Python/Node scripts, the edit tool, and the write tool. Supports regex, case-insensitive matching, line-based operations, and transactional batches.",
    promptSnippet: "PRIMARY text file tool — use this (not bash/Python) for reading, writing, replacing, inserting, deleting, finding, or batch-editing text files",
    promptGuidelines: [
      "ALWAYS use text_file for text file operations. NEVER use bash/Python/Node for reading, writing, replacing, inserting, or deleting text in files",
      "Use text_file action=read to read files — it is deterministic and won't be truncated. Prefer it over the 'read' tool for text content",
      "Use text_file action=find to search for text or regex patterns in a file or inline text — returns match locations with line numbers and context",
      "For search-and-replace, use text_file action=replace with find + replace. For adding content near markers, use action=insert with anchor + text",
      "For multiple sequential edits to the SAME file, use text_file action=batch with an operations array. Each operation runs in order on the same file. The batch can include reads mixed with writes",
      "Use oldText (alias for find) and newText (alias for replace) when migrating from Pi SDK edit — they work the same way",
      "text_file supports regex matching (regex:true), case-insensitive matching (ignore_case:true), and line-based operations",
      "Only use bash with sed/awk/Python for text when you need complex multi-line regex transformations that text_file replace cannot express",
    ],
    parameters: Type.Object({
      action: Type.String({ description: "One of: read, find, create, write, append, replace, insert, line_insert, line_delete, delete, batch." }),
      path: Type.Optional(Type.String({ description: "Target file path, absolute or relative to the current session cwd." })),
      text: Type.Optional(Type.String({ description: "Literal text payload for create, write, append, insert, or line_insert. Also used as inline source text for find when no path is given." })),
      find: Type.Optional(Type.String({ description: "Search pattern for find or replace." })),
      replace: Type.Optional(Type.String({ description: "Replacement text for replace." })),
      anchor: Type.Optional(Type.String({ description: "Anchor text for insert." })),
      start_line: Type.Optional(Type.Number({ description: "1-based start line for read or line_delete." })),
      end_line: Type.Optional(Type.Number({ description: "1-based end line for read or line_delete." })),
      line: Type.Optional(Type.Number({ description: "1-based line number for line_insert." })),
      after: Type.Optional(Type.Boolean({ description: "For insert or line_insert: place text after the target instead of before it." })),
      last: Type.Optional(Type.Boolean({ description: "For insert: target the last matching anchor instead of the first." })),
      regex: Type.Optional(Type.Boolean({ description: "Interpret find or anchor as a regex for find, replace, or insert." })),
      ignore_case: Type.Optional(Type.Boolean({ description: "Case-insensitive matching for find, replace, or insert." })),
      count: Type.Optional(Type.Number({ description: "Maximum replacements to apply. Omit or 0 for all." })),
      encoding: Type.Optional(Type.String({ description: "Text encoding. Defaults to utf8." })),
      oldText: Type.Optional(Type.String({ description: "Alias for find; works with action=replace." })),
      newText: Type.Optional(Type.String({ description: "Alias for replace; works with action=replace." })),
      max_chars: Type.Optional(Type.Number({ description: "Maximum characters to return for read." })),
      number_lines: Type.Optional(Type.Boolean({ description: "Include line numbers in read output." })),
      overwrite: Type.Optional(Type.Boolean({ description: "Allow create to overwrite an existing file." })),
      force: Type.Optional(Type.Boolean({ description: "Ignore missing file on delete." })),
      context: Type.Optional(Type.Number({ description: "For find: number of context lines around each match (0-10). Default 1." })),
      max_results: Type.Optional(Type.Number({ description: "For find: maximum number of matches to return (1-200). Default 50." })),
      operations: Type.Optional(Type.Array(textFileOperationShape(), {
        description: "For batch: sequential non-line edit operations. line_insert and line_delete are intentionally rejected in batch mode to avoid line-number drift.",
      })),
    }),
    execute: async (_toolCallId, params = {}, _signal, _onUpdate, ctx) => {
      const action = normalizeTextFileAction(params.action);
      const cwd = ctx?.sessionManager?.getCwd?.() || getCwd?.() || process.cwd();
      const sessionPath = getToolSessionPath(ctx) || ctx?.sessionPath || getSessionPath?.() || null;
      const t0 = Date.now();
      diag(`tool start action=${action} path=${params.path} batchOps=${Array.isArray(params.operations) ? params.operations.length : 0}`);

      if (!action) {
        return toolError("text_file action must be one of: read, create, write, append, replace, insert, line_insert, line_delete, delete, batch.", {
          errorCode: "TEXT_FILE_INVALID_ACTION",
        });
      }

      if (action === "batch") {
        const operations = Array.isArray(params.operations) ? params.operations : [];
        if (operations.length === 0) {
          return toolError("batch requires a non-empty operations array.", {
            errorCode: "TEXT_FILE_BATCH_REQUIRED",
          });
        }

        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index] || {};
          const subAction = normalizeTextFileAction(operation.action);
          if (!subAction) {
            return toolError(`batch operation ${index + 1} has an invalid action.`, {
              errorCode: "TEXT_FILE_INVALID_ACTION",
              completed_operations: 0,
              failed_operation_index: index,
              results: [],
            });
          }
          if (TEXT_FILE_BATCH_BLOCKED_ACTIONS.has(subAction)) {
            return toolError(`batch does not allow ${subAction}; run reads and line-based edits as separate tool calls to avoid ambiguous sequencing.`, {
              errorCode: "TEXT_FILE_BATCH_LINE_UNSAFE",
              completed_operations: 0,
              failed_operation_index: index,
              results: [],
            });
          }
        }

        const completed = [];
        const touchedFiles = [];
        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index] || {};
          const subAction = normalizeTextFileAction(operation.action);
          const result = await executeSingleAction(operation, { cwd });
          if (!result.ok) {
            const sessionFiles = await registerTouchedFiles(touchedFiles, { sessionPath, registerSessionFile });
            return toolError(result.text, {
              ...(result.details || {}),
              completed_operations: completed.length,
              failed_operation_index: index,
              results: completed,
              sessionFiles,
            });
          }
          completed.push(result.details);
          touchedFiles.push(...(result.touchedFiles || []));
        }

        const sessionFiles = await registerTouchedFiles(touchedFiles, { sessionPath, registerSessionFile });
        return toolOk(`Applied ${completed.length} text file operation(s).`, {
          action,
          results: completed,
          sessionFiles,
        });
      }

      const result = await executeSingleAction(params, { cwd });
      diag(`tool end action=${action} ok=${result.ok} elapsed=${Date.now() - t0}ms`);
      if (!result.ok) {
        return toolError(result.text, result.details || {});
      }
      const sessionFiles = await registerTouchedFiles(result.touchedFiles, { sessionPath, registerSessionFile });
      return toolOk(result.text, {
        ...(result.details || {}),
        ...(sessionFiles.length ? { sessionFiles } : {}),
      });
    },
  };
}
