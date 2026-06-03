import { describe, expect, it } from "vitest";

import {
  buildDeferredResultInterludeBlock,
  extractDeferredResultDetailMarkdown,
} from "../server/deferred-result-interlude.js";

describe("deferred result interlude", () => {
  it("uses subagent metadata for readable source labels", () => {
    const block = buildDeferredResultInterludeBlock({
      taskId: "subagent-1",
      status: "success",
      result: "整理完成",
      meta: {
        type: "subagent",
        executorAgentNameSnapshot: "明",
        summary: "大纲评估",
      },
    }, { receiverName: "小花" });

    expect(block).toMatchObject({
      type: "interlude",
      taskId: "subagent-1",
      sourceKind: "subagent",
      sourceLabel: "明 · 大纲评估",
      text: "小花收到了来自 明 · 大纲评估 的回复",
      detailMarkdown: "整理完成",
    });
  });

  it("peels human-readable fields out of structured tool results", () => {
    const detail = extractDeferredResultDetailMarkdown({
      status: "success",
      result: {
        ok: true,
        sessionFiles: [
          { label: "report.md", kind: "markdown" },
        ],
        raw: { nested: "kept out while better fields exist" },
      },
    });

    expect(detail).toContain("生成文件");
    expect(detail).toContain("report.md");
    expect(detail).toContain("ok: true");
    expect(detail).not.toContain("kept out");
  });

  it("summarizes file-only tool results without dumping raw JSON", () => {
    const detail = extractDeferredResultDetailMarkdown({
      status: "success",
      result: {
        sessionFiles: [
          { label: "generated.png", kind: "image" },
        ],
      },
    });

    expect(detail).toBe("生成文件：\n- generated.png (image)");
    expect(detail).not.toContain("sessionFiles");
  });
});
