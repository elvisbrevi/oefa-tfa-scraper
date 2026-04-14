# OEFA TFA Scraper

Scraper for the [Repositorio Digital OEFA](https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml) — extracts all resolutions from the Tribunal de Fiscalización Ambiental and downloads associated PDFs.

## Requirements

- Node.js 18+ (native `fetch` required)
- npm

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

Or build first and run compiled JS:

```bash
npm run build
npm run start:built
```

## Output

| Path | Description |
|------|-------------|
| `output/resolutions.json` | All extracted records (JSON) |
| `output/resolutions.csv` | All extracted records (CSV) |
| `output/failed_downloads.json` | PDFs that failed after all retries |
| `pdfs/` | Downloaded PDF files |

PDF filenames follow the pattern: `<nro-resolucion>_<administrado>.pdf`

## How it works

1. **Session**: GETs the page to obtain a `JSESSIONID` cookie and JSF `ViewState`.
2. **Search**: POSTs with empty filters to retrieve all 1 753 records (176 pages, 10 per page).
3. **Pagination**: Uses PrimeFaces AJAX partial-request to fetch each subsequent page, extracting the updated `ViewState` from each XML response.
4. **PDF Download**: POSTs with `param_uuid` extracted from each row's onclick handler. Handles **429 Too Many Requests** with exponential backoff (up to 5 retries, doubling delay from 2 s).
5. **Persistence**: Skips already-downloaded PDFs, logs all failures to `output/failed_downloads.json` for later retry.

## Configuration

Edit the `DEFAULT_CONFIG` object in `src/scraper.ts`:

| Key | Default | Description |
|-----|---------|-------------|
| `delayMs` | `800` | Delay between requests (ms) |
| `maxRetries` | `5` | Max retries per 429 error |
| `initialBackoffMs` | `2000` | Initial backoff for first retry (doubles each attempt) |

## Technical notes

- No browser automation — pure HTTP (`fetch`) + HTML parsing (`cheerio`).
- JSF ViewState is extracted from every response and carried forward.
- Cookies (`JSESSIONID`) are maintained across all requests.
- Pagination uses PrimeFaces DataTable AJAX params: `javax.faces.partial.ajax`, `dt_pagination`, `dt_first`, `dt_rows`, etc.
