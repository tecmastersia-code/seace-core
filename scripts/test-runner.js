const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function resetProjectModules() {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.includes(`${path.sep}src${path.sep}`)) {
      delete require.cache[modulePath];
    }
  }
}

function createTempEnv(overrides = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seace-core-test-'));
  const envValues = {
    NODE_ENV: 'production',
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: '0',
    ENABLE_SCHEDULER: 'false',
    DATABASE_PATH: path.join(rootDir, 'data', 'seace.sqlite'),
    INBOX_DIR: path.join(rootDir, 'data', 'inbox'),
    ARCHIVE_DIR: path.join(rootDir, 'data', 'archive'),
    DOWNLOAD_DIR: path.join(rootDir, 'data', 'downloads'),
    TMP_DIR: path.join(rootDir, 'data', 'tmp'),
    SESSION_DIR: path.join(rootDir, 'data', 'sessions', 'seace'),
    ...overrides,
  };

  const previousValues = {};
  for (const [key, value] of Object.entries(envValues)) {
    previousValues[key] = process.env[key];
    process.env[key] = String(value);
  }

  return {
    restore() {
      for (const [key, value] of Object.entries(previousValues)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      fs.rmSync(rootDir, { recursive: true, force: true });
      resetProjectModules();
    },
  };
}

async function createTestApp(overrides = {}) {
  resetProjectModules();
  const state = createTempEnv(overrides);
  const { createApp } = require('../src/app');
  const { app } = await createApp({ startJobs: false });
  return {
    app,
    close: async () => {
      await app.close();
      state.restore();
    },
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main() {
  await runTest('public health endpoint stays available', async () => {
    const instance = await createTestApp();
    try {
      const response = await instance.app.inject({ method: 'GET', url: '/health' });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, 'ok');
    } finally {
      await instance.close();
    }
  });

  await runTest('protected endpoints require api token when configured', async () => {
    const instance = await createTestApp({ API_TOKEN: 'secret-token' });
    try {
      const unauthorized = await instance.app.inject({ method: 'GET', url: '/api/processes' });
      assert.equal(unauthorized.statusCode, 401);
      assert.equal(unauthorized.json().error, 'No autorizado');

      const authorized = await instance.app.inject({
        method: 'GET',
        url: '/api/processes',
        headers: { authorization: 'Bearer secret-token' },
      });
      assert.equal(authorized.statusCode, 200);
    } finally {
      await instance.close();
    }
  });

  await runTest('dashboard token query sets auth cookie for browser usage', async () => {
    const instance = await createTestApp({ API_TOKEN: 'secret-token' });
    try {
      const dashboard = await instance.app.inject({ method: 'GET', url: '/dashboard?token=secret-token' });
      assert.equal(dashboard.statusCode, 200);
      assert.match(String(dashboard.headers['set-cookie'] || ''), /seace_core_auth=/);
    } finally {
      await instance.close();
    }
  });

  await runTest('upload endpoint rejects non excel files with 400', async () => {
    const instance = await createTestApp({ API_TOKEN: 'secret-token' });
    try {
      const boundary = '----seace-test-boundary';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="notes.txt"',
        'Content-Type: text/plain',
        '',
        'hello',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const response = await instance.app.inject({
        method: 'POST',
        url: '/api/uploads/excel',
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, 'Solo se permiten archivos Excel .xlsx o .xls');
    } finally {
      await instance.close();
    }
  });

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
