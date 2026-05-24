// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureChatSelection, captureSelection, clearSelection, initQuotedSelectionLifecycle } from '../../stores/selection-actions';
import { useStore } from '../../stores';
import type { PreviewItem } from '../../types';

const previewItem: PreviewItem = {
  id: 'preview-1',
  title: 'note.md',
  type: 'markdown',
  content: '',
  filePath: '/notes/note.md',
};

describe('captureSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
    useStore.getState().clearQuotedSelection();
    useStore.setState({ selectedIdsBySession: {}, chatSessions: {} } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the trimmed quoted text range for lineEnd when selection includes a trailing newline', () => {
    const doc = 'alpha\nbeta\ngamma';
    const state = EditorState.create({
      doc,
      selection: { anchor: 6, head: 11 },
    });

    captureSelection(previewItem, { state } as EditorView);

    expect(useStore.getState().quotedSelection).toMatchObject({
      text: 'beta',
      sourceTitle: 'note.md',
      sourceKind: 'preview',
      sourceFilePath: '/notes/note.md',
      lineStart: 2,
      lineEnd: 2,
      charCount: 4,
    });
  });

  it('sets explicit message selection per session and removes empty session entries', () => {
    const state = useStore.getState();

    state.setMessageSelection('/session/a.jsonl', ['m2', 'm1', 'm2']);

    expect(useStore.getState().selectedIdsBySession['/session/a.jsonl']).toEqual(['m2', 'm1']);

    useStore.getState().setMessageSelection('/session/a.jsonl', []);

    expect(useStore.getState().selectedIdsBySession['/session/a.jsonl']).toBeUndefined();
  });

  it('captures selected assistant chat text as a composer quote with explicit message ownership', () => {
    useStore.setState({
      chatSessions: {
        '/session/a.jsonl': {
          items: [
            {
              type: 'message',
              data: {
                id: 'assistant-1',
                role: 'assistant',
                blocks: [{ type: 'text', html: '<p>这段文字值得引用</p>', source: '这段文字值得引用' }],
              },
            },
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
    } as never);
    document.body.innerHTML = `
      <article data-message-id="assistant-1">
        <p><span id="selected-text">这段文字值得引用</span></p>
      </article>
    `;
    selectElementText(document.getElementById('selected-text')!);

    captureChatSelection('/session/a.jsonl');

    expect(useStore.getState().quotedSelection).toMatchObject({
      text: '这段文字值得引用',
      sourceKind: 'chat',
      sourceSessionPath: '/session/a.jsonl',
      sourceMessageId: 'assistant-1',
      sourceRole: 'assistant',
      charCount: 8,
    });
  });

  it('keeps an existing chat quote when composer focus cancels the native selection', () => {
    const dispose = initQuotedSelectionLifecycle(document);
    try {
      useStore.setState({
        quotedSelection: {
          text: 'old quote',
          sourceTitle: 'Assistant message',
          sourceKind: 'chat',
          sourceSessionPath: '/session/a.jsonl',
          sourceMessageId: 'assistant-1',
          sourceRole: 'assistant',
          charCount: 9,
        },
      } as never);
      document.body.innerHTML = '<textarea id="composer"></textarea>';
      document.getElementById('composer')?.focus();

      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));

      expect(useStore.getState().quotedSelection).toMatchObject({
        text: 'old quote',
        sourceKind: 'chat',
      });
    } finally {
      dispose();
    }
  });

  it('keeps the chat-owned visual highlight when composer focus cancels the native selection', () => {
    const highlights = installHighlightApi();
    const dispose = initQuotedSelectionLifecycle(document);
    try {
      useStore.setState({
        chatSessions: {
          '/session/a.jsonl': {
            items: [
              {
                type: 'message',
                data: {
                  id: 'assistant-1',
                  role: 'assistant',
                  blocks: [{ type: 'text', html: '<p>这段文字值得引用</p>', source: '这段文字值得引用' }],
                },
              },
            ],
            hasMore: false,
            loadingMore: false,
          },
        },
      } as never);
      document.body.innerHTML = `
        <section data-chat-selection-root="" data-session-path="/session/a.jsonl">
          <article data-message-id="assistant-1">
            <p><span id="selected-text">这段文字值得引用</span></p>
          </article>
        </section>
        <textarea id="composer"></textarea>
      `;
      selectElementText(document.getElementById('selected-text')!);
      captureChatSelection('/session/a.jsonl');

      expect(highlights.has('hana-chat-quoted-selection')).toBe(true);

      document.getElementById('composer')?.focus();
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));

      expect(useStore.getState().quotedSelection).toMatchObject({
        text: '这段文字值得引用',
        sourceKind: 'chat',
      });
      expect(highlights.has('hana-chat-quoted-selection')).toBe(true);
    } finally {
      dispose();
    }
  });

  it('removes the chat-owned visual highlight when the quote is cleared directly', () => {
    const highlights = installHighlightApi();
    const dispose = initQuotedSelectionLifecycle(document);
    try {
      useStore.setState({
        chatSessions: {
          '/session/a.jsonl': {
            items: [
              {
                type: 'message',
                data: {
                  id: 'assistant-1',
                  role: 'assistant',
                  blocks: [{ type: 'text', html: '<p>这段文字值得引用</p>', source: '这段文字值得引用' }],
                },
              },
            ],
            hasMore: false,
            loadingMore: false,
          },
        },
      } as never);
      document.body.innerHTML = `
        <section data-chat-selection-root="" data-session-path="/session/a.jsonl">
          <article data-message-id="assistant-1">
            <p><span id="selected-text">这段文字值得引用</span></p>
          </article>
        </section>
      `;
      selectElementText(document.getElementById('selected-text')!);
      captureChatSelection('/session/a.jsonl');

      expect(highlights.has('hana-chat-quoted-selection')).toBe(true);

      useStore.getState().clearQuotedSelection();

      expect(highlights.has('hana-chat-quoted-selection')).toBe(false);
    } finally {
      dispose();
    }
  });

  it('clears an existing chat quote when the collapsed native selection remains in the same chat session', () => {
    const highlights = installHighlightApi();
    const dispose = initQuotedSelectionLifecycle(document);
    try {
      useStore.setState({
        chatSessions: {
          '/session/a.jsonl': {
            items: [
              {
                type: 'message',
                data: {
                  id: 'assistant-1',
                  role: 'assistant',
                  blocks: [{ type: 'text', html: '<p>inside chat</p>', source: 'inside chat' }],
                },
              },
            ],
            hasMore: false,
            loadingMore: false,
          },
        },
      } as never);
      document.body.innerHTML = `
        <section data-chat-selection-root="" data-session-path="/session/a.jsonl">
          <article data-message-id="assistant-1">
            <span id="selected-text">inside chat</span>
            <span id="caret-host">cancel here</span>
          </article>
        </section>
      `;
      selectElementText(document.getElementById('selected-text')!);
      captureChatSelection('/session/a.jsonl');
      expect(highlights.has('hana-chat-quoted-selection')).toBe(true);

      placeCollapsedSelection(document.getElementById('caret-host')!);

      document.dispatchEvent(new Event('selectionchange'));

      expect(useStore.getState().quotedSelection).toBeNull();
      expect(highlights.has('hana-chat-quoted-selection')).toBe(false);
    } finally {
      dispose();
    }
  });

  it('keeps an existing preview quote when chat capture sees an empty selection', () => {
    useStore.setState({
      quotedSelection: {
        text: 'preview quote',
        sourceTitle: 'note.md',
        sourceKind: 'preview',
        sourceFilePath: '/notes/note.md',
        charCount: 13,
      },
    } as never);

    window.getSelection()?.removeAllRanges();
    captureChatSelection('/session/a.jsonl');

    expect(useStore.getState().quotedSelection).toMatchObject({
      text: 'preview quote',
      sourceKind: 'preview',
    });
  });

  it('clears only quotes matching the requested source scope', () => {
    useStore.setState({
      quotedSelection: {
        text: 'chat quote',
        sourceTitle: 'Assistant message',
        sourceKind: 'chat',
        sourceSessionPath: '/session/a.jsonl',
        sourceMessageId: 'assistant-1',
        sourceRole: 'assistant',
        charCount: 10,
      },
    } as never);

    clearSelection({ sourceKind: 'preview' });

    expect(useStore.getState().quotedSelection).toMatchObject({
      text: 'chat quote',
      sourceKind: 'chat',
    });

    clearSelection({ sourceKind: 'chat', sourceSessionPath: '/session/a.jsonl' });

    expect(useStore.getState().quotedSelection).toBeNull();
  });

  it('clears an existing quote when chat capture sees an empty selection', () => {
    useStore.setState({
      quotedSelection: {
        text: 'old quote',
        sourceTitle: 'Assistant message',
        sourceKind: 'chat',
        sourceSessionPath: '/session/a.jsonl',
        sourceMessageId: 'assistant-1',
        sourceRole: 'assistant',
        charCount: 9,
      },
    } as never);

    window.getSelection()?.removeAllRanges();
    captureChatSelection('/session/a.jsonl');

    expect(useStore.getState().quotedSelection).toBeNull();
  });

  it('ignores cross-message chat selections instead of stealing ambiguous ownership', () => {
    useStore.setState({
      quotedSelection: {
        text: 'existing',
        sourceTitle: 'existing source',
        sourceKind: 'preview',
        charCount: 8,
      },
      chatSessions: {
        '/session/a.jsonl': {
          items: [
            { type: 'message', data: { id: 'user-1', role: 'user', text: '第一条' } },
            { type: 'message', data: { id: 'assistant-1', role: 'assistant', blocks: [] } },
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
    } as never);
    document.body.innerHTML = `
      <article data-message-id="user-1"><span id="start-text">第一条</span></article>
      <article data-message-id="assistant-1"><span id="end-text">第二条</span></article>
    `;
    selectAcrossElements(
      document.getElementById('start-text')!,
      document.getElementById('end-text')!,
    );

    captureChatSelection('/session/a.jsonl');

    expect(useStore.getState().quotedSelection).toMatchObject({
      text: 'existing',
      sourceKind: 'preview',
    });
  });

  it('ignores selections inside chat action buttons', () => {
    useStore.setState({
      quotedSelection: null,
      chatSessions: {
        '/session/a.jsonl': {
          items: [
            { type: 'message', data: { id: 'assistant-1', role: 'assistant', blocks: [] } },
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
    } as never);
    document.body.innerHTML = `
      <article data-message-id="assistant-1">
        <button type="button"><span id="button-text">复制</span></button>
      </article>
    `;
    selectElementText(document.getElementById('button-text')!);

    captureChatSelection('/session/a.jsonl');

    expect(useStore.getState().quotedSelection).toBeNull();
  });
});

function selectElementText(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectAcrossElements(startElement: HTMLElement, endElement: HTMLElement): void {
  const startNode = startElement.firstChild;
  const endNode = endElement.firstChild;
  if (!startNode || !endNode) throw new Error('test fixture must contain text nodes');
  const range = document.createRange();
  range.setStart(startNode, 0);
  range.setEnd(endNode, endNode.textContent?.length || 0);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCollapsedSelection(element: HTMLElement): void {
  const textNode = element.firstChild;
  if (!textNode) throw new Error('test fixture must contain a text node');
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function installHighlightApi(): Map<string, Highlight> {
  const highlights = new Map<string, Highlight>();
  const registry: Pick<HighlightRegistry, 'forEach'> & {
    set: (name: string, highlight: Highlight) => void;
    delete: (name: string) => boolean;
  } = {
    set: (name, highlight) => { highlights.set(name, highlight); },
    delete: (name) => highlights.delete(name),
    forEach: (callback, thisArg) => {
      highlights.forEach((value, key) => callback.call(thisArg, value, key, registry as HighlightRegistry));
    },
  };
  class TestHighlight extends Set<AbstractRange> {
    priority = 0;
    type: HighlightType = 'highlight';

    constructor(...initialRanges: AbstractRange[]) {
      super(initialRanges);
    }
  }

  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', TestHighlight);
  return highlights;
}
