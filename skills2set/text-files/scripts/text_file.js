#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

class TextFileError extends Error {
  constructor(message, { code = "error", details = {} } = {}) {
    super(message);
    this.name = "TextFileError";
    this.code = code;
    this.details = details;
  }
}

function jsonSuccess(payload) {
  return { ok: true, ...payload };
}

function jsonError(error) {
  if (error instanceof TextFileError) {
    const payload = { ok: false, error: error.message, code: error.code };
    if (error.details && Object.keys(error.details).length > 0) {
      payload.details = error.details;
    }
    return payload;
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error), code: "unexpected_error" };
}

function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function resolvePath(value) {
  return path.resolve(String(value));
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

function requireFile(value) {
  const filePath = resolvePath(value);
  const fileStat = statIfExists(filePath);
  if (!fileStat) {
    throw new TextFileError(`File not found: ${filePath}`, { code: "file_not_found" });
  }
  if (!fileStat.isFile()) {
    throw new TextFileError(`Path is not a file: ${filePath}`, { code: "not_a_file" });
  }
  return filePath;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readText(filePath, encoding) {
  return fs.readFileSync(filePath, { encoding });
}

function writeText(filePath, content, encoding) {
  const existing = statIfExists(filePath);
  if (existing && !existing.isFile()) {
    throw new TextFileError(`Path is not a file: ${filePath}`, { code: "not_a_file" });
  }
  ensureParent(filePath);
  fs.writeFileSync(filePath, content, { encoding });
}

function loadTextArg(value, fileValue, { name, encoding }) {
  if (value !== undefined && fileValue !== undefined) {
    throw new TextFileError(`${name} accepts either --${name} or --${name}-file, not both.`, { code: "invalid_argument" });
  }
  if (fileValue !== undefined) {
    return readText(requireFile(fileValue), encoding);
  }
  if (value !== undefined) {
    return value;
  }
  throw new TextFileError(`${name} requires --${name} or --${name}-file.`, { code: "missing_value" });
}

function splitLinesKeepEnds(content) {
  if (content.length === 0) {
    return [];
  }
  const lines = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\n") {
      lines.push(content.slice(start, index + 1));
      start = index + 1;
    } else if (char === "\r") {
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

function readRange(content, startLine, endLine) {
  const lines = splitLinesKeepEnds(content);
  if (startLine == null && endLine == null) {
    return { content, startLine: 1, endLine: lines.length };
  }
  if (lines.length === 0) {
    throw new TextFileError("The file is empty.", { code: "empty_file" });
  }
  const start = startLine == null ? 1 : startLine;
  const end = endLine == null ? lines.length : endLine;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    throw new TextFileError("Line numbers must be positive integers.", { code: "invalid_range" });
  }
  if (start > end) {
    throw new TextFileError("Start line must not be greater than end line.", { code: "invalid_range" });
  }
  if (start > lines.length) {
    throw new TextFileError(
      `Start line ${start} is out of range for a file with ${lines.length} line(s).`,
      { code: "line_out_of_range" },
    );
  }
  const clippedEnd = Math.min(end, lines.length);
  return {
    content: lines.slice(start - 1, clippedEnd).join(""),
    startLine: start,
    endLine: clippedEnd,
  };
}

function numberLines(content, startLine) {
  return splitLinesKeepEnds(content)
    .map((line, index) => `${String(startLine + index).padStart(6)}: ${line}`)
    .join("");
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchRegex(find, { regex, ignoreCase }) {
  const pattern = regex ? find : escapeRegExp(find);
  const flags = `gm${ignoreCase ? "i" : ""}`;
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new TextFileError(`Invalid regular expression: ${error.message}`, { code: "invalid_argument" });
  }
}

function collectMatches(content, find, options) {
  const regex = buildSearchRegex(find, options);
  return Array.from(content.matchAll(regex));
}

function replaceText(content, find, replacement, options) {
  if (!find) {
    throw new TextFileError("The find text must not be empty.", { code: "invalid_argument" });
  }
  const matches = collectMatches(content, find, options);
  if (matches.length === 0) {
    return { content, matches: 0 };
  }
  const limit = options.count == null || options.count <= 0 ? matches.length : Math.min(options.count, matches.length);
  let result = "";
  let lastIndex = 0;
  let replaced = 0;
  for (const match of matches) {
    if (replaced >= limit) {
      break;
    }
    const start = match.index ?? 0;
    const end = start + match[0].length;
    result += content.slice(lastIndex, start) + replacement;
    lastIndex = end;
    replaced += 1;
  }
  if (replaced === 0) {
    return { content, matches: 0 };
  }
  result += content.slice(lastIndex);
  return { content: result, matches: replaced };
}

function insertText(content, anchor, insertion, options) {
  if (!anchor) {
    throw new TextFileError("The anchor text must not be empty.", { code: "invalid_argument" });
  }
  const matches = collectMatches(content, anchor, options);
  if (matches.length === 0) {
    return { content, matches: 0 };
  }
  const match = options.last ? matches[matches.length - 1] : matches[0];
  const position = options.before
    ? (match.index ?? 0)
    : (match.index ?? 0) + match[0].length;
  return {
    content: content.slice(0, position) + insertion + content.slice(position),
    matches: 1,
  };
}

function toCamelCase(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parseOptions(argv) {
  const options = {};
  const positionals = [];
  const booleanFlags = new Set(["overwrite", "force", "after", "last", "regex", "ignoreCase", "numberLines", "json", "help"]);
  const valueFlags = new Set(["text", "textFile", "encoding", "find", "findFile", "replace", "replaceFile", "count", "anchor", "anchorFile", "startLine", "endLine", "maxChars"]);
  const numberFlags = new Set(["count", "startLine", "endLine", "maxChars"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token === "-h" || token === "--help") {
      options.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const raw = token.slice(2);
    const equalIndex = raw.indexOf("=");
    const name = equalIndex >= 0 ? raw.slice(0, equalIndex) : raw;
    const value = equalIndex >= 0 ? raw.slice(equalIndex + 1) : undefined;
    const key = toCamelCase(name);

    if (booleanFlags.has(key)) {
      if (value === undefined) {
        options[key] = true;
      } else {
        const lowered = value.toLowerCase();
        options[key] = !(lowered === "false" || lowered === "0" || lowered === "no" || lowered === "off");
      }
      continue;
    }

    if (valueFlags.has(key)) {
      let actual = value;
      if (actual === undefined) {
        if (index + 1 >= argv.length) {
          throw new TextFileError(`--${name} requires a value.`, { code: "invalid_argument" });
        }
        actual = argv[index + 1];
        index += 1;
      }

      if (numberFlags.has(key)) {
        const parsed = Number(actual);
        if (!Number.isInteger(parsed)) {
          throw new TextFileError(`--${name} must be an integer.`, { code: "invalid_argument" });
        }
        options[key] = parsed;
      } else {
        options[key] = actual;
      }
      continue;
    }

    throw new TextFileError(`Unknown option: --${name}`, { code: "invalid_argument" });
  }

  return { options, positionals };
}

function printHelp(command = null) {
  if (command === "read") {
    process.stdout.write(`Usage: node skills2set/text-files/scripts/text_file.js read <path> [options]\n`);
    process.stdout.write(`Options: --start-line, --end-line, --max-chars, --number-lines, --json, --encoding\n`);
    return;
  }
  if (command === "create" || command === "write" || command === "append") {
    process.stdout.write(`Usage: node skills2set/text-files/scripts/text_file.js ${command} <path> [options]\n`);
    process.stdout.write(`Options: --text, --text-file, --encoding${command === "create" ? ", --overwrite" : ""}\n`);
    return;
  }
  if (command === "replace") {
    process.stdout.write(`Usage: node skills2set/text-files/scripts/text_file.js replace <path> [options]\n`);
    process.stdout.write(`Options: --find/--find-file, --replace/--replace-file, --count, --regex, --ignore-case, --encoding\n`);
    return;
  }
  if (command === "insert") {
    process.stdout.write(`Usage: node skills2set/text-files/scripts/text_file.js insert <path> [options]\n`);
    process.stdout.write(`Options: --anchor/--anchor-file, --text/--text-file, --after, --last, --regex, --ignore-case, --encoding\n`);
    return;
  }
  if (command === "delete") {
    process.stdout.write(`Usage: node skills2set/text-files/scripts/text_file.js delete <path> [--force]\n`);
    return;
  }

  process.stdout.write(`Usage: node skills2set/text-files/scripts/text_file.js <command> [options]\n\n`);
  process.stdout.write(`Commands:\n`);
  process.stdout.write(`  read     Read a text file.\n`);
  process.stdout.write(`  create   Create a new text file.\n`);
  process.stdout.write(`  write    Overwrite a text file.\n`);
  process.stdout.write(`  append   Append text to a file.\n`);
  process.stdout.write(`  replace  Replace matching text in a file.\n`);
  process.stdout.write(`  insert   Insert text before or after an anchor.\n`);
  process.stdout.write(`  delete   Delete a file.\n`);
}

function runRead(positionals, options) {
  const filePath = requireFile(positionals[0]);
  const encoding = options.encoding ?? "utf8";
  const content = readText(filePath, encoding);
  const range = readRange(content, options.startLine, options.endLine);
  let output = range.content;
  if (options.numberLines) {
    output = numberLines(output, range.startLine);
  }
  const rendered = applyMaxChars(output, options.maxChars);
  if (options.json) {
    emitJson(
      jsonSuccess({
        action: "read",
        path: filePath,
        encoding,
        start_line: range.startLine,
        end_line: range.endLine,
        line_count: splitLinesKeepEnds(rendered.content).length,
        character_count: rendered.content.length,
        truncated: rendered.truncated,
        content: rendered.content,
      }),
    );
  } else {
    process.stdout.write(rendered.content);
  }
  return 0;
}

function runCreate(positionals, options) {
  const filePath = resolvePath(positionals[0]);
  const encoding = options.encoding ?? "utf8";
  const existing = statIfExists(filePath);
  if (existing && !existing.isFile()) {
    throw new TextFileError(`Path is not a file: ${filePath}`, { code: "not_a_file" });
  }
  if (existing && !options.overwrite) {
    throw new TextFileError(`File already exists: ${filePath}`, { code: "file_exists" });
  }
  const content = loadTextArg(options.text, options.textFile, { name: "text", encoding });
  writeText(filePath, content, encoding);
  emitJson(
    jsonSuccess({
      action: "create",
      path: filePath,
      encoding,
      characters_written: content.length,
      created: !existing,
      overwritten: !!existing && !!options.overwrite,
    }),
  );
  return 0;
}

function runWrite(positionals, options) {
  const filePath = resolvePath(positionals[0]);
  const encoding = options.encoding ?? "utf8";
  const existing = statIfExists(filePath);
  const content = loadTextArg(options.text, options.textFile, { name: "text", encoding });
  writeText(filePath, content, encoding);
  emitJson(
    jsonSuccess({
      action: "write",
      path: filePath,
      encoding,
      characters_written: content.length,
      created: !existing,
      overwritten: !!existing,
    }),
  );
  return 0;
}

function runAppend(positionals, options) {
  const filePath = resolvePath(positionals[0]);
  const encoding = options.encoding ?? "utf8";
  const existing = statIfExists(filePath);
  if (existing && !existing.isFile()) {
    throw new TextFileError(`Path is not a file: ${filePath}`, { code: "not_a_file" });
  }
  const addition = loadTextArg(options.text, options.textFile, { name: "text", encoding });
  const current = existing ? readText(filePath, encoding) : "";
  writeText(filePath, current + addition, encoding);
  emitJson(
    jsonSuccess({
      action: "append",
      path: filePath,
      encoding,
      characters_appended: addition.length,
      created: !existing,
    }),
  );
  return 0;
}

function runReplace(positionals, options) {
  const filePath = requireFile(positionals[0]);
  const encoding = options.encoding ?? "utf8";
  if (options.count != null && options.count < 0) {
    throw new TextFileError("count must not be negative.", { code: "invalid_argument" });
  }
  const content = readText(filePath, encoding);
  const find = loadTextArg(options.find, options.findFile, { name: "find", encoding });
  const replacement = loadTextArg(options.replace, options.replaceFile, { name: "replace", encoding });
  const updated = replaceText(content, find, replacement, {
    count: options.count,
    regex: !!options.regex,
    ignoreCase: !!options.ignoreCase,
  });
  if (updated.matches === 0) {
    throw new TextFileError("No matches found for replacement.", { code: "no_match" });
  }
  writeText(filePath, updated.content, encoding);
  emitJson(
    jsonSuccess({
      action: "replace",
      path: filePath,
      encoding,
      matches: updated.matches,
      changed: updated.content !== content,
      characters_before: content.length,
      characters_after: updated.content.length,
      regex: !!options.regex,
      ignore_case: !!options.ignoreCase,
      count: options.count == null || options.count === 0 ? "all" : options.count,
    }),
  );
  return 0;
}

function runInsert(positionals, options) {
  const filePath = requireFile(positionals[0]);
  const encoding = options.encoding ?? "utf8";
  const content = readText(filePath, encoding);
  const anchor = loadTextArg(options.anchor, options.anchorFile, { name: "anchor", encoding });
  const insertion = loadTextArg(options.text, options.textFile, { name: "text", encoding });
  const updated = insertText(content, anchor, insertion, {
    before: !options.after,
    last: !!options.last,
    regex: !!options.regex,
    ignoreCase: !!options.ignoreCase,
  });
  if (updated.matches === 0) {
    throw new TextFileError("The anchor text was not found.", { code: "no_match" });
  }
  writeText(filePath, updated.content, encoding);
  emitJson(
    jsonSuccess({
      action: "insert",
      path: filePath,
      encoding,
      inserted_bytes: insertion.length,
      changed: updated.content !== content,
      before: !options.after,
      last: !!options.last,
      regex: !!options.regex,
      ignore_case: !!options.ignoreCase,
    }),
  );
  return 0;
}

function runDelete(positionals, options) {
  const filePath = resolvePath(positionals[0]);
  const existing = statIfExists(filePath);
  if (!existing) {
    if (options.force) {
      emitJson(jsonSuccess({ action: "delete", path: filePath, deleted: false, missing: true }));
      return 0;
    }
    throw new TextFileError(`File not found: ${filePath}`, { code: "file_not_found" });
  }
  if (!existing.isFile()) {
    throw new TextFileError(`Path is not a file: ${filePath}`, { code: "not_a_file" });
  }
  fs.unlinkSync(filePath);
  emitJson(jsonSuccess({ action: "delete", path: filePath, deleted: true }));
  return 0;
}

const COMMANDS = {
  read: runRead,
  create: runCreate,
  write: runWrite,
  append: runAppend,
  replace: runReplace,
  insert: runInsert,
  delete: runDelete,
};

function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    printHelp();
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    throw new TextFileError(`Unknown command: ${command}`, { code: "invalid_argument" });
  }

  const { options, positionals } = parseOptions(rest);
  if (options.help) {
    printHelp(command);
    return 0;
  }
  if (positionals.length === 0) {
    throw new TextFileError(`Missing file path for ${command}.`, { code: "missing_value" });
  }
  return handler(positionals, options);
}

try {
  const exitCode = main();
  process.exitCode = exitCode;
} catch (error) {
  emitJson(jsonError(error));
  process.exitCode = 1;
}