export function stripOaiMemoryCitations(text: string): string {
  if (!text || !text.includes('<oai-mem-citation>')) return text;
  return text
    .replace(/\s*<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>\s*/g, '\n')
    .replace(/\s*<oai-mem-citation>[\s\S]*$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
