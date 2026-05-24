/**
 * 从 CHANGELOG.md 提取指定版本的变更条目。
 *
 * 用法:
 *   node scripts/extract-changelog.mjs --unreleased          # 提取 [Unreleased] 段
 *   node scripts/extract-changelog.mjs --version v0.236.0     # 提取指定版本段
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");

// ---- args ----

function parseArgs(argv) {
  const opts = { unreleased: false, version: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--unreleased") {
      opts.unreleased = true;
    } else if (argv[i] === "--version" && argv[i + 1]) {
      opts.version = argv[++i];
    }
  }
  return opts;
}

// ---- helpers ----

/** 从 "v0.235.0" 或 "--version v0.235.0 --date 2026-05-20" 中提取纯版本号 "0.235.0" */
function stripLeadingV(ver) {
  return ver.replace(/^v/, "");
}

/**
 * 匹配 `## [<version>]` 或 `## [<version>] - YYYY-MM-DD`
 * 返回版本号（不带 v 前缀），否则返回 null。
 */
const VERSION_HEADING_RE = /^##\s+\[([^\]]+)\]/;

function parseVersionFromHeading(line) {
  const m = line.match(VERSION_HEADING_RE);
  if (!m) return null;
  return stripLeadingV(m[1]);
}

// ---- extract ----

function extractUnreleased(lines, startIdx) {
  const entries = [];
  let i = startIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    // 遇到下一个版本标题就停
    if (VERSION_HEADING_RE.test(line)) break;
    const trimmed = line.trim();
    if (trimmed) entries.push(trimmed);
    i++;
  }
  return entries.join("\n").trim();
}

function extractVersion(lines, targetVer) {
  const target = stripLeadingV(targetVer);
  for (let i = 0; i < lines.length; i++) {
    const ver = parseVersionFromHeading(lines[i]);
    if (ver === target) {
      const entries = [];
      let j = i + 1;
      while (j < lines.length) {
        if (VERSION_HEADING_RE.test(lines[j])) break;
        const trimmed = lines[j].trim();
        if (trimmed) entries.push(trimmed);
        j++;
      }
      return entries.join("\n").trim();
    }
  }
  return null;
}

// ---- main ----

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.error("CHANGELOG.md not found at", CHANGELOG_PATH);
    process.exit(1);
  }

  const content = fs.readFileSync(CHANGELOG_PATH, "utf-8");
  const lines = content.split("\n");

  let output = "";

  if (opts.unreleased) {
    // 找到 [Unreleased] 标题行（大小写不敏感）
    const idx = lines.findIndex(
      (l) => {
        const v = parseVersionFromHeading(l);
        return v && v.toLowerCase() === "unreleased";
      }
    );
    if (idx === -1) {
      console.error("No [Unreleased] section found in CHANGELOG.md");
      process.exit(1);
    }
    output = extractUnreleased(lines, idx);
  } else if (opts.version) {
    output = extractVersion(lines, opts.version);
    if (output === null) {
      console.error(
        `Version "${opts.version}" not found in CHANGELOG.md`
      );
      process.exit(1);
    }
  } else {
    console.error("Specify --unreleased or --version <tag>");
    process.exit(1);
  }

  if (!output.trim()) {
    // 空内容：不是错误，只是没有条目
    process.exit(0);
  }

  console.log(output);
}

main();
