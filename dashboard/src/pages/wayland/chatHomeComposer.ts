export function canSubmitChatHomeMessage(prompt: string, attachmentCount: number): boolean {
  return !!prompt.trim() || attachmentCount > 0;
}
