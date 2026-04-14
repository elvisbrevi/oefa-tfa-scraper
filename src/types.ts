export interface Resolution {
  nro: string;
  expediente: string;
  administrado: string;
  unidadFiscalizable: string;
  sector: string;
  nroResolucion: string;
  pdfUuid: string | null;
  pdfRowIndex: number | null; // global row index used in JSF component ID
}

export interface ScraperConfig {
  baseUrl: string;
  outputDir: string;
  pdfDir: string;
  delayMs: number;
  maxRetries: number;
  initialBackoffMs: number;
}

export interface PageResult {
  resolutions: Resolution[];
  totalRecords: number;
  totalPages: number;
  viewState: string;
}

export interface FailedDownload {
  uuid: string;
  filename: string;
  resolution: Resolution;
  error: string;
}
