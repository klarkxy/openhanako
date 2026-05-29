/**
 * ThinkingBlock — 可折叠的思考过程区块
 */

import { memo, useState, useCallback } from 'react';
import { useThinkingTranslation } from '../../hooks/use-thinking-translation';
import styles from './Chat.module.css';

interface Props {
  content: string;
  sealed: boolean;
  sessionPath?: string;
  messageId?: string;
}

export const ThinkingBlock = memo(function ThinkingBlock({ content, sealed, sessionPath, messageId }: Props) {
  const t = window.t ?? ((p: string) => p);
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);

  const { translation, status } = useThinkingTranslation({
    sessionPath: sessionPath || '',
    messageId: messageId || '',
    content,
    sealed,
  });

  return (
    <details className={styles.thinkingBlock} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className={styles.thinkingBlockSummary} onClick={(e) => { e.preventDefault(); toggle(); }}>
        <span className={`${styles.thinkingBlockArrow}${open ? ` ${styles.thinkingBlockArrowOpen}` : ''}`}>›</span>
        {' '}{sealed ? t('thinking.done') : (
          <>{t('thinking.active')}<span className={styles.thinkingDots} /></>
        )}
      </summary>
      {open && content && (
        <div className={styles.thinkingBlockBody}>{content}</div>
      )}
      {open && status === 'pending' && (
        <div className={styles.thinkingTranslationPending}>{t('thinking.translating')}</div>
      )}
      {open && translation && (
        <div className={styles.thinkingTranslation}>
          <div className={styles.thinkingTranslationLabel}>{t('thinking.translationLabel')}</div>
          <div className={styles.thinkingTranslationBody}>{translation}</div>
        </div>
      )}
      {open && status === 'error' && (
        <div className={styles.thinkingTranslationError}>{t('thinking.translationFailed')}</div>
      )}
    </details>
  );
});
