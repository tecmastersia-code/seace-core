const { createHttpError } = require('./http');

function parseCookies(headerValue) {
  return String(headerValue || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }

      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getRequestToken(request, env) {
  const authorization = String(request.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, '').trim();
  }

  const headerToken = String(request.headers['x-api-token'] || '').trim();
  if (headerToken) {
    return headerToken;
  }

  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = String(cookies[env.authCookieName] || '').trim();
  if (cookieToken) {
    return cookieToken;
  }

  const queryToken = String(request.query?.token || '').trim();
  if (queryToken) {
    return queryToken;
  }

  return null;
}

function isAuthorized(request, env) {
  if (!env.apiToken) {
    return true;
  }

  return getRequestToken(request, env) === env.apiToken;
}

function assertAuthorized(request, env) {
  if (!isAuthorized(request, env)) {
    throw createHttpError(401, 'No autorizado');
  }
}

function buildAuthCookie(env) {
  const maxAge = 12 * 60 * 60;
  const secure = env.authCookieSecure ? '; Secure' : '';
  return `${env.authCookieName}=${encodeURIComponent(env.apiToken)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

module.exports = {
  assertAuthorized,
  buildAuthCookie,
  getRequestToken,
  isAuthorized,
  parseCookies,
};
