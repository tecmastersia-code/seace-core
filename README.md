# SEACE Core

Microservicio self-hosted para VPS/Coolify que gestiona diariamente candidatos SEACE, rastrea fechas de Buena Pro y entrega a `n8n` solo la base esperada con datos extraidos del PDF oficial del postor.

Requiere `Node.js 24+` porque usa `node:sqlite` para mantener una base ligera sin dependencias nativas externas.

## Capacidades

- Ingesta de Excel exportado desde SEACE
- Filtro temprano por `OBJETO=Obra` y `VALOR_REF >= 5M`
- Tracking diario de `Fecha de Buena Pro`
- Reintentos automaticos para candidatos futuros
- Extraccion de `RUC`, `POSTOR_NOM`, `TELEFONO`, `EMAIL` desde PDF
- OCR de PDFs escaneados con `pdftoppm` + `tesseract`
- Desglose de consorcio en fila principal + integrantes
- API interna, dashboard SSE y entrega a `n8n`

## Inicio rapido

1. Copia `.env.example` a `.env`
2. Define `API_TOKEN`, `SEACE_SEARCH_URL_TEMPLATE` y `N8N_WEBHOOK_URL`
3. Instala dependencias con `npm.cmd install`
4. Ejecuta `npm.cmd test` y luego `npm.cmd start`
5. Abre `http://localhost:3000/dashboard?token=TU_API_TOKEN`

## Validacion OCR

- Para validar un caso real con OCR en el servidor: `npm run validate:ocr -- --nomenclature=LP-ABR-6-2026-C-MLV-1 --year=2026`
- El comando descarga la ficha, busca la oferta, guarda el PDF en `data/tmp` y muestra por consola si OCR encontro `telefono/email`

## Rutas

- `GET /health`
- `GET /dashboard`
- `GET /api/stream`
- `POST /api/uploads/excel`
- `POST /api/jobs/fetch-excel`
- `POST /api/jobs/ingest`
- `POST /api/jobs/review-due`
- `GET /api/processes`
- `GET /api/leads`
- `GET /api/exports/leads.csv`

## Despliegue en Coolify

- Servicio app: `Dockerfile`
- Volumenes: `data/inbox`, `data/archive`, `data/downloads`, `data/sessions`
- Variables: ver `.env.example`
- Si usas login persistente en SEACE, conserva `SESSION_DIR`
- Protege el acceso con `API_TOKEN` y, si publicas por HTTPS, activa `AUTH_COOKIE_SECURE=true`
- El contenedor instala `poppler-utils` y `tesseract-ocr` para extraer texto de PDFs escaneados

## Despliegue en Portainer

- Usa `docker-compose.portainer.yml` para crear un stack nuevo e independiente
- Si tu Portainer esta en Swarm, usa `docker-stack.swarm.yml`
- Copia `.env.portainer.example` a `.env.portainer` y completa las variables
- Recomendado: usar `APP_PORT=3080` o cualquier puerto libre para no tocar otro proyecto existente
- La guia corta esta en `PORTAINER_DEPLOY.md`

## Flujo recomendado

1. El scheduler descarga el Excel publico de SEACE y lo coloca en `data/inbox`
2. Tambien puedes subir Excel a `POST /api/uploads/excel` o colocarlo manualmente en `data/inbox`
3. Los procesos vencidos se revisan y, si hay PDF ganador, se extraen datos oficiales
4. El microservicio persiste la base final y la envia a `n8n`
