const { fetchWithTimeout, readResponseText, retryAsync } = require('../utils/http');

class N8nClient {
  constructor({ webhookUrl, logger, timeoutMs = 20000, maxRetries = 2 }) {
    this.webhookUrl = webhookUrl;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  async deliver(payload) {
    if (!this.webhookUrl) {
      return { skipped: true, reason: 'N8N_WEBHOOK_URL no configurado' };
    }

    await retryAsync(async (attempt) => {
      const response = await fetchWithTimeout(this.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }, this.timeoutMs);

      if (!response.ok) {
        const text = await readResponseText(response);
        throw new Error(`n8n respondio ${response.status}: ${text}`);
      }

      return response;
    }, {
      retries: this.maxRetries,
      onRetry: async (error, attempt) => {
        this.logger.warn({ err: error, attempt }, 'Reintentando entrega a n8n');
      },
    });

    return { skipped: false };
  }
}

module.exports = { N8nClient };
