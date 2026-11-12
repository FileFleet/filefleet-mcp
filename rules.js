// Upload rules and checks, matching src/lib/rules.ts on filefleet.io so the site, requirement
// links and this server always agree. Sizes: a file passes a maximum of N KB at N × 1,000 bytes
// or less, and a minimum of N KB at N × 1,024 bytes or more, so it passes however a form counts.

export const FMTS = ['jpg', 'png', 'pdf', 'heic', 'webp'];
const LABEL = { jpg: 'JPG', png: 'PNG', pdf: 'PDF', heic: 'HEIC', webp: 'WebP', gif: 'GIF', other: 'another type' };

export const sizeText = (kb) => (kb >= 1000 ? `${+(kb / 1000).toFixed(2)} MB` : `${+(+kb).toFixed(1)} KB`);
const fmtBytes = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} MB` : `${(n / 1000).toFixed(1)} KB`);

/** Rules from the tool input (snake_case, as AI assistants send it). */
export function rulesFromInput(i = {}) {
  const pair = (w, h) => (w && h ? { w, h } : undefined);
  return {
    for: i.for || undefined,
    what: i.what || undefined,
    types: i.types?.length ? [...new Set(i.types.map((t) => (t === 'jpeg' ? 'jpg' : t)))] : undefined,
    minKb: i.min_kb || undefined,
    maxKb: i.max_kb || undefined,
    px: pair(i.width, i.height),
    minPx: pair(i.min_width, i.min_height),
    maxPx: pair(i.max_width, i.max_height),
    square: i.square || undefined,
    maxPages: i.max_pages || undefined,
    maxFiles: i.max_files || undefined,
    name: i.file_name || undefined,
    note: i.note || undefined,
  };
}

/** Rules for one upload of a published requirement, such as us-visa/photo. */
export function rulesFromSlot(s) {
  return { types: s.formats, minKb: s.minKb, maxKb: s.maxKb, px: s.px, minPx: s.minPx, maxPx: s.maxPx, square: s.square };
}

export function describe(r) {
  const out = [];
  if (r.types?.length) {
    const l = r.types.map((t) => LABEL[t]);
    out.push(l.length === 1 ? `${l[0]} only` : `${l.slice(0, -1).join(', ')} or ${l[l.length - 1]}`);
  }
  if (r.minKb && r.maxKb) out.push(`${sizeText(r.minKb)} to ${sizeText(r.maxKb)} each`);
  else if (r.maxKb) out.push(`Up to ${sizeText(r.maxKb)} each`);
  else if (r.minKb) out.push(`At least ${sizeText(r.minKb)} each`);
  if (r.px) out.push(`Exactly ${r.px.w} × ${r.px.h} pixels`);
  if (r.minPx && r.maxPx) out.push(`${r.minPx.w} × ${r.minPx.h} to ${r.maxPx.w} × ${r.maxPx.h} pixels`);
  else if (r.minPx) out.push(`At least ${r.minPx.w} × ${r.minPx.h} pixels`);
  else if (r.maxPx) out.push(`At most ${r.maxPx.w} × ${r.maxPx.h} pixels`);
  if (r.square) out.push('Square');
  if (r.maxPages) out.push(`PDFs up to ${r.maxPages} page${r.maxPages > 1 ? 's' : ''}`);
  if (r.maxFiles) out.push(r.maxFiles === 1 ? 'One file' : `Up to ${r.maxFiles} files`);
  if (r.name) out.push(`Named like “${r.name}”`);
  return out;
}

/** The address of a requirement link: filefleet.io/fit/?… */
export function linkFor(r) {
  const p = new URLSearchParams();
  const set = (k, v) => v !== undefined && v !== '' && p.set(k, String(v));
  set('for', r.for);
  set('what', r.what);
  if (r.types?.length) set('types', r.types.join(','));
  if (r.minKb) set('min', sizeText(r.minKb).replace(' ', ''));
  if (r.maxKb) set('max', sizeText(r.maxKb).replace(' ', ''));
  if (r.px) (set('w', r.px.w), set('h', r.px.h));
  if (r.minPx) (set('minw', r.minPx.w), set('minh', r.minPx.h));
  if (r.maxPx) (set('maxw', r.maxPx.w), set('maxh', r.maxPx.h));
  if (r.square) set('square', 1);
  set('pages', r.maxPages);
  set('files', r.maxFiles);
  set('name', r.name);
  set('note', r.note);
  return `https://filefleet.io/fit/?${p.toString()}`;
}

/** Checks a file's facts (type, bytes, pixels, pages) against rules. */
export function check(r, f) {
  const out = [];
  const label = LABEL[f.type] ?? 'another type';
  if (r.types?.length) {
    const ok = r.types.includes(f.type);
    out.push({ ok, rule: 'type', text: ok ? `${label} is accepted.` : `It’s ${f.type === 'other' ? 'not a photo or PDF' : `a ${label}`}; the form takes ${describe({ types: r.types })[0]}.` });
  }
  if (r.maxKb) {
    const ok = f.bytes <= r.maxKb * 1000;
    out.push({ ok, rule: 'max_size', text: ok ? `${fmtBytes(f.bytes)} is under ${sizeText(r.maxKb)}.` : `${fmtBytes(f.bytes)} is over the ${sizeText(r.maxKb)} limit by ${fmtBytes(f.bytes - r.maxKb * 1000)}.` });
  }
  if (r.minKb) {
    const ok = f.bytes >= r.minKb * 1024;
    out.push({ ok, rule: 'min_size', text: ok ? `${fmtBytes(f.bytes)} is above the ${sizeText(r.minKb)} minimum.` : `${fmtBytes(f.bytes)} is under the ${sizeText(r.minKb)} minimum.` });
  }
  if (f.width && f.height) {
    const d = `${f.width} × ${f.height} pixels`;
    if (r.px) {
      const ok = f.width === r.px.w && f.height === r.px.h;
      out.push({ ok, rule: 'pixels', text: ok ? `${d}, exactly right.` : `${d}; it needs to be exactly ${r.px.w} × ${r.px.h}.` });
    }
    if (r.minPx) {
      const ok = f.width >= r.minPx.w && f.height >= r.minPx.h;
      out.push({ ok, rule: 'min_pixels', text: ok ? `${d} meets the ${r.minPx.w} × ${r.minPx.h} minimum.` : `${d} is smaller than the ${r.minPx.w} × ${r.minPx.h} minimum; a new photo or scan is needed.` });
    }
    if (r.maxPx) {
      const ok = f.width <= r.maxPx.w && f.height <= r.maxPx.h;
      out.push({ ok, rule: 'max_pixels', text: ok ? `${d} is within ${r.maxPx.w} × ${r.maxPx.h}.` : `${d} is bigger than ${r.maxPx.w} × ${r.maxPx.h}.` });
    }
    if (r.square) {
      const ok = f.width === f.height;
      out.push({ ok, rule: 'square', text: ok ? 'Square.' : `Not square (${d}).` });
    }
  } else if (r.px || r.minPx || r.maxPx || r.square) {
    out.push({ ok: null, rule: 'pixels', text: 'Pixel size not given, so it wasn’t checked.' });
  }
  if (r.maxPages && f.pages) {
    const ok = f.pages <= r.maxPages;
    out.push({ ok, rule: 'pages', text: ok ? `${f.pages} page${f.pages > 1 ? 's' : ''}.` : `${f.pages} pages; the form takes up to ${r.maxPages}.` });
  }
  if (f.encrypted) out.push({ ok: false, rule: 'password', text: 'The PDF has a password; most forms reject locked PDFs.' });
  return out;
}
