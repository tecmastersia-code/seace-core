const { createApp } = require('../src/app');

async function run() {
  const { app } = await createApp({ startJobs: false });
  await app.inject({ method: 'GET', url: '/health' });
  await app.close();
  console.log('smoke-check: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
