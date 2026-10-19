import { esc, fmt, fmtTime, fmtDate, api, toast, exceptionList, signaturePad, fileToDataUrl, readExifCaptureTime, statusBadge } from './ui.js';

const top = document.getElementById('top');
const view = document.getElementById('view');
const bar = document.getElementById('bar');
const barInner = document.getElementById('bar-inner');

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let D;
let me = store.get('rp-tech');
const openSteps = new Set();
let signoffMode = 'captured';
let pad = null;
let redoSignoff = null; // work order id whose existing sign-off is being replaced

const by = (a, id) => a.find((x) => x.id === id);
const LOGO = '<span class="logo-mark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-11"/></svg></span>';
const EDITABLE = ['scheduled', 'in_progress', 'needs_info'];

async function load() { D = await api('/api/bootstrap'); }

async function route() {
  if (!D) await load();
  const [, name, id] = location.hash.replace(/^#/, '').split('/');
  bar.classList.add('hidden');
  if (!me || !by(D.technicians, me)) return pickTech();
  if (name === 'job' && id) return renderJob(id);
  renderList();
}
window.addEventListener('hashchange', route);

function pickTech() {
  top.innerHTML = `${LOGO}<div><h1>RouteProof</h1><div class="sub">Technician app</div></div>`;
  view.innerHTML = `<h2 style="margin:12px 4px">Who's working today?</h2><p class="muted" style="margin:0 4px 14px">Demo sign-in — pick a fictional technician.</p>
    <div class="who-pick">${D.technicians.map((t) => `<button data-t="${t.id}">${esc(t.name)}<span>${t.skills.join(', ')} · ${esc(t.region)}</span></button>`).join('')}</div>`;
  view.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { me = b.dataset.t; store.set('rp-tech', me); location.hash = '#/'; route(); }));
}

function renderList() {
  const t = by(D.technicians, me);
  top.innerHTML = `${LOGO}<div style="flex:1"><h1>${esc(t.name)}</h1><div class="sub">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div></div><button class="btn btn-sm" style="background:rgba(255,255,255,.1);color:#fff" id="switch">Switch</button>`;
  document.getElementById('switch').onclick = () => { me = null; pickTech(); };
  const mine = D.workOrders.filter((w) => w.technicianId === me);
  const groups = [
    ['Returned — action needed', mine.filter((w) => w.status === 'needs_info')],
    ['In progress', mine.filter((w) => w.status === 'in_progress')],
    ['Scheduled', mine.filter((w) => w.status === 'scheduled').sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))],
    ['Submitted', mine.filter((w) => !EDITABLE.includes(w.status)).sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor)).slice(0, 5)],
  ];
  view.innerHTML = groups.filter(([, l]) => l.length).map(([h, list]) => `<div class="t-h">${h}</div>${list.map(jobCard).join('')}`).join('') || '<div class="t-card">No jobs assigned.</div>';
}

function jobCard(w) {
  const l = by(D.locations, w.locationId), tp = by(D.templates, w.templateId), a = w.analysis;
  return `<a class="t-card job" href="#/job/${w.id}">
    <div class="top"><span class="when">${fmtDate(w.scheduledFor)} · ${fmtTime(w.scheduledFor)}</span>${statusBadge(w.status)}</div>
    <div class="where">${esc(l.name)}${w.demo ? ' <span class="badge demo">Demo</span>' : ''}</div>
    <div class="addr">${esc(l.address)} · ${esc(tp.name)}</div>
    ${w.status !== 'scheduled' ? `<div class="meter ${a.completeness.pct === 100 ? 'ok' : ''}"><span style="width:${a.completeness.pct}%"></span></div><div class="progress-strip"><span>${a.completeness.documented}/${a.completeness.total} steps documented</span><span>${w.number}</span></div>` : `<div class="progress-strip"><span>${tp.steps.length} steps</span><span>${w.number}</span></div>`}
  </a>`;
}

async function renderJob(id, keepScroll = false) {
  const y = window.scrollY;
  let w;
  try { w = await api(`/api/work-orders/${id}`); } catch (e) { view.innerHTML = `<div class="t-card">${esc(e.message)}</div>`; return; }
  const i = D.workOrders.findIndex((x) => x.id === w.id); if (i >= 0) D.workOrders[i] = w;
  const l = by(D.locations, w.locationId), c = by(D.customers, w.customerId), tp = by(D.templates, w.templateId), a = w.analysis;
  const editable = EDITABLE.includes(w.status);
  const checkedIn = !!w.visit.checkInAt;

  top.innerHTML = `<a class="back" href="#/" aria-label="Back to jobs">‹</a><div style="flex:1;min-width:0"><h1>${esc(w.number)} · ${esc(l.name)}</h1><div class="sub">${esc(tp.name)}</div></div>`;

  const stepHtml = tp.steps.map((s, idx) => {
    const st = a.steps.find((x) => x.stepId === s.id);
    const entry = w.checklist.find((x) => x.stepId === s.id) || { status: 'not_done', note: '' };
    const photos = w.evidence.filter((e) => e.stepId === s.id);
    const open = openSteps.has(s.id);
    const flagged = w.status !== 'in_progress' && w.status !== 'scheduled' && st.missing.length;
    return `<div class="t-step ${open ? 'open' : ''} ${st.state === 'documented' || st.state === 'na' ? 'documented' : ''} ${flagged ? 'flag' : ''}" data-step="${s.id}">
      <div class="row" data-toggle="${s.id}">
        <button class="tick ${entry.status === 'done' ? 'on' : entry.status === 'na' ? 'na' : ''}" data-tick="${s.id}" ${editable && checkedIn ? '' : 'disabled'} aria-label="Mark ${esc(s.label)} ${entry.status === 'done' ? 'not done' : 'done'}">${entry.status === 'done' ? '✓' : entry.status === 'na' ? 'N/A' : ''}</button>
        <div class="lbl">${idx + 1}. ${esc(s.label)}
          <div class="req">${s.requiresPhoto ? `<span class="badge ${photos.some((p) => p.review?.status !== 'rejected') ? 'ok' : st.missing.includes('photo') && entry.status === 'done' ? 'bad' : ''}">📷 Photo</span>` : ''}${s.requiresNote ? `<span class="badge ${st.missing.includes('note') || st.missing.includes('note detail') ? (entry.status === 'done' ? 'bad' : '') : 'ok'}">✎ Note</span>` : ''}${entry.completedAt ? `<span class="badge">${fmtTime(entry.completedAt)}</span>` : ''}</div>
        </div><span class="chev">›</span>
      </div>
      <div class="body">
        ${s.noteHint ? `<p class="small muted" style="margin:0 0 6px">Include ${esc(s.noteHint)}.</p>` : ''}
        <textarea data-note="${s.id}" placeholder="${s.requiresNote ? 'Required note' : 'Optional note'}" ${editable && checkedIn ? '' : 'disabled'}>${esc(entry.note || '')}</textarea>
        ${editable && checkedIn ? `<div style="display:flex;gap:8px;margin-top:6px"><button class="btn btn-sm btn-ghost" data-savenote="${s.id}">Save note</button>${entry.status !== 'na' ? `<button class="btn btn-sm btn-ghost" data-na="${s.id}">Not applicable…</button>` : `<button class="btn btn-sm btn-ghost" data-undo-na="${s.id}">Undo N/A</button>`}</div>` : ''}
        <div class="photo-strip" style="margin-top:10px">
          ${photos.map((p) => `<figure class="${p.review?.status === 'rejected' ? 'rejected' : ''}"><img src="${esc(p.url)}" alt="${esc(p.caption)}">${p.capturedAt ? fmtTime(p.capturedAt) : 'no capture time'}${p.review?.status === 'rejected' ? `<br><b style="color:var(--bad)">Rejected: ${esc(p.review.comment)}</b>` : ''}</figure>`).join('')}
          ${editable && checkedIn ? `<label class="add-photo">＋ Photo<input type="file" accept="image/*,application/pdf" capture="environment" data-upload="${s.id}"></label>` : ''}
        </div>
      </div></div>`;
  }).join('');

  const so = redoSignoff === w.id ? null : w.signoff;
  const signoffHtml = so
    ? `<div class="t-card"><strong>Customer sign-off</strong><p style="margin:.4em 0 0">${so.status === 'captured' ? `✓ Signed by ${esc(so.signerName)} at ${fmtTime(so.capturedAt)}` : `${so.status === 'refused' ? 'Refused' : 'Not available'} — “${esc(so.reason)}”`}</p>
        ${so.signatureUrl ? `<img src="${esc(so.signatureUrl)}" alt="Signature" style="max-height:60px;margin-top:6px">` : ''}${editable ? '<button class="btn btn-sm btn-ghost" id="redo-sign" style="margin-top:8px">Redo sign-off</button>' : ''}</div>`
    : editable && checkedIn ? `<div class="t-card"><strong>Customer sign-off</strong>${redoSignoff === w.id ? ' <span class="small muted">(replacing the earlier one — it stays on file until you save)</span>' : ''}
        <div class="seg" style="margin-top:10px">${[['captured', 'Signature'], ['unavailable', 'Not available'], ['refused', 'Refused']].map(([k, l]) => `<button data-mode="${k}" class="${signoffMode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${signoffMode === 'captured'
          ? `<label class="field">Customer name and title<input type="text" id="signer" autocomplete="off"></label><canvas class="sigpad" id="sigpad" aria-label="Customer signs here"></canvas>
             <div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-ghost btn-sm" id="sig-clear">Clear</button><button class="btn btn-primary btn-sm" id="sig-save" style="flex:1">Save signature</button></div>
             <p class="small muted" style="margin:.6em 0 0">Hand the device to the customer. RouteProof records the time it's saved.</p>`
          : `<label class="field">Reason (required)<textarea id="so-reason" placeholder="${signoffMode === 'refused' ? 'What the customer said' : 'e.g. After-hours service; no one on site'}"></textarea></label><button class="btn btn-primary btn-sm" id="so-save">Record</button>`}
      </div>` : '';

  const banner = w.status === 'needs_info' ? `<div class="t-card" style="border-color:#f6c3c3;background:#fff8f8"><strong style="color:var(--bad)">Returned by reviewer</strong><p style="margin:.3em 0 0">“${esc(w.review?.comment)}”</p><p class="small muted" style="margin:.3em 0 0">${esc(w.review?.reviewer)} · ${fmt(w.review?.decidedAt)}</p></div>` : '';
  const lockedMsg = !editable ? `<div class="locked">This record is ${w.status === 'verified' ? 'verified' : w.status.replace('_', ' ')} and can no longer be edited from the field. ${w.status === 'submitted' ? 'A reviewer will check it.' : ''}</div>` : '';

  view.innerHTML = `
    ${banner}
    <div class="t-card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><strong>${esc(c.name)}</strong>${w.demo ? ' <span class="badge demo">Demo</span>' : ''}<div class="small muted">${esc(l.address)}</div></div>${statusBadge(w.status)}</div>
      <div class="progress-strip" style="margin-top:10px"><span>Check-in: ${checkedIn ? fmtTime(w.visit.checkInAt) : '—'}</span><span>Check-out: ${w.visit.checkOutAt ? fmtTime(w.visit.checkOutAt) : '—'}</span></div>
      <div class="meter ${a.completeness.pct === 100 ? 'ok' : ''}"><span style="width:${a.completeness.pct}%"></span></div>
      <div class="progress-strip"><span>${a.completeness.documented} of ${a.completeness.total} steps documented</span><span>${w.evidence.length} file(s)</span></div>
    </div>
    ${lockedMsg}
    ${!checkedIn && editable ? '<div class="locked">Check in when you arrive on site to start the checklist.</div>' : ''}
    <div class="t-h">Checklist</div>${stepHtml}
    <div class="t-h">General notes</div>
    <div class="t-card">${w.notes.map((n) => `<p style="margin:0 0 8px">${esc(n.text)}<br><span class="small muted">${fmt(n.recordedAt)}</span></p>`).join('')}
      ${editable && checkedIn ? `<textarea id="gen-note" placeholder="Anything the customer or office should know"></textarea><button class="btn btn-sm btn-ghost" id="add-note" style="margin-top:6px">Add note</button>` : w.notes.length ? '' : '<span class="muted small">None</span>'}</div>
    <div class="t-h">Sign-off</div>${signoffHtml || (so ? '' : '<div class="locked">No sign-off recorded.</div>')}
    ${editable && checkedIn ? `<div class="t-h">Before you submit</div><div class="t-card" id="precheck">${precheck(w)}</div>` : ''}`;

  // bottom action bar
  if (editable) {
    bar.classList.remove('hidden');
    barInner.innerHTML = !checkedIn
      ? '<button class="btn btn-primary" id="checkin">Check in on site</button>'
      : '<button class="btn btn-primary" id="submit">Review &amp; submit</button>';
  }
  bind(w, tp);
  if (keepScroll) window.scrollTo(0, y);
}

function precheck(w) {
  const preview = w.analysis;
  // The server analyzes in-progress jobs leniently; show what will be flagged on submit.
  const missing = preview.steps.filter((s) => s.missing.length);
  const tp = by(D.templates, w.templateId);
  const items = missing.map((s) => `<li>${esc(tp.steps.find((x) => x.id === s.stepId).label)} — <b>${s.missing.join(', ')}</b></li>`);
  if (!w.signoff || redoSignoff === w.id) items.push('<li>Customer sign-off — <b>signature or reason</b></li>');
  return items.length
    ? `<p style="margin:0 0 6px"><strong style="color:var(--bad)">${items.length} item(s) still missing</strong></p><ul style="margin:0;padding-left:1.1em;font-size:.9rem">${items.join('')}</ul><p class="small muted" style="margin:.6em 0 0">You can still submit — the reviewer will see these as missing.</p>`
    : '<p style="margin:0;color:var(--ok)"><strong>✓ Everything the template requires is in.</strong></p><p class="small muted" style="margin:.3em 0 0">A reviewer still has to verify the record.</p>';
}

function bind(w, tp) {
  const reload = () => renderJob(w.id, true);
  const call = async (path, body, msg) => { try { await api(path, { method: 'POST', body }); if (path.endsWith('/signoff')) redoSignoff = null; if (msg) toast(msg); await reload(); } catch (e) { toast(e.message, true); } };

  document.getElementById('checkin')?.addEventListener('click', () => call(`/api/work-orders/${w.id}/check-in`, {}, 'Checked in'));
  document.getElementById('submit')?.addEventListener('click', async () => {
    const pending = w.analysis.steps.filter((s) => s.missing.length).length + (w.signoff ? 0 : 1);
    if (pending && !confirm(`${pending} required item(s) are missing. Submit anyway? The reviewer will see them flagged.`)) return;
    if (!pending && !confirm('Submit this record for review? You will not be able to edit it afterwards.')) return;
    try { await api(`/api/work-orders/${w.id}/submit`, { method: 'POST' }); toast('Submitted for review'); D = null; await load(); location.hash = '#/'; } catch (e) { toast(e.message, true); }
  });

  view.querySelectorAll('[data-toggle]').forEach((r) => (r.onclick = (e) => {
    if (e.target.closest('[data-tick]')) return;
    const id = r.dataset.toggle; openSteps.has(id) ? openSteps.delete(id) : openSteps.add(id);
    r.parentElement.classList.toggle('open');
  }));
  view.querySelectorAll('[data-tick]').forEach((b) => (b.onclick = () => {
    const entry = w.checklist.find((x) => x.stepId === b.dataset.tick);
    const next = entry?.status === 'done' ? 'not_done' : 'done';
    call(`/api/work-orders/${w.id}/checklist/${b.dataset.tick}`, { status: next });
  }));
  view.querySelectorAll('[data-savenote]').forEach((b) => (b.onclick = () => {
    const v = view.querySelector(`[data-note="${b.dataset.savenote}"]`).value;
    call(`/api/work-orders/${w.id}/checklist/${b.dataset.savenote}`, { note: v }, 'Note saved');
  }));
  view.querySelectorAll('[data-na]').forEach((b) => (b.onclick = () => {
    const reason = prompt('Why does this step not apply? (required)');
    if (!reason?.trim()) return;
    call(`/api/work-orders/${w.id}/checklist/${b.dataset.na}`, { status: 'na', note: reason.trim() }, 'Marked not applicable');
  }));
  view.querySelectorAll('[data-undo-na]').forEach((b) => (b.onclick = () => call(`/api/work-orders/${w.id}/checklist/${b.dataset.undoNa}`, { status: 'not_done' })));
  view.querySelectorAll('[data-upload]').forEach((inp) => (inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('File is larger than 10 MB', true);
    const caption = prompt('Short caption (what does this show?)', '') ?? '';
    const label = inp.closest('.add-photo'); label.classList.add('uploading'); label.firstChild.textContent = 'Uploading…';
    try {
      const [dataUrl, exifCapturedAt] = await Promise.all([fileToDataUrl(file), readExifCaptureTime(file)]);
      await api(`/api/work-orders/${w.id}/evidence`, { method: 'POST', body: { dataUrl, filename: file.name, caption: caption.trim(), stepId: inp.dataset.upload, exifCapturedAt } });
      toast(exifCapturedAt ? 'Uploaded — capture time read from photo' : 'Uploaded — photo has no capture time');
      await reload();
    } catch (e) { toast(e.message, true); label.classList.remove('uploading'); label.firstChild.textContent = '＋ Photo'; }
  }));
  document.getElementById('add-note')?.addEventListener('click', () => {
    const v = document.getElementById('gen-note').value.trim(); if (!v) return;
    call(`/api/work-orders/${w.id}/notes`, { text: v }, 'Note added');
  });
  view.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { signoffMode = b.dataset.mode; reload(); }));
  const canvas = document.getElementById('sigpad');
  pad = canvas ? signaturePad(canvas) : null;
  document.getElementById('sig-clear')?.addEventListener('click', () => pad.clear());
  document.getElementById('sig-save')?.addEventListener('click', () => {
    const name = document.getElementById('signer').value.trim();
    if (!name) return toast('Enter the customer\'s name', true);
    if (pad.isEmpty()) return toast('The customer needs to sign in the box', true);
    call(`/api/work-orders/${w.id}/signoff`, { status: 'captured', signerName: name, signatureDataUrl: pad.toDataURL() }, 'Signature saved');
  });
  document.getElementById('so-save')?.addEventListener('click', () => {
    const reason = document.getElementById('so-reason').value.trim();
    if (!reason) return toast('A reason is required', true);
    call(`/api/work-orders/${w.id}/signoff`, { status: signoffMode, reason }, 'Recorded');
  });
  document.getElementById('redo-sign')?.addEventListener('click', () => { redoSignoff = w.id; signoffMode = 'captured'; reload(); });
}

route();
