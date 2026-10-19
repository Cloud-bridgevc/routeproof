import { esc, fmt, fmtDate, api, toast, statusBadge, readinessBadge, exceptionList, STATUS } from './ui.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('page-title');
const dlg = document.getElementById('dlg');
const reviewerInput = document.getElementById('reviewer');

let D = null; // bootstrap data
const ui = { woFilter: 'all', woSearch: '', woTab: 'record', historyLoc: '' };

// ---------------------------------------------------------------- identity
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
reviewerInput.value = store.get('rp-reviewer', 'Jordan Kim (demo reviewer)');
reviewerInput.addEventListener('change', () => store.set('rp-reviewer', reviewerInput.value.trim()));
const reviewer = () => reviewerInput.value.trim();

// ---------------------------------------------------------------- data helpers
const by = (arr, id) => arr.find((x) => x.id === id);
const cust = (id) => by(D.customers, id);
const loc = (id) => by(D.locations, id);
const tech = (id) => by(D.technicians, id);
const tpl = (id) => by(D.templates, id);
const SERVICE = { 'pest-control': 'Pest control', cleaning: 'Cleaning', maintenance: 'Maintenance', repair: 'Repair' };
const demoBadge = (x) => (x?.demo ? ' <span class="badge demo">Demo</span>' : '');

async function refresh() {
  D = await api('/api/bootstrap');
  const queue = D.workOrders.filter((w) => w.status === 'submitted').length;
  document.getElementById('queue-count').textContent = queue || '';
  const disputes = D.disputes.filter((d) => d.status === 'open').length;
  document.getElementById('dispute-count').textContent = disputes || '';
}

function replaceWo(wo) {
  const i = D.workOrders.findIndex((w) => w.id === wo.id);
  if (i >= 0) D.workOrders[i] = { ...D.workOrders[i], ...wo }; else D.workOrders.push(wo);
}

async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, true); throw e; }
}

// ---------------------------------------------------------------- router
const routes = {
  overview: renderOverview,
  'work-orders': (id) => (id ? renderWorkOrder(id) : renderWorkOrders()),
  queue: renderQueue,
  technicians: renderTechnicians,
  disputes: (id) => (id ? renderDispute(id) : renderDisputes()),
  directory: renderDirectory,
  history: renderHistory,
  reports: renderReports,
  insights: renderInsights,
  integrations: renderIntegrations,
};

async function route() {
  const [, name = 'overview', id] = location.hash.replace(/^#/, '').split('/');
  document.querySelectorAll('.side a.nav').forEach((a) => a.classList.toggle('on', a.dataset.r === name));
  document.body.classList.remove('nav-open');
  if (!D) await refresh();
  (routes[name] || renderOverview)(id ? decodeURIComponent(id) : undefined);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
document.getElementById('menu-btn').onclick = () => document.body.classList.toggle('nav-open');
document.getElementById('reset-demo').onclick = async (e) => {
  e.preventDefault();
  if (!confirm('Reset all demo data? Records you created will be removed.')) return;
  await act(() => api('/api/reset', { method: 'POST' }), 'Demo data reset');
  await refresh(); route();
};

const setTitle = (t) => { titleEl.textContent = t; document.title = `${t} · RouteProof`; };

function woRow(w, cols = ['number', 'customer', 'service', 'tech', 'scheduled', 'status', 'readiness']) {
  const c = {
    number: `<td><strong>${esc(w.number)}</strong>${demoBadge(w)}</td>`,
    customer: `<td>${esc(cust(w.customerId)?.name)}<div class="muted small">${esc(loc(w.locationId)?.name)}</div></td>`,
    service: `<td>${esc(SERVICE[tpl(w.templateId)?.serviceType])}</td>`,
    tech: `<td>${w.technicianId ? esc(tech(w.technicianId)?.name) : '<span class="badge warn">Unassigned</span>'}</td>`,
    scheduled: `<td class="small">${fmt(w.scheduledFor)}</td>`,
    status: `<td>${statusBadge(w.status)}</td>`,
    readiness: `<td>${readinessBadge(w.analysis.readiness)}</td>`,
    completeness: `<td style="min-width:120px"><div class="meter ${w.analysis.completeness.pct === 100 ? 'ok' : ''}"><span style="width:${w.analysis.completeness.pct}%"></span></div><div class="small muted">${w.analysis.completeness.documented}/${w.analysis.completeness.total} steps</div></td>`,
    issues: `<td>${w.analysis.blockers ? `<span class="badge bad">${w.analysis.blockers} required</span> ` : ''}${w.analysis.warnings ? `<span class="badge warn">${w.analysis.warnings} warning</span>` : ''}${!w.analysis.blockers && !w.analysis.warnings ? '<span class="muted small">None</span>' : ''}</td>`,
  };
  return `<tr class="click" data-href="#/work-orders/${w.id}">${cols.map((k) => c[k]).join('')}</tr>`;
}
const HEAD = { number: 'Work order', customer: 'Customer / location', service: 'Service', tech: 'Technician', scheduled: 'Scheduled', status: 'Status', readiness: 'Record check', completeness: 'Documented', issues: 'Exceptions' };
const table = (rows, cols) => `<div class="table-wrap"><table class="t"><thead><tr>${cols.map((c) => `<th>${HEAD[c]}</th>`).join('')}</tr></thead><tbody>${rows.map((w) => woRow(w, cols)).join('') || `<tr><td colspan="${cols.length}" class="empty">Nothing here.</td></tr>`}</tbody></table></div>`;
view.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('button,a,select,input')) location.hash = tr.dataset.href; });

// ---------------------------------------------------------------- overview
function renderOverview() {
  setTitle('Overview');
  const W = D.workOrders;
  const open = W.filter((w) => ['scheduled', 'in_progress'].includes(w.status));
  const queue = W.filter((w) => w.status === 'submitted');
  const verified = W.filter((w) => w.status === 'verified');
  const missing = queue.filter((w) => w.analysis.blockers);
  view.innerHTML = `
  <div class="grid g4">
    <div class="card kpi"><div class="l">Open jobs</div><div class="v">${open.length}</div><div class="small muted">${W.filter((w) => w.status === 'in_progress').length} in progress</div></div>
    <div class="card kpi"><div class="l">Awaiting verification</div><div class="v">${queue.length}</div><div class="small muted">submitted, not yet reviewed</div></div>
    <div class="card kpi"><div class="l">Missing required items</div><div class="v" style="color:var(--bad)">${missing.length}</div><div class="small muted">of submitted records</div></div>
    <div class="card kpi"><div class="l">Verified by reviewer</div><div class="v" style="color:var(--ok)">${verified.length}</div><div class="small muted">${D.disputes.filter((d) => d.status === 'open').length} open dispute(s)</div></div>
  </div>
  <div class="grid g-main" style="margin-top:16px">
    <div class="card"><div class="panel-h"><h3>Verification queue</h3><a href="#/queue" class="btn btn-sm btn-ghost">Open queue</a></div>
      ${table(queue.sort((a, b) => b.analysis.blockers - a.analysis.blockers), ['number', 'customer', 'tech', 'readiness', 'issues'])}</div>
    <div class="card"><div class="panel-h"><h3>Today &amp; upcoming</h3><a href="#/technicians" class="btn btn-sm btn-ghost">Assignments</a></div>
      <div class="pad">${open.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)).map((w) => `
        <a href="#/work-orders/${w.id}" style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--slate-100);text-decoration:none;color:inherit">
          <div><strong>${esc(w.number)}</strong> · ${esc(SERVICE[tpl(w.templateId).serviceType])}<div class="small muted">${esc(loc(w.locationId)?.name)} · ${w.technicianId ? esc(tech(w.technicianId).name) : 'Unassigned'}</div></div>
          <div style="text-align:right">${statusBadge(w.status)}<div class="small muted">${fmt(w.scheduledFor)}</div></div></a>`).join('') || '<p class="muted">No open jobs.</p>'}
      </div></div>
  </div>
  <div class="callout" style="margin-top:16px"><strong>How to read these numbers:</strong> "Submitted" means a technician sent a record. "Complete — awaiting review" means automated checks found nothing missing. Only a reviewer's decision makes a record <em>Verified</em>, and that confirms documentation, not the physical work.</div>`;
}

// ---------------------------------------------------------------- work orders
function renderWorkOrders() {
  setTitle('Work orders');
  const filters = ['all', 'scheduled', 'in_progress', 'submitted', 'needs_info', 'verified', 'disputed'];
  const q = ui.woSearch.toLowerCase();
  const rows = D.workOrders
    .filter((w) => ui.woFilter === 'all' || w.status === ui.woFilter)
    .filter((w) => !q || `${w.number} ${cust(w.customerId)?.name} ${loc(w.locationId)?.name} ${tech(w.technicianId)?.name || ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
  view.innerHTML = `<div class="card">
    <div class="filters">${filters.map((f) => `<button class="chip ${ui.woFilter === f ? 'on' : ''}" data-f="${f}">${f === 'all' ? 'All' : STATUS[f][0]}</button>`).join('')}
      <input type="search" id="wo-q" placeholder="Search number, customer, technician" value="${esc(ui.woSearch)}" style="margin-left:auto;min-width:220px"></div>
    ${table(rows, ['number', 'customer', 'service', 'tech', 'scheduled', 'status', 'completeness'])}</div>`;
  view.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { ui.woFilter = b.dataset.f; renderWorkOrders(); }));
  const qi = document.getElementById('wo-q');
  qi.oninput = () => { ui.woSearch = qi.value; const pos = qi.selectionStart; renderWorkOrders(); const n = document.getElementById('wo-q'); n.focus(); n.setSelectionRange(pos, pos); };
}

async function renderWorkOrder(id) {
  const wo = await api(`/api/work-orders/${id}`).catch((e) => { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  if (!wo) return;
  replaceWo(wo);
  const t = tpl(wo.templateId), a = wo.analysis;
  setTitle(wo.number);
  const tabs = [['record', 'Job record'], ['evidence', `Evidence (${wo.evidence.length})`], ['exceptions', `Exceptions (${a.exceptions.length})`], ['summary', 'AI summary'], ['timeline', 'Timeline'], ['report', 'Report']];
  const dsp = D.disputes.filter((d) => d.workOrderId === wo.id);
  view.innerHTML = `
  <div class="wo-head">
    <div><a href="#/work-orders" class="small">← Work orders</a>
      <h2>${esc(wo.number)} · ${esc(t.name)}${demoBadge(wo)}</h2>
      <div class="muted">${esc(cust(wo.customerId)?.name)} — ${esc(loc(wo.locationId)?.name)}, ${esc(loc(wo.locationId)?.address)}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${statusBadge(wo.status)} ${readinessBadge(a.readiness)} ${a.verification.state === 'verified' ? `<span class="badge ok">Verified by ${esc(a.verification.by)}</span>` : '<span class="badge">Not verified</span>'}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn-ghost btn-sm" href="/tech#/job/${wo.id}" target="_blank" rel="noopener">Open in technician app</a>
      ${!['disputed'].includes(wo.status) && ['submitted', 'verified', 'needs_info'].includes(wo.status) ? '<button class="btn btn-ghost btn-sm" id="open-dispute">Log dispute</button>' : ''}
    </div>
  </div>
  <div class="grid g-main">
    <div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="${ui.woTab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="tab-body"></div>
    </div>
    <div class="grid">
      ${reviewPanel(wo)}
      <div class="card pad"><h3 style="font-size:1rem">Job details</h3>
        <dl class="kv">
          <dt>Technician</dt><dd><select id="assign">${['<option value="">Unassigned</option>', ...D.technicians.map((x) => `<option value="${x.id}" ${x.id === wo.technicianId ? 'selected' : ''}>${esc(x.name)}</option>`)].join('')}</select></dd>
          <dt>Scheduled</dt><dd>${fmt(wo.scheduledFor)}</dd>
          <dt>Check-in</dt><dd>${fmt(wo.visit.checkInAt) === '—' ? '<span class="muted">Not recorded</span>' : fmt(wo.visit.checkInAt)}</dd>
          <dt>Check-out</dt><dd>${fmt(wo.visit.checkOutAt) === '—' ? '<span class="muted">Not recorded</span>' : fmt(wo.visit.checkOutAt)}</dd>
          <dt>Sign-off</dt><dd>${signoffText(wo.signoff)}</dd>
          <dt>Priority</dt><dd>${esc(wo.priority)}</dd>
          <dt>Completeness</dt><dd><div class="meter ${a.completeness.pct === 100 ? 'ok' : ''}"><span style="width:${a.completeness.pct}%"></span></div><span class="small muted">${a.completeness.documented} of ${a.completeness.total} steps fully documented</span></dd>
        </dl>
      </div>
      ${dsp.length ? `<div class="card pad"><h3 style="font-size:1rem">Disputes</h3>${dsp.map((d) => `<a href="#/disputes/${d.id}" style="display:block;padding:6px 0">${esc(d.id)} · ${d.status === 'open' ? '<span class="badge bad">Open</span>' : '<span class="badge ok">Resolved</span>'}</a>`).join('')}</div>` : ''}
    </div>
  </div>`;
  const tb = document.getElementById('tab-body');
  const drawTab = () => { tb.innerHTML = TABS[ui.woTab](wo, t, a); bindTab(wo, tb); view.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.woTab)); };
  view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { ui.woTab = b.dataset.tab; drawTab(); }));
  drawTab();
  bindReview(wo);
  document.getElementById('assign').onchange = async (e) => {
    await act(() => api(`/api/work-orders/${wo.id}`, { method: 'PATCH', body: { technicianId: e.target.value } }), 'Assignment updated').catch(() => {});
    await refresh(); renderWorkOrder(wo.id);
  };
  document.getElementById('open-dispute')?.addEventListener('click', () => disputeDialog(wo));
}

const signoffText = (s) => !s ? '<span class="badge bad">None recorded</span>'
  : s.status === 'captured' ? `${esc(s.signerName)}<div class="small muted">${fmt(s.capturedAt)} · ${esc(s.method || '')}</div>${s.signatureUrl ? `<img src="${esc(s.signatureUrl)}" alt="Recorded signature" style="max-height:50px;border:1px solid var(--slate-200);border-radius:6px;margin-top:4px;background:#fff">` : ''}`
  : `<span class="badge warn">${s.status === 'refused' ? 'Refused' : 'Not available'}</span><div class="small muted">${esc(s.reason || 'No reason given')}</div>`;

function evCard(e, t, { review = false } = {}) {
  const step = t.steps.find((s) => s.id === e.stepId);
  const c = e.classification;
  const rs = e.review?.status || 'pending';
  return `<div class="ev ${rs === 'rejected' ? 'rejected' : ''}">
    ${e.kind === 'photo' ? `<a href="${esc(e.url)}" target="_blank" rel="noopener"><img src="${esc(e.url)}" alt="${esc(e.caption)}" loading="lazy"></a>` : `<a class="doc" href="${esc(e.url)}" target="_blank" rel="noopener">📄</a>`}
    <div class="b"><strong>${esc(e.caption)}</strong>
      <span class="muted">${esc(step?.label || 'Not attached to a step')}</span>
      <span>Captured: ${e.capturedAt ? `${fmt(e.capturedAt)} <span class="muted">(device)</span>` : '<b style="color:var(--warn)">not available</b>'}</span>
      <span>Uploaded: ${fmt(e.uploadedAt)}</span>
      ${c ? `<span><span class="badge info" title="${esc(c.rationale)}">${esc(c.category)}</span> <span class="badge">${esc(c.stage)}</span> <span class="muted">${Math.round(c.confidence * 100)}%</span></span>` : ''}
      <span>${rs === 'approved' ? `<span class="badge ok">Approved</span> <span class="muted">${esc(e.review.by)}</span>` : rs === 'rejected' ? `<span class="badge bad">Rejected</span> <span class="muted">${esc(e.review.comment || '')}</span>` : '<span class="badge">Pending review</span>'}</span>
      ${review ? `<div class="acts">${rs !== 'approved' ? `<button class="btn btn-sm btn-ok" data-ev="${e.id}" data-s="approved">Approve</button>` : ''}${rs !== 'rejected' ? `<button class="btn btn-sm btn-bad" data-ev="${e.id}" data-s="rejected">Reject</button>` : ''}${rs !== 'pending' ? `<button class="btn btn-sm btn-ghost" data-ev="${e.id}" data-s="pending">Reset</button>` : ''}</div>` : ''}
    </div></div>`;
}

const TABS = {
  record(wo, t, a) {
    if (!wo.checklist.length) return '<div class="card empty">The technician hasn\'t started this job yet.</div>';
    return `<div class="card">${t.steps.map((s, i) => {
      const st = a.steps.find((x) => x.stepId === s.id);
      const c = wo.checklist.find((x) => x.stepId === s.id) || {};
      const ev = wo.evidence.filter((e) => e.stepId === s.id);
      return `<div class="step ${st.state}"><div class="ix">${st.state === 'documented' || st.state === 'na' ? '✓' : i + 1}</div><div>
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>${esc(s.label)}</strong>
          <span class="small muted">${c.status === 'done' ? `Done · ${fmt(c.completedAt)}` : c.status === 'na' ? 'Marked N/A' : 'Not done'}</span></div>
        <div class="reqs"><span class="badge">${s.stage}</span>${s.requiresPhoto ? `<span class="badge ${ev.some((e) => e.kind === 'photo' && e.review?.status !== 'rejected') ? 'ok' : 'bad'}">Photo required</span>` : ''}${s.requiresNote ? `<span class="badge ${st.missing.includes('note') || st.missing.includes('note detail') ? 'bad' : 'ok'}">Note required</span>` : ''}${st.missing.length ? `<span class="badge bad">Missing: ${st.missing.join(', ')}</span>` : ''}</div>
        ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
        ${ev.length ? `<div class="ev-grid">${ev.map((e) => evCard(e, t)).join('')}</div>` : ''}
      </div></div>`;
    }).join('')}
    ${wo.notes.length ? `<div class="pad" style="border-top:1px solid var(--slate-200)"><h4 class="small muted">GENERAL NOTES</h4>${wo.notes.map((n) => `<div class="note step" style="display:block;padding:8px 0">${esc(n.text)}<div class="small muted">${fmt(n.recordedAt)}</div></div>`).join('')}</div>` : ''}
    </div>`;
  },
  evidence(wo, t) {
    const locked = wo.status === 'verified';
    return `<div class="callout" style="margin-bottom:12px">Approve files that are relevant, legible and consistent with the visit. Approval means the file is acceptable as supporting evidence — it doesn't confirm the work met spec. Only approved files appear in customer reports.</div>
      ${wo.evidence.length ? `<div class="ev-grid">${wo.evidence.map((e) => evCard(e, t, { review: !locked })).join('')}</div>` : '<div class="card empty">No files submitted.</div>'}`;
  },
  exceptions(wo, t, a) {
    return `<div class="card pad">${exceptionList(a.exceptions, { empty: 'No exceptions detected. That means the record matches the template — not that the work has been verified.' })}</div>`;
  },
  summary(wo) {
    const s = wo.summary;
    const list = (h, arr) => `<h4 style="font-size:.9rem;margin-top:14px">${h}</h4>${arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted small">Nothing recorded.</p>'}`;
    return `<div class="card pad"><span class="badge info">Service record understanding · ${esc(s.source)}</span>
      <p style="margin-top:10px"><strong>${esc(s.headline)}</strong></p>
      ${list('Materials and actions', s.materials)}${list('Quantities and readings', s.readings)}${list('Follow-ups and recommendations', s.followUps)}${list('Customer-reported concerns', s.customerConcerns)}
      <p class="small muted" style="margin-top:14px">${esc(s.caveat)}</p></div>`;
  },
  timeline(wo, t) {
    const ev = [];
    if (wo.createdAt) ev.push([wo.createdAt, 'Work order created', '']);
    if (wo.visit.checkInAt) ev.push([wo.visit.checkInAt, 'Technician checked in', '']);
    for (const c of wo.checklist) if (c.completedAt) ev.push([c.completedAt, `${c.status === 'na' ? 'Marked N/A' : 'Completed'}: ${t.steps.find((s) => s.id === c.stepId)?.label}`, '']);
    for (const n of wo.notes) ev.push([n.recordedAt, 'Note added', '']);
    for (const e of wo.evidence) {
      ev.push([e.uploadedAt, `Uploaded: ${e.caption}`, '']);
      if (e.review?.at) ev.push([e.review.at, `Evidence ${e.review.status}: ${e.caption} — ${e.review.by}`, e.review.status === 'approved' ? 'ok' : 'bad']);
    }
    if (wo.signoff?.capturedAt) ev.push([wo.signoff.capturedAt, wo.signoff.status === 'captured' ? `Customer signed: ${wo.signoff.signerName}` : `Sign-off ${wo.signoff.status}: ${wo.signoff.reason || ''}`, wo.signoff.status === 'captured' ? 'ok' : 'warn']);
    if (wo.visit.checkOutAt) ev.push([wo.visit.checkOutAt, 'Technician checked out', '']);
    if (wo.submittedAt) ev.push([wo.submittedAt, 'Record submitted', '']);
    if (wo.review?.decidedAt) ev.push([wo.review.decidedAt, `Reviewer decision: ${wo.review.decision === 'verified' ? 'Verified' : 'Returned to technician'} — ${wo.review.reviewer}${wo.review.comment ? ` ("${wo.review.comment}")` : ''}`, wo.review.decision === 'verified' ? 'ok' : 'bad']);
    for (const d of D.disputes.filter((x) => x.workOrderId === wo.id)) ev.push([d.raisedAt, `Dispute ${d.id} opened by ${d.raisedBy}`, 'bad']);
    ev.sort((x, y) => x[0].localeCompare(y[0]));
    return `<div class="card pad"><p class="small muted">Only recorded events appear here. Times are server-recorded except photo capture times, which come from device metadata and are shown on each file.</p>
      <ul class="timeline">${ev.map(([at, txt, cls]) => `<li class="${cls}"><div class="when">${fmt(at, { year: 'numeric' })}</div>${esc(txt)}</li>`).join('') || '<li>No events recorded yet.</li>'}</ul></div>`;
  },
  report(wo) {
    const reps = D.reports.filter((r) => r.workOrderId === wo.id);
    return `<div class="card pad" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:200px"><strong>Service report</strong><div class="small muted">${wo.analysis.verification.state === 'verified' ? 'Record verified — report will be marked VERIFIED.' : 'Record not verified — report will be marked DRAFT.'} Only approved evidence is included.</div></div>
      <a class="btn btn-ghost btn-sm" href="/work-orders/${wo.id}/report-preview.html" target="_blank" rel="noopener">Open preview</a>
      <button class="btn btn-primary btn-sm" id="gen-report">Generate report</button></div>
      ${reps.length ? `<div class="card pad" style="margin-bottom:12px"><strong class="small">Generated versions</strong>${reps.map((r) => `<div class="small" style="padding:4px 0"><a href="/reports/${r.id}.html" target="_blank" rel="noopener">${r.id}</a> · ${esc(r.status)} · ${fmt(r.createdAt)} · ${esc(r.generator)}</div>`).join('')}</div>` : ''}
      <iframe class="report" src="/work-orders/${wo.id}/report-preview.html" title="Report preview"></iframe>`;
  },
};

function bindTab(wo, tb) {
  tb.querySelectorAll('[data-ev]').forEach((b) => (b.onclick = async () => {
    const status = b.dataset.s;
    let comment = '';
    if (status === 'rejected') { comment = prompt('Reason for rejecting this file (shared with the technician):'); if (!comment?.trim()) return; }
    if (!reviewer()) return toast('Enter your name in "Reviewing as" first.', true);
    await act(() => api(`/api/evidence/${b.dataset.ev}/review`, { method: 'POST', body: { status, reviewer: reviewer(), comment } }), `Evidence ${status}`).catch(() => {});
    await refresh(); renderWorkOrder(wo.id);
  }));
  tb.querySelector('#gen-report')?.addEventListener('click', async () => {
    const r = await act(() => api(`/api/work-orders/${wo.id}/reports`, { method: 'POST' }), 'Report generated').catch(() => null);
    if (r) { await refresh(); renderWorkOrder(wo.id); window.open(`/reports/${r.id}.html`, '_blank'); }
  });
}

function reviewPanel(wo) {
  const a = wo.analysis;
  if (wo.status === 'verified')
    return `<div class="card pad"><h3 style="font-size:1rem">Verification</h3><p><span class="badge ok">Verified</span> by <strong>${esc(wo.review.reviewer)}</strong><br><span class="small muted">${fmt(wo.review.decidedAt)}</span></p>${wo.review.comment ? `<p class="small">"${esc(wo.review.comment)}"</p>` : ''}<p class="small muted">Verification confirms the documentation met the template at review time. It is not a site inspection.</p></div>`;
  if (wo.status === 'disputed')
    return `<div class="card pad"><h3 style="font-size:1rem">Verification</h3><div class="callout warn">This record is under dispute. ${wo.review?.decision === 'verified' ? `It was previously verified by ${esc(wo.review.reviewer)}.` : ''} Resolve the dispute to change its status.</div></div>`;
  if (wo.status !== 'submitted')
    return `<div class="card pad"><h3 style="font-size:1rem">Verification</h3><p class="muted small">${wo.status === 'needs_info' ? `Returned to technician by ${esc(wo.review?.reviewer)}: "${esc(wo.review?.comment)}"` : 'Available once the technician submits the record.'}</p></div>`;
  const reasons = [];
  if (a.blockers) reasons.push(`${a.blockers} required item(s) missing`);
  if (a.pendingEvidence) reasons.push(`${a.pendingEvidence} file(s) awaiting approve/reject`);
  return `<div class="card pad"><h3 style="font-size:1rem">Reviewer decision</h3>
    ${reasons.length ? `<div class="callout warn" style="margin-bottom:10px">Can't verify yet: ${reasons.join('; ')}.</div>` : ''}
    ${a.warnings ? `<p class="small">${a.warnings} warning(s) need an explanation before verifying.</p>` : ''}
    <label class="field">Comment${a.warnings ? ' (required to verify)' : ''}<textarea id="rev-comment" rows="3" placeholder="What you checked, or what the technician needs to provide"></textarea></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ok" id="rev-verify" ${a.blockers || a.pendingEvidence ? 'disabled' : ''}>Verify record</button>
      <button class="btn btn-ghost" id="rev-return">Return to technician</button>
    </div></div>`;
}

function bindReview(wo) {
  const send = (decision) => async () => {
    if (!reviewer()) return toast('Enter your name in "Reviewing as" first.', true);
    const comment = document.getElementById('rev-comment').value;
    await act(() => api(`/api/work-orders/${wo.id}/review`, { method: 'POST', body: { decision, reviewer: reviewer(), comment } }), decision === 'verified' ? 'Record verified' : 'Returned to technician').catch(() => {});
    await refresh(); renderWorkOrder(wo.id);
  };
  document.getElementById('rev-verify')?.addEventListener('click', send('verified'));
  document.getElementById('rev-return')?.addEventListener('click', send('needs_info'));
}

// ---------------------------------------------------------------- queue
function renderQueue() {
  setTitle('Completion verification queue');
  const q = D.workOrders.filter((w) => w.status === 'submitted');
  const groups = [
    ['missing_items', 'Missing required items', 'Return to the technician or wait for the missing items.'],
    ['review_with_warnings', 'Complete — needs a closer look', 'Nothing required is missing, but timestamps, sign-off or files look inconsistent.'],
    ['ready_for_review', 'Complete — awaiting review', 'Approve the evidence and verify.'],
  ];
  view.innerHTML = `<p class="muted" style="margin-top:0">Submitted records sorted by what automated checks found. Every item here is <strong>unverified</strong> until a reviewer decides.</p>` +
    groups.map(([k, h, sub]) => {
      const rows = q.filter((w) => w.analysis.readiness === k);
      return `<div class="card" style="margin-bottom:16px"><div class="panel-h"><div><h3>${h} <span class="badge">${rows.length}</span></h3><div class="small muted">${sub}</div></div></div>${table(rows, ['number', 'customer', 'tech', 'completeness', 'issues'])}</div>`;
    }).join('');
}

// ---------------------------------------------------------------- technicians
function renderTechnicians() {
  setTitle('Technician assignments');
  const open = D.workOrders.filter((w) => ['scheduled', 'in_progress', 'needs_info'].includes(w.status));
  const unassigned = open.filter((w) => !w.technicianId);
  view.innerHTML = `
  ${unassigned.length ? `<div class="card" style="margin-bottom:16px"><div class="panel-h"><h3>Unassigned</h3></div>${table(unassigned, ['number', 'customer', 'service', 'scheduled'])}</div>` : ''}
  <div class="grid g2">${D.technicians.map((t) => {
    const mine = open.filter((w) => w.technicianId === t.id).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    const all = D.workOrders.filter((w) => w.technicianId === t.id && w.status !== 'scheduled');
    const exc = all.reduce((s, w) => s + w.analysis.blockers + w.analysis.warnings, 0);
    return `<div class="card"><div class="panel-h"><div><h3>${esc(t.name)} <span class="badge demo">Demo</span></h3><div class="small muted">${t.skills.map((s) => SERVICE[s]).join(', ')} · ${esc(t.region)} region</div></div>
      <div style="text-align:right" class="small"><strong>${mine.length}</strong> open<br><span class="muted">${exc} exception(s) on ${all.length} records</span></div></div>
      <div class="pad">${mine.map((w) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--slate-100)">
        <a href="#/work-orders/${w.id}"><strong>${esc(w.number)}</strong></a><span class="small muted" style="flex:1">${esc(loc(w.locationId)?.name)} · ${fmt(w.scheduledFor)}</span>${statusBadge(w.status)}
        <select data-reassign="${w.id}" style="width:auto;font-size:.8rem;padding:.25em">${D.technicians.map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name.split(' ')[0])}</option>`).join('')}</select></div>`).join('') || '<p class="muted small">No open jobs.</p>'}</div></div>`;
  }).join('')}</div>`;
  view.querySelectorAll('[data-reassign]').forEach((s) => (s.onchange = async () => {
    await act(() => api(`/api/work-orders/${s.dataset.reassign}`, { method: 'PATCH', body: { technicianId: s.value } }), 'Reassigned — notification queued (simulated)').catch(() => {});
    await refresh(); renderTechnicians();
  }));
}

// ---------------------------------------------------------------- directory
function renderDirectory() {
  setTitle('Customers & locations');
  view.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="add-cust">+ Customer</button><button class="btn btn-ghost btn-sm" id="add-loc">+ Location</button></div>
  <div class="grid g2">${D.customers.map((c) => {
    const locs = D.locations.filter((l) => l.customerId === c.id);
    const wos = D.workOrders.filter((w) => w.customerId === c.id);
    return `<div class="card"><div class="panel-h"><div><h3>${esc(c.name)}${c.id.match(/^cus-\d$/) ? ' <span class="badge demo">Demo</span>' : ''}</h3><div class="small muted">${esc(c.segment)} · ${esc(c.contact)} · ${esc(c.email)}</div></div><span class="small muted">${wos.length} jobs</span></div>
      <div class="pad">${locs.map((l) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--slate-100)"><div><strong>${esc(l.name)}</strong><div class="small muted">${esc(l.address)}</div></div><a class="btn btn-sm btn-ghost" href="#/history" data-loc="${l.id}">History</a></div>`).join('') || '<p class="muted small">No locations.</p>'}</div></div>`;
  }).join('')}</div>`;
  view.querySelectorAll('[data-loc]').forEach((a) => (a.onclick = () => { ui.historyLoc = a.dataset.loc; }));
  document.getElementById('add-cust').onclick = () => formDialog('New customer', [['name', 'Company name *'], ['segment', 'Segment'], ['contact', 'Primary contact'], ['email', 'Email']], async (v) => { await api('/api/customers', { method: 'POST', body: v }); });
  document.getElementById('add-loc').onclick = () => formDialog('New location', [['customerId', 'Customer *', D.customers.map((c) => [c.id, c.name])], ['name', 'Location name *'], ['address', 'Address *']], async (v) => { await api('/api/locations', { method: 'POST', body: v }); });
}

function formDialog(title, fields, onSave) {
  dlg.innerHTML = `<form method="dialog"><div class="dh"><h3>${esc(title)}</h3><button class="btn btn-sm btn-ghost" value="cancel" formnovalidate>✕</button></div><div class="db">
    ${fields.map(([k, l, opts, type]) => `<label class="field">${esc(l)}${opts ? `<select name="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>` : type === 'textarea' ? `<textarea name="${k}"></textarea>` : `<input type="${type || 'text'}" name="${k}">`}</label>`).join('')}
    </div><div class="df"><button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></form>`;
  dlg.showModal();
  const form = dlg.querySelector('form');
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    try { await onSave(Object.fromEntries(new FormData(form))); dlg.close(); toast('Saved'); await refresh(); route(); } catch (err) { toast(err.message, true); }
  };
}

document.getElementById('new-wo').onclick = () => {
  const nowLocal = new Date(Date.now() + 86400000); nowLocal.setMinutes(0, 0, 0);
  const val = new Date(nowLocal - nowLocal.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  formDialog('New work order', [
    ['customerId', 'Customer', D.customers.map((c) => [c.id, c.name])],
    ['locationId', 'Location', D.locations.map((l) => [l.id, `${cust(l.customerId)?.name} — ${l.name}`])],
    ['templateId', 'Service template', D.templates.map((t) => [t.id, t.name])],
    ['technicianId', 'Technician', [['', 'Unassigned'], ...D.technicians.map((t) => [t.id, t.name])]],
    ['scheduledFor', 'Scheduled for', null, 'datetime-local'],
    ['priority', 'Priority', [['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']]],
  ], async (v) => {
    const wo = await api('/api/work-orders', { method: 'POST', body: v });
    setTimeout(() => (location.hash = `#/work-orders/${wo.id}`));
  });
  const form = dlg.querySelector('form');
  form.scheduledFor.value = val;
  const syncLoc = () => { const c = form.customerId.value; [...form.locationId.options].forEach((o) => (o.hidden = loc(o.value)?.customerId !== c)); const first = [...form.locationId.options].find((o) => !o.hidden); if (first) form.locationId.value = first.value; };
  form.customerId.onchange = syncLoc; syncLoc();
};

// ---------------------------------------------------------------- history
function renderHistory() {
  setTitle('Service history');
  const locs = D.locations;
  if (!ui.historyLoc) ui.historyLoc = locs[0]?.id;
  const l = loc(ui.historyLoc);
  const rows = D.workOrders.filter((w) => w.locationId === ui.historyLoc).sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
  view.innerHTML = `<div class="card"><div class="filters"><label class="small" style="display:flex;gap:8px;align-items:center">Location <select id="hist-loc">${locs.map((x) => `<option value="${x.id}" ${x.id === ui.historyLoc ? 'selected' : ''}>${esc(cust(x.customerId)?.name)} — ${esc(x.name)}</option>`).join('')}</select></label></div>
    <div class="pad"><h3 style="margin:0">${esc(l?.name)}</h3><p class="muted small">${esc(l?.address)}</p>
    <ul class="timeline">${rows.map((w) => `<li class="${w.status === 'verified' ? 'ok' : w.status === 'disputed' || w.analysis.blockers ? 'bad' : w.analysis.warnings ? 'warn' : ''}"><div class="when">${fmtDate(w.scheduledFor)}</div>
      <a href="#/work-orders/${w.id}"><strong>${esc(w.number)}</strong></a> · ${esc(tpl(w.templateId).name)} · ${esc(tech(w.technicianId)?.name || 'Unassigned')}
      <div style="margin-top:4px">${statusBadge(w.status)} ${w.analysis.blockers + w.analysis.warnings ? `<span class="badge warn">${w.analysis.blockers + w.analysis.warnings} exception(s)</span>` : ''}</div>
      ${(w.notes[0]?.text) ? `<div class="small muted" style="margin-top:4px">“${esc(w.notes[0].text.slice(0, 160))}${w.notes[0].text.length > 160 ? '…' : ''}”</div>` : ''}</li>`).join('') || '<li>No service history at this location.</li>'}</ul></div></div>`;
  document.getElementById('hist-loc').onchange = (e) => { ui.historyLoc = e.target.value; renderHistory(); };
}

// ---------------------------------------------------------------- reports
function renderReports() {
  setTitle('Reports');
  const eligible = D.workOrders.filter((w) => ['submitted', 'verified', 'disputed', 'needs_info'].includes(w.status));
  view.innerHTML = `<div class="callout" style="margin-bottom:16px">Reports are generated from recorded work, the technician's own notes and reviewer-approved evidence. A report is labeled <strong>VERIFIED</strong> only when a reviewer has verified the record; otherwise it is a <strong>DRAFT</strong>. Delivery to customers is simulated in this build — no email is sent.</div>
  <div class="grid g2">
    <div class="card"><div class="panel-h"><h3>Generated reports</h3></div><div class="table-wrap"><table class="t"><thead><tr><th>Report</th><th>Work order</th><th>Status</th><th>Created</th></tr></thead><tbody>
      ${D.reports.map((r) => `<tr><td><a href="/reports/${r.id}.html" target="_blank" rel="noopener">${r.id}</a></td><td><a href="#/work-orders/${r.workOrderId}">${esc(r.number)}</a></td><td><span class="badge ${/VERIFIED/.test(r.status) && !/NOT/.test(r.status) ? 'ok' : 'warn'}">${esc(r.status)}</span></td><td class="small">${fmt(r.createdAt)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No reports generated yet.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><div class="panel-h"><h3>Ready to generate</h3></div><div class="pad">${eligible.map((w) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--slate-100)"><div><strong>${esc(w.number)}</strong> <span class="small muted">${esc(cust(w.customerId)?.name)}</span><div>${statusBadge(w.status)}</div></div><button class="btn btn-sm btn-ghost" data-gen="${w.id}">Generate ${w.status === 'verified' ? '' : 'draft'}</button></div>`).join('')}</div></div>
  </div>`;
  view.querySelectorAll('[data-gen]').forEach((b) => (b.onclick = async () => {
    const r = await act(() => api(`/api/work-orders/${b.dataset.gen}/reports`, { method: 'POST' }), 'Report generated').catch(() => null);
    if (r) { await refresh(); renderReports(); window.open(`/reports/${r.id}.html`, '_blank'); }
  }));
}

// ---------------------------------------------------------------- disputes
function renderDisputes() {
  setTitle('Dispute investigations');
  view.innerHTML = `<div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Dispute</th><th>Work order</th><th>Raised by</th><th>Claim</th><th>Status</th></tr></thead><tbody>
    ${D.disputes.map((d) => { const w = by(D.workOrders, d.workOrderId); return `<tr class="click" data-href="#/disputes/${d.id}"><td><strong>${d.id}</strong>${demoBadge(d)}</td><td>${esc(w?.number)}</td><td class="small">${esc(d.raisedBy)}<div class="muted">${fmt(d.raisedAt)}</div></td><td class="small" style="max-width:380px">${esc(d.claim)}</td><td>${d.status === 'open' ? '<span class="badge bad">Open</span>' : '<span class="badge ok">Resolved</span>'}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No disputes.</td></tr>'}
  </tbody></table></div></div>`;
}

async function renderDispute(id) {
  const d = by(D.disputes, id);
  if (!d) { view.innerHTML = '<div class="empty">Dispute not found.</div>'; return; }
  const wo = await api(`/api/work-orders/${d.workOrderId}`);
  const t = tpl(wo.templateId);
  setTitle(`Dispute ${d.id}`);
  view.innerHTML = `<a href="#/disputes" class="small">← Disputes</a>
  <div class="wo-head" style="margin-top:6px"><div><h2>${esc(d.id)} · ${esc(wo.number)}${demoBadge(d)}</h2><div class="muted">${esc(cust(wo.customerId)?.name)} — ${esc(loc(wo.locationId)?.name)}</div></div>
    <div>${d.status === 'open' ? '<span class="badge bad">Open</span>' : `<span class="badge ok">Resolved</span>`}</div></div>
  <div class="grid g-main">
    <div class="grid">
      <div class="card pad"><h3 style="font-size:1rem">Customer claim</h3><p>${esc(d.claim)}</p><dl class="kv"><dt>Raised by</dt><dd>${esc(d.raisedBy)} via ${esc(d.channel)}</dd><dt>Raised</dt><dd>${fmt(d.raisedAt)}</dd><dt>Requested outcome</dt><dd>${esc(d.requestedOutcome || '—')}</dd></dl></div>
      <div class="card pad"><h3 style="font-size:1rem">What the record does and doesn't show</h3>
        <div class="callout warn" style="margin-bottom:12px">Photos and checklist ticks show what was <em>submitted</em>. They can support or contradict a claim, but they don't settle whether the work was done correctly. Weigh them with the timeline, sign-off and any follow-up inspection.</div>
        <dl class="kv"><dt>Record status</dt><dd>${wo.review?.decision === 'verified' ? `Previously verified by ${esc(wo.review.reviewer)} on ${fmt(wo.review.decidedAt)}` : 'Never verified'}</dd>
          <dt>Visit</dt><dd>${fmt(wo.visit.checkInAt)} – ${fmt(wo.visit.checkOutAt)}</dd><dt>Technician</dt><dd>${esc(tech(wo.technicianId)?.name)}</dd><dt>Sign-off</dt><dd>${signoffText(wo.signoff)}</dd></dl>
        <h4 style="margin-top:14px;font-size:.9rem">Checklist as submitted</h4>
        ${t.steps.map((s) => { const c = wo.checklist.find((x) => x.stepId === s.id) || {}; return `<div class="small" style="padding:4px 0;border-bottom:1px solid var(--slate-100)">${c.status === 'done' ? '✓' : '✗'} ${esc(s.label)} <span class="muted">${c.completedAt ? fmt(c.completedAt) : ''}</span>${c.note ? `<div class="muted">“${esc(c.note)}”</div>` : ''}</div>`; }).join('')}
        <h4 style="margin-top:14px;font-size:.9rem">Evidence on file</h4><div class="ev-grid">${wo.evidence.map((e) => evCard(e, t)).join('')}</div>
        <h4 style="margin-top:14px;font-size:.9rem">Record exceptions</h4>${exceptionList(wo.analysis.exceptions)}</div>
    </div>
    <div class="grid">
      <div class="card pad"><h3 style="font-size:1rem">Investigation log</h3><ul class="timeline">${d.timeline.map((x) => `<li><div class="when">${fmt(x.at)} · ${esc(x.by)}</div>${esc(x.text)}</li>`).join('')}</ul>
        ${d.status === 'open' ? `<label class="field">Add finding<textarea id="dsp-note" rows="3" placeholder="What you checked and what it showed"></textarea></label><button class="btn btn-ghost btn-sm" id="dsp-add">Add to log</button>` : ''}</div>
      ${d.status === 'open' ? `<div class="card pad"><h3 style="font-size:1rem">Resolve</h3><label class="field">Outcome<input type="text" id="dsp-outcome" placeholder="e.g. Return visit scheduled; credit issued"></label><button class="btn btn-primary btn-sm" id="dsp-resolve">Resolve dispute</button></div>`
        : `<div class="card pad"><h3 style="font-size:1rem">Resolution</h3><p>${esc(d.resolution?.outcome)}</p><p class="small muted">${esc(d.resolution?.by)} · ${fmt(d.resolution?.decidedAt)}</p></div>`}
    </div>
  </div>`;
  document.getElementById('dsp-add')?.addEventListener('click', async () => {
    const text = document.getElementById('dsp-note').value;
    if (!reviewer()) return toast('Enter your name in "Reviewing as" first.', true);
    await act(() => api(`/api/disputes/${d.id}/notes`, { method: 'POST', body: { text, by: reviewer() } }), 'Added').catch(() => {});
    await refresh(); renderDispute(d.id);
  });
  document.getElementById('dsp-resolve')?.addEventListener('click', async () => {
    const outcome = document.getElementById('dsp-outcome').value;
    await act(() => api(`/api/disputes/${d.id}/resolve`, { method: 'POST', body: { outcome, by: reviewer() } }), 'Dispute resolved').catch(() => {});
    await refresh(); renderDispute(d.id);
  });
}

function disputeDialog(wo) {
  formDialog(`Log dispute on ${wo.number}`, [['raisedBy', 'Raised by *'], ['channel', 'Channel', [['email', 'Email'], ['phone', 'Phone'], ['portal', 'Customer portal'], ['other', 'Other']]], ['claim', 'Customer claim *', null, 'textarea'], ['requestedOutcome', 'Requested outcome']],
    async (v) => { const d = await api('/api/disputes', { method: 'POST', body: { ...v, workOrderId: wo.id } }); setTimeout(() => (location.hash = `#/disputes/${d.id}`)); });
}

// ---------------------------------------------------------------- insights
async function renderInsights() {
  setTitle('Recurring issue analysis');
  const r = await api('/api/insights');
  const bars = (title, rows) => {
    const max = Math.max(1, ...rows.map((x) => x.count));
    return `<div class="card pad"><h3 style="font-size:1rem">${title}</h3><div class="bars">${rows.slice(0, 6).map((x) => `<div class="row"><span title="${esc(x.key)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.key)}</span><div class="bar"><span style="width:${(x.count / max) * 100}%"></span></div><b>${x.count}</b></div>`).join('') || '<p class="muted small">No exceptions.</p>'}</div></div>`;
  };
  view.innerHTML = `
  <div class="card pad" style="margin-bottom:16px"><span class="badge info">${esc(r.source)}</span>
    <h3 style="margin-top:10px">Patterns across customers, technicians and locations</h3>
    ${r.findings.length ? `<ul>${r.findings.map((f) => `<li style="margin-bottom:6px">${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">No repeated patterns yet.</p>'}
    <p class="small muted">Counts are record exceptions (missing or inconsistent documentation), not confirmed service failures. Use them to target training, template changes or site access fixes.</p></div>
  <div class="grid g2">${bars('By exception type', r.byCode)}${bars('By checklist step', r.byStep)}${bars('By technician', r.byTech)}${bars('By location', r.byLocation)}</div>`;
}

// ---------------------------------------------------------------- integrations
async function renderIntegrations() {
  setTitle('Integrations');
  const r = await api('/api/integrations');
  const mode = (k, real) => r.config[k] === real ? '<span class="badge ok">Connected</span>' : '<span class="badge warn">Simulated</span>';
  view.innerHTML = `
  <div class="grid g4">
    <div class="card kpi"><div class="l">Amazon S3 · evidence storage</div><div style="margin-top:8px">${mode('storage', 's3')}</div><div class="small muted" style="margin-top:6px">${r.config.storage === 's3' ? 'Private bucket' : 'Files saved to local ./uploads'}</div></div>
    <div class="card kpi"><div class="l">Amazon Bedrock · AI</div><div style="margin-top:8px">${mode('ai', 'bedrock')}</div><div class="small muted" style="margin-top:6px">${r.config.ai === 'bedrock' ? 'Converse API' : 'Built-in rules engine'}</div></div>
    <div class="card kpi"><div class="l">AWS Lambda · reports &amp; notifications</div><div style="margin-top:8px">${mode('lambda', 'lambda')}</div><div class="small muted" style="margin-top:6px">${r.config.lambda === 'lambda' ? 'Async invoke' : 'Runs in-process; nothing sent'}</div></div>
    <div class="card kpi"><div class="l">HubSpot CRM</div><div style="margin-top:8px">${mode('hubspot', 'hubspot')}</div><div class="small muted" style="margin-top:6px">${r.config.hubspot === 'hubspot' ? 'Private app token' : 'Leads stored locally only'}</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="panel-h"><h3>Integration activity</h3></div><div class="table-wrap"><table class="t"><thead><tr><th>Time</th><th>Service</th><th>Action</th></tr></thead><tbody>
      ${r.log.map((x) => `<tr><td class="small">${fmt(x.at)}</td><td class="small"><strong>${esc(x.service)}</strong> ${x.simulated ? '<span class="badge warn">sim</span>' : ''}</td><td class="small">${esc(x.action)}<div class="muted">${esc(x.detail)}</div></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No activity yet. Upload evidence, generate a report or submit the website demo form.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><div class="panel-h"><h3>Website demo requests</h3></div><div class="pad">${r.leads.map((l) => `<div style="padding:8px 0;border-bottom:1px solid var(--slate-100)"><strong>${esc(l.company)}</strong> · ${esc(l.industry)} · ${esc(l.fleetSize)}<div class="small muted">${esc(l.name)} &lt;${esc(l.email)}&gt; · ${fmt(l.createdAt)}</div></div>`).join('') || '<p class="muted small">None yet.</p>'}
      <p class="small muted">See <code>docs/HUBSPOT.md</code> for the planned pipeline, properties and onboarding workflows.</p></div></div>
  </div>`;
}

route();
