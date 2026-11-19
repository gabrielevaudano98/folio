// Folio — sheet-md to a real Excel workbook. Formulas stay formulas; Excel recalculates on open.
import JSZip from 'jszip';
import { evaluator, colName } from './sheet-core.js';

const x = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const NUMFMT = { number: 4, integer: 3, percent: 10, date: 14, currency: 164, usd: 165 };

export async function buildXlsx(sheets) {
  const zip = new JSZip();
  const names = sheets.map((s, i) => (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // styles: index = numFmt variant x bold
  const fmts = ['', 'number', 'integer', 'percent', 'date', 'currency', 'usd'];
  const xfs = []; for (const b of [0, 1]) for (const f of fmts) xfs.push([f, b]);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00 [$€-x-euro2]"/><numFmt numFmtId="165" formatCode="[$$-409]#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.map(([f, b]) => `<xf numFmtId="${NUMFMT[f] || 0}" fontId="${b}" applyNumberFormat="1" applyFont="1"/>`).join('')}</cellXfs></styleSheet>`);
  sheets.forEach((s, i) => {
    const ev = evaluator(s);
    const meta = s.meta || {};
    const header = meta.header !== false;
    const cols = Math.max(1, ...s.rows.map((r) => r.length));
    const colXml = Array.from({ length: cols }, (_, c) => { const w = meta.cols?.[colName(c)]?.width; return w ? `<col min="${c + 1}" max="${c + 1}" width="${(w / 7).toFixed(1)}" customWidth="1"/>` : ''; }).join('');
    const rowsXml = s.rows.map((row, r) => `<row r="${r + 1}">${row.map((raw, c) => {
      if (raw === '' || raw == null) return '';
      const ref = `${colName(c)}${r + 1}`;
      const st = { ...(meta.cols?.[colName(c)] || {}), ...(meta.cells?.[ref] || {}) };
      const bold = st.bold || (header && r === 0) ? 1 : 0;
      const sIdx = bold * fmts.length + Math.max(0, fmts.indexOf(st.format || ''));
      const v = ev.value(r, c);
      if (String(raw).startsWith('=')) {
        const f = `<f>${x(String(raw).slice(1))}</f>`;
        if (typeof v === 'number') return `<c r="${ref}" s="${sIdx}">${f}<v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}" s="${sIdx}" t="b">${f}<v>${v ? 1 : 0}</v></c>`;
        return `<c r="${ref}" s="${sIdx}" t="str">${f}<v>${x(v ?? '')}</v></c>`;
      }
      if (typeof v === 'number') return `<c r="${ref}" s="${sIdx}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${sIdx}" t="inlineStr"><is><t xml:space="preserve">${x(raw)}</t></is></c>`;
    }).join('')}</row>`).join('');
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ''}${colXml ? `<cols>${colXml}</cols>` : ''}<sheetData>${rowsXml}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: 'uint8array' });
}
