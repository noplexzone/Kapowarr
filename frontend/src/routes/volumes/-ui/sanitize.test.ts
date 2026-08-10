import { describe, expect, it } from 'vitest';

import { sanitizeHtml } from './sanitize';

function sanitizedAnchor(html: string): HTMLAnchorElement | null {
  const document = new DOMParser().parseFromString(sanitizeHtml(html), 'text/html');
  return document.querySelector('a');
}

describe('sanitizeHtml', () => {
  it('preserves only the supported formatting tags', () => {
    const result = sanitizeHtml(
      '<p><strong>Bold</strong> <em>italic</em><br><code>x</code></p>' +
        '<div><span>plain</span></div><img src="https://example.com/tracker.png">',
    );

    expect(result).toContain('<p><strong>Bold</strong> <em>italic</em><br><code>x</code></p>');
    expect(result).toContain('plain');
    expect(result).not.toMatch(/<(?:div|span|img)\b/i);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java&#x73;cript:alert(1)',
    'java&#115;cript:alert(1)',
    'java\nscript:alert(1)',
    '&#x09;javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/path',
    'jav%61script:alert(1)',
    '%6a%61%76%61%73%63%72%69%70%74:alert(1)',
  ])('removes unsafe href %s', (href) => {
    const anchor = sanitizedAnchor(`<a href="${href}">link</a>`);

    expect(anchor).not.toBeNull();
    expect(anchor?.hasAttribute('href')).toBe(false);
    expect(anchor?.hasAttribute('target')).toBe(false);
    expect(anchor?.hasAttribute('rel')).toBe(false);
  });

  it.each([
    '/volumes/1',
    './issue/2',
    '../library',
    '#issues',
    '?offset=1',
    'relative/path',
    'https://example.com/path',
    'http://example.com/path',
  ])('keeps relative and HTTP(S) href %s with safe link attributes', (href) => {
    const anchor = sanitizedAnchor(`<a href="${href}" target="evil" rel="opener">link</a>`);

    expect(anchor?.getAttribute('href')).toBe(href);
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('removes handlers, scriptable namespaces, and attacker-controlled attributes', () => {
    const result = sanitizeHtml(
      '<p onclick="alert(1)" style="background:url(javascript:alert(1))">safe</p>' +
        '<svg><a xlink:href="javascript:alert(1)"><script>alert(1)</script></a></svg>' +
        '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
    );

    expect(result).toContain('<p>safe</p>');
    expect(result).not.toMatch(/(?:onclick|onerror|style|script|svg|math|xlink)/i);
  });

  it('handles malformed, nested, and entity-obfuscated markup as parsed HTML', () => {
    const result = sanitizeHtml(
      '<p><strong>one</p><a href="java&#x73;cript:alert(1)"><em>two</strong></a>' +
        '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    const document = new DOMParser().parseFromString(result, 'text/html');

    expect(document.querySelectorAll('script,svg,math')).toHaveLength(0);
    expect(document.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(document.body.textContent).toContain('<script>alert(1)</script>');
  });
});
