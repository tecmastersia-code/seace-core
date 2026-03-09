const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { env } = require('../config/env');
const { fetchWithTimeout, retryAsync } = require('../utils/http');
const { cleanText, extractRucs, pickFirst, toIsoDate } = require('../utils/normalizers');

const PROCEDURE_FORM_ID = 'tbBuscador:idFormBuscarProceso';
const PROCEDURE_RESULTS_TABLE_ID = `${PROCEDURE_FORM_ID}:dtProcesos_data`;
const PROCEDURE_PAGINATOR_ID = `${PROCEDURE_FORM_ID}:dtProcesos_paginator_bottom`;

function extractStatus(text) {
  const match = text.match(/\b(Adjudicado|Consentido|Desierto|Anulado)\b/i);
  return match ? cleanText(match[1]) : null;
}

function extractAwardDate(text) {
  const match = text.match(/(?:otorgamiento de la buena pro|fecha de buena pro|buena pro)[\s\S]{0,200}?(\d{1,2}\/\d{1,2}\/\d{4})/i);
  return match ? toIsoDate(match[1]) : null;
}

function normalizeComparableText(value) {
  return cleanText(String(value || ''))
    .toLowerCase()
    .replace(/^\d{11}\s*-\s*/i, '')
    .replace(/^consorcio\s*-\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractDownloadFileName(onclick) {
  const match = String(onclick || '').match(/descargaDocGeneral\([^,]+,[^,]+,'([^']+)'\)/i);
  return match ? cleanText(match[1]) : null;
}

function extractPdfLink(pageUrl, links) {
  const candidate = links.find((href) => /\.pdf(?:$|\?)/i.test(href)) || links.find((href) => /oferta|declaracion|anexo/i.test(href));
  if (!candidate) {
    return null;
  }

  try {
    return new URL(candidate, pageUrl).toString();
  } catch (error) {
    return candidate;
  }
}

function getProcessSearchYear(processRow) {
  const dateCandidates = [processRow.award_date, processRow.publish_date];
  for (const value of dateCandidates) {
    if (!value) {
      continue;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return String(parsed.getUTCFullYear());
    }
  }

  const nomenclatureMatch = String(processRow.nomenclature || '').match(/(?:^|-)(20\d{2})(?:-|$)/);
  if (nomenclatureMatch) {
    return nomenclatureMatch[1];
  }

  return env.publicSearchYear;
}

function extractItemState(text) {
  const match = String(text || '').match(/Estado:\s*(Adjudicado|Consentido|Desierto|Anulado|Convocado)/i);
  return match ? cleanText(match[1]) : null;
}

class SeaceBrowserClient {
  constructor(logger) {
    this.logger = logger;
    this.contextPromise = null;
  }

  async getContext() {
    if (!this.contextPromise) {
      fs.mkdirSync(env.sessionDir, { recursive: true });
      this.contextPromise = chromium.launchPersistentContext(env.sessionDir, {
        headless: env.playwrightHeadless,
        acceptDownloads: true,
      });
    }

    return this.contextPromise;
  }

  buildSearchUrl(processRow) {
    if (processRow.process_url) {
      return processRow.process_url;
    }

    if (!env.seaceSearchUrlTemplate || !processRow.nomenclature) {
      return null;
    }

    return env.seaceSearchUrlTemplate.replace('{nomenclature}', encodeURIComponent(processRow.nomenclature));
  }

  async waitForProcedureResults(page) {
    await page.locator(`[id="${PROCEDURE_RESULTS_TABLE_ID}"]`).waitFor({
      state: 'attached',
      timeout: env.seaceResultsTimeoutMs,
    });
    await page.waitForTimeout(env.seaceSettleDelayMs);
  }

  async runProcedureSearch(page, { year, objectValue }) {
    const objectCandidates = [
      '[id="tbBuscador:idFormBuscarProceso:j_idt192_input"]',
      '[id="tbBuscador:idFormBuscarProceso:j_idt198_input"]',
    ];
    const yearCandidates = [
      '[id="tbBuscador:idFormBuscarProceso:anioConvocatoria_input"]',
    ];

    await page.goto(env.seacePublicSearchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: env.seaceNavigationTimeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: Math.min(env.seaceNavigationTimeoutMs, 10000) }).catch(() => {});
    await page.waitForTimeout(env.seaceSettleDelayMs);

    const tabLink = page.locator('a[href="#tbBuscador:tab1"]').first();
    if (await tabLink.count()) {
      await tabLink.click();
      await page.waitForTimeout(1000);
    }

    let objectSelect = null;
    for (const selector of objectCandidates) {
      const candidate = page.locator(selector).first();
      if (await candidate.count()) {
        objectSelect = candidate;
        break;
      }
    }

    let yearSelect = null;
    for (const selector of yearCandidates) {
      const candidate = page.locator(selector).first();
      if (await candidate.count()) {
        yearSelect = candidate;
        break;
      }
    }

    const searchButton = page.locator('[id="tbBuscador:idFormBuscarProceso:btnBuscarSelToken"]').first();

    if (!objectSelect || !yearSelect || !(await searchButton.count())) {
      throw new Error('No se encontraron controles de busqueda de procedimientos SEACE');
    }

    await objectSelect.selectOption(String(objectValue), { force: true });
    await yearSelect.selectOption(String(year), { force: true });
    await page.waitForTimeout(750);
    await searchButton.click({ force: true });

    await this.waitForProcedureResults(page);
  }

  async setProcedurePageSize(page, size = 20) {
    await page.evaluate(({ paginatorId, size }) => {
      const select = document.querySelector(`[id="${paginatorId}"] select.ui-paginator-rpp-options`);
      if (!select) {
        return;
      }

      select.value = String(size);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, {
      paginatorId: PROCEDURE_PAGINATOR_ID,
      size,
    });

    await page.waitForTimeout(1200);
  }

  async openFichaSelectionFromSearch(page, processRow) {
    const totalPages = await page.evaluate(({ paginatorId }) => {
      const summary = document.querySelector(`[id="${paginatorId}"] .ui-paginator-current`)?.textContent || '';
      const match = summary.match(/Página:\s*\d+\/(\d+)/i);
      return match ? Number(match[1]) : 1;
    }, { paginatorId: PROCEDURE_PAGINATOR_ID });

    for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
      const opened = await page.evaluate(({ tableId, nomenclature }) => {
        function normalize(value) {
          return String(value || '').replace(/\s+/g, ' ').trim();
        }

        const rows = Array.from(document.querySelectorAll(`[id="${tableId}"] tr`));
        const match = rows.find((row) => {
          const cells = row.querySelectorAll('td');
          return cells[3] && normalize(cells[3].textContent) === nomenclature;
        });

        if (!match) {
          return false;
        }

        const fichaLink = match.querySelector('img[id$="grafichaSel"]')?.closest('a') || match.lastElementChild?.querySelectorAll('a')[1];
        if (!fichaLink) {
          return false;
        }

        fichaLink.click();
        return true;
      }, {
        tableId: PROCEDURE_RESULTS_TABLE_ID,
        nomenclature: processRow.nomenclature,
      });

      if (opened) {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: env.seaceNavigationTimeoutMs }).catch(() => {});
        await page.waitForTimeout(env.seaceSettleDelayMs);
        return true;
      }

      const moved = await page.evaluate(({ paginatorId }) => {
        const next = document.querySelector(`[id="${paginatorId}"] .ui-paginator-next:not(.ui-state-disabled)`);
        if (!next) {
          return false;
        }

        next.click();
        return true;
      }, { paginatorId: PROCEDURE_PAGINATOR_ID });

      if (!moved) {
        break;
      }

      await page.waitForTimeout(1500);
    }

    return false;
  }

  async openFichaSelectionPage(page, processRow) {
    if (processRow.process_url && /fichaSeleccion/i.test(processRow.process_url)) {
      await page.goto(processRow.process_url, {
        waitUntil: 'domcontentloaded',
        timeout: env.seaceNavigationTimeoutMs,
      });
      await page.waitForLoadState('networkidle', { timeout: Math.min(env.seaceNavigationTimeoutMs, 10000) }).catch(() => {});
      await page.waitForTimeout(env.seaceSettleDelayMs);

      const text = await page.locator('body').innerText().catch(() => '');
      if (!processRow.nomenclature || text.includes(processRow.nomenclature)) {
        return true;
      }
    }

    await this.runProcedureSearch(page, {
      year: getProcessSearchYear(processRow),
      objectValue: env.publicSearchObjectValue,
    });
    await this.setProcedurePageSize(page, 20);
    return this.openFichaSelectionFromSearch(page, processRow);
  }

  async openItemListPage(page) {
    const clicked = await page.evaluate(() => {
      function normalize(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      }

      const controls = Array.from(document.querySelectorAll('a,button'));
      const target = controls.find((control) => normalize(control.textContent || control.value) === 'ver listado de item'
        || normalize(control.textContent || control.value) === 'ver listado de ítem');
      if (!target) {
        return false;
      }

      target.click();
      return true;
    });

    if (!clicked) {
      return false;
    }

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: env.seaceNavigationTimeoutMs }).catch(() => {});
    await page.waitForTimeout(env.seaceSettleDelayMs);
    return true;
  }

  async openOffersPresentedPage(page) {
    const clicked = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('a,button'));
      const target = controls.find((control) => {
        const text = String(control.textContent || control.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return text === 'ver ofertas presentadas';
      });

      if (!target) {
        return false;
      }

      target.click();
      return true;
    });

    if (!clicked) {
      return false;
    }

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: env.seaceNavigationTimeoutMs }).catch(() => {});
    await page.waitForTimeout(env.seaceSettleDelayMs);
    return true;
  }

  async extractOfferListing(page) {
    return page.evaluate(() => {
      function normalize(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
      }

      const rows = Array.from(document.querySelectorAll('[id$="dtListaPostores_data"] tr'));
      return rows.map((row, index) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.textContent));
        return {
          index,
          ruc: cells[1] || null,
          name: cells[2] || null,
          submittedDate: cells[3] || null,
          submittedTime: cells[4] || null,
          user: cells[5] || null,
          detailButtonId: row.querySelector('a[id]')?.id || null,
        };
      });
    });
  }

  async openOfferDetailPage(page, winnerName, winnerRuc) {
    const offerRows = await this.extractOfferListing(page);
    if (!offerRows.length) {
      return null;
    }

    const normalizedWinnerName = normalizeComparableText(winnerName);
    const normalizedWinnerRuc = cleanText(winnerRuc);
    const selected = offerRows.find((row) => normalizedWinnerRuc && row.ruc === normalizedWinnerRuc)
      || offerRows.find((row) => normalizedWinnerName && normalizeComparableText(row.name).includes(normalizedWinnerName))
      || offerRows[0];

    if (!selected?.detailButtonId) {
      return null;
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: env.seaceNavigationTimeoutMs }).catch(() => null),
      page.evaluate((buttonId) => {
        document.getElementById(buttonId)?.click();
      }, selected.detailButtonId),
    ]);
    await page.waitForTimeout(env.seaceSettleDelayMs);
    return selected;
  }

  async extractOfferDetail(page) {
    return page.evaluate(() => {
      function normalize(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
      }

      const bodyText = document.body.innerText || '';
      const rucMatch = bodyText.match(/RUC\/Codigo\s*([0-9]{11})/i) || bodyText.match(/RUC\/Código\s*([0-9]{11})/i);
      const consortiumMatch = bodyText.match(/Consorcio\s*(Si|No)/i);
      const nameMatch = bodyText.match(/Nombre o Razon Social\s*([^\n\r]+)/i) || bodyText.match(/Nombre o Razón Social\s*([^\n\r]+)/i);

      const members = Array.from(document.querySelectorAll('[id*="dtListaIntegrantes"] tr, [id*="dtListadoIntegrantes"] tr'))
        .map((row) => Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.textContent)))
        .filter((cells) => cells.length >= 4)
        .map((cells) => ({
          ruc: cells[2] || null,
          name: cells[3] || null,
        }));

      const documents = Array.from(document.querySelectorAll('a[onclick*="descargaDocGeneral"]')).map((anchor) => ({
        id: anchor.id || null,
        text: normalize(anchor.textContent || anchor.getAttribute('value')),
        onclick: anchor.getAttribute('onclick') || '',
      }));

      return {
        winnerRuc: rucMatch ? rucMatch[1] : null,
        winnerName: nameMatch ? normalize(nameMatch[1]) : null,
        isConsortium: consortiumMatch ? consortiumMatch[1].toLowerCase() === 'si' : false,
        members,
        documents,
      };
    });
  }

  async downloadOfferPdf(page, offerDetail) {
    const pdfDocument = (offerDetail.documents || [])
      .map((document) => ({
        ...document,
        fileName: extractDownloadFileName(document.onclick),
      }))
      .find((document) => /\.pdf$/i.test(document.fileName || ''));

    if (!pdfDocument?.id) {
      return null;
    }

    const downloadPromise = page.waitForEvent('download', { timeout: env.pdfDownloadTimeoutMs });
    await page.evaluate((buttonId) => {
      document.getElementById(buttonId)?.click();
    }, pdfDocument.id);

    const download = await downloadPromise;
    const tempPath = path.join(env.tmpDir, `${Date.now()}_${download.suggestedFilename()}`);
    await download.saveAs(tempPath);
    const buffer = fs.readFileSync(tempPath);
    fs.rmSync(tempPath, { force: true });

    return {
      fileName: download.suggestedFilename() || pdfDocument.fileName || 'oferta.pdf',
      buffer,
    };
  }

  async extractItemListing(page) {
    return page.evaluate(() => {
      function normalize(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
      }

      function readState(text) {
        const match = String(text || '').match(/Estado:\s*(Adjudicado|Consentido|Desierto|Anulado|Convocado)/i);
        return match ? normalize(match[1]) : null;
      }

      const tables = Array.from(document.querySelectorAll('[id$="dtParticipantes_data"]'));
      return tables.map((table, index) => {
        let parentText = table.closest('table')?.parentElement?.innerText || table.parentElement?.innerText || '';
        let cursor = table.parentElement;
        for (let depth = 0; depth < 6 && cursor; depth += 1) {
          const candidateText = cursor.innerText || '';
          if (/Estado:/i.test(candidateText) && candidateText.length > parentText.length) {
            parentText = candidateText;
            break;
          }
          cursor = cursor.parentElement;
        }

        const participants = Array.from(table.querySelectorAll('tr'))
          .map((row) => Array.from(row.querySelectorAll('td')).map((cell) => normalize(cell.textContent)))
          .filter((cells) => cells.length)
          .map((cells) => ({
            postor: cells[0] || null,
            mype: cells[1] || null,
            leySelva: cells[2] || null,
            bonificacion: cells[3] || null,
            cantidadAdjudicada: cells[4] || null,
            montoAdjudicado: cells[5] || null,
          }));

        return {
          index,
          state: readState(parentText),
          participants,
        };
      });
    });
  }

  async downloadPublicSearchExcel({ objectValue = env.publicSearchObjectValue, year = env.publicSearchYear } = {}) {
    return retryAsync(async () => {
      const context = await this.getContext();
      const page = await context.newPage();

      try {
        page.setDefaultTimeout(env.seaceNavigationTimeoutMs);
        await page.goto(env.seacePublicSearchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: env.seaceNavigationTimeoutMs,
        });
        await page.waitForLoadState('networkidle', { timeout: Math.min(env.seaceNavigationTimeoutMs, 10000) }).catch(() => {});
        await page.waitForTimeout(env.seaceSettleDelayMs);

        const tabLink = page.locator('a[href="#tbBuscador:tab1"]').first();
        const objectSelect = page.locator('[id="tbBuscador:idFormBuscarProceso:j_idt192_input"]').first();
        const yearSelect = page.locator('[id="tbBuscador:idFormBuscarProceso:anioConvocatoria_input"]').first();
        const searchButton = page.locator('[id="tbBuscador:idFormBuscarProceso:btnBuscarSelToken"]').first();
        const exportButton = page.locator('[id="tbBuscador:idFormBuscarProceso:btnExportar"]').first();

        if (!(await objectSelect.count()) || !(await yearSelect.count()) || !(await searchButton.count()) || !(await exportButton.count())) {
          throw new Error('No se encontraron los controles necesarios del buscador publico SEACE');
        }

        if (await tabLink.count()) {
          await tabLink.click();
          await page.waitForTimeout(1000);
        }

        await objectSelect.selectOption(String(objectValue), { force: true });
        await yearSelect.selectOption(String(year), { force: true });
        await page.waitForTimeout(750);
        await searchButton.click({ force: true });

        await page.locator('[id="tbBuscador:idFormBuscarProceso:dtProcesos_data"] tr').first()
          .waitFor({ state: 'attached', timeout: env.seaceResultsTimeoutMs })
          .catch(() => {});
        await page.waitForTimeout(env.seaceExportDelayMs);

        const downloadPromise = page.waitForEvent('download', { timeout: env.seaceResultsTimeoutMs });
        await exportButton.click({ force: true });
        const download = await downloadPromise;
        const tempPath = path.join(env.tmpDir, `${Date.now()}_${download.suggestedFilename()}`);
        await download.saveAs(tempPath);

        const buffer = fs.readFileSync(tempPath);
        fs.rmSync(tempPath, { force: true });

        return {
          fileName: download.suggestedFilename() || `seace_${year}.xlsx`,
          buffer,
          year: String(year),
          objectValue: String(objectValue),
          pageUrl: page.url(),
        };
      } finally {
        await page.close().catch(() => {});
      }
    }, {
      retries: 1,
      onRetry: async (error, attempt) => {
        this.logger.warn({ err: error, attempt }, 'Reintentando descarga publica de Excel SEACE');
        await this.close().catch(() => {});
      },
    });
  }

  async reviewProcess(processRow) {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      page.setDefaultTimeout(env.seaceNavigationTimeoutMs);
      const opened = await this.openFichaSelectionPage(page, processRow);
      if (!opened) {
        return {
          status: processRow.status || null,
          awardDate: processRow.award_date || null,
          processUrl: processRow.process_url || null,
          pdfUrl: processRow.pdf_url || null,
          winnerName: processRow.winner_name || null,
          winnerRuc: processRow.winner_ruc || null,
        };
      }

      const pageText = await page.locator('body').innerText().catch(() => '');
      const fichaUrl = page.url();
      const awardDate = pickFirst(extractAwardDate(pageText), processRow.award_date);

      let status = pickFirst(extractStatus(pageText), processRow.status);
      let winnerName = processRow.winner_name || null;
      let winnerRuc = processRow.winner_ruc || null;
      const pdfUrl = processRow.pdf_url || null;
      let members = [];
      let pdfDownload = null;

      if (awardDate && new Date(awardDate).getTime() <= Date.now()) {
        const items = await this.extractItemListing(page);
        const resolvedItem = items.find((item) => item.participants.length) || items.find((item) => item.state);
        if (resolvedItem) {
          status = pickFirst(resolvedItem.state, status);
          winnerName = pickFirst(resolvedItem.participants[0]?.postor, winnerName);
          winnerRuc = pickFirst(extractRucs(winnerName)[0], winnerRuc);
          members = resolvedItem.participants.slice(1).map((participant) => ({
            ruc: extractRucs(participant.postor)[0] || null,
            name: cleanText(String(participant.postor || '').replace(/^\d{11}\s*-\s*/i, '')) || null,
          })).filter((participant) => participant.ruc || participant.name);
        }

        if (await this.openOffersPresentedPage(page)) {
          const selectedOffer = await this.openOfferDetailPage(page, winnerName, winnerRuc);
          if (selectedOffer) {
            const offerDetail = await this.extractOfferDetail(page);
            winnerName = pickFirst(offerDetail.winnerName, selectedOffer.name, winnerName);
            winnerRuc = pickFirst(offerDetail.winnerRuc, selectedOffer.ruc, winnerRuc);
            if (offerDetail.members.length) {
              members = offerDetail.members;
            }
            pdfDownload = await this.downloadOfferPdf(page, offerDetail);
          }
        }
      }

      return {
        status,
        awardDate,
        processUrl: fichaUrl,
        pdfUrl,
        winnerName,
        winnerRuc,
        members,
        pdfBuffer: pdfDownload?.buffer || null,
        pdfFileName: pdfDownload?.fileName || null,
      };
    } finally {
      await page.close();
    }
  }

  async downloadPdf(pdfUrl) {
    return retryAsync(async () => {
      const response = await fetchWithTimeout(pdfUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36',
        },
      }, env.pdfDownloadTimeoutMs);

      if (!response.ok) {
        throw new Error(`No se pudo descargar el PDF: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const fileName = path.basename(new URL(pdfUrl).pathname) || 'oferta.pdf';
      return {
        fileName,
        buffer: Buffer.from(arrayBuffer),
      };
    }, {
      retries: env.pdfDownloadRetries,
      onRetry: async (error, attempt) => {
        this.logger.warn({ err: error, attempt, pdfUrl }, 'Reintentando descarga de PDF');
      },
    });
  }

  async close() {
    if (!this.contextPromise) {
      return;
    }

    const context = await this.contextPromise;
    await context.close();
    this.contextPromise = null;
  }
}

module.exports = { SeaceBrowserClient };
