# SEACE Core Task

## Mision

Construir un microservicio self-hosted para VPS que gestione diariamente candidatos SEACE y entregue a `n8n` una base final minimizada, alimentada por datos oficiales obtenidos del PDF ganador.

## Objetivos

- Ingerir Excel exportado desde SEACE
- Filtrar solo obras con `VALOR_REF >= 5M`
- Verificar diariamente la `Fecha de Buena Pro`
- Reintentar candidatos futuros sin ruido operativo
- Extraer datos oficiales del PDF del ganador
- Desglosar consorcios en multiples filas
- Entregar la base final a `n8n`

## Restricciones

- Produccion solo en VPS
- Sin APIs externas
- Persistir solo datos utiles
- Evitar almacenar artefactos temporales de forma indefinida
- Usar navegador solo cuando el sitio lo requiera
