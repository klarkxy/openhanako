import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../stores';
import { computeFloatingInputPosition } from '../floating-input/position';
import styles from './SelectionQuoteActionSurface.module.css';

const ACTION_SIZE = 36;
const TOOLTIP_DELAY_MS = 500;

function getViewportSize() {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  };
}

export function SelectionQuoteActionSurface() {
  const quoteCandidate = useStore(s => s.quoteCandidate);
  const addQuotedSelection = useStore(s => s.addQuotedSelection);
  const clearQuoteCandidate = useStore(s => s.clearQuoteCandidate);
  const requestInputFocus = useStore(s => s.requestInputFocus);
  const [viewport, setViewport] = useState(() => getViewportSize());
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleResize = () => setViewport(getViewportSize());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setTooltipVisible(false);
  }, [quoteCandidate?.updatedAt]);

  const position = useMemo(() => {
    const anchorRect = quoteCandidate?.anchorRect;
    if (!anchorRect || viewport.width <= 0 || viewport.height <= 0) return null;
    return computeFloatingInputPosition(
      anchorRect,
      viewport,
      { width: ACTION_SIZE, height: ACTION_SIZE },
      8,
      16,
      'top',
    );
  }, [quoteCandidate?.anchorRect, viewport]);

  const showTooltipLater = useCallback(() => {
    if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = window.setTimeout(() => {
      setTooltipVisible(true);
      tooltipTimerRef.current = null;
    }, TOOLTIP_DELAY_MS);
  }, []);
  const hideTooltip = useCallback(() => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltipVisible(false);
  }, []);

  useEffect(() => () => {
    if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
  }, []);

  const handleAddQuote = useCallback(() => {
    if (!quoteCandidate) return;
    addQuotedSelection(quoteCandidate);
    clearQuoteCandidate();
    requestInputFocus();
  }, [addQuotedSelection, clearQuoteCandidate, quoteCandidate, requestInputFocus]);

  if (!quoteCandidate || !position) return null;

  const tooltipId = 'selection-quote-action-tooltip';

  return (
    <div
      className={styles.surface}
      data-origin={position.origin}
      data-selection-ignore="true"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
    >
      <button
        type="button"
        className={styles.button}
        aria-label="引用到对话"
        aria-describedby={tooltipVisible ? tooltipId : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleAddQuote}
        onMouseEnter={showTooltipLater}
        onMouseLeave={hideTooltip}
        onFocus={showTooltipLater}
        onBlur={hideTooltip}
      >
        <span className={styles.icon} aria-hidden="true">"</span>
      </button>
      {tooltipVisible && (
        <div id={tooltipId} role="tooltip" className={styles.tooltip}>
          引用到对话
        </div>
      )}
    </div>
  );
}
