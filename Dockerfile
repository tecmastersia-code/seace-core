FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  poppler-utils \
  tesseract-ocr \
  tesseract-ocr-spa \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

RUN npx playwright install --with-deps chromium && chown -R node:node /app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

USER node

CMD ["npm", "start"]
