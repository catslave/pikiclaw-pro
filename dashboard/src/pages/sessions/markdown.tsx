import { useEffect, useState, type ReactNode } from 'react';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '../../utils';
import { api } from '../../api';

export const mdPlugins = [remarkGfm, remarkBreaks];

const isWebUrl = (href: string) => /^https?:\/\//.test(href);
const isFilePath = (href: string) => /^(file:\/\/|\/|~\/|\.\.?\/|[A-Za-z]:[\\/]|[^:#?]+[\\/])/.test(href);

export type FileLinkTarget = { path: string; line?: number };
export type OpenFileLinkHandler = (target: FileLinkTarget) => void;

const remoteBranchUrlCache = new Map<string, string | null>();

function safeDecodeHref(href: string): string {
  try { return decodeURI(href); } catch { return href; }
}

export function parseFileLinkTarget(rawHref: string): FileLinkTarget | null {
  let href = safeDecodeHref(String(rawHref || '').trim());
  if (!href || isWebUrl(href)) return null;
  if (href.startsWith('file://')) {
    try {
      const url = new URL(href);
      href = decodeURIComponent(url.pathname);
    } catch {
      href = href.replace(/^file:\/\//, '');
    }
  }

  let line: number | undefined;
  const hashLine = href.match(/^(.*)#L?(\d+)(?:[-:]\d+)?$/i);
  if (hashLine) {
    href = hashLine[1];
    line = Number(hashLine[2]);
  } else {
    const suffixLine = href.match(/^(.*):(\d+)(?::\d+)?$/);
    if (suffixLine && isFilePath(suffixLine[1])) {
      href = suffixLine[1];
      line = Number(suffixLine[2]);
    }
  }

  if (!isFilePath(href)) return null;
  return Number.isFinite(line) && line && line > 0
    ? { path: href, line }
    : { path: href };
}

function defaultOpenFileLink(target: FileLinkTarget) {
  void api.openInEditor(target.path);
}

function fileLinkTitle(target: FileLinkTarget): string {
  return target.line ? `${target.path}:${target.line}` : target.path;
}

function TargetTooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span title={label}>{children}</span>;
}

function looksLikeRemoteBranchRef(text: string): boolean {
  return /^[A-Za-z0-9._-]+\/[^\s\\~^:?*[\]]+$/.test(text)
    && !text.includes('//')
    && !text.endsWith('/');
}

/* ── Copy button for fenced code blocks ── */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); };
  return (
    <button onClick={copy} className="flex items-center text-fg-5/50 hover:text-fg-3 transition-colors">
      {copied
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      }
    </button>
  );
}

export function classifyCode(text: string): string {
  const isPath = /^[.~/].*\.\w+$/.test(text) || /^[a-z][\w-]*\//.test(text);
  const isCmd = /^(npm |npx |git |python|pip |yarn |pnpm |cargo |go |make )/.test(text);
  if (isPath) return 'bg-blue-500/8 border-blue-400/12 text-blue-300/90';
  if (isCmd) return 'bg-amber-500/8 border-amber-400/10 text-amber-300/80';
  return 'bg-[rgba(255,255,255,0.06)] border-edge/20 text-fg-3';
}

function themeValue(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function MermaidBlock({ text }: { text: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    const render = async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            background: 'transparent',
            primaryColor: themeValue('--th-panel', '#0f172a'),
            primaryTextColor: themeValue('--th-fg', '#f8fafc'),
            primaryBorderColor: themeValue('--th-edge-h', '#64748b'),
            lineColor: themeValue('--th-fg-5', '#94a3b8'),
            secondaryColor: themeValue('--th-panel-alt', '#1e293b'),
            tertiaryColor: themeValue('--th-session-bg', '#111827'),
            textColor: themeValue('--th-fg-2', '#e2e8f0'),
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
        });
        const renderId = `mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const result = await mermaid.render(renderId, text);
        if (!cancelled) setSvg(result.svg);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    void render();
    return () => { cancelled = true; };
  }, [text]);

  return (
    <div className="rounded-lg overflow-hidden border border-edge/30 bg-[var(--th-code-block-bg)] my-3 not-prose">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-edge/15 bg-[var(--th-code-block-header)]">
        <span className="text-[10px] font-mono text-fg-5/60">mermaid</span>
        <CopyButton text={text} />
      </div>
      <div className="overflow-x-auto px-3.5 py-3">
        {svg ? (
          <div
            className="min-w-fit [&>svg]:h-auto [&>svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : error ? (
          <div className="space-y-2">
            <div className="rounded-md border border-err/25 bg-err/[0.06] px-3 py-2 text-[12px] leading-[1.6] text-err">
              {error}
            </div>
            <pre className="text-[12px] leading-[1.65] text-fg-3 font-mono whitespace-pre-wrap break-words">
              <code>{text}</code>
            </pre>
          </div>
        ) : (
          <div className="text-[12px] text-fg-5">Rendering diagram...</div>
        )}
      </div>
    </div>
  );
}

function RemoteBranchCode({ text, workdir, className }: { text: string; workdir: string; className: string }) {
  const cacheKey = `${workdir}\0${text}`;
  const [url, setUrl] = useState<string | null | undefined>(() => remoteBranchUrlCache.get(cacheKey));

  useEffect(() => {
    if (url !== undefined) return;
    let cancelled = false;
    void api.gitRemoteBranchUrl(workdir, text)
      .then(res => {
        const nextUrl = res.ok && res.url ? res.url : null;
        remoteBranchUrlCache.set(cacheKey, nextUrl);
        if (!cancelled) setUrl(nextUrl);
      })
      .catch(() => {
        remoteBranchUrlCache.set(cacheKey, null);
        if (!cancelled) setUrl(null);
      });
    return () => { cancelled = true; };
  }, [cacheKey, text, url, workdir]);

  if (!url) return <code className={className}>{text}</code>;
  return (
    <TargetTooltip label={url}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(className, 'inline-flex cursor-pointer items-center hover:brightness-125')}
        aria-label={url}
      >
        {text}
      </a>
    </TargetTooltip>
  );
}

export function createMdComponents({ onOpenFileLink, workdir }: { onOpenFileLink?: OpenFileLinkHandler; workdir?: string } = {}): Record<string, React.ComponentType<any>> {
  const openFileLink = onOpenFileLink || defaultOpenFileLink;
  return {
  h1: ({ children }: any) => <h2 className="text-[16px] font-bold text-fg mt-4 mb-2">{children}</h2>,
  h2: ({ children }: any) => <h3 className="text-[14.5px] font-semibold text-fg mt-4 mb-1.5">{children}</h3>,
  h3: ({ children }: any) => <h4 className="text-[13.5px] font-semibold text-fg mt-3 mb-1">{children}</h4>,
  p: ({ children }: any) => <p className="my-1.5 whitespace-pre-wrap break-words">{children}</p>,
  strong: ({ children }: any) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }: any) => <em className="italic text-fg-3">{children}</em>,
  a: ({ href, children }: any) => {
    if (href && isWebUrl(href)) {
      return (
        <TargetTooltip label={href}>
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={href} className="text-blue-400 underline underline-offset-2 decoration-blue-400/30 cursor-pointer hover:text-blue-300 transition-colors">{children}</a>
        </TargetTooltip>
      );
    }
    const fileTarget = href ? parseFileLinkTarget(href) : null;
    if (fileTarget) {
      const title = fileLinkTitle(fileTarget);
      return (
        <TargetTooltip label={title}>
          <button
            type="button"
            data-copy-path={title}
            className="inline cursor-pointer rounded-sm bg-transparent p-0 text-left text-blue-400 underline decoration-blue-400/30 underline-offset-2 transition-colors hover:text-blue-300"
            aria-label={title}
            onClick={() => openFileLink(fileTarget)}
          >
            {children}
          </button>
        </TargetTooltip>
      );
    }
    return <span className="text-blue-400 underline underline-offset-2 decoration-blue-400/30" title={href || undefined}>{children}</span>;
  },
  ul: ({ children }: any) => <ul className="space-y-1 my-2 ml-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="space-y-1 my-2 ml-1 list-decimal list-inside">{children}</ol>,
  li: ({ children }: any) => (
    <li className="flex gap-2 items-start">
      <span className="shrink-0 mt-[10px] w-[5px] h-[5px] rounded-full bg-fg-5/40" />
      <span className="flex-1">{children}</span>
    </li>
  ),
  blockquote: ({ children }: any) => <blockquote className="rounded-md bg-[var(--th-code-block-bg)] px-3 py-2 my-2 text-fg-4 italic">{children}</blockquote>,
  hr: () => <hr className="border-edge/30 my-4" />,
  code: ({ className, children, ...props }: any) => {
    const text = String(children).replace(/\n$/, '');
    const langMatch = /language-([^\s]+)/.exec(className || '');

    // Inline code (no language class, no embedded newlines)
    if (!langMatch && !className && !text.includes('\n')) {
      const fileTarget = parseFileLinkTarget(text);
      if (fileTarget) {
        const title = fileLinkTitle(fileTarget);
        return (
          <TargetTooltip label={title}>
            <code
              className={cn('px-1.5 py-[1px] rounded text-[12px] font-mono border cursor-pointer hover:brightness-125 transition-all', classifyCode(fileTarget.path))}
              aria-label={title}
              onClick={() => openFileLink(fileTarget)}
            >
              {text}
            </code>
          </TargetTooltip>
        );
      }
      const codeClassName = cn('px-1.5 py-[1px] rounded text-[12px] font-mono border', classifyCode(text));
      if (workdir && looksLikeRemoteBranchRef(text)) {
        return <RemoteBranchCode text={text} workdir={workdir} className={codeClassName} />;
      }
      return <code className={codeClassName}>{text}</code>;
    }

    // Fenced code block
    const lang = langMatch?.[1] || '';
    if (['mermaid', 'mmd'].includes(lang.toLowerCase())) {
      return <MermaidBlock text={text} />;
    }

    return (
      <div className="rounded-lg overflow-hidden border border-edge/30 bg-[var(--th-code-block-bg)] my-3 not-prose">
        <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-edge/15 bg-[var(--th-code-block-header)]">
          <span className="text-[10px] font-mono text-fg-5/50">{lang || 'text'}</span>
          <CopyButton text={text} />
        </div>
        <pre className="px-3.5 py-3 text-[12px] leading-[1.65] text-fg-3 font-mono whitespace-pre-wrap break-words overflow-x-auto">
          <code>{text}</code>
        </pre>
      </div>
    );
  },
  pre: ({ children }: any) => <>{children}</>,
  table: ({ children }: any) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-edge/30">
      <table className="w-full text-[12.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-[rgba(0,0,0,0.1)]">{children}</thead>,
  th: ({ children }: any) => <th className="px-3 py-1.5 text-left font-semibold text-fg-3 border-b border-edge/30">{children}</th>,
  td: ({ children }: any) => <td className="px-3 py-1.5 text-fg-4 border-t border-edge/12">{children}</td>,
  tr: ({ children }: any) => <tr className="even:bg-[rgba(255,255,255,0.015)]">{children}</tr>,
};
}

export const mdComponents = createMdComponents();
