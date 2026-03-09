# Despliegue aislado en Portainer

Este stack esta preparado para desplegarse sin tocar otros proyectos existentes en Portainer.

## Archivos

- Stack: `docker-compose.portainer.yml`
- Stack Swarm/Portainer recomendado: `docker-stack.swarm.yml`
- Variables: copiar `.env.portainer.example` a `.env.portainer`

## Aislamiento recomendado

- Usa un nombre de stack distinto, por ejemplo: `seace-core`
- Usa un puerto host libre, por ejemplo `3080`
- El volumen persistente queda separado como `seace_core_data`
- No reutiliza contenedores, redes ni volumenes de otros proyectos
- El servicio corre como `root` en el stack para evitar errores `EACCES` sobre el volumen persistente `/app/data`
- En tu VPS actual NO uses el puerto `3000`, porque ya esta ocupado por otro servicio

## Pasos

1. Copia `.env.portainer.example` a `.env.portainer`
2. Completa al menos `API_TOKEN` y `N8N_WEBHOOK_URL`
3. Publica primero la imagen en GHCR con GitHub Actions
4. En Portainer crea un stack nuevo usando `docker-stack.swarm.yml`
5. Carga las variables de `.env.portainer.example` en el editor de variables del stack
6. Define `SEACE_CORE_IMAGE=ghcr.io/TU_USUARIO_GITHUB/TU_REPO:latest`
7. Publica el puerto que definas en `APP_PORT`

## Verificaciones

- Salud: `http://IP_O_HOST:APP_PORT/health`
- Dashboard: `http://IP_O_HOST:APP_PORT/dashboard?token=API_TOKEN`
- Validacion OCR dentro del contenedor: `npm run validate:ocr -- --nomenclature=LP-ABR-6-2026-C-MLV-1 --year=2026`

## Importante

- Este stack no debe desplegarse sobre un stack existente
- Si tu Portainer usa Git deployment, crea un repositorio nuevo para este proyecto
- Si quieres mantenerlo solo en red interna, no expongas el puerto publicamente y publícalo solo en la red privada/VPN/proxy interno
