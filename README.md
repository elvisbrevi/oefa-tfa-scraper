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
| `pdfs/` | Archivos PDF descargados |

Los nombres de los PDFs siguen el patrón: `<nro-resolucion>_<administrado>.pdf`

## Cómo funciona

1. **Sesión**: hace un GET a la página para obtener la cookie `JSESSIONID` y el `ViewState` de JSF.
2. **Búsqueda**: hace un POST con filtros vacíos para obtener los 1 753 registros completos (176 páginas, 10 por página).
3. **Paginación**: usa peticiones AJAX parciales de PrimeFaces para obtener cada página, extrayendo el `ViewState` actualizado de cada respuesta XML.
4. **Descarga de PDFs**: hace un POST con el `param_uuid` extraído del atributo `onclick` de cada fila. Maneja errores **429 Too Many Requests** con retroceso exponencial (hasta 5 reintentos, duplicando el tiempo de espera desde 2 s).
5. **Persistencia**: omite PDFs ya descargados, registra todos los fallos en `output/failed_downloads.json` para reintento posterior. Guarda el progreso en `output/progress.json` para poder reanudar si se interrumpe.

## Configuración

Editar el objeto `DEFAULT_CONFIG` en `src/scraper.ts`:

| Clave | Valor por defecto | Descripción |
|-------|-------------------|-------------|
| `delayMs` | `800` | Pausa entre peticiones (ms) |
| `maxRetries` | `5` | Máximo de reintentos por error 429 |
| `initialBackoffMs` | `2000` | Espera inicial en el primer reintento (se duplica en cada intento) |

## Notas técnicas

- Sin automatización de navegador — HTTP puro (`fetch`) + análisis HTML (`cheerio`).
- El ViewState de JSF se extrae de cada respuesta y se reutiliza en la siguiente petición.
- Las cookies (`JSESSIONID`) se mantienen en todas las peticiones.
- La paginación usa parámetros AJAX de PrimeFaces DataTable: `javax.faces.partial.ajax`, `dt_pagination`, `dt_first`, `dt_rows`, etc.
