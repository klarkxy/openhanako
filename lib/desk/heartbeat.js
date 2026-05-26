/**
 * heartbeat.js — 日常巡检 + 笺目录扫描
 *
 * 让 agent 从被动应答变成主动行动的关键机制。
 * 两个阶段：
 *   Phase 1: 工作台文件变化检测
 *   Phase 2: 笺扫描（根目录 + 一级子目录的 jian.md，指纹比对后隔离执行）
 *
 * 定时任务（cron）由独立的 cron-scheduler 调度，不经过巡检。
 */

import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../../shared/safe-fs.js";
import { createHash } from "crypto";
import { Type, StringEnum } from "../pi-sdk/index.js";
import { debugLog, createModuleLogger } from "../debug-log.js";
import {
  WORKSPACE_OUTPUT_ROOT_DIRNAME,
  resolveAgentWorkspaceOutputDirs,
  resolveAgentWorkspaceOutputRelativeDirs,
} from "../../shared/workspace-output.js";

const log = createModuleLogger("heartbeat");
const EXEC_LOG_START = "<!-- exec-log -->";
const EXEC_LOG_END = "<!-- /exec-log -->";
const JIAN_STATUS_VALUES = ["in_progress", "completed", "skipped", "failed"];

/**
 * Agent 工作区产物的统一根目录名。
 * 巡检日志与主动创建的文件都收纳在此目录下，避免污染工作区顶层。
 * 快照差量检测需要跳过它，否则巡检自己的写入会把下一轮触发成"有变化"。
 */
export const HEARTBEAT_ACTIVITY_DIR = WORKSPACE_OUTPUT_ROOT_DIRNAME;

/** 12 位 MD5 短指纹 */
function quickHash(str) {
  return createHash("md5").update(str).digest("hex").slice(0, 12);
}

/** 人类可读文件大小 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function markdownFenceFor(text) {
  const matches = String(text || "").match(/`{3,}/g) || [];
  const longest = matches.reduce((max, run) => Math.max(max, run.length), 2);
  return "`".repeat(longest + 1);
}

// ═══════════════════════════════════════
//  Prompt 构建
// ═══════════════════════════════════════

/**
 * 工作台巡检 prompt（English-only — behavior instruction to the LLM）
 *
 * @param {object} opts
 * @param {boolean} opts.deskChanged - 工作区文件是否有变化
 * @param {{added: string[], modified: string[], removed: string[]}} opts.changedFiles - 变化的文件
 * @param {string|null} opts.overwatch
 * @param {string} opts.agentName
 * @param {string|null} opts.patrolLog - 近期巡检记录（截断后的内容）
 * @param {string} opts.activityDir - 自主活动目录（工作区相对路径，POSIX 风格）
 * @param {string} opts.patrolLogPath - 巡检日志路径（工作区相对路径，POSIX 风格）
 */
function buildHeartbeatContext({ deskChanged, changedFiles, overwatch, agentName, patrolLog, activityDir, patrolLogPath }) {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", { hour12: false });

  const parts = [
    `[Heartbeat Patrol] Current time: ${timeStr}`,
    "",
    "**Note: This is an automated patrol message, NOT from the user. The user is not currently talking to you — do not treat this as a user query.**",
    "Independently determine if there are items that need proactive handling. If so, act directly — do not ask the user or wait for a reply.",
    "",
  ];

  if (overwatch) {
    parts.push("## Overwatch");
    parts.push(overwatch);
    parts.push("");
  }

  // 工作台文件变化（差量上报）
  if (deskChanged && changedFiles) {
    parts.push("## Workspace file changes:");
    if (changedFiles.added.length > 0) {
      parts.push("Added:");
      for (const f of changedFiles.added) parts.push(`  + ${f}`);
    }
    if (changedFiles.modified.length > 0) {
      parts.push("Modified:");
      for (const f of changedFiles.modified) parts.push(`  ~ ${f}`);
    }
    if (changedFiles.removed.length > 0) {
      parts.push("Removed:");
      for (const f of changedFiles.removed) parts.push(`  - ${f}`);
    }
    parts.push("");
  } else {
    parts.push("## Workspace status: no file changes.");
    parts.push("");
  }

  // 近期巡检记录
  if (patrolLog) {
    parts.push("## Recent Patrol Log");
    parts.push(patrolLog);
    parts.push("");
  }

  parts.push("---");
  parts.push([
    `1. **Check the activity directory first**: Use the ls tool to list files under \`${activityDir}/\`, understand what you've created before, and avoid duplicates.`,
    "2. **Review the recent patrol log**: Check the \"Recent Patrol Log\" section above — do not repeat what has already been done.",
    "3. Based on your memory, determine if there is anything you can **proactively do for the user** (organize files, generate summaries, remind about tasks, etc.).",
    "4. If you find something noteworthy, use the notify tool to alert the user.",
    `5. If you need to **create files proactively** (based on memory or judgment, not processing existing files), place them under \`${activityDir}/\` in the workspace (create the directory if it doesn't exist).`,
    "",
    "You may also use patrol downtime to **learn on your own**: search topics that interest you, research areas the user has been focused on recently, or read up on relevant material to enrich your knowledge. Save valuable findings under the autonomous activity directory — you can draw on them naturally in future conversations.",
    "",
    "Do not proactively query system status such as cron jobs that is not listed above.",
    "If everything is fine, there's nothing to proactively do, and nothing you want to learn, do not call any tools (but still write the patrol log).",
    "",
    `6. **Write patrol log when done**: Append what you did this round to \`${patrolLogPath}\`, format: \`- [YYYY-MM-DD HH:mm] what you did\`. If nothing was done, write \`- [YYYY-MM-DD HH:mm] Patrol complete, no action needed\`.`,
  ].join("\n"));

  return parts.join("\n");
}

/**
 * 从 jian 内容中分离用户指令和执行记录
 */
function splitJianContent(raw) {
  const startIdx = raw.indexOf(EXEC_LOG_START);
  if (startIdx === -1) return { instructions: raw.trim(), execLog: "" };
  const endIdx = raw.indexOf(EXEC_LOG_END, startIdx);
  const logBlock = endIdx === -1
    ? raw.slice(startIdx + EXEC_LOG_START.length).trim()
    : raw.slice(startIdx + EXEC_LOG_START.length, endIdx).trim();
  return {
    instructions: raw.slice(0, startIdx).trim(),
    execLog: logBlock,
  };
}

function composeJianContent(instructions, execLog) {
  const body = String(instructions || "").trimEnd();
  const logBlock = String(execLog || "").trim();
  if (!logBlock) return body ? `${body}\n` : "";
  return `${body}\n\n${EXEC_LOG_START}\n${logBlock}\n${EXEC_LOG_END}\n`;
}

function formatJianStatusBlock({ snapshot, status, progress, note }) {
  const fence = markdownFenceFor(snapshot);
  const lines = [
    "Last Task Snapshot:",
    `${fence}jian-snapshot`,
    String(snapshot || "").trim(),
    fence,
    "",
    "Execution Status:",
    `- Status: ${status}`,
    `- Progress: ${String(progress || "none").trim() || "none"}`,
    `- Note: ${String(note || "").trim() || "none"}`,
  ];
  return lines.join("\n");
}

function createJianStatusTool({ jianPath, instructionSnapshot }) {
  return {
    name: "jian_update_status",
    label: "Update Jian Status",
    description: "Update the current jian.md execution status. The program writes the task snapshot captured at patrol start; submit only status, progress, and note.",
    parameters: Type.Object({
      status: StringEnum(JIAN_STATUS_VALUES, {
        description: "Task status after this patrol. Use completed for done and in_progress when future patrols should continue.",
      }),
      progress: Type.Optional(Type.String({
        description: "Short progress, for example 4/5, 5/5, or none.",
      })),
      note: Type.String({
        minLength: 1,
        description: "One sentence describing what happened this patrol, or why it was skipped.",
      }),
    }),
    execute: async (_toolCallId, params) => {
      const status = JIAN_STATUS_VALUES.includes(params?.status) ? params.status : "in_progress";
      let currentRaw = "";
      try {
        currentRaw = fs.readFileSync(jianPath, "utf-8");
      } catch {}
      const { instructions } = splitJianContent(currentRaw || instructionSnapshot || "");
      const execLog = formatJianStatusBlock({
        snapshot: instructionSnapshot,
        status,
        progress: params?.progress,
        note: params?.note,
      });
      fs.mkdirSync(path.dirname(jianPath), { recursive: true });
      atomicWriteSync(jianPath, composeJianContent(instructions, execLog));
      return {
        content: [{
          type: "text",
          text: `Jian status updated: ${status}`,
        }],
        details: {
          status,
          progress: params?.progress || null,
          note: params?.note || "",
          snapshot: instructionSnapshot,
          jianPath,
        },
      };
    },
  };
}

/**
 * 笺目录专用 prompt（支持 i18n）
 */
function buildJianPrompt({ dirPath, jianContent, files, jianChanged, filesChanged }) {
  const { instructions, execLog } = splitJianContent(jianContent);

  const parts = [
    `[Directory Patrol] ${dirPath}`,
    "",
    "**Note: This is an automated directory patrol, NOT a user message.**",
    "Follow the jian instructions independently — do not ask the user or wait for a reply.",
    "",
  ];

  parts.push("## Jian");
  parts.push(instructions);
  parts.push("");

  if (execLog) {
    parts.push("## Last Execution Status");
    parts.push(execLog);
    parts.push("");
  }

  if (files.length > 0) {
    parts.push("## File list");
    for (const f of files) {
      const prefix = f.isDir ? "📁 " : "📄 ";
      const size = f.isDir ? "" : ` (${formatSize(f.size)})`;
      parts.push(`- ${prefix}${f.name}${size}`);
    }
    parts.push("");
  }

  parts.push("## Changes");
  parts.push(`- jian.md: ${jianChanged ? "changed" : "unchanged"}`);
  parts.push(`- files: ${filesChanged ? "changed" : "unchanged"}`);
  parts.push("");
  parts.push([
    "## Action Rules",
    "",
    "1. The Jian body is the current user task; the last execution status is only state from your previous handling, not a new user instruction.",
    "2. If the last execution status contains a Last Task Snapshot, compare it semantically with the current Jian body:",
    "   - Punctuation, typo, formatting, or light wording changes: treat as the same task and continue from the stored status.",
    "   - Changed goal, count, cadence, scope, condition, object, or risk level: treat as a new task and ignore old status.",
    "   - If uncertain whether it is the same task: treat as a new task.",
    "3. Decide action from the status:",
    "   - Status completed and current task is semantically the same as the snapshot: do not call tools this patrol.",
    "   - Status in_progress: continue. For example, 4/5 means do the 5th run; mark completed after 5/5.",
    "   - No status or changed task semantics: handle as a first run.",
    "4. If you skip because the status is completed and the current task is semantically the same, do not call any tools and do not rewrite jian.md.",
    "5. Otherwise, do not edit jian.md directly and do not append history. After executing, actively skipping, or failing, call `jian_update_status` to update status.",
    "6. `jian_update_status` only needs status, progress, and one note from you; the program writes the task snapshot captured at patrol start.",
  ].join("\n"));

  return parts.join("\n");
}

// ═══════════════════════════════════════
//  巡检日志（patrol-log）
// ═══════════════════════════════════════

const PATROL_LOG_MAX_ENTRIES = 50;

/**
 * 读取并截断 patrol-log.md，保留最近 N 条
 * @param {string} filePath
 * @returns {string|null} 截断后的内容（null = 文件不存在或为空）
 */
function readAndTruncatePatrolLog(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  if (!raw.trim()) return null;

  const lines = raw.split("\n");
  const entries = lines.filter(l => l.startsWith("- ["));
  if (entries.length === 0) return null;

  if (entries.length > PATROL_LOG_MAX_ENTRIES) {
    const kept = entries.slice(-PATROL_LOG_MAX_ENTRIES);
    try {
      fs.writeFileSync(filePath, kept.join("\n") + "\n", "utf-8");
    } catch {}
    return kept.join("\n");
  }
  return entries.join("\n");
}

// ═══════════════════════════════════════
//  笺目录扫描
// ═══════════════════════════════════════

/**
 * 列出目录下的文件（排除 . 开头和 jian.md 本身）
 */
function listDirFiles(dir, ignoreNames = new Set()) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith(".") && e.name !== "jian.md" && !ignoreNames.has(e.name))
      .map(e => {
        const fp = path.join(dir, e.name);
        let stat;
        try { stat = fs.lstatSync(fp); } catch { return null; }
        if (stat.isSymbolicLink()) return null; // 跳过 symlink
        return {
          name: e.name,
          isDir: e.isDirectory(),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 扫描工作台，找到所有含 jian.md 的目录（根目录 + 一级子目录）
 */
function scanJianDirs(wsPath) {
  if (!wsPath || !fs.existsSync(wsPath)) return [];

  const dirs = [];

  // 根目录
  const rootIgnoreNames = new Set([WORKSPACE_OUTPUT_ROOT_DIRNAME]);

  if (fs.existsSync(path.join(wsPath, "jian.md"))) {
    try {
      dirs.push({
        name: ".",
        absPath: wsPath,
        jianContent: fs.readFileSync(path.join(wsPath, "jian.md"), "utf-8"),
        files: listDirFiles(wsPath, rootIgnoreNames),
      });
    } catch {}
  }

  // 一级子目录
  try {
    const entries = fs.readdirSync(wsPath, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      if (e.name === WORKSPACE_OUTPUT_ROOT_DIRNAME) continue;
      const subPath = path.join(wsPath, e.name);
      const jianFile = path.join(subPath, "jian.md");
      if (!fs.existsSync(jianFile)) continue;
      try {
        dirs.push({
          name: e.name,
          absPath: subPath,
          jianContent: fs.readFileSync(jianFile, "utf-8"),
          files: listDirFiles(subPath),
        });
      } catch {}
    }
  } catch {}

  return dirs;
}

// ═══════════════════════════════════════
//  心跳调度器
// ═══════════════════════════════════════

/**
 * 创建心跳调度器
 *
 * @param {object} opts
 * @param {() => Array|Promise<Array>} [opts.getDeskFiles] - 获取根目录文件列表（支持 async）
 * @param {() => string} [opts.getWorkspacePath] - 获取工作台路径
 * @param {() => string} [opts.getAgentName] - 获取当前 agent 名称
 * @param {string} [opts.registryPath] - jian-registry.json 存储路径
 * @param {(prompt: string) => Promise<void>} opts.onBeat - 工作台巡检回调
 * @param {(prompt: string, cwd: string) => Promise<void>} [opts.onJianBeat] - 笺巡检回调（带 cwd）
 * @param {number} [opts.intervalMinutes] - 巡检间隔（分钟），默认 31
 * @param {(text: string, level?: string) => void} [opts.emitDevLog]
 * @returns {{ start, stop, beat, triggerNow }}
 */
export function createHeartbeat({
  getDeskFiles, getWorkspacePath, getAgentName, registryPath,
  onBeat, onJianBeat,
  intervalMinutes, emitDevLog,
  overwatchPath, locale,
}) {
  const isZh = !locale || String(locale).startsWith("zh");
  const devlog = (text, level = "heartbeat") => {
    emitDevLog?.(text, level);
  };
  const INTERVAL = (intervalMinutes || 31) * 60 * 1000;
  const COOLDOWN = 2 * 60 * 1000;
  const BEAT_TIMEOUT = 5 * 60 * 1000;

  let _timer = null;
  let _running = false;
  let _beatPromise = null;
  let _lastTrigger = 0;
  /** @type {Map<string, number>} name → mtime */
  let _lastDeskSnapshot = new Map();

  // ── 指纹注册表 ──

  function loadRegistry() {
    if (!registryPath) return {};
    try {
      return JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    } catch {
      return {};
    }
  }

  function saveRegistry(reg) {
    if (!registryPath) return;
    try {
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      atomicWriteSync(registryPath, JSON.stringify(reg, null, 2));
    } catch (err) {
      log.warn(`saveRegistry 失败: ${err.message}`);
    }
  }

  // ── 心跳执行 ──

  async function beat() {
    if (_running) return;
    _running = true;
    const p = _doBeat();
    _beatPromise = p;
    await p;
  }

  async function _doBeat() {
    try {
      log.log(`── 心跳开始 ──`);
      debugLog()?.log("heartbeat", "beat start");
      devlog("── 心跳开始 ──");

      // ── 收集上下文 ──
      const deskFiles = (await getDeskFiles?.()) || [];

      // 差量 diff：对比上一轮快照，算出 added / modified / removed
      const currentSnapshot = new Map(deskFiles.map(f => [f.name, f.mtime || 0]));
      const changedFiles = { added: [], modified: [], removed: [] };
      for (const [name, mtime] of currentSnapshot) {
        if (!_lastDeskSnapshot.has(name)) changedFiles.added.push(name);
        else if (_lastDeskSnapshot.get(name) !== mtime) changedFiles.modified.push(name);
      }
      for (const name of _lastDeskSnapshot.keys()) {
        if (!currentSnapshot.has(name)) changedFiles.removed.push(name);
      }
      const deskChanged = changedFiles.added.length > 0 || changedFiles.modified.length > 0 || changedFiles.removed.length > 0;
      // 更新快照（不管有没有变化都更新，保持准确）
      _lastDeskSnapshot = currentSnapshot;

      // Overwatch 注意力清单
      let overwatch = null;
      if (overwatchPath) {
        try {
          const content = fs.readFileSync(overwatchPath, "utf-8").trim();
          if (content) overwatch = content;
        } catch {}
      }

      // 笺目录扫描
      const wsPath = getWorkspacePath?.();
      const agentName = getAgentName?.() || "Hanako";
      const relativeOutputDirs = resolveAgentWorkspaceOutputRelativeDirs(agentName, locale);
      const jianDirs = (onJianBeat && wsPath) ? scanJianDirs(wsPath) : [];
      const jianChanges = _detectJianChanges(jianDirs);

      // 汇总日志
      const changeCount = changedFiles.added.length + changedFiles.modified.length + changedFiles.removed.length;
      const summaryParts = [isZh ? `文件: ${deskFiles.length}${deskChanged ? ` (${changeCount} 变化)` : ""}` : `files: ${deskFiles.length}${deskChanged ? ` (${changeCount} changed)` : ""}`];
      if (overwatch) summaryParts.push(isZh ? "overwatch: 有内容" : "overwatch: active");
      if (jianDirs.length > 0) summaryParts.push(isZh ? `笺: ${jianDirs.length} 目录, ${jianChanges.length} 变化` : `jian: ${jianDirs.length} dirs, ${jianChanges.length} changed`);
      const summary = summaryParts.join("  |  ");
      log.log(summary);
      devlog(summary);

      // ── Phase 1: 工作台巡检（始终执行，让 agent 结合记忆判断） ──
      {
        // 读取巡检日志（截断）
        const patrolLogPath = wsPath
          ? path.join(resolveAgentWorkspaceOutputDirs(wsPath, agentName, locale).patrolDir, "patrol-log.md")
          : null;
        const patrolLog = patrolLogPath ? readAndTruncatePatrolLog(patrolLogPath) : null;
        const prompt = buildHeartbeatContext({
          deskChanged,
          changedFiles,
          overwatch,
          agentName,
          patrolLog,
          activityDir: relativeOutputDirs.activityDir,
          patrolLogPath: relativeOutputDirs.patrolLog,
        });
        log.log(`Phase 1: 工作台巡检 (${prompt.length} chars, ${deskChanged ? "有变化" : "无变化"})`);
        devlog(`Phase 1: 工作台巡检执行中...${deskChanged ? "" : " (无文件变化)"}`);
        {
          let timer;
          try {
            await Promise.race([
              onBeat(prompt),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(isZh ? "心跳执行超时 (5min)" : "Heartbeat timed out (5min)")), BEAT_TIMEOUT); }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
      }

      // ── Phase 2: 笺目录执行 ──
      if (jianChanges.length > 0) {
        await _processJianChanges(jianChanges);
      }

      log.log(`── 心跳完成 ──`);
      debugLog()?.log("heartbeat", "beat done");
      devlog("── 心跳完成 ──");
    } catch (err) {
      log.error(`beat error: ${err.message}`);
      debugLog()?.error("heartbeat", `beat error: ${err.message}`);
      devlog(`错误: ${err.message}`, "error");
    } finally {
      _running = false;
    }
  }

  /**
   * 对比注册表，找出有变化的笺目录
   */
  function _detectJianChanges(jianDirs) {
    if (jianDirs.length === 0) return [];

    const registry = loadRegistry();
    const result = [];

    for (const dir of jianDirs) {
      const key = dir.absPath;
      const jianHash = quickHash(dir.jianContent);
      const filesHash = quickHash(dir.files.map(f => `${f.name}:${f.mtime}`).join("|"));

      const prev = registry[key];
      const jianChanged = !prev || prev.jianHash !== jianHash;
      const filesChanged = !prev || prev.filesHash !== filesHash;

      // 有内容就触发，agent 自己决定要不要行动
      result.push({ ...dir, jianHash, filesHash, jianChanged, filesChanged });
    }

    return result;
  }

  /**
   * 逐个执行有变化的笺目录
   */
  async function _processJianChanges(changes) {
    const registry = loadRegistry();

    for (const dir of changes) {
      const label = dir.name === "." ? (isZh ? "根目录" : "root") : dir.name;
      log.log(`Phase 2: 笺 [${label}] 有变化，执行中...`);
      devlog(`笺 [${label}] 有变化，执行中...`);

      const prompt = buildJianPrompt({
        dirPath: dir.absPath,
        jianContent: dir.jianContent,
        files: dir.files,
        jianChanged: dir.jianChanged,
        filesChanged: dir.filesChanged,
      });
      const { instructions: instructionSnapshot } = splitJianContent(dir.jianContent);
      const jianStatusTool = createJianStatusTool({
        jianPath: path.join(dir.absPath, "jian.md"),
        instructionSnapshot,
      });

      try {
        {
          let timer;
          try {
            await Promise.race([
              onJianBeat(prompt, dir.absPath, { customTools: [jianStatusTool] }),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(isZh ? `笺 [${label}] 执行超时 (5min)` : `Jian [${label}] timed out (5min)`)), BEAT_TIMEOUT); }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }

        // 执行成功 → 重新扫描目录，用执行后的指纹存入 registry
        // 避免任务自身修改文件导致下次心跳重复触发（自激振荡）
        const postFiles = listDirFiles(dir.absPath);
        const postFilesHash = quickHash(postFiles.map(f => `${f.name}:${f.mtime}`).join("|"));
        let postJianHash = dir.jianHash;
        try {
          const postJian = fs.readFileSync(path.join(dir.absPath, "jian.md"), "utf-8");
          postJianHash = quickHash(postJian);
        } catch {}

        registry[dir.absPath] = {
          jianHash: postJianHash,
          filesHash: postFilesHash,
          lastCheckedAt: new Date().toISOString(),
        };
        saveRegistry(registry);

        devlog(`笺 [${label}] 执行完成`);
      } catch (err) {
        devlog(`笺 [${label}] 执行失败: ${err.message}`, "error");
      }
    }
  }

  // ── 调度 ──

  function start() {
    if (_timer) return;
    const now = Date.now();
    const msIntoSlot = now % INTERVAL;
    const delay = INTERVAL - msIntoSlot;
    const nextTime = new Date(now + delay);
    log.log(`已启动，下次心跳: ${nextTime.toLocaleTimeString("zh-CN", { hour12: false })}`);
    debugLog()?.log("heartbeat", `started, next: ${nextTime.toLocaleTimeString("zh-CN", { hour12: false })}`);
    devlog(`心跳已启动，下次: ${nextTime.toLocaleTimeString("zh-CN", { hour12: false })}`);
    _timer = setTimeout(function fire() {
      beat();
      _timer = setInterval(() => beat(), INTERVAL);
      if (_timer.unref) _timer.unref();
    }, delay);
    if (_timer.unref) _timer.unref();
  }

  async function stop() {
    if (_timer) {
      clearTimeout(_timer);
      clearInterval(_timer);
      _timer = null;
    }
    if (_beatPromise) {
      await _beatPromise.catch(() => {});
    }
    _running = false; // 确保 stop 后状态干净
    debugLog()?.log("heartbeat", "stopped");
    devlog("心跳已停止");
  }

  function triggerNow() {
    const now = Date.now();
    if (now - _lastTrigger < COOLDOWN) {
      devlog("手动触发冷却中，跳过");
      return false;
    }
    _lastTrigger = now;
    devlog("手动触发心跳");
    beat();
    return true;
  }

  return { start, stop, beat, triggerNow };
}
