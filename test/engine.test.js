import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templates, buildWorkOrders } from '../server/seed.js';
import { analyzeRecord, buildHashIndex, buildReport, summarizeRecord, classifyEvidence } from '../public/js/engine.js';

const wos = buildWorkOrders();
const idx = buildHashIndex(wos);
const tpl = (wo) => templates.find((t) => t.id === wo.templateId);
const analyze = (id) => { const wo = wos.find((w) => w.id === id); return analyzeRecord(wo, tpl(wo), { hashIndex: idx }); };
const codes = (a) => a.exceptions.map((e) => e.code);

test('complete record has no blockers and is still not verified by the engine', () => {
  const a = analyze('wo-1047');
  assert.equal(a.blockers, 0);
  assert.equal(a.readiness, 'ready_for_review');
  assert.equal(a.verification.state, 'not_verified');
});

test('missing restroom photo and empty supplies note are blockers', () => {
  const a = analyze('wo-1042');
  assert.ok(codes(a).includes('STEP_NO_PHOTO'));
  assert.ok(codes(a).includes('STEP_NO_NOTE'));
  assert.ok(codes(a).includes('SIGNOFF_NOT_OBTAINED'));
  assert.equal(a.readiness, 'missing_items');
});

test('sign-off before last step and incomplete step are flagged', () => {
  const a = analyze('wo-1043');
  assert.ok(codes(a).includes('SIGNOFF_BEFORE_COMPLETION'));
  assert.ok(codes(a).includes('STEP_INCOMPLETE'));
});

test('photo outside visit, reused file and missing capture time are flagged', () => {
  const a = analyze('wo-1044');
  assert.ok(codes(a).includes('PHOTO_OUTSIDE_VISIT'));
  assert.ok(codes(a).includes('DUPLICATE_EVIDENCE'));
  assert.ok(codes(a).includes('PHOTO_NO_CAPTURE_TIME'));
});

test('N/A without a reason is flagged', () => {
  assert.ok(codes(analyze('wo-1050')).includes('NA_WITHOUT_REASON'));
});

test('report is a draft until a reviewer verifies, and excludes unapproved evidence', () => {
  const wo = wos.find((w) => w.id === 'wo-1047');
  const a = analyzeRecord(wo, tpl(wo));
  const r = buildReport({ wo, template: tpl(wo), analysis: a, summary: summarizeRecord(wo, tpl(wo)), generatedAt: new Date().toISOString() });
  assert.match(r.reportStatus, /DRAFT/);
  assert.equal(r.evidence.length, 0);
  assert.equal(r.excludedEvidence, 4);
  assert.match(r.integrityStatement, /not, on their own, proof/);
});

test('summary only reflects technician text', () => {
  const wo = wos.find((w) => w.id === 'wo-1049');
  const s = summarizeRecord(wo, tpl(wo));
  assert.ok(s.readings.some((r) => r.includes('118 psi')));
});

test('classifier never claims completion', () => {
  const c = classifyEvidence({ caption: 'After: new filter installed', filename: 'x.jpg', kind: 'photo', stepId: 'hv2' }, templates[2]);
  assert.equal(c.stage, 'after');
  assert.match(c.note, /Not a determination/);
});
