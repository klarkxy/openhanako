/**
 * AskUserConfirmCard — 让 agent 向用户提一个可选项问题的卡片
 *
 * 单选 / 多选 + 自由输入（"其他"）。
 * 通过 REST /api/confirm/:confirmId resolve 阻塞的 tool Promise。
 *
 * 桌面用户操作结构化表单 → value = { mode, selected, custom }；
 * 不走 bridge parser（parser 专为纯文本协议设计）。
 */

import { memo, useCallback, useMemo, useState } from 'react';
import styles from './Chat.module.css';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useI18n } from '../../hooks/use-i18n';

interface AskOption {
  label: string;
  description?: string | null;
}

interface Props {
  confirmId?: string;
  question: string;
  header?: string | null;
  mode: 'single' | 'multi';
  options: AskOption[];
  multiMin?: number | null;
  multiMax?: number | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'timeout';
  result?: { selected?: string | string[] | null; custom?: string | null } | null;
}

function isFilled(set: Set<string>): boolean {
  return set.size > 0;
}

function isMultiValid(count: number, min?: number | null, max?: number | null): boolean {
  if (min != null && count < min) return false;
  if (max != null && count > max) return false;
  return true;
}

export const AskUserConfirmCard = memo(function AskUserConfirmCard(props: Props) {
  const { confirmId, question, header, mode, options, multiMin, multiMax, status: initialStatus, result } = props;
  const { t } = useI18n();
  const [status, setStatus] = useState(initialStatus || 'pending');
  // 多选用 Set 记录 label；单选用 string|null
  const [singlePick, setSinglePick] = useState<string | null>(null);
  const [multiPick, setMultiPick] = useState<Set<string>>(() => new Set());
  const [useOther, setUseOther] = useState(false);
  const [customText, setCustomText] = useState('');

  const isMulti = mode === 'multi';

  const multiCount = multiPick.size;
  const otherEnabled = useOther;
  const customValid = !otherEnabled || customText.trim().length > 0;

  const canSubmit = useMemo(() => {
    if (otherEnabled) return customValid;
    if (isMulti) {
      if (multiCount === 0) return false;
      return isMultiValid(multiCount, multiMin, multiMax);
    }
    return !!singlePick;
  }, [otherEnabled, customValid, isMulti, multiCount, multiMin, multiMax, singlePick]);

  const buildValue = useCallback((): { mode: 'single' | 'multi'; selected: string | string[] | null; custom: string | null } => {
    if (otherEnabled) {
      return { mode, selected: null, custom: customText.trim() };
    }
    if (isMulti) {
      return { mode: 'multi', selected: Array.from(multiPick), custom: null };
    }
    return { mode: 'single', selected: singlePick, custom: null };
  }, [otherEnabled, customText, isMulti, multiPick, singlePick, mode]);

  const handleConfirm = useCallback(async () => {
    if (!confirmId) {
      setStatus('confirmed');
      return;
    }
    const value = buildValue();
    try {
      await hanaFetch(`/api/confirm/${confirmId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirmed', value }),
      });
      setStatus('confirmed');
    } catch { /* silent */ }
  }, [confirmId, buildValue]);

  const handleReject = useCallback(async () => {
    if (confirmId) {
      try {
        await hanaFetch(`/api/confirm/${confirmId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rejected' }),
        });
      } catch { /* silent */ }
    }
    setStatus('rejected');
  }, [confirmId]);

  const toggleMulti = useCallback((label: string) => {
    setMultiPick(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  // ── 已完成状态 ──
  if (status !== 'pending') {
    const summary = (() => {
      if (status === 'rejected') return t('common.rejected') || '已取消';
      if (status === 'timeout') return t('common.timeout') || '已超时';
      if (result?.custom != null) return `其他：${result.custom}`;
      if (Array.isArray(result?.selected)) return `已选：${result.selected.join('、')}`;
      if (typeof result?.selected === 'string') return `已选：${result.selected}`;
      return '已记录';
    })();
    return (
      <div className={`${styles.askUserCard} ${styles.askUserCardDone}`}>
        <div className={styles.askUserHeader}>
          <span className={styles.askUserQuestion}>{question}</span>
        </div>
        <div className={`${styles.askUserSummary} ${status === 'confirmed' ? styles.askUserSummaryConfirmed : styles.askUserSummaryRejected}`}>
          <span>{summary}</span>
          {status === 'confirmed' ? (
            <svg className={styles.askUserIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg className={styles.askUserIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </div>
      </div>
    );
  }

  const multiHint = isMulti && (multiMin != null || multiMax != null)
    ? (() => {
      const parts: string[] = [];
      if (multiMin != null) parts.push(`至少 ${multiMin} 项`);
      if (multiMax != null) parts.push(`最多 ${multiMax} 项`);
      return parts.join('，');
    })()
    : null;

  return (
    <div className={styles.askUserCard}>
      <div className={styles.askUserHeader}>
        {header && <span className={styles.askUserTag}>{header}</span>}
        <span className={styles.askUserQuestion}>{question}</span>
      </div>

      <div className={styles.askUserOptions}>
        {options.map((opt, i) => {
          const checked = isMulti
            ? multiPick.has(opt.label)
            : singlePick === opt.label;
          const onClick = () => {
            if (isMulti) toggleMulti(opt.label);
            else setSinglePick(opt.label);
          };
          return (
            <button
              key={`${i}-${opt.label}`}
              type="button"
              className={`${styles.askUserOption}${checked ? ` ${styles.askUserOptionSelected}` : ''}`}
              onClick={onClick}
            >
              <span className={styles.askUserOptionMark}>
                {checked ? (isMulti ? '☑' : '●') : (isMulti ? '☐' : '○')}
              </span>
              <span className={styles.askUserOptionBody}>
                <span className={styles.askUserOptionLabel}>{opt.label}</span>
                {opt.description && <span className={styles.askUserOptionDesc}>{opt.description}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.askUserOther}>
        <button
          type="button"
          className={`${styles.askUserOption}${useOther ? ` ${styles.askUserOptionSelected}` : ''}`}
          onClick={() => setUseOther(v => !v)}
        >
          <span className={styles.askUserOptionMark}>
            {useOther ? '●' : '○'}
          </span>
          <span className={styles.askUserOptionBody}>
            <span className={styles.askUserOptionLabel}>{t('askUser.otherLabel') || '其他'}</span>
            <span className={styles.askUserOptionDesc}>{t('askUser.otherHint') || '（自由输入）'}</span>
          </span>
        </button>
        {useOther && (
          <textarea
            className={styles.askUserOtherInput}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={t('askUser.otherPlaceholder') || '请输入你的回答…'}
            rows={2}
            maxLength={500}
          />
        )}
      </div>

      {isMulti && (
        <div className={styles.askUserMeta}>
          {multiHint ? `${multiHint}（已选 ${multiCount}）` : (isMulti ? `已选 ${multiCount} 项` : '')}
        </div>
      )}

      <div className={styles.askUserActions}>
        <button
          type="button"
          className={`${styles.askUserBtn} ${styles.askUserBtnConfirm}`}
          onClick={handleConfirm}
          disabled={!canSubmit}
        >
          {t('common.confirm') || '确认'}
        </button>
        <button
          type="button"
          className={`${styles.askUserBtn} ${styles.askUserBtnCancel}`}
          onClick={handleReject}
        >
          {t('common.cancel') || '取消'}
        </button>
      </div>
    </div>
  );
});
