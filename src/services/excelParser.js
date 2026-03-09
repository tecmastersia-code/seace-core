const xlsx = require('xlsx');
const {
  cleanText,
  normalizeHeader,
  parseMoney,
  pickFirst,
  toIsoDate,
} = require('../utils/normalizers');

const headerAliases = {
  entity: ['entidad', 'nombre_o_sigla_de_la_entidad'],
  publish_date: ['fecha_publ', 'fecha_publicacion', 'fecha_public', 'fecha_publicacion_convocatoria', 'fecha_y_hora_de_publicacion'],
  nomenclature: ['nomenclatura', 'nomenclatura_procedimiento'],
  object: ['objeto', 'objeto_contratacion', 'objeto_de_contratacion'],
  description: ['descripcion', 'descripcion_contratacion', 'descripcion_de_objeto'],
  reference_value: ['valor_ref', 'valor_referencial', 'monto_referencial', 'valorreferencial', 'vr_ve_cuantia_de_la_contratacion'],
  award_date: ['fecha_b_pro', 'fecha_buena_pro', 'fecha_b_pro.', 'fecha_otorgamiento_buena_pro'],
  status: ['estado'],
  fideicomiso: ['fideicomiso', 'fideicomisos'],
  process_url: ['process_url', 'proceso_url', 'url_proceso'],
  pdf_url: ['pdf_url', 'offer_pdf_url', 'url_pdf', 'url_oferta_pdf'],
};

function buildHeaderMap(headers) {
  const normalizedHeaders = new Map();
  for (const header of headers) {
    normalizedHeaders.set(normalizeHeader(header), header);
  }

  const result = {};
  for (const [field, aliases] of Object.entries(headerAliases)) {
    const matched = aliases.find((alias) => normalizedHeaders.has(alias));
    if (matched) {
      result[field] = normalizedHeaders.get(matched);
    }
  }
  return result;
}

function parseExcel(filePath, minReferenceValue) {
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: null, raw: false });

  if (!rows.length) {
    return [];
  }

  const headerMap = buildHeaderMap(Object.keys(rows[0]));
  return rows
    .map((row) => {
      const object = cleanText(pickFirst(row[headerMap.object], 'Obra'));
      const referenceValue = parseMoney(row[headerMap.reference_value]);
      return {
        entity: cleanText(row[headerMap.entity]),
        publish_date: toIsoDate(row[headerMap.publish_date]),
        nomenclature: cleanText(row[headerMap.nomenclature]),
        object,
        description: cleanText(row[headerMap.description]),
        reference_value: referenceValue,
        award_date: toIsoDate(row[headerMap.award_date]),
        status: cleanText(row[headerMap.status]),
        fideicomiso: cleanText(row[headerMap.fideicomiso]),
        process_url: cleanText(row[headerMap.process_url]),
        pdf_url: cleanText(row[headerMap.pdf_url]),
        raw: row,
      };
    })
    .filter((row) => row.nomenclature)
    .filter((row) => (!row.object || /obra/i.test(row.object)))
    .filter((row) => row.reference_value >= minReferenceValue);
}

module.exports = { parseExcel };
