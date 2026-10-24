/** Mirrors the server's message builder (server/services/automationMatcher.js) so the form can preview the exact text. */
export interface PreviewInput {
  reply_text: string;
  link_url: string;
  disclose_automation: boolean;
}

export const MAX_MESSAGE_BYTES = 1000;

export function previewMessage(rule: PreviewInput, username = 'example_user'): string {
  const link = rule.link_url.trim();
  let text = rule.reply_text.replaceAll('{{username}}', username ? `@${username}` : 'there');
  if (link) {
    text = text.includes('{{link}}') ? text.replaceAll('{{link}}', link) : `${text}\n${link}`;
  } else {
    text = text.replaceAll('{{link}}', '');
  }
  text = text.trim();
  if (rule.disclose_automation) text = `${text}\n\n(Automated reply)`;
  return text.trim();
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function parseKeywords(raw: string): string[] {
  return [...new Set(raw.split(',').map((k) => k.trim()).filter(Boolean))];
}
