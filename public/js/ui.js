// Small shared browser helpers.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmt = (iso, opts = {}) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts }) : '—';
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—');
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
export function toast(msg, isErr = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast${isErr ? ' err' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

export const SEV_BADGE = { blocker: '<span class="badge bad sev">Required</span>', warning: '<span class="badge warn sev">Check</span>', info: '<span class="badge info sev">Note</span>' };

export const STATUS = {
  scheduled: ['Scheduled', ''],
  in_progress: ['In progress', 'info'],
  submitted: ['Submitted — unverified', 'warn'],
  in_review: ['In review', 'info'],
  needs_info: ['Returned to technician', 'bad'],
  verified: ['Verified by reviewer', 'ok'],
  disputed: ['Disputed', 'bad'],
};
export const statusBadge = (s) => { const [l, c] = STATUS[s] || [s, '']; return `<span class="badge ${c}"><span class="dot"></span>${esc(l)}</span>`; };

export const READINESS = {
  not_started: ['Not started', ''],
  in_progress: ['In progress', 'info'],
  missing_items: ['Missing required items', 'bad'],
  review_with_warnings: ['Complete — has warnings', 'warn'],
  ready_for_review: ['Complete — awaiting review', 'ok'],
};
export const readinessBadge = (r) => { const [l, c] = READINESS[r] || [r, '']; return `<span class="badge ${c}">${esc(l)}</span>`; };

export function exceptionList(exceptions, { empty = 'No exceptions found.' } = {}) {
  if (!exceptions.length) return `<p class="muted small">${esc(empty)}</p>`;
  const order = { blocker: 0, warning: 1, info: 2 };
  return [...exceptions].sort((a, b) => order[a.severity] - order[b.severity])
    .map((e) => `<div class="exc ${e.severity}">${SEV_BADGE[e.severity]}<div><strong>${esc(e.title)}</strong>${esc(e.message)}</div></div>`).join('');
}

// ---------------------------------------------------------------- signature pad
export function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, inked = 0, last = null;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1b33';
    inked = 0;
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    inked += Math.hypot(p.x - last.x, p.y - last.y); last = p;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  requestAnimationFrame(resize);
  return {
    clear: resize,
    isEmpty: () => inked < 40, // ignore taps and tiny marks
    toDataURL: () => canvas.toDataURL('image/png'),
  };
}

// ---------------------------------------------------------------- files
export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
});

/**
 * Read DateTimeOriginal from a JPEG's EXIF block. Returns an ISO string or null.
 * This is what the camera *reports*; RouteProof labels it as device metadata and
 * never substitutes another time when it is missing.
 */
export async function readExifCaptureTime(file) {
  if (!/jpe?g$/i.test(file.type.split('/')[1] || '') && !/\.jpe?g$/i.test(file.name)) return null;
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off); const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
    if ((marker & 0xff00) !== 0xff00) break;
    off += 2 + len;
  }
  return null;
}

function parseTiff(v, start) {
  try {
    const le = v.getUint16(start) === 0x4949;
    const u16 = (o) => v.getUint16(start + o, le), u32 = (o) => v.getUint32(start + o, le);
    const str = (o, n) => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i)); return s; };
    const readIfd = (o) => { const n = u16(o), tags = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 }; } return tags; };
    const ifd0 = readIfd(u32(4));
    const exifPtr = ifd0[0x8769];
    if (!exifPtr) return null;
    const exif = readIfd(u32(exifPtr.valOff));
    const dt = exif[0x9003] || exif[0x9004];
    if (!dt) return null;
    const raw = str(u32(dt.valOff), dt.count); // "YYYY:MM:DD HH:MM:SS"
    const offTag = exif[0x9011];
    const tz = offTag ? str(offTag.count > 4 ? u32(offTag.valOff) : offTag.valOff, offTag.count) : '';
    const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(raw);
    if (!m) return null;
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${/^[+-]\d\d:\d\d$/.test(tz) ? tz : ''}`;
    const d = new Date(iso);
    return isNaN(d) ? null : d.toISOString();
  } catch { return null; }
}
