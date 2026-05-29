/**
 * ToolGroupBlock — 工具调用组，含展开/折叠
 */

import { memo, useState, useCallback, useEffect } from 'react';
import styles from './Chat.module.css';
import { extractToolDetail } from '../../utils/message-parser';
import type { ToolDetail } from '../../utils/message-parser';
import { openInternalLink } from '../../utils/link-open';
import { LinkContextMenu, type LinkContextMenuState } from '../shared/LinkContextMenu';

import type { ToolCall } from '../../stores/chat-types';

interface Props {
  tools: ToolCall[];
  collapsed: boolean;
  agentName?: string;
}

function getToolLabel(name: string, phase: string, agentName: string, toolLabel?: string): string {
  const t = window.t;
  const vars = { name: agentName };
  const val = t?.(`tool.${name}.${phase}`, vars);
  // Has a locale entry for this specific tool + phase → use it (these are fun!)
  if (val && val !== `tool.${name}.${phase}`) return val;
  // No locale entry: craft a fun message using the tool label
  if (toolLabel) {
    const funFallbacks: Record<string, Record<string, string>> = {
      running: {
        'edit': `✏️ ${agentName} 正在精雕细琢`,
        'search': `🔍 ${agentName} 正在翻箱倒柜`,
        'read': `📖 ${agentName} 正在认真研读`,
        'write': `✍️ ${agentName} 正在奋笔疾书`,
        'query': `🔎 ${agentName} 正在刨根问底`,
        'generate': `🎨 ${agentName} 正在灵感迸发`,
        'analyze': `🧠 ${agentName} 正在深度思考`,
        'send': `💌 ${agentName} 正在传递心意`,
        'fetch': `🌐 ${agentName} 正在探索网络`,
        'convert': `🔄 ${agentName} 正在变形转化`,
        'build': `🏗️ ${agentName} 正在搭建构造`,
        'check': `✅ ${agentName} 正在仔细检查`,
      },
      done: {
        'edit': `✏️ ${agentName} 改得漂漂亮亮`,
        'search': `🔍 ${agentName} 满载而归`,
        'read': `📖 ${agentName} 了然于胸`,
        'write': `✍️ ${agentName} 大功告成`,
        'query': `🔎 ${agentName} 找到答案了`,
        'generate': `🎨 ${agentName} 作品出炉`,
        'analyze': `🧠 ${agentName} 想明白了`,
        'send': `💌 ${agentName} 送达`,
        'fetch': `🌐 ${agentName} 取到宝了`,
        'convert': `🔄 ${agentName} 变好了`,
        'build': `🏗️ ${agentName} 搭好了`,
        'check': `✅ ${agentName} 检查完毕`,
      },
      failed: {
        'edit': `✏️ ${agentName} 改砸了`,
        'search': `🔍 ${agentName} 白忙一场`,
        'read': `📖 ${agentName} 没读到`,
        'write': `✍️ ${agentName} 写不出`,
        'query': `🔎 ${agentName} 没查到`,
        'generate': `🎨 ${agentName} 灵感枯竭`,
        'analyze': `🧠 ${agentName} 想不通了`,
        'send': `💌 ${agentName} 信没寄出`,
        'fetch': `🌐 ${agentName} 迷路了`,
        'convert': `🔄 ${agentName} 变不了`,
        'build': `🏗️ ${agentName} 塌了`,
        'check': `✅ ${agentName} 检查失败`,
      },
    };
    const lower = toolLabel.toLowerCase();
    for (const [keyword, messages] of Object.entries(funFallbacks[phase] || {})) {
      if (lower.includes(keyword)) {
        return messages;
      }
    }
    // No keyword match → generic but with tool label
    if (phase === 'running') return `🔧 ${agentName} 正在使用 ${toolLabel}`;
    if (phase === 'done') return `✅ ${agentName} 完成了 ${toolLabel}`;
  }
  // Ultimate fallback
  return t?.(`tool._fallback.${phase}`, vars) || name;
}

export const ToolGroupBlock = memo(function ToolGroupBlock({ tools: rawTools, collapsed: initialCollapsed, agentName = 'Hanako' }: Props) {
  // subagent 有独立卡片，不在工具组里重复显示
  const tools = rawTools.filter(t => t.name !== 'subagent');
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  useEffect(() => {
    setCollapsed(initialCollapsed);
  }, [initialCollapsed]);
  const toggle = useCallback(() => setCollapsed(v => !v), []);

  if (tools.length === 0) return null;

  const allDone = tools.every(t => t.done);
  const failCount = tools.filter(t => t.done && !t.success).length;
  const isSingle = tools.length === 1;

  // 摘要标题
  const _t = window.t ?? ((p: string) => p);
  let summaryText = '';
  if (allDone) {
    if (failCount > 0) {
      summaryText = _t('toolGroup.countWithFail', { total: tools.length, fail: failCount });
    } else {
      summaryText = _t('toolGroup.count', { n: tools.length });
    }
  } else {
    const running = tools.filter(t => !t.done).length;
    summaryText = _t('toolGroup.running', { n: running });
  }

  return (
    <div className={`${styles.toolGroup}${isSingle ? ` ${styles.toolGroupSingle}` : ''}`}>
      {!isSingle && (
        <div
          className={`${styles.toolGroupSummary}${allDone ? ` ${styles.toolGroupSummaryClickable}` : ''}`}
          onClick={allDone ? toggle : undefined}
        >
          <span className={styles.toolGroupTitle}>{summaryText}</span>
          {allDone && <span className={styles.toolGroupArrow}>{collapsed ? '›' : '‹'}</span>}
          {!allDone && (
            <span className={styles.toolDots} />
          )}
        </div>
      )}
      <div className={`${styles.toolGroupContent}${collapsed && !isSingle ? ` ${styles.toolGroupContentCollapsed}` : ''}`}>
        {tools.map((tool, i) => (
          <ToolIndicator key={`${tool.name}-${i}`} tool={tool} agentName={agentName} />
        ))}
      </div>
    </div>
  );
});

// ── ToolIndicator ──

function handleDetailClick(e: React.MouseEvent, detail: ToolDetail) {
  e.preventDefault();
  e.stopPropagation();
  if (!detail.href) return;
  void openInternalLink(detail.href, { origin: 'session' });
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function waitSecondsFromTool(tool: ToolCall, now: number): number | null {
  const args = tool.args || {};
  const details = tool.details || {};
  const detailSeconds = finiteNumber(details.seconds);
  const argSeconds = finiteNumber(args.seconds);
  const seconds = detailSeconds ?? argSeconds;

  if (tool.done) return seconds;

  const startedAt = finiteNumber(args.startedAt);
  const durationMs = finiteNumber(args.durationMs);
  if (startedAt !== null && durationMs !== null) {
    return Math.max(0, Math.ceil((startedAt + durationMs - now) / 1000));
  }
  return seconds;
}

function waitToolDetail(tool: ToolCall, now: number): ToolDetail {
  const seconds = waitSecondsFromTool(tool, now);
  return { text: seconds === null ? '?s' : `${seconds}s` };
}

const ToolIndicator = memo(function ToolIndicator({ tool, agentName }: { tool: ToolCall; agentName: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [linkMenu, setLinkMenu] = useState<LinkContextMenuState | null>(null);
  useEffect(() => {
    if (tool.name !== 'wait' || tool.done) return;
    if (finiteNumber(tool.args?.startedAt) === null || finiteNumber(tool.args?.durationMs) === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tool.name, tool.done, tool.args?.startedAt, tool.args?.durationMs]);

  const detail = tool.name === 'wait'
    ? waitToolDetail(tool, now)
    : extractToolDetail(tool.name, tool.args);
  const label = getToolLabel(tool.name, tool.done ? 'done' : 'running', agentName, tool.label);
  const detailTitle = detail.title || detail.href;

  // 如果 args 里有 tag 类型信息（如 agent 名）
  const tag = tool.args?.agentId as string | undefined;

  return (
    <>
      <div className={styles.toolIndicator} data-tool={tool.name} data-done={String(tool.done)}>
        <span className={styles.toolDesc}>{label}</span>
        {detail.text && (
          detail.href ? (
            <span
              className={`${styles.toolDetail} ${styles.toolDetailLink}`}
              title={detailTitle}
              onClick={(e) => handleDetailClick(e, detail)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!detail.href) return;
                setLinkMenu({
                  href: detail.href,
                  context: { origin: 'session', label: detail.text },
                  position: { x: e.clientX, y: e.clientY },
                });
              }}
            >
              {detail.text}
            </span>
          ) : (
            <span className={styles.toolDetail} title={detailTitle}>{detail.text}</span>
          )
        )}
        {tag && <span className={styles.toolTag}>{tag}</span>}
        {tool.done ? (
          <span className={`${styles.toolStatus} ${tool.success ? styles.toolStatusDone : styles.toolStatusFailed}`}>
            {tool.success ? '✓' : '✗'}
          </span>
        ) : (
          <span className={styles.toolDots} />
        )}
      </div>
      {linkMenu && (
        <LinkContextMenu
          state={linkMenu}
          onClose={() => setLinkMenu(null)}
        />
      )}
    </>
  );
});
