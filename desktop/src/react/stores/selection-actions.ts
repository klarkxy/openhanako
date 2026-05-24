import { useStore } from './index';
import type { PreviewItem } from '../types';
import type { EditorView } from '@codemirror/view';
import type { FloatingAnchorRect, QuotedSelection } from './input-slice';
import type { ChatMessage } from './chat-types';

const MAX_QUOTED_SELECTION_CHARS = 2000;
const CHAT_QUOTE_HIGHLIGHT_NAME = 'hana-chat-quoted-selection';
type QuoteClearScope = {
  sourceKind?: QuotedSelection['sourceKind'];
  sourceFilePath?: string | null;
  sourceSessionPath?: string | null;
  sourceMessageId?: string | null;
};
type HighlightRegistryWithMutation = HighlightRegistry & {
  set: (name: string, highlight: Highlight) => void;
  delete: (name: string) => boolean;
};
type ChatHighlightIdentity = {
  sourceSessionPath?: string;
  sourceMessageId?: string;
  text: string;
  updatedAt?: number;
};

let quotedSelectionLifecycle:
  | { target: Document; cleanup: () => void }
  | null = null;
let activeChatHighlightIdentity: ChatHighlightIdentity | null = null;

export function initQuotedSelectionLifecycle(target: Document = document): () => void {
  if (quotedSelectionLifecycle?.target === target) {
    return quotedSelectionLifecycle.cleanup;
  }
  quotedSelectionLifecycle?.cleanup();

  const handleSelectionChange = () => {
    clearSelectionIfNativeSelectionIsEmpty(target);
  };
  target.addEventListener('selectionchange', handleSelectionChange);
  const unsubscribeQuotedSelection = useStore.subscribe((state) => {
    reconcileChatPersistentHighlight(state.quotedSelection);
  });

  const cleanup = () => {
    target.removeEventListener('selectionchange', handleSelectionChange);
    unsubscribeQuotedSelection();
    clearChatPersistentHighlight();
    if (quotedSelectionLifecycle?.target === target) {
      quotedSelectionLifecycle = null;
    }
  };
  quotedSelectionLifecycle = { target, cleanup };
  return cleanup;
}

/**
 * 捕获 previewItem 中的文本选中。
 * CM 模式传入 cmView，DOM 模式不传。
 */
export function captureSelection(previewItem: PreviewItem, cmView?: EditorView): void {
  if (cmView) {
    captureCMSelection(previewItem, cmView);
  } else {
    captureDOMSelection(previewItem);
  }
}

function captureCMSelection(previewItem: PreviewItem, view: EditorView): void {
  const { from, to } = view.state.selection.main;
  if (from === to) {
    clearSelection(previewClearScope(previewItem));
    return;
  }
  const rawText = view.state.sliceDoc(from, to);
  const text = rawText.trim();
  if (!text) {
    clearSelection(previewClearScope(previewItem));
    return;
  }
  clearChatPersistentHighlight();
  const leadingTrimmed = rawText.length - rawText.trimStart().length;
  const trailingTrimmed = rawText.length - rawText.trimEnd().length;
  const textStart = from + leadingTrimmed;
  const textEnd = to - trailingTrimmed;
  const lineStart = view.state.doc.lineAt(textStart).number;
  const lineEnd = view.state.doc.lineAt(Math.max(textStart, textEnd - 1)).number;

  useStore.getState().setQuotedSelection({
    text,
    sourceTitle: previewItem.title,
    sourceKind: 'preview',
    sourceFilePath: previewItem.filePath,
    lineStart,
    lineEnd,
    charCount: text.length,
    anchorRect: getCMSelectionAnchorRect(view, textStart, textEnd),
    updatedAt: Date.now(),
  });
}

function captureDOMSelection(previewItem: PreviewItem): void {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text) {
    clearSelection(previewClearScope(previewItem));
    return;
  }
  clearChatPersistentHighlight();
  const clipped = clipQuotedText(text);

  useStore.getState().setQuotedSelection({
    text: clipped,
    sourceTitle: previewItem.title,
    sourceKind: 'preview',
    sourceFilePath: previewItem.filePath,
    charCount: text.length,
    anchorRect: sel && sel.rangeCount > 0 ? getRangeAnchorRect(sel.getRangeAt(0)) : undefined,
    updatedAt: Date.now(),
  });
}

export function captureChatSelection(sessionPath: string): void {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!sel || !text || sel.rangeCount === 0) {
    clearSelection({ sourceKind: 'chat', sourceSessionPath: sessionPath });
    return;
  }

  const anchorElement = nodeElement(sel.anchorNode);
  const focusElement = nodeElement(sel.focusNode);
  if (!anchorElement || !focusElement) return;
  if (isInteractiveSelectionElement(anchorElement) || isInteractiveSelectionElement(focusElement)) return;

  const anchorMessage = closestMessageElement(anchorElement);
  const focusMessage = closestMessageElement(focusElement);
  if (!anchorMessage || !focusMessage || anchorMessage !== focusMessage) return;

  const messageId = anchorMessage.dataset.messageId;
  if (!messageId) return;

  const message = findMessage(sessionPath, messageId);
  if (!message) return;

  const quotedSelection: QuotedSelection = {
    text: clipQuotedText(text),
    sourceTitle: message.role === 'assistant' ? 'Assistant message' : 'User message',
    sourceKind: 'chat',
    sourceSessionPath: sessionPath,
    sourceMessageId: message.id,
    sourceRole: message.role,
    charCount: text.length,
    anchorRect: getRangeAnchorRect(sel.getRangeAt(0)),
    updatedAt: Date.now(),
  };
  setChatPersistentHighlight(sel.getRangeAt(0), quotedSelection);
  useStore.getState().setQuotedSelection(quotedSelection);
}

function clipQuotedText(text: string): string {
  return text.length > MAX_QUOTED_SELECTION_CHARS ? text.slice(0, MAX_QUOTED_SELECTION_CHARS) : text;
}

function nodeElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

function closestMessageElement(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>('[data-message-id]');
}

function isInteractiveSelectionElement(element: Element): boolean {
  return !!element.closest('input, textarea, select, button, [contenteditable="true"], [data-selection-ignore="true"], [data-mobile-gesture-ignore="true"]');
}

function findMessage(sessionPath: string, messageId: string): ChatMessage | null {
  const session = useStore.getState().chatSessions[sessionPath];
  if (!session) return null;
  for (const item of session.items) {
    if (item.type === 'message' && item.data.id === messageId) return item.data;
  }
  return null;
}

function toPlainRect(rect: DOMRect | ClientRect): FloatingAnchorRect {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function unionRects(rects: Array<DOMRect | ClientRect>): FloatingAnchorRect | undefined {
  if (rects.length === 0) return undefined;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) return undefined;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

export function getRangeAnchorRect(range: Range): FloatingAnchorRect | undefined {
  const clientRects = typeof range.getClientRects === 'function'
    ? Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0)
    : [];
  if (clientRects.length > 0) return unionRects(clientRects);

  if (typeof range.getBoundingClientRect !== 'function') return undefined;
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return undefined;
  return toPlainRect(rect);
}

function getCMSelectionAnchorRect(view: EditorView, from: number, to: number): FloatingAnchorRect | undefined {
  const withCoords = view as EditorView & {
    coordsAtPos?: (pos: number, side?: -1 | 1) => DOMRect | null;
  };
  if (typeof withCoords.coordsAtPos !== 'function') return undefined;

  const start = withCoords.coordsAtPos(from, 1);
  const end = withCoords.coordsAtPos(to, -1) || withCoords.coordsAtPos(Math.max(from, to - 1), 1);
  const rects = [start, end].filter((rect): rect is DOMRect => !!rect);
  return unionRects(rects);
}

export function clearSelection(scope?: QuoteClearScope): void {
  const s = useStore.getState();
  if (s.quotedSelection && quotedSelectionMatchesScope(s.quotedSelection, scope)) {
    if (s.quotedSelection.sourceKind === 'chat') clearChatPersistentHighlight();
    s.clearQuotedSelection();
  }
}

function clearSelectionIfNativeSelectionIsEmpty(target: Document): void {
  const current = useStore.getState().quotedSelection;
  if (!current) return;
  const sel = getNativeSelection(target);
  const text = sel?.toString().trim();
  if (sel && text && sel.rangeCount > 0) return;
  if (!sel || sel.rangeCount === 0) return;

  if (current.sourceKind === 'chat' && nativeSelectionBelongsToChatSource(sel, current)) {
    clearSelection({
      sourceKind: 'chat',
      sourceSessionPath: current.sourceSessionPath,
      sourceMessageId: current.sourceMessageId,
    });
  }
}

function getNativeSelection(target: Document): Selection | null {
  if (typeof target.getSelection === 'function') {
    return target.getSelection();
  }
  return target.defaultView?.getSelection?.() ?? window.getSelection();
}

function previewClearScope(previewItem: PreviewItem): QuoteClearScope {
  return previewItem.filePath
    ? { sourceKind: 'preview', sourceFilePath: previewItem.filePath }
    : { sourceKind: 'preview' };
}

function quotedSelectionMatchesScope(selection: QuotedSelection, scope?: QuoteClearScope): boolean {
  if (!scope) return true;
  if (scope.sourceKind && selection.sourceKind !== scope.sourceKind) return false;
  if (scope.sourceFilePath !== undefined && selection.sourceFilePath !== scope.sourceFilePath) return false;
  if (scope.sourceSessionPath !== undefined && selection.sourceSessionPath !== scope.sourceSessionPath) return false;
  if (scope.sourceMessageId !== undefined && selection.sourceMessageId !== scope.sourceMessageId) return false;
  return true;
}

function nativeSelectionBelongsToChatSource(selection: Selection, quotedSelection: QuotedSelection): boolean {
  const anchorElement = nodeElement(selection.anchorNode);
  const focusElement = nodeElement(selection.focusNode);
  if (!anchorElement || !focusElement) return false;

  const anchorRoot = closestChatSelectionRoot(anchorElement);
  const focusRoot = closestChatSelectionRoot(focusElement);
  if (!anchorRoot || anchorRoot !== focusRoot) return false;

  const sessionPath = anchorRoot.dataset.sessionPath || null;
  return !quotedSelection.sourceSessionPath || sessionPath === quotedSelection.sourceSessionPath;
}

function closestChatSelectionRoot(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>('[data-chat-selection-root]');
}

function setChatPersistentHighlight(range: Range, quotedSelection: QuotedSelection): void {
  const registry = getHighlightRegistry();
  if (!registry) {
    activeChatHighlightIdentity = null;
    return;
  }
  registry.set(CHAT_QUOTE_HIGHLIGHT_NAME, new Highlight(range.cloneRange()));
  activeChatHighlightIdentity = chatHighlightIdentity(quotedSelection);
}

function clearChatPersistentHighlight(): void {
  getHighlightRegistry()?.delete(CHAT_QUOTE_HIGHLIGHT_NAME);
  activeChatHighlightIdentity = null;
}

function reconcileChatPersistentHighlight(quotedSelection: QuotedSelection | null): void {
  if (
    quotedSelection?.sourceKind === 'chat'
    && activeChatHighlightIdentity
    && chatHighlightMatchesSelection(activeChatHighlightIdentity, quotedSelection)
  ) {
    return;
  }
  if (activeChatHighlightIdentity) clearChatPersistentHighlight();
}

function chatHighlightIdentity(selection: QuotedSelection): ChatHighlightIdentity {
  return {
    sourceSessionPath: selection.sourceSessionPath,
    sourceMessageId: selection.sourceMessageId,
    text: selection.text,
    updatedAt: selection.updatedAt,
  };
}

function chatHighlightMatchesSelection(identity: ChatHighlightIdentity, selection: QuotedSelection): boolean {
  return selection.sourceSessionPath === identity.sourceSessionPath
    && selection.sourceMessageId === identity.sourceMessageId
    && selection.text === identity.text
    && selection.updatedAt === identity.updatedAt;
}

function getHighlightRegistry(): HighlightRegistryWithMutation | null {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return null;
  const registry = CSS.highlights as HighlightRegistryWithMutation;
  if (typeof registry.set !== 'function' || typeof registry.delete !== 'function') return null;
  return registry;
}
