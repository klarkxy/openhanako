/**
 * json-query-tool.js — JSON/YAML query tool
 *
 * Parse JSON or YAML files and extract values by path.
 * Supports dot-notation paths, array indexing, and output formatting.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "js-yaml";
import { Type } from "../pi-sdk/index.ts";
import { toolOk, toolError } from "./tool-result.ts";

export const JSON_QUERY_TOOL_NAME = "json_query";

function isYamlFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".yaml" || ext === ".yml";
}

function parseContent(content, filePath) {
  const ext = filePath ? path.extname(filePath).toLowerCase() : "";
  if (ext === ".json" || content.trimStart().startsWith("{") || content.trimStart().startsWith("[")) {
    try {
      return { data: JSON.parse(content), format: "json" };
    } catch (err) {
      return { error: `JSON parse error: ${err.message}` };
    }
  }
  // Default to YAML
  try {
    return { data: YAML.load(content), format: "yaml" };
  } catch (err) {
    // Fallback: try JSON
    try {
      return { data: JSON.parse(content), format: "json" };
    } catch {
      return { error: `Parse error: ${err.message}` };
    }
  }
}

function getByPath(obj, dotPath) {
  if (!dotPath || !dotPath.trim()) return obj;
  const parts = dotPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    // Support array index: "items[0]" or "items.0"
    const bracketMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (bracketMatch) {
      current = current[bracketMatch[1]];
      if (current == null) return undefined;
      current = current[parseInt(bracketMatch[2], 10)];
    } else {
      current = current[part];
    }
  }
  return current;
}

function formatValue(value, pretty) {
  if (value === undefined) return { text: "(undefined)", truncated: false };
  if (value === null) return { text: "null", truncated: false };
  const str = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  const maxLen = 10000;
  if (str.length > maxLen) {
    return { text: str.slice(0, maxLen) + "\n... [truncated]", truncated: true };
  }
  return { text: str, truncated: false };
}

export function createJsonQueryTool({ getCwd } = {}) {
  return {
    name: JSON_QUERY_TOOL_NAME,
    label: "json_query",
    description:
      "Parse JSON or YAML files and extract values by dot-notation path. Supports array indexing, pretty printing, and validation. Use this instead of running jq/yq/node -e in bash.",
    promptSnippet: "Extract values from JSON/YAML files by path",
    promptGuidelines: [
      "Use json_query to read structured config files (package.json, tsconfig.yaml, etc.) instead of text_file + manual parsing",
      "Supports dot paths like 'dependencies.express' or 'scripts.build'",
      "Array indexing: 'items[0].name' or 'items.0.name'",
      "Leave path empty to see the full structure (useful for exploring unknown files)",
      "Set validate_only:true to check if a file is valid JSON/YAML without extracting",
    ],
    parameters: Type.Object({
      filePath: Type.String({
        description: "Absolute path to the JSON or YAML file.",
      }),
      path: Type.Optional(Type.String({
        description: "Dot-notation path to extract (e.g. 'scripts.build', 'dependencies[0]'). Omit to return the entire content.",
      })),
      pretty: Type.Optional(Type.Boolean({
        description: "Pretty-print the output with indentation. Default true.",
      })),
      validate_only: Type.Optional(Type.Boolean({
        description: "Only validate whether the file is valid JSON/YAML, don't extract. Default false.",
      })),
    }),

    execute: async (_toolCallId, params) => {
      const rawPath = params.filePath?.trim()?.replace(/^['"]|['"]$/g, "");
      if (!rawPath) {
        return toolError("filePath is required.", { errorCode: "JSON_QUERY_NO_PATH" });
      }
      const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(getCwd?.() || process.cwd(), rawPath);

      let content;
      try {
        content = fs.readFileSync(resolved, "utf-8");
      } catch (err) {
        return toolError(`Failed to read file: ${err.message}`, { errorCode: "JSON_QUERY_READ_FAILED", path: resolved });
      }

      const { data, format, error } = parseContent(content, resolved);
      if (error) {
        if (params.validate_only) {
          return toolOk(`❌ Invalid: ${error}`, { valid: false, error, path: resolved });
        }
        return toolError(error, { errorCode: "JSON_QUERY_PARSE_FAILED", path: resolved });
      }

      if (params.validate_only) {
        return toolOk(`✅ Valid ${format.toUpperCase()}`, { valid: true, format, path: resolved });
      }

      const queryPath = params.path || "";
      const value = getByPath(data, queryPath);

      if (value === undefined && queryPath) {
        // List available top-level keys for guidance
        const topKeys = typeof data === "object" && data !== null ? Object.keys(data).slice(0, 30) : [];
        return toolError(`Path "${queryPath}" not found in ${path.basename(resolved)}.`, {
          errorCode: "JSON_QUERY_PATH_NOT_FOUND",
          path: resolved,
          format,
          available_keys: topKeys,
        });
      }

      const pretty = params.pretty !== false;
      const { text, truncated } = formatValue(value, pretty);

      const label = queryPath
        ? `${path.basename(resolved)} → ${queryPath}`
        : path.basename(resolved);

      return toolOk(`📄 ${label}:\n\n${text}`, {
        path: resolved,
        format,
        query_path: queryPath || "(root)",
        truncated,
        value_type: Array.isArray(value) ? "array" : typeof value,
        ...(Array.isArray(value) ? { length: value.length } : {}),
      });
    },
  };
}
