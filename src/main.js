const { createApp } = require('./app');
const { env } = require('./config/env');

let appInstance = null;

async function shutdown(signal) {
  try {
    if (appInstance) {
      await appInstance.close();
    }
    process.exit(0);
  } catch (error) {
    console.error(`${signal} shutdown failed`, error);
    process.exit(1);
  }
}

async function start() {
  const { app } = await createApp();
  appInstance = app;
  await app.listen({ host: env.host, port: env.port });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
