import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'i',
  'em',
  'strong',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'a',
  'blockquote',
  'pre',
  'code',
];

const URI_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const URL_WHITESPACE_OR_CONTROL = /[\u0000-\u0020\u007f-\u009f]/;

function decodeForValidation(value: string): string | null {
  let decoded = value;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null;
  }
  return decoded;
}

function isAllowedHref(value: string): boolean {
  if (!value || value !== value.trim() || URL_WHITESPACE_OR_CONTROL.test(value) || value.includes('\\')) {
    return false;
  }

  const decoded = decodeForValidation(value);
  if (!decoded || URL_WHITESPACE_OR_CONTROL.test(decoded) || decoded.startsWith('//')) {
    return false;
  }

  const scheme = URI_SCHEME.exec(decoded)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (scheme !== 'http' && scheme !== 'https') return false;

  try {
    const parsed = new URL(decoded);
    return parsed.protocol === `${scheme}:`;
  } catch {
    return false;
  }
}

/**
 * Sanitize untrusted ComicVine description HTML with the browser's HTML parser.
 * Only formatting elements and link hrefs survive; link browsing attributes are
 * added after DOMPurify has completed.
 */
export function sanitizeHtml(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;

  fragment.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (!href || !isAllowedHref(href)) {
      anchor.removeAttribute('href');
      anchor.removeAttribute('target');
      anchor.removeAttribute('rel');
      return;
    }

    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });

  const template = document.createElement('template');
  template.content.append(fragment);
  return template.innerHTML;
}
