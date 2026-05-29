/**
 * dirty-json.js — Lenient JSON repair for LLM outputs
 *
 * When LLMs produce malformed JSON (trailing commas, unquoted keys,
 * truncated strings, extra text around JSON, etc.), this module
 * attempts to repair it into valid JSON before falling back.
 *
 * Strategy:
 *   1. Try JSON.parse directly (fast path)
 *   2. Strip markdown fences and extract JSON substring
 *   3. Fix common LLM JSON errors
 *   4. Try progressive truncation from the end (for truncated responses)
 *   5. Return null if all attempts fail
 */

// ─── Step 1: Direct parse ────────────────────────────────

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ─── Step 2: Extract JSON from surrounding text ──────────

function extractJsonString(text) {
  const trimmed = text.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Find first { or [ and its matching closing bracket
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  let start = -1;
  let openChar, closeChar;

  if (firstBrace === -1 && firstBracket === -1) return trimmed;

  if (firstBrace === -1) {
    start = firstBracket; openChar = "["; closeChar = "]";
  } else if (firstBracket === -1) {
    start = firstBrace; openChar = "{"; closeChar = "}";
  } else if (firstBrace < firstBracket) {
    start = firstBrace; openChar = "{"; closeChar = "}";
  } else {
    start = firstBracket; openChar = "["; closeChar = "]";
  }

  // Walk from the end to find the matching close bracket
  let depth = 0;
  let end = -1;
  for (let i = trimmed.length - 1; i >= start; i--) {
    if (trimmed[i] === closeChar) {
      if (depth === 0) { end = i; break; }
      depth--;
    }
    if (trimmed[i] === openChar) depth++;
  }

  if (end > start) return trimmed.slice(start, end + 1);
  return trimmed.slice(start);
}

// ─── Step 3: Fix common LLM JSON errors ──────────────────

function fixCommonErrors(text) {
  let s = text;

  // Remove single-line comments (// ...)
  s = s.replace(/\/\/[^\n]*/g, "");

  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, "$1");

  // Fix unquoted keys: { key: "value" } → { "key": "value" }
  // Match word chars + colon after { or ,
  s = s.replace(/([,{]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');

  // Fix single-quoted strings to double-quoted
  // This is tricky; do a simple pass that handles common cases
  s = fixSingleQuotes(s);

  // Fix undefined / NaN / Infinity (not valid JSON)
  s = s.replace(/:\s*undefined\b/g, ": null");
  s = s.replace(/:\s*NaN\b/g, ": null");
  s = s.replace(/:\s*Infinity\b/g, ": null");
  s = s.replace(/:\s*-Infinity\b/g, ": null");

  // Fix trailing text after the closing bracket
  // (some LLMs add commentary after JSON)
  s = trimTrailingJunk(s);

  return s;
}

function fixSingleQuotes(s) {
  // Simple state machine to convert single-quoted strings to double-quoted
  const chars = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '"') {
      // Skip double-quoted string
      chars.push(s[i++]);
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') { chars.push(s[i++]); }
        if (i < s.length) chars.push(s[i++]);
      }
      if (i < s.length) chars.push(s[i++]);
    } else if (s[i] === "'") {
      // Convert single-quoted to double-quoted
      chars.push('"');
      i++;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\') {
          chars.push(s[i++]);
          if (i < s.length) chars.push(s[i++]);
        } else if (s[i] === '"') {
          chars.push('\\"'); // Escape embedded double quotes
          i++;
        } else {
          chars.push(s[i++]);
        }
      }
      if (i < s.length) { chars.push('"'); i++; }
    } else {
      chars.push(s[i++]);
    }
  }
  return chars.join("");
}

function trimTrailingJunk(s) {
  // Find the last } or ] and trim everything after it (ignoring whitespace)
  const lastClose = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastClose >= 0) {
    return s.slice(0, lastClose + 1);
  }
  return s;
}

// ─── Step 4: Progressive truncation repair ───────────────
// For truncated JSON (LLM hit token limit), try closing open brackets

function tryCloseBrackets(text) {
  const s = text.trim();

  // Count unclosed brackets
  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    if (ch === '}') { if (stack[stack.length - 1] === '{') stack.pop(); }
    if (ch === ']') { if (stack[stack.length - 1] === '[') stack.pop(); }
  }

  if (stack.length === 0) return s; // Already balanced

  let repaired = s;

  // If we're inside a string, close it first
  if (inString) repaired += '"';

  // Remove any trailing comma or colon (incomplete key/value)
  repaired = repaired.replace(/,\s*$/, "");
  repaired = repaired.replace(/:\s*$/, "");

  // Remove trailing partial value after a colon:
  // e.g. {"a": 1, "b": "partial  →  {"a": 1, "b": "partial"
  // e.g. {"a": 1, "b": 123abc   →  {"a": 1, "b": 123
  repaired = repaired.replace(/:\s*"[^"]*$/, ':""');
  repaired = repaired.replace(/:\s*(\d+)[^,\]}]*$/, ":$1");

  // Remove trailing partial key (unquoted)
  repaired = repaired.replace(/,\s*[a-zA-Z_$][a-zA-Z0-9_$]*$/, "");

  // Close remaining brackets (innermost first)
  while (stack.length > 0) {
    const open = stack.pop();
    repaired += open === '{' ? '}' : ']';
  }

  return repaired;
}

// ─── Step 5: Fix unescaped control chars in strings ──────

function fixControlChars(s) {
  // Replace literal newlines/tabs inside JSON strings with escaped versions
  // This handles LLMs that put raw newlines in string values
  const chars = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { chars.push(ch); escape = false; continue; }
    if (ch === '\\' && inString) { chars.push(ch); escape = true; continue; }
    if (ch === '"') { inString = !inString; chars.push(ch); continue; }

    if (inString) {
      if (ch === '\n') { chars.push('\\n'); continue; }
      if (ch === '\r') { chars.push('\\r'); continue; }
      if (ch === '\t') { chars.push('\\t'); continue; }
    }
    chars.push(ch);
  }
  return chars.join("");
}

// ─── Main entry point ────────────────────────────────────

/**
 * Attempt to parse potentially malformed JSON from LLM output.
 *
 * @param {string} raw - Raw text that should contain JSON
 * @returns {{ value: any, repaired: boolean } | null}
 *   - value: the parsed object/array
 *   - repaired: true if repair was needed
 *   - null if all attempts fail
 */
export function dirtyParse(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Fast path: valid JSON
  const direct = tryParse(trimmed);
  if (direct !== undefined) return { value: direct, repaired: false };

  // Extract JSON substring from markdown fences or surrounding text
  const extracted = extractJsonString(trimmed);

  // Try extracted as-is
  const fromExtracted = tryParse(extracted);
  if (fromExtracted !== undefined) return { value: fromExtracted, repaired: true };

  // Fix common errors
  const fixed = fixCommonErrors(extracted);
  const fromFixed = tryParse(fixed);
  if (fromFixed !== undefined) return { value: fromFixed, repaired: true };

  // Fix control chars then try again
  const fixedCtrl = fixControlChars(fixed);
  const fromFixedCtrl = tryParse(fixedCtrl);
  if (fromFixedCtrl !== undefined) return { value: fromFixedCtrl, repaired: true };

  // Try closing unclosed brackets (truncated JSON)
  const closed = tryCloseBrackets(fixedCtrl);
  const fromClosed = tryParse(closed);
  if (fromClosed !== undefined) return { value: fromClosed, repaired: true };

  // One more round of fixes after bracket closing
  const closedFixed = fixCommonErrors(closed);
  const fromClosedFixed = tryParse(closedFixed);
  if (fromClosedFixed !== undefined) return { value: fromClosedFixed, repaired: true };

  return null;
}

/**
 * Convenience: parse or return fallback.
 */
export function dirtyParseOr(raw, fallback = null) {
  const result = dirtyParse(raw);
  return result ? result.value : fallback;
}
