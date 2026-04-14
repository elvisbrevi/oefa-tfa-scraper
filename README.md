# OEFA TFA Scraper

> **Nombre:** `oefa` por el *Organismo de Evaluación y Fiscalización Ambiental* y `tfa` por el *Tribunal de Fiscalización Ambiental*, la sección específica del repositorio que se extrae.

Scraper para el [Repositorio Digital OEFA](https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml) — extrae todas las resoluciones del Tribunal de Fiscalización Ambiental y descarga los PDFs asociados.

## Requisitos

- Node.js 18+ (requiere `fetch` nativo)
- npm

## Instalación

```bash
npm install
```

## Uso

```bash
npm start
```

O compilar primero y ejecutar el JS generado:

```bash
npm run build
npm run start:built
```

## Archivos de salida

| Ruta | Descripción |
|------|-------------|
| `output/resolutions.json` | Todos los registros extraídos (JSON) |
| `output/resolutions.csv` | Todos los registros extraídos (CSV) |
| `output/failed_downloads.json` | PDFs que fallaron tras todos los reintentos |
| `output/progress.json` | Progreso actual (se elimina al terminar con éxito) |
| `pdfs/` | Archivos PDF descargados |

Los nombres de los PDFs siguen el patrón: `<nro-resolucion>_<administrado>.pdf`

## Reanudar una ejecución interrumpida

Si el scraper se interrumpe, se puede volver a ejecutar `npm start` sin perder el trabajo ya hecho:

- El archivo `output/progress.json` guarda la última página completada y todos los registros extraídos hasta ese punto.
- Los PDFs ya descargados se omiten automáticamente (se verifica si el archivo existe en disco antes de descargar).
- Al terminar exitosamente, `progress.json` se elimina solo.

## Cómo funciona

1. **Sesión**: hace un GET a la página para obtener la cookie `JSESSIONID` y el `ViewState` de JSF.
2. **Búsqueda**: hace un POST con filtros vacíos para obtener los 1 753 registros completos (176 páginas, 10 por página).
3. **Paginación**: usa peticiones AJAX parciales de PrimeFaces para obtener cada página, extrayendo el `ViewState` actualizado de cada respuesta XML.
4. **Descarga de PDFs**: inmediatamente después de obtener cada página, se descargan sus PDFs usando el `param_uuid` y el índice global de fila extraídos del atributo `onclick` de cada enlace.
5. **Manejo de errores 429**: detecta la respuesta HTTP 429 y aplica retroceso exponencial — espera 2 s, luego 4 s, 8 s, 16 s, 32 s. Tras 5 reintentos fallidos, registra el documento en `output/failed_downloads.json` y continúa con el siguiente.
6. **Persistencia**: omite PDFs ya descargados, registra todos los fallos para reintento posterior y guarda el progreso página a página.

## Configuración

Editar el objeto `DEFAULT_CONFIG` en `src/scraper.ts`:

| Clave | Valor por defecto | Descripción |
|-------|-------------------|-------------|
| `delayMs` | `800` | Pausa entre peticiones (ms) |
| `maxRetries` | `5` | Máximo de reintentos por error 429 u error transitorio |
| `initialBackoffMs` | `2000` | Espera inicial en el primer reintento (se duplica en cada intento) |

## Estructura del proyecto

```
src/
  types.ts      → interfaces TypeScript (Resolution, FailedDownload, ScraperConfig)
  session.ts    → GET inicial, extracción de JSESSIONID y ViewState
  parser.ts     → cheerio: parseo de filas desde HTML completo y respuesta XML parcial
  requests.ts   → POST búsqueda, paginación AJAX, descarga de PDF
  downloader.ts → lógica de reintentos con backoff exponencial
  scraper.ts    → orquestación principal, progreso, salida JSON/CSV
```

## Notas técnicas

- Sin automatización de navegador — HTTP puro (`fetch`) + análisis HTML (`cheerio`).
- El `ViewState` de JSF se extrae de cada respuesta y se reutiliza en la siguiente petición.
- Las cookies (`JSESSIONID`) se mantienen en todas las peticiones.
- La paginación usa parámetros AJAX de PrimeFaces DataTable: `javax.faces.partial.ajax`, `dt_pagination`, `dt_first`, `dt_rows`, etc.
- El índice de fila en el ID del componente JSF es **global** (no de página), por lo que se extrae directamente del `onclick` de cada enlace PDF.

## Edge cases manejados

| Caso | Solución |
|------|----------|
| `progress.json` corrupto | Se ignora con `try/catch` y se empieza desde cero |
| PDF ya descargado | Se omite con `fs.existsSync` antes de descargar |
| Error en una página | Se registra en consola y se continúa con la siguiente |
| Respuesta 429 | Backoff exponencial hasta 5 reintentos |
| Respuesta HTML en lugar de PDF | Tratada como error transitorio y reintentada |
| Caracteres inválidos en nombre de archivo | Se reemplazan por `-` o espacio antes de guardar |
| `\n` en campos de texto del HTML | Se normalizan a espacio en el nombre del archivo |
