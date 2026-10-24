import { describe, it, expect } from 'vitest';
import { byteLength, parseKeywords, previewMessage } from './automationPreview';

const base = { reply_text: 'Hi {{username}}, here: {{link}}', link_url: 'https://changtechs.com/', disclose_automation: false };

describe('previewMessage', () => {
  it('fills in the link and username', () => {
    expect(previewMessage(base, 'asha')).toBe('Hi @asha, here: https://changtechs.com/');
  });
  it('appends the link when there is no placeholder', () => {
    expect(previewMessage({ ...base, reply_text: 'Thanks!' })).toBe('Thanks!\nhttps://changtechs.com/');
  });
  it('adds the automation note and drops {{link}} without a URL', () => {
    expect(previewMessage({ ...base, link_url: '', reply_text: 'Hello {{link}}', disclose_automation: true })).toBe('Hello\n\n(Automated reply)');
  });
});

describe('helpers', () => {
  it('counts UTF-8 bytes (Tamil letters are 3 bytes each)', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('ல')).toBe(3);
  });
  it('splits, trims and de-duplicates keywords', () => {
    expect(parseKeywords(' link, Link ,, pdf,link ')).toEqual(['link', 'Link', 'pdf']);
  });
});
