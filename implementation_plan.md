# Implementation Plan

## Arquitectura

- `Fastify` para API, health y dashboard
- `SQLite` con `better-sqlite3` para una unica instancia ligera
- `node-cron` para tareas diarias y reintentos
- `xlsx` para ingesta de Excel
- `pdf-parse` para extraccion oficial desde PDF
- `Playwright` solo como capa de apoyo para revisar procesos en SEACE

## Flujos

1. Ingesta de Excel a `processes`
2. Programacion de revisiones por `Fecha de Buena Pro`
3. Revision de procesos vencidos
4. Localizacion de PDF ganador
5. Extraccion de datos oficiales
6. Generacion de `leads` y entrega a `n8n`

## Calidad de datos

- Base final solo con columnas necesarias
- Idempotencia por `NOMENCLATURA`
- No persistir HTML crudo
- Mantener solo `pdf_text_excerpt` y URLs de evidencia

## Operacion

- Coolify despliega el contenedor
- `n8n` consume el webhook de leads
- GitHub mantiene el repo y versionado
