const fs = require('fs');
const path = require('path');
const { logger } = require('../src/utils/logger');
const { SeaceBrowserClient } = require('../src/services/seaceBrowserClient');
const { env } = require('../src/config/env');

async function main() {
  const client = new SeaceBrowserClient(logger);
  const context = await client.getContext();
  const page = await context.newPage();

  try {
    page.setDefaultTimeout(env.seaceNavigationTimeoutMs);
    await page.goto(env.seacePublicSearchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: env.seaceNavigationTimeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: Math.min(env.seaceNavigationTimeoutMs, 10000) }).catch(() => {});
    await page.waitForTimeout(env.seaceSettleDelayMs);

    const screenshotPath = path.join(env.tmpDir, `debug-seace-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    const diagnostics = await page.evaluate(() => {
      function normalize(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
      }

      const forms = Array.from(document.querySelectorAll('form')).map((form) => ({
        id: form.id || null,
        action: form.getAttribute('action') || null,
        text: normalize(form.textContent).slice(0, 500),
      }));

      const selects = Array.from(document.querySelectorAll('select')).map((node) => ({
        id: node.id || null,
        name: node.name || null,
        optionCount: node.options.length,
        firstOptions: Array.from(node.options).slice(0, 8).map((option) => normalize(option.textContent)),
      }));

      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a')).map((node) => ({
        id: node.id || null,
        tag: node.tagName,
        text: normalize(node.textContent || node.value),
        href: node.getAttribute('href') || null,
      })).filter((item) => item.id || item.text);

      return {
        title: document.title,
        location: window.location.href,
        bodySnippet: normalize(document.body?.innerText).slice(0, 3000),
        forms,
        selects,
        buttons: buttons.slice(0, 120),
      };
    });

    console.log(JSON.stringify({
      screenshotPath,
      diagnostics,
    }, null, 2));
  } finally {
    await page.close().catch(() => {});
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
