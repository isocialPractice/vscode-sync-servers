/** What the Site Settings page links to. */
export interface PageOptions {
  /** The webview's `cspSource`. */
  readonly cspSource: string;
  /** A fresh random nonce for this page's one script. */
  readonly nonce: string;
  readonly styleUri: string;
  readonly scriptUri: string;
  readonly title: string;
}

/**
 * The page's Content-Security-Policy: nothing but its own stylesheet, its
 * one script with the nonce, and its own images and fonts. No inline style
 * or script, no remote content, no eval.
 */
export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return `default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; font-src ${cspSource}`;
}

/** Escapes text for an HTML attribute or element. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${String(character.charCodeAt(0))};`);
}

/** The HTML of the Site Settings page. The form itself is drawn by the script. */
export function settingsPage(options: PageOptions): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(options.cspSource, options.nonce))}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<link rel="stylesheet" href="${escapeHtml(options.styleUri)}">`,
    `<title>${escapeHtml(options.title)}</title>`,
    '</head>',
    '<body>',
    '<div id="app"><p>Loading the site settings...</p></div>',
    `<script nonce="${escapeHtml(options.nonce)}" src="${escapeHtml(options.scriptUri)}"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
