import { analyzeRecord, classifyEvidence, summarizeRecord, buildReport, renderReportHTML } from './engine.js';
import { demoTemplate as T, demoPeople, buildDemoWorkOrder, stepHints } from './demo-data.js';
import { esc, fmtTime, exceptionList, signaturePad, api } from './ui.js';

const STAGES = ['Raw submission', 'Organize record', 'Check completeness', 'Resolve gaps', 'Draft report', 'Review & verify'];
const REVIEWER = 'You (demo reviewer)';
const HINT_ORDER = ['d5', 'd1', 'd2', 'd3', 'd4'];

let S;
function reset() {
  S = { stage: 0, reached: 0, wo: buildDemoWorkOrder(), mapping: [], organized: false, submitted: false, verified: false, pad: null, reviewComment: '' };
  render();
}

const stepLabel = (id) => T.steps.find((s) => s.id === id)?.label || 'Unassigned';
const asSubmitted = () => ({ ...S.wo, status: 'submitted' });
const analysis = () => analyzeRecord(S.submitted || S.stage >= 2 ? asSubmitted() : S.wo, T);
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- organize
function organize() {
  if (S.organized) return;
  const raw = S.wo.notes[0].text;
  const sentences = raw.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const stepId = HINT_ORDER.find((id) => stepHints[id].test(s)) || null;
    S.mapping.push({ text: s, stepId });
    if (stepId) {
      const c = S.wo.checklist.find((x) => x.stepId === stepId);
      c.note = c.note ? `${c.note} ${s}` : s;
    }
  }
  for (const e of S.wo.evidence) {
    const stepId = HINT_ORDER.find((id) => stepHints[id].test(e.caption)) || null;
    e.stepId = stepId;
    e.classification = classifyEvidence(e, T);
  }
  S.organized = true;
}

// ---------------------------------------------------------------- views
function checklistView({ withAssigned = false, withState = null } = {}) {
  return T.steps.map((st) => {
    const c = S.wo.checklist.find((x) => x.stepId === st.id);
    const state = withState?.steps.find((x) => x.step.id === st.id);
    const req = [st.requiresPhoto && 'photo', st.requiresNote && 'note'].filter(Boolean).join(' + ');
    const photos = S.wo.evidence.filter((e) => e.stepId === st.id);
    return `<div class="ck ${state ? 'state-' + state.state : ''}">
      <span class="box ${c.status === 'done' ? 'on' : ''}">${c.status === 'done' ? '✓' : ''}</span>
      <div style="flex:1">
        <div><strong>${esc(st.label)}</strong></div>
        <div class="meta">${c.status === 'done' ? `Ticked ${fmtTime(c.completedAt)}` : 'Not ticked'}${req ? ` · requires ${req}` : ''}${withAssigned ? ` · ${photos.length} photo(s)` : ''}</div>
        ${withAssigned && c.note ? `<div class="assigned">${esc(c.note)}</div>` : ''}
        ${state && state.missing.length ? `<div class="meta" style="color:var(--bad);font-weight:600">Missing: ${state.missing.join(', ')}</div>` : ''}
      </div></div>`;
  }).join('');
}

function photosView({ showClass = false, review = false } = {}) {
  return `<div class="thumbs">${S.wo.evidence.map((e) => `
    <div class="thumb ${e.review.status === 'rejected' ? 'rejected' : ''}">
      <img src="${esc(e.url)}" alt="${esc(e.caption)}">
      <div class="cap"><b>${esc(e.filename)}</b>
        ${esc(e.caption)}<br>
        <span class="muted">Captured: ${e.capturedAt ? fmtTime(e.capturedAt) + ' <span title="Reported by the device">(device)</span>' : '<b style="display:inline;color:var(--warn)">not available</b>'}</span>
        ${showClass && e.classification ? `<div style="margin-top:4px"><span class="badge info">${esc(e.classification.category)}</span> <span class="badge">${esc(e.classification.stage)}</span><div class="muted">→ ${esc(stepLabel(e.stepId))} · ${Math.round(e.classification.confidence * 100)}% conf.</div></div>` : ''}
        ${review ? reviewControls(e) : ''}
      </div>
    </div>`).join('')}</div>`;
}

function reviewControls(e) {
  if (e.review.status !== 'pending')
    return `<div style="margin-top:6px"><span class="badge ${e.review.status === 'approved' ? 'ok' : 'bad'}">${e.review.status}</span>${e.review.comment ? `<div class="muted">${esc(e.review.comment)}</div>` : ''} <button class="btn btn-sm btn-ghost" data-act="undo-ev" data-id="${e.id}" style="margin-top:4px">Undo</button></div>`;
  return `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">
    <button class="btn btn-sm btn-ok" data-act="approve-ev" data-id="${e.id}">Approve</button>
    <button class="btn btn-sm btn-bad" data-act="reject-ev" data-id="${e.id}">Reject</button></div>`;
}

function stats(a) {
  return `<div class="stat-row">
    <div class="stat"><b>${a.completeness.documented}/${a.completeness.total}</b><span>steps fully documented</span></div>
    <div class="stat"><b style="color:${a.blockers ? 'var(--bad)' : 'var(--ok)'}">${a.blockers}</b><span>required items missing</span></div>
    <div class="stat"><b style="color:${a.warnings ? 'var(--warn)' : 'inherit'}">${a.warnings}</b><span>warnings to review</span></div>
  </div>
  <div class="meter ${a.completeness.pct === 100 ? 'ok' : ''}" style="margin-bottom:16px"><span style="width:${a.completeness.pct}%"></span></div>`;
}

const STAGE_VIEWS = [
  // 0 — raw
  () => ({
    left: `<h4>Technician's checklist</h4>${checklistView()}
      <p class="small muted">Sign-off: <b style="color:var(--bad)">none captured</b> · Check-in ${fmtTime(S.wo.visit.checkInAt)} (simulated)</p>`,
    right: `<div class="demo-explain">This is exactly what <b>${esc(demoPeople.technician.name)}</b> submitted from the van: four boxes ticked, one free-text note, and three untagged photos. Typical end-of-shift data.</div>
      <h4>Technician note (verbatim)</h4><div class="raw-notes">${esc(S.wo.notes[0].text)}</div>
      <h4 style="margin-top:18px">Uploaded files (not tagged to any step)</h4>${photosView()}
      <p style="margin-top:18px"><button class="btn btn-primary" data-act="go" data-to="1">Organize this record →</button></p>`,
  }),
  // 1 — organize
  () => ({
    left: `<h4>Structured job record</h4>${checklistView({ withAssigned: true })}`,
    right: `<div class="demo-explain"><b>Service record understanding.</b> Each sentence of the note is placed on the checklist step it describes, and each photo is classified and attached to a step. The original wording is kept — nothing is reworded or added.</div>
      <h4>Note → step mapping</h4>
      ${S.mapping.map((m) => `<div class="exc ${m.stepId ? 'info' : 'warning'}"><span class="badge ${m.stepId ? 'info' : 'warn'} sev">${m.stepId ? m.stepId.toUpperCase() : '??'}</span><div><strong>${esc(stepLabel(m.stepId))}</strong>"${esc(m.text)}"</div></div>`).join('')}
      <h4 style="margin-top:16px">Evidence classification</h4>${photosView({ showClass: true })}
      <p class="small muted" style="margin-top:10px">Classification describes what a file appears to show. It is not a finding that work was done.</p>
      <p><button class="btn btn-primary" data-act="go" data-to="2">Check completeness →</button></p>`,
  }),
  // 2 — check
  () => {
    const a = analysis();
    return {
      left: `<h4>Checklist against template</h4>${checklistView({ withAssigned: true, withState: a })}`,
      right: `<div class="demo-explain"><b>Completeness analysis and exception detection</b> compare the record with the "${esc(T.name)}" template: required steps, photos, notes and sign-off, plus timestamp consistency.</div>
        ${stats(a)}
        <h4>Exceptions found</h4>${exceptionList(a.exceptions)}
        <p class="small muted">Photos attached to steps count as <em>submitted evidence</em> only. Nothing on this screen means the work was verified.</p>
        <p><button class="btn btn-primary" data-act="go" data-to="3">Resolve missing items →</button></p>`,
    };
  },
  // 3 — resolve
  () => {
    const a = analysis();
    const has = (code, stepId) => a.exceptions.some((e) => e.code === code && (!stepId || e.stepId === stepId));
    const fixes = [];
    fixes.push(fixRow(!has('STEP_NO_PHOTO', 'd2'), 'Bait-station photo missing',
      'Technician takes the photo on site; the upload time is your current time.',
      `<button class="btn btn-sm btn-primary" data-act="add-photo">Simulate upload</button>`));
    fixes.push(fixRow(!has('STEP_NOTE_INCOMPLETE', 'd3'), 'Treatment note lacks EPA registration number',
      `<input type="text" id="epa-note" placeholder="Product, EPA Reg. No., amount" style="margin-top:6px"><button class="btn btn-sm btn-ghost" data-act="epa-example" style="margin-top:6px">Insert example text</button>`,
      `<button class="btn btn-sm btn-primary" data-act="save-epa">Add to note</button>`));
    fixes.push(fixRow(!has('STEP_INCOMPLETE', 'd5'), 'Recommendations step not ticked',
      'The note covers it, but only the technician can confirm the step is done.',
      `<button class="btn btn-sm btn-primary" data-act="tick-d5">Technician ticks step</button>`));
    const signed = !!S.wo.signoff;
    fixes.push(fixRow(signed, 'Customer sign-off missing',
      signed ? (S.wo.signoff.status === 'captured' ? `Signed by ${esc(S.wo.signoff.signerName)} at ${fmtTime(S.wo.signoff.capturedAt)}` : `Not obtained: ${esc(S.wo.signoff.reason)}`)
        : `<input type="text" id="signer" placeholder="Customer name and title" style="margin:6px 0"><canvas class="sigpad" id="sigpad" aria-label="Signature pad — draw here"></canvas>
           <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn btn-sm btn-ghost" data-act="sig-clear">Clear</button><button class="btn btn-sm btn-ghost" data-act="sig-unavailable">Customer not available…</button></div>`,
      signed ? '' : `<button class="btn btn-sm btn-primary" data-act="sig-save">Capture sign-off</button>`));
    const ready = a.blockers === 0;
    return {
      left: `<h4>What still needs to happen</h4>${fixes.join('')}
        <p class="small muted">The demo won't fill these in for you. A signature has to be drawn, and the reason for a missing sign-off has to be typed.</p>`,
      right: `<div class="demo-explain">The checks rerun live as each gap is closed. When nothing required is missing, the technician can submit.</div>
        ${stats(a)}${exceptionList(a.exceptions)}
        <p><button class="btn btn-primary" data-act="submit" ${ready && !S.submitted ? '' : 'disabled'}>${S.submitted ? 'Submitted ✓' : 'Submit record'}</button>
        ${S.submitted ? `<button class="btn btn-ghost" data-act="go" data-to="4">View draft report →</button>` : ''}</p>`,
    };
  },
  // 4 — draft report
  () => {
    const r = report();
    return {
      left: `<div class="demo-explain"><b>Service report generation</b> uses the template, the recorded work, the technician's own notes and approved evidence. Right now no files are approved, so the photos are left out and the report is marked <b>Draft — not verified</b>.</div>
        <h4>Extracted from technician notes</h4>${summaryView()}
        <p><button class="btn btn-primary" data-act="go" data-to="5">Review as operations →</button></p>`,
      right: `<div class="report-frame">${renderReportHTML(r, { standalone: false })}</div>`,
    };
  },
  // 5 — review
  () => {
    const a = analysis();
    const pending = a.pendingEvidence;
    const canVerify = !S.verified && a.blockers === 0 && pending === 0 && (a.warnings === 0 || S.reviewComment.trim());
    return {
      left: `<div class="demo-explain">You're the reviewer. Approve or reject each file, then decide whether the documentation is complete. <b>Verifying confirms the record, not the physical work.</b></div>
        <h4>Evidence review</h4>${photosView({ showClass: true, review: !S.verified })}
        <h4 style="margin-top:16px">Record decision</h4>
        ${a.warnings ? `<label class="field">How were the warnings resolved? (required)<textarea id="rev-comment">${esc(S.reviewComment)}</textarea></label>` : ''}
        <p class="small muted">${pending ? `${pending} file(s) still need a decision.` : 'All files reviewed.'}</p>
        <button class="btn btn-ok" data-act="verify" ${canVerify ? '' : 'disabled'}>${S.verified ? 'Verified ✓' : 'Verify record'}</button>`,
      right: `<div class="report-frame">${renderReportHTML(report(), { standalone: false })}</div>`,
    };
  },
];

function fixRow(resolved, title, body, action) {
  return `<div class="fix ${resolved ? 'resolved' : ''}"><div style="flex:1"><p><strong>${resolved ? '✓ ' : ''}${esc(title)}</strong></p>${resolved ? '' : `<div class="small muted">${body}</div>`}</div>${resolved ? '<span class="badge ok">Resolved</span>' : action}</div>`;
}

function summaryView() {
  const s = summarizeRecord(S.wo, T);
  const list = (title, arr) => arr.length ? `<p class="small" style="margin:10px 0 4px"><b>${title}</b></p><ul class="small" style="margin:0;padding-left:1.1em">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  return `<p class="small">${esc(s.headline)}</p>${list('Materials / actions', s.materials)}${list('Quantities & readings', s.readings)}${list('Follow-ups', s.followUps)}<p class="small muted" style="margin-top:8px">${esc(s.caveat)}</p>`;
}

function report() {
  const wo = S.submitted ? asSubmitted() : S.wo;
  if (S.verified) wo.status = 'verified';
  const a = analyzeRecord(wo, T);
  return buildReport({ wo, template: T, customer: demoPeople.customer, location: demoPeople.location, technician: demoPeople.technician, analysis: a, summary: summarizeRecord(wo, T), generatedAt: nowIso() });
}

// ---------------------------------------------------------------- render + events
const stepsEl = document.getElementById('demo-steps');
const bodyEl = document.getElementById('demo-body');

function render() {
  stepsEl.innerHTML = STAGES.map((s, i) => `<button role="tab" aria-selected="${i === S.stage}" class="${i === S.stage ? 'on' : i <= S.reached ? 'done' : ''}" data-act="go" data-to="${i}" ${i > S.reached ? 'disabled' : ''}><span class="n">${i < S.reached || (i === 5 && S.verified) ? '✓' : i + 1}</span>${s}</button>`).join('');
  const v = STAGE_VIEWS[S.stage]();
  bodyEl.innerHTML = `<div>${v.left}</div><div>${v.right}</div>`;
  const pad = document.getElementById('sigpad');
  S.pad = pad ? signaturePad(pad) : null;
  document.getElementById('rev-comment')?.addEventListener('input', (e) => {
    S.reviewComment = e.target.value;
    const btn = bodyEl.querySelector('[data-act=verify]');
    const a = analysis();
    if (btn && !S.verified) btn.disabled = !(a.blockers === 0 && a.pendingEvidence === 0 && S.reviewComment.trim());
  });
}

function go(to) {
  if (to > S.reached + 1) return;
  if (to === 4 && !S.submitted) return;
  if (to >= 1) organize();
  S.stage = to; S.reached = Math.max(S.reached, to);
  render();
  document.getElementById('demo').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

bodyEl.addEventListener('click', handle);
stepsEl.addEventListener('click', handle);

function handle(ev) {
  const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act;
  const wo = S.wo;
  switch (act) {
    case 'go': return go(Number(b.dataset.to));
    case 'add-photo': {
      const t = nowIso();
      const e = { id: `dev-${wo.evidence.length + 1}`, kind: 'photo', filename: 'IMG_4482.jpg', caption: 'Bait station 7 serviced, bait replaced', stepId: 'd2', url: '/demo-img.svg?t=Bait%20station%207%20serviced&tone=green', capturedAt: t, capturedAtSource: 'device-metadata', uploadedAt: t, sha256: 'demo-d', review: { status: 'pending' } };
      e.classification = classifyEvidence(e, T);
      wo.evidence.push(e);
      break;
    }
    case 'epa-example':
      document.getElementById('epa-note').value = 'Product: Example Gel Bait (fictional), EPA Reg. No. 0000-00 (placeholder), approx. 5 g.';
      return;
    case 'save-epa': {
      const v = document.getElementById('epa-note').value.trim();
      if (!v) return document.getElementById('epa-note').focus();
      const c = wo.checklist.find((x) => x.stepId === 'd3'); c.note = `${c.note} ${v}`.trim();
      break;
    }
    case 'tick-d5': { const c = wo.checklist.find((x) => x.stepId === 'd5'); c.status = 'done'; c.completedAt = nowIso(); break; }
    case 'sig-clear': S.pad?.clear(); return;
    case 'sig-save': {
      const name = document.getElementById('signer').value.trim();
      if (!name) return document.getElementById('signer').focus();
      if (!S.pad || S.pad.isEmpty()) { alert('Draw a signature in the box first.'); return; }
      wo.signoff = { status: 'captured', signerName: name, capturedAt: nowIso(), method: 'on-device signature (demo)', signatureUrl: S.pad.toDataURL() };
      break;
    }
    case 'sig-unavailable': {
      const reason = prompt('Why was sign-off not obtained? (This reason is recorded as typed.)');
      if (!reason?.trim()) return;
      wo.signoff = { status: 'unavailable', reason: reason.trim(), capturedAt: nowIso() };
      break;
    }
    case 'submit': wo.visit.checkOutAt = nowIso(); wo.status = 'submitted'; S.submitted = true; S.reached = Math.max(S.reached, 3); break;
    case 'approve-ev': wo.evidence.find((e) => e.id === b.dataset.id).review = { status: 'approved', by: REVIEWER, at: nowIso() }; break;
    case 'reject-ev': {
      const e = wo.evidence.find((x) => x.id === b.dataset.id);
      const reason = prompt('Reason for rejecting this file:', e.capturedAt ? '' : 'Screenshot with no capture metadata; cannot be placed in the visit.');
      if (!reason?.trim()) return;
      e.review = { status: 'rejected', by: REVIEWER, at: nowIso(), comment: reason.trim() };
      break;
    }
    case 'undo-ev': wo.evidence.find((e) => e.id === b.dataset.id).review = { status: 'pending' }; break;
    case 'verify':
      wo.review = { decision: 'verified', reviewer: REVIEWER, decidedAt: nowIso(), comment: S.reviewComment.trim() };
      S.verified = true;
      break;
  }
  render();
}

document.getElementById('demo-restart').addEventListener('click', reset);
reset();

// ---------------------------------------------------------------- lead form
const form = document.getElementById('lead-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('lead-status');
  const data = Object.fromEntries(new FormData(form));
  if (!data.email || !data.company) { status.textContent = 'Email and company are required.'; status.style.color = 'var(--bad)'; return; }
  try {
    const r = await api('/api/demo-requests', { method: 'POST', body: data });
    form.reset();
    status.style.color = 'var(--ok)';
    status.textContent = r.simulated ? 'Request saved. HubSpot sync is simulated in this demo — no data left this server.' : 'Thanks — we will be in touch.';
  } catch (err) { status.style.color = 'var(--bad)'; status.textContent = err.message; }
});
