// =====================================================================
// media.js — turns ANY picked file into something the gallery can show.
// Order: native browser decode → HEIC/HEIF converter → TIFF decoder →
// JPEG preview embedded in camera RAW files (DNG/CR2/NEF/ARW/…) →
// placeholder card (the original is still stored and can be downloaded).
// Nothing is ever rejected because of its format.
// =====================================================================
import { decodeImage, makeThumb, canvasToBlob, videoInfo, isVideoFile } from './core.js';

const EXT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', heic: 'image/heic', heif: 'image/heif',
  tif: 'image/tiff', tiff: 'image/tiff', dng: 'image/x-adobe-dng', cr2: 'image/x-canon-cr2', cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef', arw: 'image/x-sony-arw', orf: 'image/x-olympus-orf', rw2: 'image/x-panasonic-rw2',
  raf: 'image/x-fuji-raf', pef: 'image/x-pentax-pef', srw: 'image/x-samsung-srw', raw: 'image/x-raw', jxl: 'image/jxl',
  mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska', avi: 'video/x-msvideo'
};
export const extOf = name => ((name || '').match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
export function guessType(file) {
  const t = (file.type || '').toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  return EXT_TYPES[extOf(file.name)] || 'application/octet-stream';
}
// Accept list for the file picker: everything image/video plus formats some phones don't tag as images.
export const ACCEPT = 'image/*,video/*,.heic,.heif,.dng,.tif,.tiff,.cr2,.cr3,.nef,.arw,.orf,.rw2,.raf,.pef,.srw,.raw,.avif,.webp,.jxl';
export const looksLikeMedia = f => {
  const t = (f.type || '').toLowerCase();
  return t.startsWith('image/') || t.startsWith('video/') || !t || t === 'application/octet-stream' || !!EXT_TYPES[extOf(f.name)];
};

async function head(blob, n = 64) { return new Uint8Array(await blob.slice(0, n).arrayBuffer()); }
const ascii = (b, s, e) => String.fromCharCode(...b.slice(s, e));
async function sniff(blob) {
  const b = await head(blob, 32);
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avci)$/.test(brand)) return 'heic';
    if (/^(avif|avis)$/.test(brand)) return 'avif';
    if (/^(crx )$/.test(brand)) return 'cr3';
    return 'mp4';
  }
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'tiff'; // also DNG/NEF/CR2/ARW
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 3) === 'GIF') return 'gif';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  return '';
}

async function fromBitmap(img, keepView) {
  const w = img.width, h = img.height;
  const thumb = await makeThumb(img, 500, 0.82);
  const view = keepView ? await makeThumb(img, 2560, 0.9) : null;
  img.close?.();
  return { thumb, view, w, h };
}

async function heicToJpeg(blob) {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
}

async function tiffToCanvas(blob) {
  const UTIF = (await import('utif')).default;
  const buf = await blob.arrayBuffer();
  const ifds = UTIF.decode(buf);
  // pick the largest decodable page
  let best = null;
  for (const ifd of ifds) {
    try { UTIF.decodeImage(buf, ifd, ifds); if (ifd.width && (!best || ifd.width * ifd.height > best.width * best.height)) best = ifd; } catch { /* skip */ }
  }
  if (!best) throw new Error('tiff');
  const rgba = UTIF.toRGBA8(best);
  const c = document.createElement('canvas');
  c.width = best.width; c.height = best.height;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(best.width, best.height);
  id.data.set(rgba);
  ctx.putImageData(id, 0, 0);
  return c;
}

// Camera RAW files carry a full-size JPEG preview; find the biggest one.
function jpegEnd(b, i) {
  let pos = i + 2;
  const n = b.length;
  while (pos < n - 3) {
    if (b[pos] !== 0xff) return -1;
    const m = b[pos + 1];
    if (m === 0xd9) return pos + 2;
    if (m === 0xff) { pos++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { pos += 2; continue; }
    const len = (b[pos + 2] << 8) | b[pos + 3];
    if (len < 2) return -1;
    pos += 2 + len;
    if (m === 0xda) { // entropy-coded data: FF is followed by 00 or RSTn unless it's a real marker
      while (pos < n - 1) {
        if (b[pos] === 0xff && b[pos + 1] !== 0 && !(b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) break;
        pos++;
      }
    }
  }
  return -1;
}
async function embeddedJpeg(blob) {
  const max = Math.min(blob.size, 80 * 1024 * 1024);
  const b = new Uint8Array(await blob.slice(0, max).arrayBuffer());
  let best = null;
  for (let i = 0; i < b.length - 3; i++) {
    if (b[i] !== 0xff || b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue;
    const end = jpegEnd(b, i);
    if (end > 0) {
      if (end - i > 30000 && (!best || end - i > best[1] - best[0])) best = [i, end];
      i = end - 1;
    }
  }
  return best ? new Blob([b.slice(best[0], best[1])], { type: 'image/jpeg' }) : null;
}

async function placeholder(label) {
  const c = document.createElement('canvas'); c.width = c.height = 500;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 500, 500);
  gr.addColorStop(0, '#2a2350'); gr.addColorStop(1, '#14121f');
  g.fillStyle = gr; g.fillRect(0, 0, 500, 500);
  g.fillStyle = 'rgba(255,255,255,.12)';
  g.beginPath(); g.roundRect ? g.roundRect(150, 110, 200, 250, 24) : g.rect(150, 110, 200, 250); g.fill();
  g.fillStyle = '#ffffff'; g.font = 'bold 54px -apple-system, Segoe UI, Roboto, sans-serif'; g.textAlign = 'center';
  g.fillText((label || 'FILE').toUpperCase().slice(0, 5), 250, 255);
  g.font = '600 26px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillStyle = 'rgba(255,255,255,.6)';
  g.fillText('Ketuk untuk unduh', 250, 420);
  return canvasToBlob(c, 'image/jpeg', 0.85);
}

/**
 * prepareMedia(fileOrBlob, {name}) → { kind, type, thumb, view, w, h, duration, conv, unsupported }
 * view = a browser-friendly JPEG to display when the original can't be shown here.
 */
export async function prepareMedia(file, { name = file.name || '', type = '' } = {}) {
  const t = type || guessType({ type: file.type, name });
  const sig = await sniff(file).catch(() => '');
  const isVid = t.startsWith('video/') || (sig === 'mp4' && !t.startsWith('image/')) || isVideoFile({ type: t, name });
  if (isVid) {
    const info = await videoInfo(file);
    return { kind: 'video', type: t.startsWith('video/') ? t : 'video/mp4', thumb: info.thumb, view: null, w: info.w, h: info.h, duration: info.duration, conv: '', unsupported: false };
  }
  const base = { kind: 'photo', type: t, duration: 0, conv: '', unsupported: false };
  // 1) native decode (JPEG, PNG, GIF, WebP, AVIF, BMP, SVG; HEIC/TIFF on iPhone)
  try {
    const img = await decodeImage(file);
    if (img.width && img.height) {
      const r = await fromBitmap(img, false);
      return { ...base, ...r };
    }
  } catch { /* try converters */ }
  // 2) HEIC / HEIF
  if (sig === 'heic' || /hei[cf]/.test(t) || /^hei[cf]$/.test(extOf(name))) {
    try {
      const jpg = await heicToJpeg(file);
      const r = await fromBitmap(await decodeImage(jpg), true);
      return { ...base, ...r, conv: 'heic' };
    } catch (e) { console.warn('heic convert', e); }
  }
  // 3) TIFF (and TIFF-based RAW)
  if (sig === 'tiff') {
    try {
      const c = await tiffToCanvas(file);
      if (c.width * c.height <= 16e6) {
        const r = await fromBitmap(c, true);
        return { ...base, ...r, conv: 'tiff' };
      }
    } catch (e) { /* maybe RAW: fall through */ }
  }
  // 4) embedded JPEG preview (DNG, CR2, CR3, NEF, ARW, ORF, RW2, RAF…)
  try {
    const jpg = await embeddedJpeg(file);
    if (jpg) {
      const r = await fromBitmap(await decodeImage(jpg), true);
      return { ...base, ...r, conv: 'preview' };
    }
  } catch (e) { console.warn('raw preview', e); }
  // 5) keep the file anyway
  return { ...base, thumb: await placeholder(extOf(name) || sig || 'file'), view: null, w: 0, h: 0, conv: 'none', unsupported: true };
}
