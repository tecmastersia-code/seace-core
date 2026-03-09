const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pdfParse = require('pdf-parse');
const { env } = require('../config/env');
const {
  cleanText,
  extractEmails,
  extractPhones,
  extractRucs,
  scoreConfidence,
  unique,
} = require('../utils/normalizers');

function runCommand(command, args, { timeoutMs, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timer = null;

    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        const error = new Error(`Timeout ejecutando ${command}`);
        error.code = 'TIMEOUT';
        reject(error);
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(error);
    });

    child.on('close', (code) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(`${command} termino con codigo ${code}: ${stderr || stdout}`.trim());
      error.code = code;
      reject(error);
    });
  });
}

function removeDirSafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function createOcrWorkspace() {
  const workspace = path.join(env.tmpDir, `ocr_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`);
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function shouldRunOcr(text, parsedData) {
  if (!env.ocrEnabled) {
    return false;
  }

  const normalized = cleanText(text);
  const alphaCount = (normalized.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
  const digitCount = (normalized.match(/\d/g) || []).length;

  if (normalized.length < env.ocrMinTextLength) {
    return true;
  }

  if (parsedData.confidence < env.ocrConfidenceThreshold) {
    return true;
  }

  if (!parsedData.email && !parsedData.phone && !parsedData.winnerName && !parsedData.members.length) {
    return true;
  }

  return alphaCount < 400 || (!parsedData.email && digitCount > alphaCount * 1.5);
}

function sortPageImages(fileNames) {
  return fileNames.sort((left, right) => {
    const leftPage = Number((left.match(/-(\d+)\.(?:png|jpg)$/i) || [])[1] || 0);
    const rightPage = Number((right.match(/-(\d+)\.(?:png|jpg)$/i) || [])[1] || 0);
    return leftPage - rightPage;
  });
}

async function extractTextViaOcr(filePath) {
  const workspace = createOcrWorkspace();
  const imagePrefix = path.join(workspace, 'page');

  try {
    await runCommand(env.ocrPdftoppmBin, [
      '-png',
      '-r', String(env.ocrDpi),
      '-f', '1',
      '-l', String(env.ocrMaxPages),
      filePath,
      imagePrefix,
    ], {
      timeoutMs: env.ocrTimeoutMs,
    });

    const images = sortPageImages(fs.readdirSync(workspace)
      .filter((fileName) => /^page-\d+\.png$/i.test(fileName)));

    if (!images.length) {
      return null;
    }

    const pageTexts = [];
    for (const imageName of images) {
      const imagePath = path.join(workspace, imageName);
      const { stdout } = await runCommand(env.ocrTesseractBin, [
        imagePath,
        'stdout',
        '-l', env.ocrLang,
      ], {
        timeoutMs: env.ocrTimeoutMs,
      });
      pageTexts.push(stdout);
    }

    return pageTexts.join('\n');
  } finally {
    removeDirSafe(workspace);
  }
}

function buildPdfData(text) {
  const cleanBodyText = String(text || '').replace(/\u0000/g, ' ');
  const emails = extractEmails(cleanBodyText);
  const phones = extractPhones(cleanBodyText);
  const rucs = extractRucs(cleanBodyText);
  const names = extractNameCandidates(cleanBodyText);
  const consortiumLine = names.find((value) => /consorcio/i.test(value)) || null;
  const winnerType = consortiumLine ? 'consorcio' : 'empresa';
  const winnerName = consortiumLine || names[0] || null;
  const winnerRuc = winnerType === 'consorcio' ? 'CONSORCIO' : (rucs[0] || null);
  const members = extractMembers(cleanBodyText, phones, emails);

  return {
    text: cleanBodyText,
    excerpt: cleanText(cleanBodyText).slice(0, 1200),
    winnerType,
    winnerName,
    winnerRuc,
    phone: phones[0] || null,
    email: emails[0] || null,
    members,
    confidence: scoreConfidence({
      email: emails[0],
      phone: phones[0],
      ruc: winnerRuc,
      winnerName,
      members,
    }),
  };
}

function extractNameCandidates(text) {
  const lines = text.split(/\r?\n/).map(cleanText).filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    if (line.length < 5 || line.length > 160) {
      continue;
    }

    if (/^(razon social|nombre|postor|consorcio|empresa|integrante)/i.test(line) || /S\.A\.|S\.R\.L\.|SAC|CONSORCIO/i.test(line)) {
      candidates.push(line.replace(/^(razon social|nombre del postor|postor|consorcio|empresa|integrante)\s*:?\s*/i, '').trim());
    }
  }
  return unique(candidates);
}

function extractMembers(text, sharedPhones, sharedEmails) {
  const lines = text.split(/\r?\n/).map(cleanText).filter(Boolean);
  const members = [];
  for (const line of lines) {
    const rucMatch = line.match(/\b\d{11}\b/);
    if (!rucMatch) {
      continue;
    }

    const name = cleanText(line.replace(rucMatch[0], '').replace(/^(ruc|integrante|consorciado|empresa)\s*:?/i, ''));
    if (!name || name.length < 4) {
      continue;
    }

    members.push({
      ruc: rucMatch[0],
      name,
      phone: sharedPhones[0] || null,
      email: sharedEmails[0] || null,
    });
  }

  const seen = new Set();
  return members.filter((member) => {
    const key = `${member.ruc}:${member.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function extractPdfData(filePath) {
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);
  const text = String(result.text || '').replace(/\u0000/g, ' ');
  let parsedData = buildPdfData(text);

  if (shouldRunOcr(text, parsedData)) {
    try {
      const ocrText = await extractTextViaOcr(filePath);
      if (ocrText && cleanText(ocrText)) {
        parsedData = {
          ...buildPdfData([text, ocrText].filter(Boolean).join('\n')),
          ocrApplied: true,
        };
      }
    } catch (error) {
      if (!['ENOENT', 'TIMEOUT'].includes(String(error.code))) {
        throw error;
      }
    }
  }

  return parsedData;
}

module.exports = { extractPdfData };
