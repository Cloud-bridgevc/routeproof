// RouteProof verification engine.
// Shared by the server (Node) and the browser (public demo). Pure functions, no I/O.
//
// Integrity rules this module enforces:
//  * It never marks a record "verified". Verification is a human reviewer decision
//    recorded separately (workOrder.review). The engine only reports what was
//    submitted, what is missing, and what looks inconsistent.
//  * A photograph counts as *submitted evidence* for a step, never as proof that
//    the step was performed correctly.
//  * Missing timestamps, signatures or approvals are reported as missing. Nothing
//    here fills in a value that was not recorded.

export const TOLERANCE_MIN = 15;

const ms = (iso) => (iso ? new Date(iso).getTime() : null);
const minutes = (n) => n * 60 * 1000;

export const EXCEPTION_INFO = {
  STEP_INCOMPLETE: 'Required checklist step not completed',
  STEP_NO_PHOTO: 'Required photo not submitted',
  STEP_NO_NOTE: 'Required technician note missing',
  STEP_NOTE_INCOMPLETE: 'Technician note missing required detail',
  NA_WITHOUT_REASON: 'Step marked not applicable without a reason',
  SIGNOFF_MISSING: 'Customer sign-off missing',
  SIGNOFF_NOT_OBTAINED: 'Customer sign-off not obtained',
  SIGNOFF_BEFORE_COMPLETION: 'Sign-off recorded before work was finished',
  NO_CHECKIN: 'No check-in recorded',
  NO_CHECKOUT: 'No check-out recorded',
  VISIT_ORDER: 'Check-out is earlier than check-in',
  STEP_TIME_MISSING: 'Completion time not recorded',
  STEP_OUTSIDE_VISIT: 'Step completed outside the visit window',
  PHOTO_OUTSIDE_VISIT: 'Photo capture time outside the visit window',
  PHOTO_NO_CAPTURE_TIME: 'Photo has no capture time',
  PHOTO_CAPTURE_AFTER_UPLOAD: 'Photo capture time is after its upload time',
  DUPLICATE_EVIDENCE: 'Same file submitted on another work order',
  STAGE_MISMATCH: 'Photo stage does not match checklist step',
  EVIDENCE_REJECTED: 'Evidence rejected by reviewer',
};

function exc(code, severity, message, extra = {}) {
  return { code, severity, title: EXCEPTION_INFO[code] || code, message, ...extra };
}

const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'not recorded';

/**
 * Analyze one work order against its service template.
 * ctx.hashIndex: Map<sha256, Array<{workOrderId, evidenceId}>> across all work orders (optional)
 */
export function analyzeRecord(wo, template, ctx = {}) {
  const exceptions = [];
  const visitStart = ms(wo.visit?.checkInAt);
  const visitEnd = ms(wo.visit?.checkOutAt);
  const submitted = ['submitted', 'in_review', 'verified', 'needs_info', 'disputed'].includes(wo.status);
  const started = !!visitStart || (wo.checklist || []).some((c) => c.status !== 'not_done');

  // ---- Visit timestamps -------------------------------------------------
  if (submitted && !visitStart) exceptions.push(exc('NO_CHECKIN', 'warning', 'The record was submitted without a check-in time.'));
  if (submitted && !visitEnd) exceptions.push(exc('NO_CHECKOUT', 'warning', 'The record was submitted without a check-out time.'));
  if (visitStart && visitEnd && visitEnd < visitStart)
    exceptions.push(exc('VISIT_ORDER', 'blocker', `Check-in ${fmt(wo.visit.checkInAt)}, check-out ${fmt(wo.visit.checkOutAt)}.`));

  const inWindow = (t) => {
    if (t == null || visitStart == null) return null;
    const end = visitEnd ?? Date.now();
    return t >= visitStart - minutes(TOLERANCE_MIN) && t <= end + minutes(TOLERANCE_MIN);
  };

  const evidence = wo.evidence || [];
  const liveEvidence = evidence.filter((e) => e.review?.status !== 'rejected');

  // ---- Checklist --------------------------------------------------------
  let lastCompletion = null;
  const steps = template.steps.map((step) => {
    const entry = (wo.checklist || []).find((c) => c.stepId === step.id) || { stepId: step.id, status: 'not_done', completedAt: null, note: '' };
    const photos = liveEvidence.filter((e) => e.stepId === step.id && e.kind === 'photo');
    const approvedPhotos = photos.filter((e) => e.review?.status === 'approved');
    const hasNote = !!(entry.note && entry.note.trim());
    const missing = [];

    if (entry.status === 'na') {
      if (!hasNote) {
        missing.push('reason');
        if (submitted) exceptions.push(exc('NA_WITHOUT_REASON', 'warning', `"${step.label}" marked N/A with no explanation.`, { stepId: step.id }));
      }
    } else {
      if (entry.status !== 'done') missing.push('completion');
      if (step.requiresPhoto && photos.length === 0) missing.push('photo');
      if (step.requiresNote && !hasNote) missing.push('note');
      else if (hasNote && step.noteMustMatch && !new RegExp(step.noteMustMatch, 'i').test(entry.note)) missing.push('note detail');
    }

    if (entry.status === 'done') {
      const t = ms(entry.completedAt);
      if (t == null) {
        exceptions.push(exc('STEP_TIME_MISSING', 'info', `"${step.label}" is marked done but has no completion time.`, { stepId: step.id }));
      } else {
        lastCompletion = Math.max(lastCompletion ?? 0, t);
        if (inWindow(t) === false)
          exceptions.push(exc('STEP_OUTSIDE_VISIT', 'warning', `"${step.label}" completed ${fmt(entry.completedAt)}, outside the recorded visit.`, { stepId: step.id }));
      }
    }

    if (submitted) {
      if (missing.includes('completion'))
        exceptions.push(exc('STEP_INCOMPLETE', 'blocker', `"${step.label}" was not completed.`, { stepId: step.id }));
      if (missing.includes('photo'))
        exceptions.push(exc('STEP_NO_PHOTO', 'blocker', `"${step.label}" requires a photo; none was submitted.`, { stepId: step.id }));
      if (missing.includes('note'))
        exceptions.push(exc('STEP_NO_NOTE', 'blocker', `"${step.label}" requires a technician note.`, { stepId: step.id }));
      if (missing.includes('note detail'))
        exceptions.push(exc('STEP_NOTE_INCOMPLETE', 'blocker', `"${step.label}" note must include ${step.noteHint || 'required details'}.`, { stepId: step.id }));
    }

    const state =
      entry.status === 'na' ? (hasNote ? 'na' : 'needs_attention')
      : missing.length === 0 ? 'documented'
      : entry.status === 'done' ? 'needs_attention'
      : 'open';

    return { step, entry, photos, approvedPhotos, hasNote, missing, state };
  });

  // ---- Evidence ---------------------------------------------------------
  for (const e of evidence) {
    const label = `"${e.caption || e.filename}"`;
    if (e.review?.status === 'rejected') {
      exceptions.push(exc('EVIDENCE_REJECTED', 'info', `${label} was rejected${e.review.comment ? `: ${e.review.comment}` : ''}.`, { evidenceId: e.id }));
      continue;
    }
    if (e.kind !== 'photo') continue;
    const cap = ms(e.capturedAt);
    if (cap == null) {
      exceptions.push(exc('PHOTO_NO_CAPTURE_TIME', 'info', `${label} has no capture time in its metadata; only the upload time (${fmt(e.uploadedAt)}) is known.`, { evidenceId: e.id }));
    } else {
      if (inWindow(cap) === false)
        exceptions.push(exc('PHOTO_OUTSIDE_VISIT', 'warning', `${label} reports capture at ${fmt(e.capturedAt)}, outside the visit (${fmt(wo.visit?.checkInAt)} – ${fmt(wo.visit?.checkOutAt)}).`, { evidenceId: e.id }));
      if (ms(e.uploadedAt) != null && cap > ms(e.uploadedAt) + minutes(2))
        exceptions.push(exc('PHOTO_CAPTURE_AFTER_UPLOAD', 'warning', `${label} capture time is later than its upload time — device clock may be wrong.`, { evidenceId: e.id }));
    }
    if (ctx.hashIndex && e.sha256) {
      const others = (ctx.hashIndex.get(e.sha256) || []).filter((x) => x.workOrderId !== wo.id);
      if (others.length)
        exceptions.push(exc('DUPLICATE_EVIDENCE', 'warning', `${label} is byte-identical to a file on ${others.map((o) => o.number || o.workOrderId).join(', ')}.`, { evidenceId: e.id }));
    }
    const step = template.steps.find((s) => s.id === e.stepId);
    if (step && e.classification?.stage && e.classification.stage !== 'unknown' && step.stage === 'before' && e.classification.stage === 'after')
      exceptions.push(exc('STAGE_MISMATCH', 'info', `${label} looks like an "after" photo but is attached to a "before" step.`, { evidenceId: e.id }));
  }

  // ---- Sign-off ---------------------------------------------------------
  const so = wo.signoff;
  if (template.requiresSignoff && submitted) {
    if (!so) exceptions.push(exc('SIGNOFF_MISSING', 'blocker', 'No customer sign-off and no reason recorded.'));
    else if (so.status === 'unavailable' || so.status === 'refused')
      exceptions.push(exc('SIGNOFF_NOT_OBTAINED', 'warning', `Sign-off ${so.status === 'refused' ? 'refused' : 'unavailable'}${so.reason ? ` — "${so.reason}"` : ' and no reason given'}.`));
  }
  if (so?.status === 'captured') {
    const st = ms(so.capturedAt);
    if (st == null) exceptions.push(exc('STEP_TIME_MISSING', 'info', 'Sign-off has no recorded time.'));
    else if (lastCompletion && st < lastCompletion - minutes(1))
      exceptions.push(exc('SIGNOFF_BEFORE_COMPLETION', 'warning', `Customer signed at ${fmt(so.capturedAt)}, before the last step was completed (${fmt(new Date(lastCompletion).toISOString())}).`));
  }

  // ---- Totals -----------------------------------------------------------
  const applicable = steps.filter((s) => s.entry.status !== 'na' || !s.hasNote);
  const completed = steps.filter((s) => s.entry.status === 'done' || (s.entry.status === 'na' && s.hasNote));
  const documented = steps.filter((s) => s.state === 'documented' || s.state === 'na');
  const pct = template.steps.length ? Math.round((documented.length / template.steps.length) * 100) : 0;

  const blockers = exceptions.filter((e) => e.severity === 'blocker');
  const warnings = exceptions.filter((e) => e.severity === 'warning');
  const pendingEvidence = liveEvidence.filter((e) => (e.review?.status || 'pending') === 'pending');

  let readiness;
  if (!submitted) readiness = started ? 'in_progress' : 'not_started';
  else if (blockers.length) readiness = 'missing_items';
  else if (warnings.length) readiness = 'review_with_warnings';
  else readiness = 'ready_for_review';

  return {
    steps,
    exceptions,
    blockers: blockers.length,
    warnings: warnings.length,
    completeness: { total: template.steps.length, applicable: applicable.length, completed: completed.length, documented: documented.length, pct },
    pendingEvidence: pendingEvidence.length,
    readiness,
    // Explicit, separate from readiness: only a human review can set this.
    verification: wo.review?.decision === 'verified'
      ? { state: 'verified', by: wo.review.reviewer, at: wo.review.decidedAt }
      : { state: 'not_verified' },
  };
}

export const READINESS_LABEL = {
  not_started: 'Not started',
  in_progress: 'In progress',
  missing_items: 'Missing required items',
  review_with_warnings: 'Submitted — needs a closer look',
  ready_for_review: 'Submitted — complete, awaiting review',
};

export function buildHashIndex(workOrders) {
  const idx = new Map();
  for (const wo of workOrders)
    for (const e of wo.evidence || []) {
      if (!e.sha256) continue;
      if (!idx.has(e.sha256)) idx.set(e.sha256, []);
      idx.get(e.sha256).push({ workOrderId: wo.id, number: wo.number, evidenceId: e.id });
    }
  return idx;
}

// ---------------------------------------------------------------------------
// Evidence classification (simulated stand-in for the Bedrock classifier).
// Uses filename, caption and the step the technician attached it to. Output is
// a suggestion with a confidence score, never a verification.
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  { re: /bait|station|trap|rodent|dropping/i, category: 'Bait station / monitoring', type: 'pest-control' },
  { re: /perimeter|exterior|granular|bed/i, category: 'Exterior treatment area', type: 'pest-control' },
  { re: /door sweep|entry|threshold|gap|exclusion/i, category: 'Entry point / exclusion', type: 'pest-control' },
  { re: /restroom|toilet|washroom|bathroom/i, category: 'Restroom', type: 'cleaning' },
  { re: /kitchen|breakroom|counter|smoothie/i, category: 'Kitchen / breakroom', type: 'cleaning' },
  { re: /floor|mop|vacuum|lobby|hallway|studio/i, category: 'Floor surfaces', type: 'cleaning' },
  { re: /office|walkthrough|waiting|locker/i, category: 'General area walkthrough', type: 'cleaning' },
  { re: /nameplate|serial|model/i, category: 'Equipment nameplate', type: 'maintenance' },
  { re: /filter/i, category: 'Air filter', type: 'maintenance' },
  { re: /rtu|unit|coil|belt|panel|gauge|thermostat/i, category: 'HVAC equipment', type: 'maintenance' },
  { re: /leak|drip|water/i, category: 'Leak / water damage', type: 'repair' },
  { re: /supply line|fitting|valve|pipe|sink/i, category: 'Plumbing component', type: 'repair' },
  { re: /clean(ed)?\b|cleanup|work area/i, category: 'Work area condition', type: null },
  { re: /ticket|invoice|receipt|permit|scan|\.pdf$/i, category: 'Service document', type: null },
];

export function classifyEvidence(e, template) {
  const text = `${e.caption || ''} ${e.filename || ''}`;
  let stage = 'unknown';
  if (/\bbefore\b|\bpre[- ]|initial|reported|found/i.test(text)) stage = 'before';
  else if (/\bafter\b|\bpost[- ]|complete|finished|installed|cleaned|closed/i.test(text)) stage = 'after';
  else if (/servic|inspect|treat|replac|apply|during/i.test(text)) stage = 'during';

  const rule = CATEGORY_RULES.find((r) => r.re.test(text));
  const step = template?.steps.find((s) => s.id === e.stepId);
  let confidence = 0.45;
  const rationale = [];
  if (rule) { confidence += 0.25; rationale.push(`Text matches "${rule.category}".`); }
  if (stage !== 'unknown') { confidence += 0.1; rationale.push(`Wording suggests a ${stage} photo.`); }
  if (step) {
    confidence += 0.1;
    rationale.push(`Technician attached it to "${step.label}".`);
    if (stage === 'unknown') stage = step.stage;
  }
  if (e.kind === 'document') { stage = 'n/a'; }
  return {
    serviceType: rule?.type || template?.serviceType || 'unknown',
    category: rule?.category || (e.kind === 'document' ? 'Supporting document' : 'Unclassified photo'),
    stage,
    stepId: e.stepId || null,
    confidence: Math.min(0.9, Number(confidence.toFixed(2))),
    rationale: rationale.join(' ') || 'Little descriptive text available.',
    source: 'simulated-classifier',
    note: 'Describes what the file appears to show. Not a determination that work was done.',
  };
}

// ---------------------------------------------------------------------------
// Service record understanding (simulated stand-in for a Bedrock summary).
// Extracts structure from what the technician actually wrote; adds nothing.
// ---------------------------------------------------------------------------
export function summarizeRecord(wo, template) {
  const texts = [
    ...(wo.checklist || []).filter((c) => c.note).map((c) => ({ text: c.note, stepId: c.stepId })),
    ...(wo.notes || []).map((n) => ({ text: n.text, stepId: null })),
  ];
  const sentences = texts.flatMap(({ text, stepId }) =>
    text.split(/(?<=[.!?])\s+/).filter(Boolean).map((s) => ({ s: s.trim(), stepId })));

  const pick = (re) => sentences.filter(({ s }) => re.test(s)).map(({ s }) => s);
  const readings = [];
  for (const { s } of sentences) {
    for (const m of s.matchAll(/(\b[A-Za-z ]{0,20}?)\s*(\d+(?:\.\d+)?)\s*(psi|°F|°C|ppm|g|oz|gal|min(?:utes)?|stations?)\b/gi))
      readings.push(`${m[1].trim()} ${m[2]} ${m[3]}`.trim());
  }
  const materials = pick(/\b(applied|used|installed|replaced|restocked|EPA Reg)/i);
  const followUps = pick(/\b(recommend|follow[- ]?up|should|needs?|replace(ment)?|return visit|next visit)\b/i);
  const concerns = pick(/\b(customer|owner|manager|front desk|tenant)\b.*\b(report|said|asked|state|seeing)/i);

  const doneSteps = template.steps
    .map((st) => ({ st, c: (wo.checklist || []).find((c) => c.stepId === st.id) }))
    .filter((x) => x.c?.status === 'done');

  return {
    headline: `${doneSteps.length} of ${template.steps.length} checklist steps marked done by the technician; ${(wo.evidence || []).length} file(s) submitted.`,
    workPerformed: doneSteps.map(({ st, c }) => ({ label: st.label, note: c.note || null, completedAt: c.completedAt || null })),
    materials: [...new Set(materials)],
    readings: [...new Set(readings)],
    followUps: [...new Set(followUps)],
    customerConcerns: [...new Set(concerns)],
    source: 'simulated-summarizer',
    caveat: 'Built only from technician-entered text. Statements are as reported, not independently confirmed.',
  };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------
export function buildReport({ wo, template, customer, location, technician, analysis, summary, generatedAt }) {
  const verified = analysis.verification.state === 'verified';
  const approvedEvidence = (wo.evidence || []).filter((e) => e.review?.status === 'approved');
  const excluded = (wo.evidence || []).length - approvedEvidence.length;
  const openIssues = analysis.exceptions.filter((e) => e.severity !== 'info');
  return {
    title: `${template.name} — Service Report`,
    reportStatus: verified ? 'VERIFIED' : 'DRAFT — NOT VERIFIED',
    workOrder: wo.number,
    demo: !!wo.demo,
    generatedAt,
    customer: customer?.name,
    location: location ? `${location.name}, ${location.address}` : '',
    technician: technician?.name,
    visit: { checkInAt: wo.visit?.checkInAt || null, checkOutAt: wo.visit?.checkOutAt || null },
    steps: analysis.steps.map((s) => ({
      label: s.step.label,
      status: s.entry.status,
      completedAt: s.entry.completedAt || null,
      note: s.entry.note || null,
      evidenceIds: s.approvedPhotos.map((p) => p.id),
    })),
    notes: (wo.notes || []).map((n) => ({ text: n.text, recordedAt: n.recordedAt || null })),
    followUps: summary.followUps,
    evidence: approvedEvidence.map((e) => ({
      id: e.id, caption: e.caption, url: e.url, kind: e.kind,
      capturedAt: e.capturedAt || null, capturedAtSource: e.capturedAtSource, uploadedAt: e.uploadedAt || null,
      step: template.steps.find((s) => s.id === e.stepId)?.label || 'General',
    })),
    excludedEvidence: excluded,
    signoff: wo.signoff || null,
    verification: verified
      ? { by: wo.review.reviewer, at: wo.review.decidedAt, comment: wo.review.comment || '' }
      : null,
    openIssues: openIssues.map((e) => ({ severity: e.severity, title: e.title, message: e.message })),
    integrityStatement:
      'This report summarizes records submitted by the assigned technician. Photographs show conditions at the time they were captured and are supporting evidence only — they are not, on their own, proof that work was performed correctly. ' +
      (verified
        ? 'The record was reviewed by the named reviewer against the service checklist; that review confirms documentation completeness, not physical inspection of the site.'
        : 'This record has not been verified by a reviewer.'),
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const full = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '<em>Not recorded</em>');

export function renderReportHTML(r, { standalone = true } = {}) {
  const signoff = !r.signoff
    ? '<p class="rp-missing">No customer sign-off recorded.</p>'
    : r.signoff.status === 'captured'
      ? `<p>Signed by <strong>${esc(r.signoff.signerName)}</strong> on ${full(r.signoff.capturedAt)} (${esc(r.signoff.method || 'recorded on device')}).</p>${r.signoff.signatureUrl ? `<img class="rp-sig" src="${esc(r.signoff.signatureUrl)}" alt="Recorded signature">` : ''}`
      : `<p class="rp-missing">Sign-off ${esc(r.signoff.status)}: ${esc(r.signoff.reason || 'no reason given')}.</p>`;

  const body = `
<article class="rp-report">
  ${r.demo ? '<div class="rp-demo">DEMONSTRATION DATA — fictional customer, technician, timestamps and placeholder images.</div>' : ''}
  <header class="rp-head">
    <div><div class="rp-brand">RouteProof</div><h1>${esc(r.title)}</h1>
    <p class="rp-meta">${esc(r.workOrder)} · Generated ${full(r.generatedAt)}</p></div>
    <span class="rp-status ${r.verification ? 'ok' : 'draft'}">${esc(r.reportStatus)}</span>
  </header>
  <section class="rp-grid">
    <div><h4>Customer</h4><p>${esc(r.customer)}</p></div>
    <div><h4>Location</h4><p>${esc(r.location)}</p></div>
    <div><h4>Technician</h4><p>${esc(r.technician)}</p></div>
    <div><h4>Visit (as recorded)</h4><p>Check-in: ${full(r.visit.checkInAt)}<br>Check-out: ${full(r.visit.checkOutAt)}</p></div>
  </section>
  <section><h3>Work performed</h3>
    <table class="rp-table"><thead><tr><th>Step</th><th>Status</th><th>Recorded</th><th>Technician note</th></tr></thead><tbody>
    ${r.steps.map((s) => `<tr><td>${esc(s.label)}</td><td>${s.status === 'done' ? 'Done' : s.status === 'na' ? 'N/A' : '<span class="rp-missing">Not completed</span>'}</td><td>${s.completedAt ? full(s.completedAt) : '—'}</td><td>${esc(s.note || '')}</td></tr>`).join('')}
    </tbody></table>
  </section>
  ${r.notes.length ? `<section><h3>Technician notes</h3>${r.notes.map((n) => `<blockquote>${esc(n.text)}<cite>${n.recordedAt ? full(n.recordedAt) : 'time not recorded'}</cite></blockquote>`).join('')}</section>` : ''}
  ${r.followUps.length ? `<section><h3>Recommendations noted by technician</h3><ul>${r.followUps.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
  <section><h3>Supporting evidence</h3>
    ${r.evidence.length ? `<div class="rp-photos">${r.evidence.map((e) => `<figure>${e.kind === 'photo' ? `<img src="${esc(e.url)}" alt="${esc(e.caption)}">` : `<div class="rp-doc">📄</div>`}<figcaption><strong>${esc(e.caption)}</strong><br>${esc(e.step)}<br>Captured: ${e.capturedAt ? full(e.capturedAt) + ' (device metadata)' : 'not available'}<br>Uploaded: ${full(e.uploadedAt)}</figcaption></figure>`).join('')}</div>` : '<p>No reviewer-approved evidence.</p>'}
    ${r.excludedEvidence ? `<p class="rp-small">${r.excludedEvidence} submitted file(s) not included because they have not been approved by a reviewer.</p>` : ''}
  </section>
  <section><h3>Customer sign-off</h3>${signoff}</section>
  ${r.openIssues.length ? `<section><h3>Open record exceptions</h3><ul>${r.openIssues.map((i) => `<li><strong>${esc(i.title)}:</strong> ${esc(i.message)}</li>`).join('')}</ul></section>` : ''}
  <section><h3>Verification</h3>${r.verification ? `<p>Reviewed and verified by <strong>${esc(r.verification.by)}</strong> on ${full(r.verification.at)}. ${esc(r.verification.comment)}</p>` : '<p class="rp-missing">Not verified. This is a draft built from submitted records.</p>'}
    <p class="rp-small">${esc(r.integrityStatement)}</p></section>
</article>`;
  if (!standalone) return body;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.workOrder)} report</title><link rel="stylesheet" href="/css/report.css"></head><body>${body}<p class="rp-print"><button onclick="print()">Print / Save as PDF</button></p></body></html>`;
}

// ---------------------------------------------------------------------------
// Recurring issue analysis across many work orders.
// ---------------------------------------------------------------------------
export function recurringIssues(rows) {
  // rows: [{ wo, analysis, technician, customer, location, template }]
  const tally = (keyFn) => {
    const m = new Map();
    for (const r of rows)
      for (const e of r.analysis.exceptions.filter((x) => x.severity !== 'info')) {
        const k = keyFn(r, e);
        if (!k) continue;
        if (!m.has(k)) m.set(k, { key: k, count: 0, workOrders: new Set(), codes: new Map() });
        const v = m.get(k);
        v.count++; v.workOrders.add(r.wo.number);
        v.codes.set(e.title, (v.codes.get(e.title) || 0) + 1);
      }
    return [...m.values()]
      .map((v) => ({ key: v.key, count: v.count, workOrders: [...v.workOrders], topIssue: [...v.codes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] }))
      .sort((a, b) => b.count - a.count);
  };

  const byCode = tally((r, e) => e.title);
  const byTech = tally((r) => r.technician?.name);
  const byCustomer = tally((r) => r.customer?.name);
  const byLocation = tally((r) => r.location?.name);
  const byStep = tally((r, e) => (e.stepId ? r.template.steps.find((s) => s.id === e.stepId)?.label : null));

  const findings = [];
  for (const s of byStep.filter((x) => x.workOrders.length >= 2))
    findings.push(`"${s.key}" was flagged on ${s.workOrders.length} work orders (${s.workOrders.join(', ')}); most often: ${s.topIssue.toLowerCase()}.`);
  for (const t of byTech.filter((x) => x.workOrders.length >= 2))
    findings.push(`${t.key}: ${t.count} exception(s) across ${t.workOrders.length} work orders; most common: ${t.topIssue.toLowerCase()}. Consider a checklist refresher rather than assuming poor work.`);
  for (const l of byLocation.filter((x) => x.workOrders.length >= 2))
    findings.push(`${l.key} has repeated record exceptions (${l.workOrders.join(', ')}). Check whether site access or sign-off contacts are the cause.`);

  return { byCode, byTech, byCustomer, byLocation, byStep, findings, source: 'rule-based aggregation (simulated AI narrative)' };
}
