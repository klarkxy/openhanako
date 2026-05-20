/**
 * diary.js — 日记 REST API
 *
 * POST /api/diary/write — 生成当日日记
 * GET  /api/diary/list  — 列出已有日记
 */

import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { resolveDiaryDir } from "../../lib/diary/diary-writer.js";
import { getLogicalDay } from "../../lib/time-utils.js";
import { resolveAgent } from "../utils/resolve-agent.js";
import { createModuleLogger } from "../../lib/debug-log.js";

const log = createModuleLogger("diary");

export function createDiaryRoute(engine) {
  const route = new Hono();

  /** POST /diary/write — 触发日记生成 */
  route.post("/diary/write", async (c) => {
    try {
      const result = await engine.writeDiary();
      if (result.error) {
        return c.json({
          error: result.error,
          ...(Array.isArray(result.warnings) && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        }, 400);
      }
      return c.json({
        filePath: result.filePath,
        content: result.content,
        logicalDate: result.logicalDate,
        ...(Array.isArray(result.warnings) && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      });
    } catch (err) {
      log.error(`write failed: ${err.message}`);
      return c.json({ error: err.message }, 500);
    }
  });

  /** GET /diary/list — 列出已有日记文件 */
  route.get("/diary/list", async (c) => {
    const agent = resolveAgent(engine, c);
    const cwd = agent?.homeCwd || engine.homeCwd || process.cwd();
    const primaryDir = resolveDiaryDir(cwd);
    const alternateDir = path.basename(primaryDir) === "日记"
      ? path.join(cwd, "diary")
      : path.join(cwd, "日记");

    const map = new Map();
    const pushDir = (dirPath) => {
      try {
        const names = fs.readdirSync(dirPath).filter((f) => f.endsWith(".md"));
        for (const name of names) {
          if (!map.has(name)) map.set(name, { dir: dirPath, name });
        }
      } catch {
        // ignore missing diary dirs
      }
    };

    pushDir(primaryDir);
    pushDir(alternateDir);

    const files = [...map.values()].map((it) => it.name).sort().reverse();
    const { logicalDate } = getLogicalDay(new Date(), engine.getTimezone?.() || null);
    const today = files.find((name) => name.startsWith(`${logicalDate}`)) || null;

    try {
      return c.json({ files, today, logicalDate });
    } catch {
      return c.json({ files: [], today: null, logicalDate });
    }
  });

  return route;
}
