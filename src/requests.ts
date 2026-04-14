import { Session, extractViewState, mergeCookies } from './session';
import { parseResolutionsFromHtml, parseResolutionsFromPartialResponse, parsePaginationInfo } from './parser';
import { PageResult } from './types';

const BASE_URL = 'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml';
const FORM_ID = 'listarDetalleInfraccionRAAForm';
const TABLE_ID = `${FORM_ID}:dt`;
const ROWS_PER_PAGE = 10;

function buildCommonHeaders(session: Session): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
    'Cookie': session.cookies,
    'Origin': 'https://publico.oefa.gob.pe',
    'Referer': BASE_URL,
  };
}

function buildBaseFormData(session: Session): URLSearchParams {
  const params = new URLSearchParams();

  // Include all hidden fields from the form (captures ViewState and any form tokens)
  for (const [name, value] of Object.entries(session.formHiddenFields)) {
    params.set(name, value);
  }

  // JSF form identification (tells the server which form was submitted)
  params.set(FORM_ID, FORM_ID);

  // Standard search filter fields (empty = all results)
  params.set(`${FORM_ID}:txtNroexp`, '');
  params.set(`${FORM_ID}:j_idt21`, '');
  params.set(`${FORM_ID}:j_idt25`, '');
  params.set(`${FORM_ID}:idsector`, '');
  params.set(`${FORM_ID}:j_idt34`, '');
  params.set(`${FORM_ID}:dt_scrollState`, '0,0');

  // Override with current ViewState
  params.set('javax.faces.ViewState', session.viewState);

  return params;
}

/**
 * POSTs the search form (all empty filters = all records).
 * Returns page 1 data.
 */
export async function searchAll(session: Session): Promise<PageResult> {
  const params = buildBaseFormData(session);
  params.set(`${FORM_ID}:btnBuscar`, '');

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      ...buildCommonHeaders(session),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    body: params.toString(),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Search failed: HTTP ${response.status}`);
  }

  const html = await response.text();

  // Update session cookies
  const newCookies = response.headers.getSetCookie?.() ?? [];
  if (newCookies.length > 0) {
    session.cookies = mergeCookies(session.cookies, newCookies.map(c => c.split(';')[0]).join('; '));
  }

  // Update ViewState
  const newViewState = extractViewState(html);
  if (newViewState) session.viewState = newViewState;

  const pagination = parsePaginationInfo(html);
  const resolutions = parseResolutionsFromHtml(html);

  return { resolutions, ...pagination, viewState: session.viewState };
}

/**
 * Fetches a specific page using JSF/PrimeFaces AJAX pagination.
 * page is 0-indexed.
 */
export async function fetchPage(session: Session, page: number, totalRecords: number): Promise<PageResult> {
  const first = page * ROWS_PER_PAGE;
  const params = buildBaseFormData(session);

  // JSF partial-ajax params
  params.set('javax.faces.partial.ajax', 'true');
  params.set('javax.faces.source', TABLE_ID);
  params.set('javax.faces.partial.execute', TABLE_ID);
  params.set('javax.faces.partial.render', TABLE_ID);
  params.set(FORM_ID, FORM_ID);

  // PrimeFaces DataTable pagination params
  params.set(`${TABLE_ID}_pagination`, 'true');
  params.set(`${TABLE_ID}_first`, String(first));
  params.set(`${TABLE_ID}_rows`, String(ROWS_PER_PAGE));
  params.set(`${TABLE_ID}_encodeFeature`, 'true');

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      ...buildCommonHeaders(session),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/xml, text/xml, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Faces-Request': 'partial/ajax',
    },
    body: params.toString(),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Page ${page + 1} fetch failed: HTTP ${response.status}`);
  }

  const xml = await response.text();

  // Update cookies
  const newCookies = response.headers.getSetCookie?.() ?? [];
  if (newCookies.length > 0) {
    session.cookies = mergeCookies(session.cookies, newCookies.map(c => c.split(';')[0]).join('; '));
  }

  // Extract new ViewState from partial response
  const newViewState = extractViewState(xml);
  if (newViewState) session.viewState = newViewState;

  const pagination = parsePaginationInfo(xml);
  const resolutions = parseResolutionsFromPartialResponse(xml);

  return {
    resolutions,
    totalRecords: pagination.totalRecords || totalRecords,
    totalPages: pagination.totalPages || Math.ceil(totalRecords / ROWS_PER_PAGE),
    viewState: session.viewState,
  };
}

/**
 * Downloads a PDF by POSTing with param_uuid.
 * Returns the PDF buffer on success.
 */
export async function downloadPdf(
  session: Session,
  uuid: string,
  rowIndex: number  // global row index from JSF component ID (e.g. 10 for page 2 row 0)
): Promise<Buffer> {
  const params = buildBaseFormData(session);

  // Mojarra jsfcljs form submit params — must use the exact component ID from the onclick
  params.set(`${FORM_ID}:dt:${rowIndex}:j_idt63`, `${FORM_ID}:dt:${rowIndex}:j_idt63`);
  params.set('param_uuid', uuid);

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      ...buildCommonHeaders(session),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/pdf,application/octet-stream,*/*',
    },
    body: params.toString(),
    redirect: 'follow',
  });

  if (response.status === 429) {
    const err = new Error(`Rate limited (429)`);
    (err as any).statusCode = 429;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`PDF download failed: HTTP ${response.status}`);
    (err as any).statusCode = response.status;
    throw err;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
    throw new Error(`Unexpected content-type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
