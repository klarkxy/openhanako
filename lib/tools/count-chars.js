/**
 * count-chars.js — Character count tool
 *
 * Count Chinese characters (Han script), total characters, and UTF-8 byte size
 * in a text or file. Supports inline text or file path input.
 *
 * When to use:
 * - User asks to count words or characters
 * - User asks about the length of a text/document
 * - Writing scenarios where word count targets need to be checked
 * - Code/document review where file size is relevant
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "../pi-sdk/index.js";
import { t } from "../../server/i18n.js";

export const COUNT_CHARS_TOOL_NAME = "count_chars";

/**
 * 判断一个字符是否为 CJK 汉字（Unicode Script=Han）
 */
function isHanChar(ch) {
  return /\p{Script=Han}/u.test(ch);
}

/**
 * 创建 count_chars 工具定义
 */
export function createCountCharsTool() {
  return {
    name: COUNT_CHARS_TOOL_NAME,
    label: t("toolDef.countChars.label"),
    description: t("toolDef.countChars.description"),
    promptSnippet: "Count Chinese characters, total chars, and UTF-8 bytes in a text or file",
    promptGuidelines: [
      "Use count_chars to count Chinese characters (Han script) and total characters instead of writing bash/perl/python one-liners",
    ],
    parameters: Type.Object({
      filePath: Type.Optional(Type.String({
        description: t("toolDef.countChars.filePathDesc"),
      })),
      text: Type.Optional(Type.String({
        description: t("toolDef.countChars.textDesc"),
      })),
    }),

    execute: async (_toolCallId, params) => {
      let source = "";
      let sourceLabel = "";

      // 优先读取文件
      if (params.filePath && params.filePath.trim()) {
        const rawPath = params.filePath.trim();
        const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);

        try {
          source = fs.readFileSync(resolved, "utf-8");
          sourceLabel = path.basename(resolved);
        } catch (err) {
          return {
            content: [{ type: "text", text: `${t("toolDef.countChars.errorRead")} ${err.message}` }],
            details: { error: err.message },
          };
        }
      } else if (params.text && params.text.trim()) {
        source = params.text;
        sourceLabel = t("toolDef.countChars.inputText");
      } else {
        return {
          content: [{ type: "text", text: t("toolDef.countChars.errorNoInput") }],
          details: {},
        };
      }

      const totalChars = source.length;
      let hanChars = 0;

      for (const ch of source) {
        if (isHanChar(ch)) hanChars++;
      }

      const nonHanChars = totalChars - hanChars;
      const byteLength = Buffer.byteLength(source, "utf-8");

      const title = `${t("toolDef.countChars.resultTitle")}${sourceLabel ? `：${sourceLabel}` : ""}`;
      const lines = [
        title,
        "",
        `| ${t("toolDef.countChars.colItem")} | ${t("toolDef.countChars.colCount")} |`,
        `|------|------|`,
        `| ${t("toolDef.countChars.rowHan")} | ${hanChars.toLocaleString()} |`,
        `| ${t("toolDef.countChars.rowNonHan")} | ${nonHanChars.toLocaleString()} |`,
        `| ${t("toolDef.countChars.rowTotal")} | ${totalChars.toLocaleString()} |`,
        `| ${t("toolDef.countChars.rowBytes")} | ${byteLength.toLocaleString()} |`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { hanChars, totalChars, nonHanChars, byteLength, sourceLabel },
      };
    },
  };
}
