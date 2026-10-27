/**
 * Single-page PDF export (`downloadChartPDF` / `toPDF`) and clipboard copy (`copyChartImage`).
 *
 * The PDF is written by hand (no dependencies): one page the size of the chart (CSS px at
 * 96 dpi -> points) showing the composited PNG export (chart-export.ts: canvas + DOM overlay)
 * as an RGB image XObject, deflated with `CompressionStream` when the runtime has it (raw
 * otherwise). The result is raster: for vector output use `exportChartSVG`.
 */

export interface PdfImage {
  /** Pixel size of the image */
  width: number;
  height: number;
  /** RGB bytes (`width * height * 3`), zlib-deflated when `deflated` */
  data: Uint8Array;
  deflated: boolean;
}

export interface PdfPage {
  /** Page size in points (1/72 in) */
  widthPt: number;
  heightPt: number;
  image: PdfImage;
  title?: string;
}

const enc = new TextEncoder();

/** PDF literal string `( ... )` with `\`, `(`, `)` escaped and non-ASCII dropped. */
export function pdfString(s: string): string {
  // eslint-disable-next-line no-control-regex
  return `(${s.replace(/[^\x20-\x7e]/g, '').replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** Bytes of a one-page PDF drawing `page.image` over the whole page. */
export function buildPdf(page: PdfPage): Uint8Array {
  const { widthPt: W, heightPt: H, image } = page;
  const num = (v: number) => (Math.round(v * 100) / 100).toString();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };
  // Header + binary comment (marks the file as binary for transfer tools)
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  const filter = image.deflated ? ' /Filter /FlateDecode' : '';
  obj(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${filter} /Length ${image.data.length} >>`,
    image.data
  );
  const content = enc.encode(`q ${num(W)} 0 0 ${num(H)} 0 0 cm /Im0 Do Q`);
  obj(5, `<< /Length ${content.length} >>`, content);
  obj(6, `<< /Producer (charturbo-engine) /Title ${pdfString(page.title ?? 'Chart')} >>`);
  const xref = length;
  let table = `xref\n0 7\n0000000000 65535 f \n`;
  for (let id = 1; id <= 6; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** RGB bytes of straight RGBA pixels, flattened over white where translucent. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const n = rgba.length >> 2;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + 255 * (1 - a));
  }
  return out;
}

/** zlib deflate via `CompressionStream` (`null` when the runtime has none). */
export async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    void writer.write(data as Uint8Array<ArrayBuffer>);
    void writer.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch {
    return null;
  }
}

/** PDF of a composited chart canvas (`cssW x cssH` CSS px page). */
export async function canvasToPdf(canvas: HTMLCanvasElement, cssW: number, cssH: number, title?: string): Promise<Blob> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('toPDF: 2D canvas unavailable');
  const rgb = rgbaToRgb(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  const packed = await deflate(rgb);
  const bytes = buildPdf({
    widthPt: cssW * 0.75,
    heightPt: cssH * 0.75,
    image: { width: canvas.width, height: canvas.height, data: packed ?? rgb, deflated: packed !== null },
    title,
  });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** True when this browser can put a PNG on the clipboard (`ClipboardItem` + `clipboard.write`). */
export function canCopyImage(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  );
}

/**
 * Copies a PNG to the clipboard; false when unsupported or refused (permission / no user
 * gesture). `png` may be a promise so Safari keeps the user-gesture context.
 */
export async function copyPngToClipboard(png: Blob | Promise<Blob>): Promise<boolean> {
  if (!canCopyImage()) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
