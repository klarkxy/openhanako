import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTextFileTool } from "../lib/tools/text-file-tool.js";

describe("text_file tool", () => {
  let tempRoot;
  let registerSessionFile;
  let tool;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-text-file-tool-"));
    registerSessionFile = vi.fn((entry) => ({
      id: `sf-${path.basename(entry.filePath)}`,
      sessionPath: entry.sessionPath,
      filePath: entry.filePath,
      label: entry.label,
      origin: entry.origin,
    }));
    tool = createTextFileTool({
      getCwd: () => tempRoot,
      getSessionPath: () => "sessions/main",
      registerSessionFile,
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("reads a line range with line numbers", async () => {
    const filePath = path.join(tempRoot, "note.md");
    fs.writeFileSync(filePath, "alpha\nbravo\ncharlie\n", "utf8");

    const result = await tool.execute("call-1", {
      action: "read",
      path: "note.md",
      start_line: 2,
      end_line: 3,
      number_lines: true,
    });

    expect(result.details.path).toBe(filePath);
    expect(result.details.start_line).toBe(2);
    expect(result.details.end_line).toBe(3);
    expect(result.content[0].text).toContain("     2: bravo");
    expect(result.content[0].text).toContain("     3: charlie");
  });

  it("supports line_insert and line_delete as separate operations", async () => {
    const filePath = path.join(tempRoot, "sample.txt");
    fs.writeFileSync(filePath, "alpha\ncharlie\n", "utf8");

    const inserted = await tool.execute("call-2", {
      action: "line_insert",
      path: "sample.txt",
      line: 2,
      text: "bravo\n",
    });
    const deleted = await tool.execute("call-3", {
      action: "line_delete",
      path: "sample.txt",
      start_line: 3,
      end_line: 3,
    });

    expect(inserted.details.inserted_at).toBe(2);
    expect(deleted.details.deleted_line_count).toBe(1);
    expect(fs.readFileSync(filePath, "utf8")).toBe("alpha\nbravo\n");
    expect(registerSessionFile).toHaveBeenCalledTimes(2);
  });

  it("dedupes session file registration for batch edits on the same file", async () => {
    const filePath = path.join(tempRoot, "batch.txt");
    fs.writeFileSync(filePath, "alpha\nold\n", "utf8");

    const result = await tool.execute("call-4", {
      action: "batch",
      operations: [
        { action: "replace", path: "batch.txt", find: "old", replace: "new" },
        { action: "append", path: "batch.txt", text: "tail\n" },
      ],
    });

    expect(result.details.results).toHaveLength(2);
    expect(result.details.sessionFiles).toHaveLength(1);
    expect(registerSessionFile).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(filePath, "utf8")).toBe("alpha\nnew\ntail\n");
  });

  it("rejects line-based batch edits before applying any changes", async () => {
    const filePath = path.join(tempRoot, "unsafe.txt");
    fs.writeFileSync(filePath, "alpha\nbravo\n", "utf8");

    const result = await tool.execute("call-5", {
      action: "batch",
      operations: [
        { action: "append", path: "unsafe.txt", text: "charlie\n" },
        { action: "line_delete", path: "unsafe.txt", start_line: 1, end_line: 1 },
      ],
    });

    expect(result.details.errorCode).toBe("TEXT_FILE_BATCH_LINE_UNSAFE");
    expect(result.details.completed_operations).toBe(0);
    expect(fs.readFileSync(filePath, "utf8")).toBe("alpha\nbravo\n");
    expect(registerSessionFile).not.toHaveBeenCalled();
  });
});