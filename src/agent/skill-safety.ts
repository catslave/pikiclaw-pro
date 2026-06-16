export interface SkillImportWarning {
  severity: 'warning' | 'danger';
  message: string;
}

export type SkillImportVerdict = 'clean' | 'review' | 'blocked';
export type SkillSecurityVerdict = SkillImportVerdict | 'unscanned';

export interface SkillSecurityReport {
  verdict: SkillSecurityVerdict;
  warnings: SkillImportWarning[];
}

function frontmatterBlock(content: string): string | null {
  return content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || null;
}

function withoutFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*/, '');
}

function frontmatterValue(content: string, key: string): string | null {
  const fm = frontmatterBlock(content);
  if (!fm) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = fm.match(new RegExp(`^${escaped}:[ \\t]*(.+)$`, 'im'));
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '').trim() || null;
}

function frontmatterList(content: string, key: string): string[] {
  const fm = frontmatterBlock(content);
  if (!fm) return [];
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inline = fm.match(new RegExp(`^${escaped}:[ \\t]*(.+)$`, 'im'))?.[1]?.trim();
  if (inline) {
    const normalized = inline.replace(/^\[|\]$/g, '');
    return normalized
      .split(',')
      .map(item => item.trim().replace(/^['"]|['"]$/g, '').trim())
      .filter(Boolean);
  }
  const block = fm.match(new RegExp(`^${escaped}:[ \\t]*\\n((?:\\s+-\\s+.+\\n?)+)`, 'im'))?.[1] || '';
  return block
    .split('\n')
    .map(item => item.replace(/^\s*-\s*/, '').replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

export function scanSkillMarkdown(content: string): SkillImportWarning[] {
  const checks: Array<{ pattern: RegExp; severity: SkillImportWarning['severity']; message: string }> = [
    { pattern: /\brm\s+-rf\s+(?:\/|\$HOME|~)/i, severity: 'danger', message: 'Contains destructive delete commands against root or home directories.' },
    { pattern: /\b(?:curl|wget)\b[^\n|;&]*\|\s*(?:sh|bash|zsh)\b/i, severity: 'danger', message: 'Downloads and executes a remote script in one step.' },
    { pattern: /\b(curl|wget)\b[^\n]*(?:\bPOST\b|--data|--upload-file|-T\s)/i, severity: 'danger', message: 'Uploads data to an external host.' },
    { pattern: /\b(?:nc|netcat)\b[^\n]*\s-e\s/i, severity: 'danger', message: 'Mentions a netcat execution pattern commonly used for remote shells.' },
    { pattern: /\|\s*(?:bash|sh|zsh)\b|\beval\s*[(`]/i, severity: 'danger', message: 'Runs piped shell code or dynamic eval.' },
    { pattern: /AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9_-]{20,}|~\/\.ssh\/|\.env\b|\bid_rsa\b/i, severity: 'danger', message: 'References credential stores, private keys, or token-like values.' },
    { pattern: /\bchmod\s+(?:777|\+x)\b/i, severity: 'warning', message: 'Changes executable permissions; review whether scripts are expected.' },
    { pattern: /\bsudo\b/i, severity: 'warning', message: 'Requests elevated privileges.' },
    { pattern: /(?:~\/\.ssh|ssh-key|id_rsa|id_ed25519)/i, severity: 'warning', message: 'References SSH keys or private key paths.' },
    { pattern: /\b(?:token|secret|password|api[_-]?key)\b/i, severity: 'warning', message: 'Mentions sensitive credentials; make sure the skill does not ask agents to expose them.' },
    { pattern: /\b(?:exfiltrat|upload|send)\w*[^\n]*(?:token|secret|password|key)\b/i, severity: 'danger', message: 'Appears to move credential-like data elsewhere.' },
    { pattern: /\b(?:write|tee|>>?)\s+\/etc\/|~\/Library\/(?:Application Support|Preferences)\/|~\/\.config\/[a-z]/i, severity: 'warning', message: 'Writes outside the project workspace.' },
    { pattern: /\bignore (?:previous|prior|all|the above) instructions\b|\bdisregard (?:the |your )?(?:system |previous )?(?:prompt|instructions)\b|\boverride (?:the |your )?system\b/i, severity: 'warning', message: 'Contains instruction-override phrasing.' },
  ];
  const warnings: SkillImportWarning[] = [];
  for (const check of checks) {
    if (check.pattern.test(content) && !warnings.some(item => item.message === check.message)) {
      warnings.push({ severity: check.severity, message: check.message });
    }
  }
  if (/[A-Za-z0-9+/]{80,}={0,2}/.test(content) && /\batob\s*\(|\bbase64\s+-(?:d|-decode)\b|\bopenssl\s+enc\b/i.test(content)) {
    warnings.push({ severity: 'warning', message: 'Contains obfuscated base64-like content paired with a decode step.' });
  }
  const tags = frontmatterList(content, 'tags');
  if (tags.length >= 5) {
    const searchable = `${withoutFrontmatter(content)}\n${frontmatterValue(content, 'description') || ''}`.toLowerCase();
    const appearing = tags.filter(tag => searchable.includes(tag.toLowerCase())).length;
    const ratio = appearing / tags.length;
    if (ratio < 0.3) {
      warnings.push({
        severity: 'warning',
        message: `Potential index poisoning: ${tags.length} tags but only ${Math.round(ratio * 100)}% appear in body or description.`,
      });
    }
  }
  return warnings;
}

export function skillImportVerdict(warnings: SkillImportWarning[]): SkillImportVerdict {
  if (warnings.some(item => item.severity === 'danger')) return 'blocked';
  if (warnings.length) return 'review';
  return 'clean';
}

export function scanSkillSecurity(content: string): SkillSecurityReport {
  const warnings = scanSkillMarkdown(content);
  return { verdict: skillImportVerdict(warnings), warnings };
}
