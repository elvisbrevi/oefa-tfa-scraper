import * as fs from 'fs';
import * as path from 'path';
import { Resolution, FailedDownload } from './types';
import { Session } from './session';
import { downloadPdf } from './requests';

/**
 * Builds a safe filename from resolution data.
 */
export function buildFilename(resolution: Resolution): string {
  const clean = (s: string) =>
    s
      .replace(/[\r\n\t]+/g, ' ')           // newlines/tabs → space
      .replace(/[/\\?%*:|"<>]/g, '-')       // invalid filesystem chars → dash
      .replace(/\s{2,}/g, ' ')              // collapse multiple spaces
      .trim()
      .substring(0, 80);
  const parts = [
    clean(resolution.nroResolucion) || 'sin-resolucion',
    clean(resolution.administrado) || 'sin-administrado',
  ].filter(Boolean);
  return `${parts.join('_')}.pdf`;
}

/**
 * Sleeps for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Downloads a PDF with exponential backoff on 429 errors.
 */
export async function downloadWithRetry(
  session: Session,
  resolution: Resolution,
  pdfDir: string,
  rowIndex: number,
  maxRetries = 5,
  initialBackoffMs = 2000,
  delayMs = 500
): Promise<{ success: boolean; failed?: FailedDownload }> {
  if (!resolution.pdfUuid) {
    console.log(`  [SKIP] No UUID for: ${resolution.nroResolucion}`);
    return { success: false, failed: { uuid: '', filename: '', resolution, error: 'No UUID' } };
  }

  const filename = buildFilename(resolution);
  const filePath = path.join(pdfDir, filename);

  // Skip already downloaded
  if (fs.existsSync(filePath)) {
    console.log(`  [SKIP] Already exists: ${filename}`);
    return { success: true };
  }

  let attempt = 0;
  let backoff = initialBackoffMs;

  while (attempt <= maxRetries) {
    try {
      await sleep(delayMs);
      const buffer = await downloadPdf(session, resolution.pdfUuid, rowIndex);
      fs.writeFileSync(filePath, buffer);
      console.log(`  [OK] ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);
      return { success: true };
    } catch (err: any) {
      const status = err.statusCode;

      const isRetryable = status === 429 || err.message?.includes('text/html') || err.message?.includes('Unexpected content-type');

      if (isRetryable && attempt < maxRetries) {
        const label = status === 429 ? '429 Rate limited' : 'Transient error';
        console.warn(`  [${label}] backing off ${backoff}ms (attempt ${attempt + 1}/${maxRetries}): ${filename}`);
        await sleep(backoff);
        backoff *= 2;
        attempt++;
      } else if (isRetryable) {
        const errMsg = status === 429 ? 'Rate limit (429)' : err.message;
        console.warn(`  [FAIL] Max retries exceeded: ${filename}`);
        return {
          success: false,
          failed: { uuid: resolution.pdfUuid, filename, resolution, error: `${errMsg} - max retries exceeded` },
        };
      } else {
        console.warn(`  [FAIL] ${filename}: ${err.message}`);
        return {
          success: false,
          failed: { uuid: resolution.pdfUuid, filename, resolution, error: err.message },
        };
      }
    }
  }

  return {
    success: false,
    failed: {
      uuid: resolution.pdfUuid!,
      filename,
      resolution,
      error: 'Max retries exceeded',
    },
  };
}
