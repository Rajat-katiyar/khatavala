import bwipjs from 'bwip-js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Barcode rendering, via bwip-js.
 *
 * Two shapes are produced:
 *   - `renderBarcode` — one PNG, for the product page and label printers;
 *   - `renderSheetSvg` — an A4 sheet of labels as inline SVG, for the print
 *     preview. SVG rather than a grid of PNGs because a barcode is line art:
 *     it must stay crisp at whatever DPI the printer runs, and a raster image
 *     scaled to a 38mm label prints as mush that scanners refuse to read.
 */

/** Symbologies worth exposing. `code128` handles arbitrary alphanumeric SKUs. */
export const SYMBOLOGIES = ['code128', 'ean13', 'ean8', 'upca', 'code39'] as const;
export type Symbology = (typeof SYMBOLOGIES)[number];

export interface BarcodeOptions {
  symbology?: Symbology;
  /** Print the human-readable digits under the bars. */
  includeText?: boolean;
  scale?: number;
  height?: number;
}

/**
 * EAN/UPC are fixed-length numeric with a check digit. bwip-js throws on bad
 * input, but its message ("bwipp.ean13badLength") is not something to show a
 * shopkeeper, so the common cases are checked up front.
 */
function assertEncodable(text: string, symbology: Symbology) {
  if (!text) throw ApiError.badRequest('Nothing to encode — this product has no barcode or SKU');

  const digitsOnly = /^[0-9]+$/.test(text);
  const rules: Partial<Record<Symbology, { len: number[]; label: string }>> = {
    ean13: { len: [12, 13], label: 'EAN-13 needs 12 or 13 digits' },
    ean8: { len: [7, 8], label: 'EAN-8 needs 7 or 8 digits' },
    upca: { len: [11, 12], label: 'UPC-A needs 11 or 12 digits' },
  };

  const rule = rules[symbology];
  if (!rule) return;
  if (!digitsOnly || !rule.len.includes(text.length)) {
    throw ApiError.badRequest(
      `"${text}" cannot be encoded as ${symbology.toUpperCase()} — ${rule.label}. Use Code 128 for free-form SKUs.`
    );
  }
}

export async function renderBarcode(
  text: string,
  options: BarcodeOptions = {}
): Promise<Buffer> {
  const symbology = options.symbology ?? 'code128';
  assertEncodable(text, symbology);

  try {
    return await bwipjs.toBuffer({
      bcid: symbology,
      text,
      scale: options.scale ?? 3,
      height: options.height ?? 12,
      includetext: options.includeText ?? true,
      textxalign: 'center',
    });
  } catch (err) {
    throw ApiError.badRequest(
      `Could not render that barcode: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }
}

export interface LabelInput {
  /** What the bars encode — the barcode if set, otherwise the SKU. */
  code: string;
  name: string;
  sku: string;
  price?: number;
  /** How many copies of this label to lay out. */
  quantity: number;
}

export interface SheetOptions {
  symbology?: Symbology;
  showPrice?: boolean;
  showName?: boolean;
  currency?: string;
  /** Labels across the page. 3 suits a 65×38mm A4 sheet. */
  columns?: number;
}

/** Escapes text for inclusion in SVG character data. */
const esc = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Lays out a printable A4 label sheet.
 *
 * Each label is a bwip-js-rendered SVG barcode plus optional name and price.
 * The caller prints the returned document directly; there is no PDF step,
 * because every target browser prints SVG at device resolution already and a
 * PDF dependency would buy nothing.
 */
export async function renderSheetSvg(
  labels: LabelInput[],
  options: SheetOptions = {}
): Promise<string> {
  const symbology = options.symbology ?? 'code128';
  const columns = Math.max(1, Math.min(5, options.columns ?? 3));
  const showName = options.showName ?? true;
  const showPrice = options.showPrice ?? true;
  const currency = options.currency ?? 'INR';

  // Expand quantities into individual labels, capped so one careless request
  // cannot ask for 100,000 barcodes and pin the event loop.
  const expanded: LabelInput[] = [];
  for (const label of labels) {
    const quantity = Math.max(1, Math.min(500, Math.floor(label.quantity) || 1));
    for (let i = 0; i < quantity; i += 1) expanded.push(label);
  }
  if (expanded.length === 0) throw ApiError.badRequest('Select at least one product to print');
  if (expanded.length > 1000) {
    throw ApiError.badRequest('That is more than 1000 labels — print them in smaller batches');
  }

  // Render each DISTINCT code once and reuse it. A sheet of 200 identical
  // labels should be one bwip-js call, not 200.
  const distinct = [...new Set(expanded.map((label) => label.code))];
  const svgByCode = new Map<string, string>();

  for (const code of distinct) {
    assertEncodable(code, symbology);
    try {
      const svg = bwipjs.toSVG({
        bcid: symbology,
        text: code,
        scale: 2,
        height: 10,
        includetext: true,
        textxalign: 'center',
      });
      svgByCode.set(code, svg);
    } catch (err) {
      throw ApiError.badRequest(
        `Could not render a barcode for "${code}": ${
          err instanceof Error ? err.message : 'unknown error'
        }`
      );
    }
  }

  const labelWidth = 180;
  const labelHeight = showName || showPrice ? 118 : 92;
  const gap = 10;
  const rows = Math.ceil(expanded.length / columns);
  const sheetWidth = columns * labelWidth + (columns + 1) * gap;
  const sheetHeight = rows * labelHeight + (rows + 1) * gap;

  const cells = expanded.map((label, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + col * (labelWidth + gap);
    const y = gap + row * (labelHeight + gap);

    // bwip-js returns a complete <svg> document; strip its wrapper so the
    // barcode can be positioned as a group inside the sheet.
    const inner = (svgByCode.get(label.code) ?? '')
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '');

    const nameLine = showName
      ? `<text x="${labelWidth / 2}" y="16" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11">${esc(
          label.name.length > 28 ? `${label.name.slice(0, 27)}…` : label.name
        )}</text>`
      : '';

    const priceLine =
      showPrice && label.price !== undefined
        ? `<text x="${labelWidth / 2}" y="${labelHeight - 6}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold">${esc(
            new Intl.NumberFormat('en-IN', {
              style: 'currency',
              currency,
              maximumFractionDigits: 2,
            }).format(label.price)
          )}</text>`
        : '';

    return `<g transform="translate(${x},${y})">
      <rect width="${labelWidth}" height="${labelHeight}" fill="#fff" stroke="#e5e7eb" stroke-width="0.5"/>
      ${nameLine}
      <g transform="translate(10,${showName ? 22 : 8})">${inner}</g>
      ${priceLine}
    </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${cells.join('\n')}
</svg>`;
}
