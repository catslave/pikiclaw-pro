import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import { cn } from '../../utils';

const IconChat = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-5 4v-4A2 2 0 0 1 4 13z" />
    <path d="M8 8h8" />
    <path d="M8 11.5h5" />
  </svg>
);

const IconSend = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m22 2-7 20-4-9-9-4z" />
    <path d="M22 2 11 13" />
  </svg>
);

export function FocusCanvasPage() {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState('');
  const defaultAgent = useStore(state => (
    state.state?.bot?.defaultAgent
    || state.state?.config?.defaultAgent
    || 'codex'
  ));

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submitChat = useCallback(() => {
    const prompt = draft.trim();
    if (!prompt) return;
    navigate('/', {
      state: {
        forceWorkspace: true,
        newSessionAgent: defaultAgent,
        newSessionPrompt: prompt,
        newSessionAutoSend: true,
        newSessionNonce: Date.now(),
      },
    });
  }, [defaultAgent, draft, navigate]);

  return (
    <div className="flex h-full items-center justify-center px-5">
      <form
        className="w-full max-w-[720px]"
        onSubmit={event => {
          event.preventDefault();
          submitChat();
        }}
      >
        <div className="rounded-[28px] border border-edge bg-panel px-5 py-4 shadow-[0_18px_60px_rgba(2,6,23,0.10)]">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              submitChat();
            }}
            rows={3}
            placeholder="Ask Pikiclaw"
            className="max-h-48 min-h-24 w-full resize-none bg-transparent text-[17px] leading-relaxed text-fg outline-none placeholder:text-fg-5"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex h-9 items-center gap-2 rounded-full border border-edge bg-panel-alt px-3 text-xs font-medium text-fg-4">
              {IconChat}
              Chat
            </div>
            <button
              type="submit"
              disabled={!draft.trim()}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-full border transition',
                draft.trim()
                  ? 'border-transparent bg-primary text-primary-fg hover:bg-primary-hover'
                  : 'border-edge bg-panel-alt text-fg-5 opacity-60',
              )}
              aria-label="Send"
            >
              {IconSend}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export { FocusCanvasPage as FocusKnowledgePage };
