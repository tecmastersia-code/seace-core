const fs = require('fs');
const path = require('path');
const { env } = require('../src/config/env');
const { logger } = require('../src/utils/logger');
const { SeaceBrowserClient } = require('../src/services/seaceBrowserClient');
const { extractPdfData } = require('../src/services/pdfExtractor');

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

async function main() {
  const nomenclature = readArg('nomenclature');
  const year = readArg('year', env.publicSearchYear);
  const publishDate = readArg('publish-date', `${year}-01-01T00:00:00.000Z`);

  if (!nomenclature) {
    throw new Error('Falta --nomenclature=VALOR');
  }

  const browserClient = new SeaceBrowserClient(logger);

  try {
    const processRow = {
      nomenclature,
      publish_date: publishDate,
      award_date: null,
      status: null,
      process_url: null,
      pdf_url: null,
      winner_name: null,
      winner_ruc: null,
      object: 'Obra',
    };

    const reviewData = await browserClient.reviewProcess(processRow);
    if (!reviewData.pdfBuffer) {
      console.log(JSON.stringify({
        ok: false,
        message: 'No se descargo PDF en la validacion',
        reviewData,
      }, null, 2));
      return;
    }

    const pdfPath = path.join(env.tmpDir, reviewData.pdfFileName || `${Date.now()}_oferta.pdf`);
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.writeFileSync(pdfPath, reviewData.pdfBuffer);

    const pdfData = await extractPdfData(pdfPath);
    console.log(JSON.stringify({
      ok: true,
      nomenclature,
      process: {
        status: reviewData.status,
        awardDate: reviewData.awardDate,
        processUrl: reviewData.processUrl,
        winnerName: reviewData.winnerName,
        winnerRuc: reviewData.winnerRuc,
        members: reviewData.members,
      },
      pdf: {
        fileName: reviewData.pdfFileName,
        savedPath: pdfPath,
        size: reviewData.pdfBuffer.length,
      },
      extraction: {
        phone: pdfData.phone,
        email: pdfData.email,
        winnerType: pdfData.winnerType,
        winnerName: pdfData.winnerName,
        winnerRuc: pdfData.winnerRuc,
        members: pdfData.members,
        confidence: pdfData.confidence,
        ocrApplied: Boolean(pdfData.ocrApplied),
        excerpt: pdfData.excerpt,
      },
    }, null, 2));
  } finally {
    await browserClient.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
