import * as fs from 'fs';
import * as path from 'path';
import { createSession, Session } from './session';
import { searchAll, fetchPage } from './requests';
import { downloadWithRetry, sleep } from './downloader';
import { Resolution, FailedDownload, ScraperConfig } from './types';

const DEFAULT_CONFIG: ScraperConfig = {
  baseUrl: 'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml',
  outputDir: path.join(process.cwd(), 'output'),
  pdfDir: path.join(process.cwd(), 'pdfs'),
  delayMs: 800,
  maxRetries: 5,
  initialBackoffMs: 2000,
};

/**
 * Creates a fresh session and performs the initial search.
 * Returns the session and first-page results.
 */
async function initSession(config: ScraperConfig) {
  const session = await createSession();
  const page1 = await searchAll(session);
  if (page1.totalRecords === 0) {
    throw new Error('No records found — search returned 0 results');
  }
  return { session, page1 };
}

/**
 * Loads progress from a previous partial run (pages already scraped).
 */
function loadProgress(outputDir: string): { resolutions: Resolution[]; lastPage: number } {
  const progressPath = path.join(outputDir, 'progress.json');
  if (fs.existsSync(progressPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
      return data;
    } catch {
      // ignore corrupt progress file
    }
  }
  return { resolutions: [], lastPage: -1 };
}

function saveProgress(outputDir: string, resolutions: Resolution[], lastPage: number) {
  fs.writeFileSync(
    path.join(outputDir, 'progress.json'),
    JSON.stringify({ resolutions, lastPage }, null, 2)
  );
}

async function run(config: ScraperConfig = DEFAULT_CONFIG) {
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.mkdirSync(config.pdfDir, { recursive: true });

  const failedDownloads: FailedDownload[] = [];

  // Load any prior progress
  const progress = loadProgress(config.outputDir);
  const allResolutions: Resolution[] = [...progress.resolutions];
  const startPage = progress.lastPage + 1;

  if (startPage > 0) {
    console.log(`Resuming from page ${startPage + 1} (${allResolutions.length} rows already extracted).`);
  }

  // ---------- Init session ----------
  console.log('Creating session...');
  let session: Session;
  let page1: Awaited<ReturnType<typeof searchAll>>;

  try {
    const init = await initSession(config);
    session = init.session;
    page1 = init.page1;
  } catch (err: any) {
    console.error('Failed to create session:', err.message);
    process.exit(1);
  }

  const totalPages = page1.totalPages;
  const totalRecords = page1.totalRecords;
  console.log(`Found ${totalRecords} records across ${totalPages} pages.`);

  // ---------- Page 1 (if not already done) ----------
  if (startPage === 0) {
    allResolutions.push(...page1.resolutions);
    console.log(`Page 1/${totalPages}: ${page1.resolutions.length} rows.`);

    // Download PDFs for page 1
    await downloadPagePdfs(page1.resolutions, session, config, failedDownloads);
    saveProgress(config.outputDir, allResolutions, 0);
  }

  // ---------- Remaining pages ----------
  for (let page = Math.max(startPage, 1); page < totalPages; page++) {
    await sleep(config.delayMs);
    try {
      const result = await fetchPage(session, page, totalRecords);
      allResolutions.push(...result.resolutions);
      console.log(`Page ${page + 1}/${totalPages}: ${result.resolutions.length} rows.`);

      // Download PDFs for this page while ViewState is fresh
      await downloadPagePdfs(result.resolutions, session, config, failedDownloads);
      saveProgress(config.outputDir, allResolutions, page);
    } catch (err: any) {
      console.error(`Error on page ${page + 1}: ${err.message}`);
      // Continue to next page
    }
  }

  // ---------- Save final output ----------
  console.log(`\nTotal resolutions: ${allResolutions.length}`);

  const outputPath = path.join(config.outputDir, 'resolutions.json');
  fs.writeFileSync(outputPath, JSON.stringify(allResolutions, null, 2));
  console.log(`JSON saved to: ${outputPath}`);

  const csvPath = path.join(config.outputDir, 'resolutions.csv');
  const csvHeader = 'Nro.,Expediente,Administrado,Unidad Fiscalizable,Sector,Nro. Resolución,PDF UUID';
  const csvRows = allResolutions.map(r =>
    [r.nro, r.expediente, r.administrado, r.unidadFiscalizable, r.sector, r.nroResolucion, r.pdfUuid ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));
  console.log(`CSV saved to: ${csvPath}`);

  if (failedDownloads.length > 0) {
    const failedPath = path.join(config.outputDir, 'failed_downloads.json');
    fs.writeFileSync(failedPath, JSON.stringify(failedDownloads, null, 2));
    console.log(`${failedDownloads.length} failed downloads → ${failedPath}`);
  }

  // Clean up progress file on success
  const progressPath = path.join(config.outputDir, 'progress.json');
  if (fs.existsSync(progressPath)) fs.unlinkSync(progressPath);

  console.log('\n✓ Scraping complete!');
  console.log(`  Records extracted: ${allResolutions.length}/${totalRecords}`);
  const withPdf = allResolutions.filter(r => r.pdfUuid).length;
  console.log(`  PDFs downloaded:   ${withPdf - failedDownloads.length}/${withPdf}`);
  if (failedDownloads.length > 0) {
    console.log(`  Failed downloads:  ${failedDownloads.length} (see output/failed_downloads.json)`);
  }
}

/**
 * Downloads PDFs for all resolutions on a single page.
 * Using per-page download keeps the ViewState fresh.
 */
async function downloadPagePdfs(
  resolutions: Resolution[],
  session: Session,
  config: ScraperConfig,
  failedDownloads: FailedDownload[]
) {
  for (let i = 0; i < resolutions.length; i++) {
    const resolution = resolutions[i];
    if (!resolution.pdfUuid) continue;

    const result = await downloadWithRetry(
      session,
      resolution,
      config.pdfDir,
      config.maxRetries,
      config.initialBackoffMs,
      config.delayMs
    );

    if (!result.success && result.failed) {
      failedDownloads.push(result.failed);
    }
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
