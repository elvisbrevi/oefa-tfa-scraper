import * as cheerio from 'cheerio';

const BASE_URL = 'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml';

export interface Session {
  cookies: string;
  viewState: string;
  formHiddenFields: Record<string, string>;
}

/**
 * Extracts all hidden input fields from an HTML page.
 */
function extractHiddenFields(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    const value = $(el).attr('value') ?? '';
    if (name) fields[name] = value;
  });
  return fields;
}

/**
 * Extracts ViewState from HTML or JSF partial-response XML.
 */
export function extractViewState(content: string): string {
  // JSF partial-response XML: <update id="...ViewState...">value</update>
  const xmlMatch = content.match(/<update[^>]+ViewState[^>]*><!\[CDATA\[([^\]]+)\]\]><\/update>/);
  if (xmlMatch) return xmlMatch[1];

  const xmlMatch2 = content.match(/<update[^>]+ViewState[^>]*>([^<]+)<\/update>/);
  if (xmlMatch2) return xmlMatch2[1];

  // HTML hidden input
  const htmlMatch = content.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
  if (htmlMatch) return htmlMatch[1];

  const htmlMatch2 = content.match(/value="([^"]+)"[^>]*name="javax\.faces\.ViewState"/);
  if (htmlMatch2) return htmlMatch2[1];

  return '';
}

/**
 * Parses Set-Cookie headers into a cookie string.
 */
function parseCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map(h => h.split(';')[0].trim())
    .join('; ');
}

/**
 * Merges new cookies with existing ones (updates values).
 */
export function mergeCookies(existing: string, newCookies: string): string {
  const map = new Map<string, string>();
  for (const part of existing.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) map.set(k.trim(), v.join('=').trim());
  }
  for (const part of newCookies.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) map.set(k.trim(), v.join('=').trim());
  }
  return [...map.entries()].map(([k, v]) => (v ? `${k}=${v}` : k)).join('; ');
}

/**
 * Creates initial session by GETting the page.
 */
export async function createSession(): Promise<Session> {
  const response = await fetch(BASE_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  });

  const html = await response.text();
  const setCookieRaw = response.headers.getSetCookie?.() ?? [];
  const cookies = parseCookies(setCookieRaw);
  const viewState = extractViewState(html);
  const formHiddenFields = extractHiddenFields(html);

  if (!viewState) throw new Error('Could not extract ViewState from initial page');

  return { cookies, viewState, formHiddenFields };
}
