import { describe, expect, it } from "vitest";
import { dirtyParse, dirtyParseOr } from "../lib/dirty-json.js";

describe("dirtyParse", () => {
  // ── Fast path: valid JSON ──────────────────────────────

  it("parses valid JSON directly (repaired=false)", () => {
    const result = dirtyParse('{"name":"hana","version":1}');
    expect(result).not.toBeNull();
    expect(result.repaired).toBe(false);
    expect(result.value).toEqual({ name: "hana", version: 1 });
  });

  it("parses valid JSON array", () => {
    const result = dirtyParse("[1, 2, 3]");
    expect(result).not.toBeNull();
    expect(result.repaired).toBe(false);
    expect(result.value).toEqual([1, 2, 3]);
  });

  // ── Null / empty inputs ────────────────────────────────

  it("returns null for empty string", () => {
    expect(dirtyParse("")).toBeNull();
  });

  it("returns null for whitespace-only", () => {
    expect(dirtyParse("   \n\t  ")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(dirtyParse(null)).toBeNull();
    expect(dirtyParse(undefined)).toBeNull();
    expect(dirtyParse(42)).toBeNull();
  });

  // ── Markdown fence extraction ──────────────────────────

  it("extracts JSON from ```json fence", () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = dirtyParse(input);
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ key: "value" });
    expect(result.repaired).toBe(true);
  });

  it("extracts JSON from plain ``` fence", () => {
    const input = '```\n{"x": 1}\n```';
    const result = dirtyParse(input);
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ x: 1 });
  });

  // ── Trailing commas ────────────────────────────────────

  it("fixes trailing comma in object", () => {
    const result = dirtyParse('{"a": 1, "b": 2,}');
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ a: 1, b: 2 });
  });

  it("fixes trailing comma in array", () => {
    const result = dirtyParse("[1, 2, 3,]");
    expect(result).not.toBeNull();
    expect(result.value).toEqual([1, 2, 3]);
  });

  // ── Unquoted keys ──────────────────────────────────────

  it("fixes unquoted keys", () => {
    const result = dirtyParse('{name: "hana", version: 1}');
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ name: "hana", version: 1 });
  });

  // ── Single-quoted strings ──────────────────────────────

  it("fixes single-quoted strings", () => {
    const result = dirtyParse("{'key': 'value'}");
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ key: "value" });
  });

  it("fixes single-quoted strings with embedded double quotes", () => {
    const result = dirtyParse("{'key': 'say \"hello\"'}");
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ key: 'say "hello"' });
  });

  // ── undefined / NaN / Infinity ─────────────────────────

  it("replaces undefined with null", () => {
    const result = dirtyParse('{"a": undefined}');
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ a: null });
  });

  it("replaces NaN with null", () => {
    const result = dirtyParse('{"a": NaN}');
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ a: null });
  });

  it("replaces Infinity with null", () => {
    const result = dirtyParse('{"a": Infinity, "b": -Infinity}');
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ a: null, b: null });
  });

  // ── Control characters in strings ──────────────────────

  it("fixes literal newlines inside strings", () => {
    const result = dirtyParse('{"text": "line1\nline2"}');
    expect(result).not.toBeNull();
    expect(result.value.text).toBe("line1\nline2");
  });

  // ── Trailing text after JSON ───────────────────────────

  it("trims trailing commentary after JSON", () => {
    const input = '{"result": true} Here is my analysis of the code...';
    const result = dirtyParse(input);
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ result: true });
  });

  // ── Truncated JSON (bracket closing) ───────────────────

  it("closes unclosed object", () => {
    const result = dirtyParse('{"a": 1, "b": {"c": 2');
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ a: 1, b: { c: 2 } });
  });

  it("closes unclosed array", () => {
    const result = dirtyParse('[1, 2, {"a": 3');
    expect(result).not.toBeNull();
    expect(result.value).toEqual([1, 2, { a: 3 }]);
  });

  it("closes unclosed string in truncated JSON", () => {
    const result = dirtyParse('{"key": "partial_val');
    expect(result).not.toBeNull();
    expect(result.value).toHaveProperty("key");
  });

  // ── Comments ───────────────────────────────────────────

  it("removes single-line comments", () => {
    const input = '{\n  "a": 1, // this is a comment\n  "b": 2\n}';
    const result = dirtyParse(input);
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ a: 1, b: 2 });
  });

  // ── Nested structures ──────────────────────────────────

  it("handles complex nested structure with multiple issues", () => {
    const input = `{
      name: 'test',
      items: [1, 2, 3,],
      config: {
        debug: true,
        value: undefined,
      },
    }`;
    const result = dirtyParse(input);
    expect(result).not.toBeNull();
    expect(result.value.name).toBe("test");
    expect(result.value.items).toEqual([1, 2, 3]);
    expect(result.value.config.debug).toBe(true);
    expect(result.value.config.value).toBeNull();
  });

  // ── Surrounding text extraction ────────────────────────

  it("extracts JSON from surrounding LLM text", () => {
    const input = 'Sure! Here is the result:\n{"answer": 42}\nLet me know if you need more.';
    const result = dirtyParse(input);
    expect(result).not.toBeNull();
    expect(result.value).toEqual({ answer: 42 });
  });
});

describe("dirtyParseOr", () => {
  it("returns parsed value on success", () => {
    expect(dirtyParseOr('{"a": 1}')).toEqual({ a: 1 });
  });

  it("returns fallback on failure", () => {
    expect(dirtyParseOr("not json at all", { fallback: true })).toEqual({ fallback: true });
  });

  it("returns null fallback by default", () => {
    expect(dirtyParseOr("!!!")).toBeNull();
  });
});
