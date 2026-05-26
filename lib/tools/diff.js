/**
 * diff.js — 文件差异比较工具
 *
 * 对比两个文件的差异，输出 unified diff 格式。
 * 纯 JavaScript 实现，不依赖外部 diff 二进制，跨平台一致。
 *
 * 使用时机：
 * - 用户要求对比两个文件
 * - 需要查看某个文件的修改变化
 * - 写作/代码审阅场景中需要对比版本差异
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "../pi-sdk/index.js";
import { t } from "../../server/i18n.js";

export const DIFF_TOOL_NAME = "diff";

/**
 * 简化的 Myers diff 启发式实现
 * 产生人类可读的 diff 输出
 */
function simpleDiff(oldLines, newLines) {
  const result = [];
  const oldLen = oldLines.length;
  const newLen = newLines.length;

  let i = 0, j = 0;

  while (i < oldLen || j < newLen) {
    // 跳过相同的行
    let eqCount = 0;
    while (i + eqCount < oldLen && j + eqCount < newLen && oldLines[i + eqCount] === newLines[j + eqCount]) {
      eqCount++;
    }

    if (eqCount > 0) {
      if (eqCount <= 6) {
        for (let k = 0; k < eqCount; k++) {
          result.push({ type: "equal", text: oldLines[i + k], oldNum: i + k + 1, newNum: j + k + 1 });
        }
      } else {
        // 长段相同时只展示首尾
        result.push({ type: "equal", text: oldLines[i], oldNum: i + 1, newNum: j + 1 });
        if (eqCount > 2) {
          result.push({ type: "skip", count: eqCount - 2 });
        }
        result.push({ type: "equal", text: oldLines[i + eqCount - 1], oldNum: i + eqCount, newNum: j + eqCount });
      }
      i += eqCount;
      j += eqCount;
      continue;
    }

    // 找到下一个匹配点
    let bestMatchDist = Infinity;
    let bestOldIdx = -1;
    let bestNewIdx = -1;

    // 在旧文件中找新文件当前行
    const searchLimit = Math.min(50, oldLen - i);
    for (let oi = i; oi < i + searchLimit && oi < oldLen; oi++) {
      const nextNewIdx = newLines.indexOf(oldLines[oi], j);
      if (nextNewIdx >= j) {
        const dist = (oi - i) + (nextNewIdx - j);
        if (dist < bestMatchDist) {
          bestMatchDist = dist;
          bestOldIdx = oi;
          bestNewIdx = nextNewIdx;
        }
      }
    }

    // 在新文件中找旧文件当前行
    const newSearchLimit = Math.min(50, newLen - j);
    for (let nj = j; nj < j + newSearchLimit && nj < newLen; nj++) {
      const nextOldIdx = oldLines.indexOf(newLines[nj], i);
      if (nextOldIdx >= i) {
        const dist = (nextOldIdx - i) + (nj - j);
        if (dist < bestMatchDist) {
          bestMatchDist = dist;
          bestOldIdx = nextOldIdx;
          bestNewIdx = nj;
        }
      }
    }

    if (bestMatchDist === Infinity || bestMatchDist > 100) {
      // 没有近邻匹配，全部视为删除+新增
      while (i < oldLen) {
        result.push({ type: "del", text: oldLines[i], oldNum: i + 1 });
        i++;
      }
      while (j < newLen) {
        result.push({ type: "add", text: newLines[j], newNum: j + 1 });
        j++;
      }
      break;
    }

    // 输出差异
    for (let oi = i; oi < bestOldIdx; oi++) {
      result.push({ type: "del", text: oldLines[oi], oldNum: oi + 1 });
    }
    for (let nj = j; nj < bestNewIdx; nj++) {
      result.push({ type: "add", text: newLines[nj], newNum: nj + 1 });
    }

    // 匹配行
    result.push({ type: "equal", text: oldLines[bestOldIdx], oldNum: bestOldIdx + 1, newNum: bestNewIdx + 1 });
    i = bestOldIdx + 1;
    j = bestNewIdx + 1;
  }

  return result;
}

/**
 * 格式化 diff 为 unified diff 风格输出
 */
function formatUnifiedDiff(diffOps, oldLabel, newLabel, oldLines, newLines) {
  const lines = [];
  lines.push(`--- ${oldLabel}`);
  lines.push(`+++ ${newLabel}`);

  // 收集 hunks
  const hunks = [];
  let currentHunk = null;

  for (const op of diffOps) {
    if (op.type === "skip") {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      continue;
    }

    if (!currentHunk) {
      currentHunk = { ops: [] };
    }

    currentHunk.ops.push(op);

    // 连续相等行超过 6 行就断开 hunk
    if (op.type === "equal") {
      let eqCount = 0;
      for (let k = currentHunk.ops.length - 1; k >= 0; k--) {
        if (currentHunk.ops[k].type === "equal") eqCount++;
        else break;
      }
      if (eqCount >= 6) {
        // 保留前 3 行相等作为上下文
        const keep = currentHunk.ops.splice(currentHunk.ops.length - eqCount + 3);
        if (currentHunk.ops.length > 0) hunks.push(currentHunk);
        currentHunk = keep.length > 0 && keep.some(o => o.type !== "equal")
          ? { ops: keep }
          : null;
      }
    }
  }
  if (currentHunk && currentHunk.ops.length > 0) hunks.push(currentHunk);

  // 输出 hunks
  for (const hunk of hunks) {
    // 计算范围
    let oldStart = Infinity, oldCount = 0;
    let newStart = Infinity, newCount = 0;

    for (const op of hunk.ops) {
      if (op.type === "del" || op.type === "equal") {
        if (op.oldNum < oldStart) oldStart = op.oldNum;
        oldCount++;
      }
      if (op.type === "add" || op.type === "equal") {
        if (op.newNum < newStart) newStart = op.newNum;
        newCount++;
      }
    }

    const oldRange = oldStart === Infinity ? "0,0" : oldCount === 1 ? `${oldStart}` : `${oldStart},${oldCount}`;
    const newRange = newStart === Infinity ? "0,0" : newCount === 1 ? `${newStart}` : `${newStart},${newCount}`;
    lines.push(`@@ -${oldRange} +${newRange} @@`);

    for (const op of hunk.ops) {
      switch (op.type) {
        case "equal": lines.push(` ${op.text}`); break;
        case "del": lines.push(`-${op.text}`); break;
        case "add": lines.push(`+${op.text}`); break;
      }
    }
  }

  return lines;
}

/**
 * 创建 diff 工具定义
 */
export function createDiffTool() {
  return {
    name: DIFF_TOOL_NAME,
    label: t("toolDef.diff.label"),
    description: t("toolDef.diff.description"),
    promptSnippet: "Compare two files and show differences in unified diff format (prefer this over bash diff)",
    promptGuidelines: [
      "Prefer the diff tool over 'bash diff' for file comparison — it's cross-platform and doesn't need a system diff binary",
    ],
    parameters: Type.Object({
      filePathA: Type.String({
        description: t("toolDef.diff.filePathADesc"),
      }),
      filePathB: Type.String({
        description: t("toolDef.diff.filePathBDesc"),
      }),
      context: Type.Optional(Type.Number({
        description: t("toolDef.diff.contextDesc"),
      })),
    }),

    execute: async (_toolCallId, params) => {
      const rawA = (params.filePathA || "").trim();
      const rawB = (params.filePathB || "").trim();

      if (!rawA || !rawB) {
        return {
          content: [{ type: "text", text: t("toolDef.diff.errorNoPaths") }],
          details: {},
        };
      }

      const resolvePath = (p) => path.isAbsolute(p) ? p : path.resolve(p);
      const pathA = resolvePath(rawA);
      const pathB = resolvePath(rawB);

      let contentA, contentB;
      try {
        contentA = fs.readFileSync(pathA, "utf-8");
      } catch (err) {
        return {
          content: [{ type: "text", text: `${t("toolDef.diff.errorRead")} ${pathA}: ${err.message}` }],
          details: { error: err.message },
        };
      }
      try {
        contentB = fs.readFileSync(pathB, "utf-8");
      } catch (err) {
        return {
          content: [{ type: "text", text: `${t("toolDef.diff.errorRead")} ${pathB}: ${err.message}` }],
          details: { error: err.message },
        };
      }

      if (contentA === contentB) {
        return {
          content: [{ type: "text", text: t("toolDef.diff.noDifference") }],
          details: { identical: true },
        };
      }

      const oldLines = contentA.split("\n");
      const newLines = contentB.split("\n");
      const ops = simpleDiff(oldLines, newLines);
      const labelA = path.basename(pathA);
      const labelB = path.basename(pathB);

      const diffOutput = formatUnifiedDiff(ops, labelA, labelB, oldLines, newLines);

      // 统计
      let added = 0, deleted = 0;
      for (const op of ops) {
        if (op.type === "add") added++;
        if (op.type === "del") deleted++;
      }

      const header = `\`\`\`diff\n${diffOutput.join("\n")}\n\`\`\``;

      const summary = t("toolDef.diff.summary")
        .replace("{added}", added.toString())
        .replace("{deleted}", deleted.toString());

      return {
        content: [{ type: "text", text: `${summary}\n\n${header}` }],
        details: { added, deleted, pathA, pathB },
      };
    },
  };
}
