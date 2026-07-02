import React, { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import './style.css';

type DiffPayload = {
  diffText: string;
  viewType?: 'unified' | 'split';
  comments?: DiffCommentPayload[];
};

type DiffCommentPayload = {
  id: string;
  lineNumber: number;
  quote: string;
  note: string;
};

type PendingCommentTarget = {
  lineNumber: number | null;
  lineNumbers: number[];
  quote: string;
  top: number;
};

type InlineComment = PendingCommentTarget & {
  id: string;
  note: string;
};

declare global {
  interface Window {
    PikiclawDiffViewer?: {
      render: (payload: DiffPayload) => void;
    };
    webkit?: {
      messageHandlers?: {
        pikiclawDiffComment?: {
          postMessage: (payload: { lineNumber: number | null; lineNumbers: number[]; quote: string; note: string }) => void;
        };
      };
    };
  }
}

function DiffFile({ diffText, viewType = 'unified', comments = [] }: DiffPayload) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [commentTarget, setCommentTarget] = useState<PendingCommentTarget | null>(null);
  const [draftTarget, setDraftTarget] = useState<PendingCommentTarget | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [inlineComments, setInlineComments] = useState<InlineComment[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const files = useMemo(() => {
    try {
      return parseDiff(diffText || '', { nearbySequences: 'zip' });
    } catch (error) {
      console.error(error);
      return [];
    }
  }, [diffText]);

  useEffect(() => {
    setCommentTarget(null);
    setDraftTarget(null);
    setDraftNote('');
    setInlineComments([]);
    setActiveCommentId(null);
  }, [diffText]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const shell = shellRef.current;
      if (!shell) return;
      setInlineComments(
        comments
          .map((comment) => {
            const row = rowForLineNumber(shell, comment.lineNumber);
            if (!row) return null;
            const rowRect = row.getBoundingClientRect();
            const shellRect = shell.getBoundingClientRect();
            return {
              id: comment.id,
              lineNumber: comment.lineNumber,
              lineNumbers: [comment.lineNumber],
              quote: comment.quote,
              note: comment.note,
              top: rowRect.top - shellRect.top + shell.scrollTop,
            } satisfies InlineComment;
          })
          .filter((comment): comment is InlineComment => comment !== null),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [comments, files]);

  if (!diffText.trim()) {
    return <div className="empty">No textual diff available for this file.</div>;
  }

  if (files.length === 0) {
    return <pre className="raw">{diffText}</pre>;
  }

  const markCommentTarget = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('.comment-button, .inline-comment-editor, .inline-comment-marker, .inline-comment-popover')) {
      return;
    }
    const shell = shellRef.current;
    if (!shell) {
      setCommentTarget(null);
      return;
    }

    const selection = window.getSelection()?.toString().trim() || '';
    const selectedRows = rowsFromSelection(shell);
    const row = (selectedRows[0] || (event.target as HTMLElement).closest('.diff-line')) as HTMLElement | null;
    if (!row) {
      setCommentTarget(null);
      return;
    }

    const targetRows = selectedRows.length > 0 ? selectedRows : [row];
    const rowQuote = targetRows
      .map((targetRow) => targetRow.querySelector('.diff-code-content')?.textContent?.trim() || '')
      .filter(Boolean)
      .join('\n');
    const quote = selection || rowQuote;
    if (!quote) {
      setCommentTarget(null);
      return;
    }

    const lineNumbers = targetRows.map(lineNumberFromRow).filter((lineNumber): lineNumber is number => lineNumber !== null);
    const firstLineNumber = lineNumbers[0] ?? null;
    const rowRect = row.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    setCommentTarget({
      lineNumber: firstLineNumber,
      lineNumbers,
      quote,
      top: rowRect.top - shellRect.top + shell.scrollTop,
    });
  };

  const openCommentEditor = () => {
    if (!commentTarget) return;
    setDraftTarget(commentTarget);
    setDraftNote('');
    setCommentTarget(null);
  };

  const cancelCommentEditor = () => {
    setDraftTarget(null);
    setDraftNote('');
  };

  const submitCommentTarget = () => {
    if (!draftTarget) return;
    const note = draftNote.trim();
    if (!note) return;
    window.webkit?.messageHandlers?.pikiclawDiffComment?.postMessage({
      lineNumber: draftTarget.lineNumber,
      lineNumbers: draftTarget.lineNumbers,
      quote: draftTarget.quote,
      note,
    });
    setDraftTarget(null);
    setDraftNote('');
    setActiveCommentId(null);
    window.getSelection()?.removeAllRanges();
  };

  const commentButtonStyle: CSSProperties | undefined = commentTarget
    ? { top: Math.max(4, commentTarget.top + 1) }
    : undefined;
  const editorStyle: CSSProperties | undefined = draftTarget
    ? { top: Math.max(4, draftTarget.top + 26) }
    : undefined;
  const activeComment = inlineComments.find((comment) => comment.id === activeCommentId) ?? null;
  const popoverStyle: CSSProperties | undefined = activeComment
    ? { top: Math.max(4, activeComment.top + 24) }
    : undefined;

  return (
    <div ref={shellRef} className="diff-shell" onMouseUp={markCommentTarget} onClick={markCommentTarget}>
      {inlineComments.map((comment) => (
        <button
          key={comment.id}
          className="inline-comment-marker"
          style={{ top: Math.max(4, comment.top + 1) }}
          title={comment.note}
          onClick={(event) => {
            event.stopPropagation();
            setCommentTarget(null);
            setDraftTarget(null);
            setActiveCommentId(activeCommentId === comment.id ? null : comment.id);
          }}
        >
          ◔
        </button>
      ))}
      {activeComment && (
        <div className="inline-comment-popover" style={popoverStyle} onClick={(event) => event.stopPropagation()}>
          <div className="inline-comment-popover-title">Review comment</div>
          <div className="inline-comment-popover-note">{activeComment.note || 'No comment text.'}</div>
          <div className="inline-comment-popover-quote">{activeComment.quote}</div>
        </div>
      )}
      {commentTarget && (
        <button className="comment-button" style={commentButtonStyle} onClick={openCommentEditor} title="Add review comment">
          +
        </button>
      )}
      {draftTarget && (
        <div className="inline-comment-editor" style={editorStyle}>
          <textarea
            autoFocus
            value={draftNote}
            placeholder="Add review comment"
            onChange={(event) => setDraftNote(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                submitCommentTarget();
              }
              if (event.key === 'Escape') {
                cancelCommentEditor();
              }
            }}
          />
          <div className="inline-comment-actions">
            <button onClick={submitCommentTarget} disabled={!draftNote.trim()}>
              Add comment
            </button>
            <button onClick={cancelCommentEditor}>Cancel</button>
          </div>
        </div>
      )}
      {files.map((file, index) => (
        <Diff
          key={`${file.oldRevision}-${file.newRevision}-${index}`}
          viewType={viewType}
          diffType={file.type}
          hunks={file.hunks}
          gutterType="default"
          optimizeSelection
        >
          {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
      ))}
    </div>
  );
}

function rowsFromSelection(shell: HTMLElement): HTMLElement[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  return Array.from(shell.querySelectorAll<HTMLElement>('.diff-line')).filter((row) => {
    try {
      return range.intersectsNode(row);
    } catch {
      return false;
    }
  });
}

function lineNumberFromRow(row: Element): number | null {
  const gutterText = Array.from(row.querySelectorAll('.diff-gutter'))
    .map((node) => node.textContent?.trim() || '')
    .filter(Boolean)
    .pop();
  const parsed = gutterText ? Number.parseInt(gutterText, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function rowForLineNumber(shell: HTMLElement, lineNumber: number): HTMLElement | null {
  if (!lineNumber) return null;
  return (
    Array.from(shell.querySelectorAll<HTMLElement>('.diff-line')).find((row) => lineNumberFromRow(row) === lineNumber) ?? null
  );
}

function App() {
  const [payload, setPayload] = useState<DiffPayload>({ diffText: '' });

  useEffect(() => {
    window.PikiclawDiffViewer = {
      render(nextPayload) {
        setPayload(nextPayload);
      },
    };

    const receiveMessage = (event: MessageEvent<DiffPayload>) => {
      if (event.data && typeof event.data.diffText === 'string') {
        setPayload(event.data);
      }
    };
    window.addEventListener('message', receiveMessage);
    return () => {
      window.removeEventListener('message', receiveMessage);
    };
  }, []);

  return <DiffFile {...payload} />;
}

createRoot(document.getElementById('root')!).render(<App />);
