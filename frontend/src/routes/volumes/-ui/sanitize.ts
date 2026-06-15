/**
 * Minimal HTML sanitizer for ComicVine descriptions.
 * Strips script tags, event handlers, and allows only safe inline elements.
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's',
  'ul', 'ol', 'li',
  'a', 'span', 'div',
  'blockquote', 'pre', 'code',
]);

export function sanitizeHtml(html: string): string {
  // First pass: strip script and style tags + their content
  let safe = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  safe = safe.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Strip event handler attributes (onclick, onload, etc.)
  safe = safe.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Strip javascript: in href
  safe = safe.replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"');

  // Strip all tags not in the allowed set
  safe = safe.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tagName) => {
    const lower = tagName.toLowerCase();
    if (ALLOWED_TAGS.has(lower)) {
      // For allowed tags, strip any attributes except href on <a>
      if (lower === 'a') {
        const hrefMatch = match.match(/href\s*=\s*"([^"]*)"/i);
        const href = hrefMatch ? hrefMatch[1] : '';
        return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : '<a>';
      }
      // Keep only the bare tag for other allowed elements
      return `<${lower}>`;
    }
    // Stripped tags: just remove them entirely, keeping inner content
    const isClosing = match.startsWith('</');
    return isClosing ? '' : '';
  });

  return safe;
}
