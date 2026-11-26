// Folio Sheets — Univer in the window. Univer draws the grid, the formula bar, the sheet bar, menus and panels;
// Folio draws the ribbon around it (ribbon.js), so Univer's own header and toolbar are off.
// The theme is read from Folio's design tokens at start, so the grid follows tokens.css (grey, chroma 0) and dark mode.
import { Univer, LocaleType, mergeLocales, UniverInstanceType, ICommandService } from '@univerjs/core';
import { defaultTheme } from '@univerjs/themes';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverSheetsNumfmtUIPlugin } from '@univerjs/sheets-numfmt-ui';
import { UniverDataValidationPlugin } from '@univerjs/data-validation';
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation';
import { UniverSheetsDataValidationUIPlugin } from '@univerjs/sheets-data-validation-ui';
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter';
import { UniverSheetsFilterUIPlugin } from '@univerjs/sheets-filter-ui';
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort';
import { UniverSheetsSortUIPlugin } from '@univerjs/sheets-sort-ui';
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting';
import { UniverSheetsConditionalFormattingUIPlugin } from '@univerjs/sheets-conditional-formatting-ui';
import { UniverSheetsNotePlugin } from '@univerjs/sheets-note';
import { UniverSheetsNoteUIPlugin } from '@univerjs/sheets-note-ui';
import { UniverSheetsTablePlugin } from '@univerjs/sheets-table';
import { UniverSheetsTableUIPlugin } from '@univerjs/sheets-table-ui';
import { UniverSheetsHyperLinkPlugin } from '@univerjs/sheets-hyper-link';
import { UniverSheetsHyperLinkUIPlugin } from '@univerjs/sheets-hyper-link-ui';
import { UniverFindReplacePlugin } from '@univerjs/find-replace';
import { UniverSheetsFindReplacePlugin } from '@univerjs/sheets-find-replace';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { UniverDrawingUIPlugin } from '@univerjs/drawing-ui';
import { UniverSheetsDrawingPlugin } from '@univerjs/sheets-drawing';
import { UniverSheetsDrawingUIPlugin } from '@univerjs/sheets-drawing-ui';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/ui/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
import '@univerjs/sheets-numfmt/facade';
import '@univerjs/sheets-data-validation/facade';
import '@univerjs/sheets-filter/facade';
import '@univerjs/sheets-conditional-formatting/facade';
import '@univerjs/sheets-note/facade';
import '@univerjs/sheets-table/facade';
import '@univerjs/sheets-find-replace/facade';
import '@univerjs/sheets-drawing-ui/facade';
import '@univerjs/sheets-hyper-link-ui/facade';
import enDesign from '@univerjs/design/locale/en-US'; import itDesign from '@univerjs/design/locale/it-IT';
import enUI from '@univerjs/ui/locale/en-US'; import itUI from '@univerjs/ui/locale/it-IT';
import enDocsUI from '@univerjs/docs-ui/locale/en-US'; import itDocsUI from '@univerjs/docs-ui/locale/it-IT';
import enSheets from '@univerjs/sheets/locale/en-US'; import itSheets from '@univerjs/sheets/locale/it-IT';
import enSheetsUI from '@univerjs/sheets-ui/locale/en-US'; import itSheetsUI from '@univerjs/sheets-ui/locale/it-IT';
import enFormula from '@univerjs/sheets-formula/locale/en-US'; import itFormula from '@univerjs/sheets-formula/locale/it-IT';
import enFormulaUI from '@univerjs/sheets-formula-ui/locale/en-US'; import itFormulaUI from '@univerjs/sheets-formula-ui/locale/it-IT';
import enEngineFormula from '@univerjs/engine-formula/locale/en-US'; import itEngineFormula from '@univerjs/engine-formula/locale/it-IT';
import enNumfmt from '@univerjs/sheets-numfmt-ui/locale/en-US'; import itNumfmt from '@univerjs/sheets-numfmt-ui/locale/it-IT';
import enDV from '@univerjs/data-validation/locale/en-US'; import itDV from '@univerjs/data-validation/locale/it-IT';
import enSDV from '@univerjs/sheets-data-validation/locale/en-US'; import itSDV from '@univerjs/sheets-data-validation/locale/it-IT';
import enSDVUI from '@univerjs/sheets-data-validation-ui/locale/en-US'; import itSDVUI from '@univerjs/sheets-data-validation-ui/locale/it-IT';
import enFilter from '@univerjs/sheets-filter/locale/en-US'; import itFilter from '@univerjs/sheets-filter/locale/it-IT';
import enFilterUI from '@univerjs/sheets-filter-ui/locale/en-US'; import itFilterUI from '@univerjs/sheets-filter-ui/locale/it-IT';
import enSortUI from '@univerjs/sheets-sort-ui/locale/en-US'; import itSortUI from '@univerjs/sheets-sort-ui/locale/it-IT';
import enCF from '@univerjs/sheets-conditional-formatting/locale/en-US'; import itCF from '@univerjs/sheets-conditional-formatting/locale/it-IT';
import enCFUI from '@univerjs/sheets-conditional-formatting-ui/locale/en-US'; import itCFUI from '@univerjs/sheets-conditional-formatting-ui/locale/it-IT';
import enNote from '@univerjs/sheets-note/locale/en-US'; import itNote from '@univerjs/sheets-note/locale/it-IT';
import enNoteUI from '@univerjs/sheets-note-ui/locale/en-US'; import itNoteUI from '@univerjs/sheets-note-ui/locale/it-IT';
import enTable from '@univerjs/sheets-table/locale/en-US'; import itTable from '@univerjs/sheets-table/locale/it-IT';
import enTableUI from '@univerjs/sheets-table-ui/locale/en-US'; import itTableUI from '@univerjs/sheets-table-ui/locale/it-IT';
import enLink from '@univerjs/sheets-hyper-link/locale/en-US'; import itLink from '@univerjs/sheets-hyper-link/locale/it-IT';
import enLinkUI from '@univerjs/sheets-hyper-link-ui/locale/en-US'; import itLinkUI from '@univerjs/sheets-hyper-link-ui/locale/it-IT';
import enFind from '@univerjs/find-replace/locale/en-US'; import itFind from '@univerjs/find-replace/locale/it-IT';
import enDrawingUI from '@univerjs/drawing-ui/locale/en-US'; import itDrawingUI from '@univerjs/drawing-ui/locale/it-IT';
import enSDrawingUI from '@univerjs/sheets-drawing-ui/locale/en-US'; import itSDrawingUI from '@univerjs/sheets-drawing-ui/locale/it-IT';

const EN = [enDesign, enUI, enDocsUI, enSheets, enSheetsUI, enFormula, enFormulaUI, enEngineFormula, enNumfmt, enDV, enSDV, enSDVUI, enFilter, enFilterUI, enSortUI, enCF, enCFUI, enNote, enNoteUI, enTable, enTableUI, enLink, enLinkUI, enFind, enDrawingUI, enSDrawingUI];
const IT = [itDesign, itUI, itDocsUI, itSheets, itSheetsUI, itFormula, itFormulaUI, itEngineFormula, itNumfmt, itDV, itSDV, itSDVUI, itFilter, itFilterUI, itSortUI, itCF, itCFUI, itNote, itNoteUI, itTable, itTableUI, itLink, itLinkUI, itFind, itDrawingUI, itSDrawingUI];

/* ---------- theme from tokens.css ---------- */
const probe = (() => { let c; return () => (c ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })); })();
/** any CSS colour (oklch, color-mix…) → #rrggbb, painted over the paper colour */
export function cssHex(color, over = '#ffffff') {
  const g = probe(); g.clearRect(0, 0, 1, 1); g.fillStyle = over; g.fillRect(0, 0, 1, 1); g.fillStyle = color; g.fillRect(0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data; return '#' + [r, gg, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const tok = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();
/** Univer theme with only greys: primary is ink, the neutral scale is Folio's paper → ink ramp */
export function folioTheme(dark) {
  const L = (l) => `oklch(${l}% 0 0)`;
  const scale = (steps) => Object.fromEntries(Object.entries(steps).map(([k, l]) => [k, cssHex(L(l))]));
  const gray = dark
    ? scale({ 0: 100, 50: 96, 100: 90, 200: 82, 300: 66, 400: 54, 500: 42, 600: 32, 700: 26, 800: 22, 900: 19, 1000: 0 })
    : scale({ 0: 100, 50: 98.2, 100: 95.6, 200: 92.4, 300: 81, 400: 61, 500: 48, 600: 38, 700: 29, 800: 24, 900: 21, 1000: 0 });
  const primary = scale(dark ? { 50: 26, 100: 30, 200: 36, 300: 46, 400: 62, 500: 78, 600: 86, 700: 92, 800: 95, 900: 98 } : { 50: 96.5, 100: 93, 200: 88, 300: 78, 400: 58, 500: 38, 600: 28, 700: 21, 800: 18, 900: 14 });
  return { ...defaultTheme, primary, gray, blue: primary, jiqing: primary, indigo: primary };
}

/** start Univer in `container`; returns { univer, api, commands, dispose } */
export function startUniver(container, { lang = 'en', dark = false } = {}) {
  const locale = lang === 'it' ? LocaleType.IT_IT : LocaleType.EN_US;
  const univer = new Univer({
    theme: folioTheme(dark), darkMode: dark, locale,
    locales: { [LocaleType.EN_US]: mergeLocales(...EN), [LocaleType.IT_IT]: mergeLocales(...IT) },
  });
  const fontFamily = tok('--font-sans');
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverUIPlugin, { container, header: true, toolbar: false, footer: true, contextMenu: true, disableAutoFocus: true, customFontFamily: [{ value: fontFamily, label: 'System', category: 'sans-serif' }] });
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverDocsUIPlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsUIPlugin, { formulaBar: true, footer: { sheetBar: true, statisticBar: true, menus: true, zoomSlider: true } });
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverSheetsFormulaUIPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
  univer.registerPlugin(UniverDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationUIPlugin);
  univer.registerPlugin(UniverSheetsFilterPlugin);
  univer.registerPlugin(UniverSheetsFilterUIPlugin);
  univer.registerPlugin(UniverSheetsSortPlugin);
  univer.registerPlugin(UniverSheetsSortUIPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingUIPlugin);
  univer.registerPlugin(UniverSheetsNotePlugin);
  univer.registerPlugin(UniverSheetsNoteUIPlugin);
  univer.registerPlugin(UniverSheetsTablePlugin);
  univer.registerPlugin(UniverSheetsTableUIPlugin);
  univer.registerPlugin(UniverSheetsHyperLinkPlugin);
  univer.registerPlugin(UniverSheetsHyperLinkUIPlugin);
  univer.registerPlugin(UniverFindReplacePlugin);
  univer.registerPlugin(UniverSheetsFindReplacePlugin);
  univer.registerPlugin(UniverDrawingPlugin);
  univer.registerPlugin(UniverDrawingUIPlugin);
  univer.registerPlugin(UniverSheetsDrawingPlugin);
  univer.registerPlugin(UniverSheetsDrawingUIPlugin);
  const api = FUniver.newAPI(univer);
  const commands = univer.__getInjector().get(ICommandService);
  return {
    univer, api, commands,
    open(data) { return univer.createUnit(UniverInstanceType.UNIVER_SHEET, data); },
    close(unitId) { api.disposeUnit?.(unitId); },
    setDark(on) { api.toggleDarkMode?.(on); univer.setTheme?.(folioTheme(on)); },
    dispose() { univer.dispose(); },
  };
}
