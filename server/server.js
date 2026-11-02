// RouteProof API + static server. Zero dependencies (Node 20+).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { load, save, get, nextId, logIntegration } from './store.js';
import { config, putObject, classify, summarize, invokeReportLambda, notify, hubspotDemoRequest } from './integrations.js';
import { analyzeRecord, buildHashIndex, buildReport, renderReportHTML, recurringIssues } from '../public/js/engine.js';

const PORT = Number(process.env.PORT || 4180);
const PUBLIC = path.resolve('public');
const UPLOADS = path.resolve('uploads');

if (process.argv.includes('--reset-only')) {
  load({ reset: true });
  console.log('Demo data reset.');
  process.exit(0);
}
load();

// ------------------------------------------------------------------ helpers
const now = () => new Date().toISOString();
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const need = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };

const db = () => get();
const tplOf = (wo) => db().templates.find((t) => t.id === wo.templateId);
const findWo = (id) => {
  const wo = db().workOrders.find((w) => w.id === id || w.number === id);
  need(wo, 404, 'Work order not found');
  return wo;
};

function analysisFor(wo, hashIndex = buildHashIndex(db().workOrders)) {
  return analyzeRecord(wo, tplOf(wo), { hashIndex });
}

function enrich(wo, hashIndex) {
  const a = analysisFor(wo, hashIndex);
  // steps contain template objects already sent separately; keep payload lean
  const { steps, ...rest } = a;
  return {
    ...wo,
    analysis: { ...rest, steps: steps.map((s) => ({ stepId: s.step.id, state: s.state, missing: s.missing })) },
  };
}

const TECH_EDITABLE = ['scheduled', 'in_progress', 'needs_info'];
const assertEditable = (wo) =>
  need(TECH_EDITABLE.includes(wo.status), 409, `Work order is ${wo.status.replace('_', ' ')} — technician edits are locked.`);

function startIfNeeded(wo) {
  if (wo.status === 'scheduled') wo.status = 'in_progress';
  if (!wo.checklist.length) wo.checklist = tplOf(wo).steps.map((s) => ({ stepId: s.id, status: 'not_done', completedAt: null, note: '' }));
}

function rowsForInsights() {
  const d = db();
  const idx = buildHashIndex(d.workOrders);
  return d.workOrders.map((wo) => ({
    wo,
    analysis: analysisFor(wo, idx),
    template: tplOf(wo),
    technician: d.technicians.find((t) => t.id === wo.technicianId),
    customer: d.customers.find((c) => c.id === wo.customerId),
    location: d.locations.find((l) => l.id === wo.locationId),
  }));
}

async function reportFor(wo) {
  const d = db();
  const template = tplOf(wo);
  return buildReport({
    wo, template,
    customer: d.customers.find((c) => c.id === wo.customerId),
    location: d.locations.find((l) => l.id === wo.locationId),
    technician: d.technicians.find((t) => t.id === wo.technicianId),
    analysis: analysisFor(wo),
    summary: await summarize(wo, template),
    generatedAt: now(),
  });
}

function demoSvg(text = 'Photo', tone = 'blue') {
  const colors = { blue: ['#0f2547', '#2f7bff'], amber: ['#3a2a0c', '#f5a524'], slate: ['#1e293b', '#94a3b8'], green: ['#0d2e24', '#22c55e'] }[tone] || ['#0f2547', '#2f7bff'];
  const words = String(text).slice(0, 70).replace(/[<&>"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="#0b1b33"/></linearGradient>
<pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${colors[1]}" stroke-opacity=".12"/></pattern></defs>
<rect width="400" height="300" fill="url(#g)"/><rect width="400" height="300" fill="url(#p)"/>
<g fill="none" stroke="${colors[1]}" stroke-width="3" stroke-opacity=".8"><rect x="160" y="88" width="80" height="58" rx="8"/><circle cx="200" cy="117" r="17"/><path d="M178 88l8-12h28l8 12"/></g>
<text x="200" y="188" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" fill="#e2e8f0">${words}</text>
<rect x="12" y="12" width="168" height="24" rx="12" fill="#000" fill-opacity=".45"/>
<text x="96" y="29" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="1" fill="#fbbf24">DEMO PLACEHOLDER</text>
</svg>`;
}

async function readBody(req, limit = 15 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Request too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

function serveFile(res, root, rel) {
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(root)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ------------------------------------------------------------------ routes
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/bootstrap', () => {
  const d = db();
  const idx = buildHashIndex(d.workOrders);
  return {
    meta: { ...d.meta, integrations: config, serverTime: now() },
    templates: d.templates, customers: d.customers, locations: d.locations, technicians: d.technicians,
    workOrders: d.workOrders.map((wo) => enrich(wo, idx)),
    disputes: d.disputes, reports: d.reports.map(({ snapshot, ...r }) => r),
  };
});

route('GET', '/api/work-orders/:id', async ({ id }) => {
  const wo = findWo(id);
  return { ...enrich(wo), summary: await summarize(wo, tplOf(wo)) };
});

route('POST', '/api/work-orders', async (_, body) => {
  const d = db();
  need(d.customers.some((c) => c.id === body.customerId), 400, 'Unknown customer');
  need(d.locations.some((l) => l.id === body.locationId && l.customerId === body.customerId), 400, 'Location does not belong to customer');
  need(d.templates.some((t) => t.id === body.templateId), 400, 'Unknown service template');
  need(body.scheduledFor, 400, 'Scheduled time is required');
  const n = nextId('wo');
  const wo = {
    id: `wo-${n}`, number: `WO-${n}`, customerId: body.customerId, locationId: body.locationId, templateId: body.templateId,
    technicianId: body.technicianId || null, scheduledFor: new Date(body.scheduledFor).toISOString(), status: 'scheduled',
    priority: body.priority || 'normal', demo: false, createdAt: now(),
    visit: { checkInAt: null, checkOutAt: null }, checklist: [], notes: [], evidence: [], signoff: null, review: null,
  };
  d.workOrders.push(wo);
  if (wo.technicianId) notify('technician_assigned', `${wo.number} → ${d.technicians.find((t) => t.id === wo.technicianId)?.name}`);
  save();
  return enrich(wo);
});

route('PATCH', '/api/work-orders/:id', ({ id }, body) => {
  const wo = findWo(id);
  if ('technicianId' in body) {
    need(!body.technicianId || db().technicians.some((t) => t.id === body.technicianId), 400, 'Unknown technician');
    need(!['verified', 'disputed'].includes(wo.status), 409, 'Cannot reassign a closed work order');
    wo.technicianId = body.technicianId || null;
    notify('technician_assigned', `${wo.number} → ${db().technicians.find((t) => t.id === wo.technicianId)?.name || 'unassigned'}`);
  }
  if (body.scheduledFor) wo.scheduledFor = new Date(body.scheduledFor).toISOString();
  if (body.priority) wo.priority = body.priority;
  save();
  return enrich(wo);
});

// --- technician actions. All timestamps are taken from the server clock at the
//     moment of the action; clients cannot supply them.
route('POST', '/api/work-orders/:id/check-in', ({ id }) => {
  const wo = findWo(id); assertEditable(wo);
  need(!wo.visit.checkInAt, 409, 'Already checked in');
  startIfNeeded(wo);
  wo.visit.checkInAt = now();
  save(); return enrich(wo);
});

route('POST', '/api/work-orders/:id/check-out', ({ id }) => {
  const wo = findWo(id); assertEditable(wo);
  need(wo.visit.checkInAt, 409, 'Check in first');
  wo.visit.checkOutAt = now();
  save(); return enrich(wo);
});

route('POST', '/api/work-orders/:id/checklist/:stepId', ({ id, stepId }, body) => {
  const wo = findWo(id); assertEditable(wo);
  need(tplOf(wo).steps.some((s) => s.id === stepId), 400, 'Unknown step');
  need(['done', 'not_done', 'na'].includes(body.status ?? 'done'), 400, 'Invalid status');
  startIfNeeded(wo);
  const entry = wo.checklist.find((c) => c.stepId === stepId);
  if (body.status && body.status !== entry.status) {
    entry.status = body.status;
    entry.completedAt = body.status === 'not_done' ? null : now();
  }
  if (typeof body.note === 'string') entry.note = body.note.slice(0, 2000);
  save(); return enrich(wo);
});

route('POST', '/api/work-orders/:id/notes', ({ id }, body) => {
  const wo = findWo(id); assertEditable(wo);
  need(body.text?.trim(), 400, 'Note text required');
  startIfNeeded(wo);
  wo.notes.push({ text: body.text.trim().slice(0, 4000), recordedAt: now() });
  save(); return enrich(wo);
});

route('POST', '/api/work-orders/:id/evidence', async ({ id }, body) => {
  const wo = findWo(id); assertEditable(wo);
  need(body.dataUrl && body.filename, 400, 'File required');
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(body.dataUrl);
  need(m, 400, 'Invalid file encoding');
  const [, contentType, b64] = m;
  need(/^image\/(jpeg|png|webp|heic)|^application\/pdf$/.test(contentType), 415, 'Supported: JPEG, PNG, WebP, HEIC, PDF');
  const buffer = Buffer.from(b64, 'base64');
  startIfNeeded(wo);
  const stored = await putObject({ workOrderId: wo.id, filename: body.filename, buffer, contentType });
  const template = tplOf(wo);
  // capturedAt comes only from the file's own EXIF metadata (parsed client-side).
  // It is device-reported and labelled as such; if absent we store null.
  const capturedAt = body.exifCapturedAt && !isNaN(Date.parse(body.exifCapturedAt)) ? new Date(body.exifCapturedAt).toISOString() : null;
  const ev = {
    id: `ev-${nextId('evidence')}`,
    kind: contentType === 'application/pdf' ? 'document' : 'photo',
    filename: body.filename.slice(0, 120), caption: (body.caption || '').slice(0, 200) || body.filename,
    stepId: template.steps.some((s) => s.id === body.stepId) ? body.stepId : null,
    url: stored.url, storageKey: stored.key, sha256: stored.sha256,
    capturedAt, capturedAtSource: capturedAt ? 'device-metadata' : 'unavailable',
    uploadedAt: now(), review: { status: 'pending' }, demo: false,
  };
  ev.classification = await classify(ev, template, buffer);
  wo.evidence.push(ev);
  save(); return enrich(wo);
});

route('POST', '/api/work-orders/:id/signoff', ({ id }, body) => {
  const wo = findWo(id); assertEditable(wo);
  need(['captured', 'unavailable', 'refused'].includes(body.status), 400, 'Invalid sign-off status');
  if (body.status === 'captured') {
    need(body.signerName?.trim(), 400, 'Signer name required');
    need(/^data:image\/png;base64,/.test(body.signatureDataUrl || '') && body.signatureDataUrl.length > 2000, 400, 'A drawn signature is required');
    wo.signoff = { status: 'captured', signerName: body.signerName.trim().slice(0, 120), capturedAt: now(), method: 'on-device signature', signatureUrl: body.signatureDataUrl };
  } else {
    need(body.reason?.trim(), 400, 'Explain why sign-off was not obtained');
    wo.signoff = { status: body.status, reason: body.reason.trim().slice(0, 500), capturedAt: now() };
  }
  save(); return enrich(wo);
});

route('POST', '/api/work-orders/:id/submit', ({ id }) => {
  const wo = findWo(id); assertEditable(wo);
  need(wo.visit.checkInAt, 409, 'Check in before submitting');
  if (!wo.visit.checkOutAt) wo.visit.checkOutAt = now();
  wo.status = 'submitted';
  wo.submittedAt = now();
  const a = analysisFor(wo);
  notify('record_submitted', `${wo.number}: ${a.blockers} blocker(s), ${a.warnings} warning(s)`);
  save(); return enrich(wo);
});

// --- reviewer actions
route('POST', '/api/evidence/:evId/review', ({ evId }, body) => {
  need(['approved', 'rejected', 'pending'].includes(body.status), 400, 'Invalid status');
  need(body.reviewer?.trim(), 400, 'Reviewer name required');
  const wo = db().workOrders.find((w) => w.evidence.some((e) => e.id === evId));
  need(wo, 404, 'Evidence not found');
  need(wo.status !== 'verified', 409, 'Record already verified');
  if (body.status === 'rejected') need(body.comment?.trim(), 400, 'Give a reason for rejecting evidence');
  const ev = wo.evidence.find((e) => e.id === evId);
  ev.review = { status: body.status, by: body.reviewer.trim(), at: now(), comment: body.comment || '' };
  save(); return enrich(wo);
});

route('POST', '/api/work-orders/:id/review', ({ id }, body) => {
  const wo = findWo(id);
  need(['submitted', 'in_review'].includes(wo.status), 409, 'Only submitted records can be reviewed');
  need(body.reviewer?.trim(), 400, 'Reviewer name required');
  need(['verified', 'needs_info'].includes(body.decision), 400, 'Invalid decision');
  const a = analysisFor(wo);
  if (body.decision === 'verified') {
    need(a.blockers === 0, 409, 'Resolve required items before verifying');
    need(a.pendingEvidence === 0, 409, 'Approve or reject every submitted file first');
    need(a.warnings === 0 || body.comment?.trim(), 400, 'Explain how the warnings were resolved');
  } else need(body.comment?.trim(), 400, 'Tell the technician what is needed');
  wo.review = { decision: body.decision, reviewer: body.reviewer.trim(), decidedAt: now(), comment: body.comment || '', acknowledgedWarnings: a.exceptions.filter((e) => e.severity === 'warning').map((e) => e.title) };
  wo.status = body.decision;
  notify(body.decision === 'verified' ? 'record_verified' : 'technician_info_requested', wo.number);
  save(); return enrich(wo);
});

// --- reports
route('GET', '/api/work-orders/:id/report', async ({ id }) => reportFor(findWo(id)));

route('POST', '/api/work-orders/:id/reports', async ({ id }) => {
  const wo = findWo(id);
  const report = await reportFor(wo);
  const lambda = await invokeReportLambda({ workOrderNumber: wo.number, workOrderId: wo.id, report });
  const rec = { id: `rpt-${nextId('report')}`, workOrderId: wo.id, number: wo.number, createdAt: now(), status: report.reportStatus, generator: lambda.simulated ? 'in-process (Lambda simulated)' : 'AWS Lambda', snapshot: report };
  db().reports.unshift(rec);
  notify('report_ready', `${wo.number} (${report.reportStatus}) — customer email NOT sent in demo`);
  save();
  const { snapshot, ...meta } = rec;
  return meta;
});

// --- disputes
route('POST', '/api/disputes', (_, body) => {
  const wo = findWo(body.workOrderId);
  need(body.claim?.trim() && body.raisedBy?.trim(), 400, 'Claim and source are required');
  need(!db().disputes.some((d) => d.workOrderId === wo.id && d.status === 'open'), 409, 'An open dispute already exists');
  const dsp = { id: `dsp-${nextId('dispute')}`, workOrderId: wo.id, status: 'open', demo: false, raisedBy: body.raisedBy.trim(), raisedAt: now(), channel: body.channel || 'other', claim: body.claim.trim(), requestedOutcome: body.requestedOutcome || '', priorStatus: wo.status, timeline: [{ at: now(), by: 'System', text: 'Dispute opened.' }], resolution: null };
  db().disputes.unshift(dsp);
  wo.status = 'disputed';
  save(); return dsp;
});

route('POST', '/api/disputes/:id/notes', ({ id }, body) => {
  const dsp = db().disputes.find((d) => d.id === id); need(dsp, 404, 'Dispute not found');
  need(body.text?.trim() && body.by?.trim(), 400, 'Note and author required');
  dsp.timeline.push({ at: now(), by: body.by.trim(), text: body.text.trim() });
  save(); return dsp;
});

route('POST', '/api/disputes/:id/resolve', ({ id }, body) => {
  const dsp = db().disputes.find((d) => d.id === id); need(dsp, 404, 'Dispute not found');
  need(dsp.status === 'open', 409, 'Already resolved');
  need(body.outcome?.trim() && body.by?.trim(), 400, 'Outcome and reviewer required');
  dsp.status = 'resolved';
  dsp.resolution = { outcome: body.outcome.trim(), decidedAt: now(), by: body.by.trim() };
  dsp.timeline.push({ at: now(), by: body.by.trim(), text: `Resolved: ${body.outcome.trim()}` });
  const wo = findWo(dsp.workOrderId);
  wo.status = dsp.priorStatus || (wo.review?.decision === 'verified' ? 'verified' : 'submitted');
  save(); return dsp;
});

// --- directory
route('POST', '/api/customers', (_, body) => {
  need(body.name?.trim(), 400, 'Name required');
  const c = { id: `cus-${Date.now().toString(36)}`, name: body.name.trim(), contact: body.contact || '', email: body.email || '', segment: body.segment || '' };
  db().customers.push(c); save(); return c;
});
route('POST', '/api/locations', (_, body) => {
  need(db().customers.some((c) => c.id === body.customerId), 400, 'Unknown customer');
  need(body.name?.trim() && body.address?.trim(), 400, 'Name and address required');
  const l = { id: `loc-${Date.now().toString(36)}`, customerId: body.customerId, name: body.name.trim(), address: body.address.trim() };
  db().locations.push(l); save(); return l;
});

// --- insights / integrations / website
route('GET', '/api/insights', () => recurringIssues(rowsForInsights()));
route('GET', '/api/integrations', () => ({ config, log: db().integrationLog, leads: db().leads }));

route('POST', '/api/demo-requests', async (_, body) => {
  need(body.email && /.+@.+\..+/.test(body.email), 400, 'Valid email required');
  need(body.company?.trim(), 400, 'Company required');
  const lead = { id: `lead-${nextId('lead')}`, name: (body.name || '').slice(0, 100), email: body.email.slice(0, 200), company: body.company.slice(0, 120), industry: body.industry || 'other', fleetSize: body.fleetSize || '', message: (body.message || '').slice(0, 1000), createdAt: now() };
  db().leads.unshift(lead);
  const hs = await hubspotDemoRequest(lead);
  save();
  return { ok: true, simulated: hs.simulated };
});

route('POST', '/api/reset', () => { load({ reset: true }); logIntegration('System', 'Demo data reset', ''); save(); return { ok: true }; });

// ------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/demo-img.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      return res.end(demoSvg(url.searchParams.get('t'), url.searchParams.get('tone')));
    }
    const rm = /^\/reports\/(rpt-\d+)\.html$/.exec(p);
    if (rm) {
      const rec = db().reports.find((r) => r.id === rm[1]); need(rec, 404, 'Report not found');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderReportHTML(rec.snapshot));
    }
    const pm = /^\/work-orders\/([\w-]+)\/report-preview\.html$/.exec(p);
    if (pm) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderReportHTML(await reportFor(findWo(pm[1]))));
    }
    if (p.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(p); if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const out = await r.handler(params, body, url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(out));
      }
      throw new HttpError(404, 'Not found');
    }
    if (p.startsWith('/uploads/') && serveFile(res, UPLOADS, p.slice('/uploads'.length))) return;
    const pages = { '/': '/index.html', '/app': '/app.html', '/tech': '/tech.html' };
    if (serveFile(res, PUBLIC, pages[p] || p)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`RouteProof running → http://localhost:${PORT}`);
  console.log(`  website  /      dashboard  /app      technician  /tech`);
  console.log(`  integrations: ${JSON.stringify(config)}`);
});
