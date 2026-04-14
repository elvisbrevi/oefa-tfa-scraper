import * as cheerio from 'cheerio';
import { Resolution } from './types';

const FORM_ID = 'listarDetalleInfraccionRAAForm';

/**
 * Parses resolution rows from full HTML page.
 */
export function parseResolutionsFromHtml(html: string): Resolution[] {
  const $ = cheerio.load(html);
  return parseRows($);
}

/**
 * Parses resolution rows from JSF partial-response XML.
 * The partial response contains CDATA with raw <tr> elements (no wrapping <tbody>).
 */
export function parseResolutionsFromPartialResponse(xml: string): Resolution[] {
  // Extract CDATA content from the table update
  const cdataMatch = xml.match(/<update[^>]+id="listarDetalleInfraccionRAAForm:dt"[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/update>/);
  const content = cdataMatch ? cdataMatch[1] : null;

  if (!content) {
    // Try without CDATA wrapper
    const htmlMatch = xml.match(/<update[^>]+id="listarDetalleInfraccionRAAForm:dt"[^>]*>([\s\S]*?)<\/update>/);
    if (!htmlMatch) return [];
    return parseRawRows(htmlMatch[1]);
  }

  return parseRawRows(content);
}

/**
 * Parses raw <tr> HTML (no table/tbody wrapper) from partial response.
 */
function parseRawRows(html: string): Resolution[] {
  // Wrap in a table so cheerio can parse tr/td correctly
  const $ = cheerio.load(`<table><tbody>${html}</tbody></table>`);
  return parseRows($);
}

/**
 * Extracts total records and pages from HTML or partial response.
 */
export function parsePaginationInfo(content: string): { totalRecords: number; totalPages: number } {
  // "Página X de Y (Z registros)"
  const match = content.match(/Página\s+\d+\s+de\s+(\d+)\s+\((\d+)\s+registros\)/);
  if (match) {
    return { totalPages: parseInt(match[1], 10), totalRecords: parseInt(match[2], 10) };
  }
  return { totalPages: 0, totalRecords: 0 };
}

/**
 * Extracts UUID from onclick attribute of PDF link.
 * onclick: "mojarra.jsfcljs(...,'param_uuid':'<uuid>',...)"
 */
function extractUuid(onclick: string | undefined): string | null {
  if (!onclick) return null;
  const m = onclick.match(/param_uuid['":\s]+([a-f0-9-]{36})/);
  return m ? m[1] : null;
}

function parseRows($: cheerio.CheerioAPI): Resolution[] {
  const resolutions: Resolution[] = [];
  const tableId = `${FORM_ID}\\:dt`;

  // Try datatable selectors first; fall back to any tr with td cells
  let rows = $(`#${tableId} tbody tr, .ui-datatable tbody tr`);
  if (rows.length === 0) {
    // Used when parsing raw <tr> fragments wrapped in a fake table
    rows = $('tbody tr');
  }

  rows.each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 6) return;

    const nro = cells.eq(0).text().trim();
    const expediente = cells.eq(1).text().trim();
    const administrado = cells.eq(2).text().trim();
    const unidadFiscalizable = cells.eq(3).text().trim();
    const sector = cells.eq(4).text().trim();
    const nroResolucion = cells.eq(5).text().trim();

    // PDF link in last cell
    const pdfLink = cells.eq(6).find('a[onclick*="param_uuid"]');
    const pdfUuid = extractUuid(pdfLink.attr('onclick'));

    if (expediente || nroResolucion) {
      resolutions.push({
        nro,
        expediente,
        administrado,
        unidadFiscalizable,
        sector,
        nroResolucion,
        pdfUuid,
      });
    }
  });

  return resolutions;
}
