function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

async function retryAsync(operation, { retries = 0, baseDelayMs = 500, onRetry } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }

      attempt += 1;
      if (onRetry) {
        await onRetry(error, attempt);
      }
      await sleep(baseDelayMs * attempt);
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const signal = options.signal || AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...options, signal });
}

async function readResponseText(response, maxLength = 4000) {
  const text = await response.text();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

module.exports = {
  createHttpError,
  fetchWithTimeout,
  readResponseText,
  retryAsync,
  sleep,
};
