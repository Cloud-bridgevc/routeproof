// Data store: SQLite through Node's built-in `node:sqlite` (no server, no packages).
// The database lives in data/routeproof.db. The API works on an in-memory object
// graph; load() assembles it from the tables and save() writes it back in one
// transaction. Mutable rows are upserted; evidentiary rows (evidence, reviews,
// sign-offs, notes, dispute events, reports) are insert-only and protected by
// triggers in schema.sql, so every past review or sign-off stays on record and the
// current value is simply the latest row.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { templates, customers, locations, technicians, buildWorkOrders, buildDisputes } from './seed.js';
import { classifyEvidence } from '../public/js/engine.js';

const DATA_DIR = path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'routeproof.db');
const LEGACY_JSON = path.join(DATA_DIR, 'db.json');
const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

let sql;   // DatabaseSync
let db;    // in-memory object graph used by the API
let logSeq = 0;

// ------------------------------------------------------------------ helpers
const b = (v) => (v ? 1 : 0);
const j = (v) => (v == null ? null : JSON.stringify(v));
const pj = (v, d = null) => (v == null ? d : JSON.parse(v));

function upsert(table, keys, row) {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
  sql.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT (${keys.join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`,
  ).run(...cols.map((c) => row[c]));
}

function insertOnce(table, row) {
  const cols = Object.keys(row);
  sql.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
}

// Deterministic ids for append-only rows: an unchanged value maps to the same id
// (ignored on re-save); a new decision gets a new id (inserted as a new row).
const reviewId = (evId, r) => `${evId}#${r.at || 'initial'}#${r.status}`;
const signoffId = (woId, s) => `${woId}#${s.capturedAt || 'initial'}#${s.status}`;
const recordReviewId = (woId, r) => `${woId}#${r.decidedAt}#${r.decision}`;

// ------------------------------------------------------------------ seed
function freshGraph() {
  const workOrders = buildWorkOrders();
  for (const wo of workOrders) {
    const tpl = templates.find((t) => t.id === wo.templateId);
    for (const e of wo.evidence) e.classification = classifyEvidence(e, tpl);
  }
  return {
    meta: { seededAt: new Date().toISOString(), mode: 'demo', storage: 'sqlite' },
    templates, customers, locations, technicians,
    workOrders,
    disputes: buildDisputes(),
    reports: [],
    leads: [],
    integrationLog: [],
    counters: { wo: 1052, dispute: 201, report: 0, evidence: 1000, lead: 0 },
  };
}

// ------------------------------------------------------------------ open / load
function open({ reset }) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sql?.close();
  if (reset) for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) fs.rmSync(f, { force: true });
  const isNew = !fs.existsSync(DB_FILE);
  sql = new DatabaseSync(DB_FILE);
  sql.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  sql.exec(SCHEMA);
  return isNew;
}

export function load({ reset = false } = {}) {
  const isNew = open({ reset });
  if (isNew) {
    // One-time import of data saved by the earlier JSON-file build, if present.
    if (!reset && fs.existsSync(LEGACY_JSON)) {
      db = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8'));
      db.integrationLog = (db.integrationLog || []).map((e, i) => ({ id: `log-import-${i}`, ...e }));
      db.meta = { ...db.meta, storage: 'sqlite', importedFrom: 'data/db.json' };
      save();
      fs.renameSync(LEGACY_JSON, `${LEGACY_JSON}.imported`);
    } else {
      db = freshGraph();
      save();
    }
  }
  db = readGraph();
  return db;
}

function readGraph() {
  const all = (q, ...p) => sql.prepare(q).all(...p);
  const meta = Object.fromEntries(all('SELECT key, value FROM meta').map((r) => [r.key, pj(r.value)]));
  const counters = Object.fromEntries(all('SELECT kind, value FROM counters').map((r) => [r.kind, r.value]));

  const steps = all('SELECT * FROM template_steps ORDER BY template_id, position');
  const tpls = all('SELECT * FROM service_templates ORDER BY rowid').map((t) => ({
    id: t.id, name: t.name, serviceType: t.service_type, requiresSignoff: !!t.requires_signoff,
    steps: steps.filter((s) => s.template_id === t.id).map((s) => ({
      id: s.id, label: s.label, stage: s.stage, requiresPhoto: !!s.requires_photo, requiresNote: !!s.requires_note,
      ...(s.note_must_match ? { noteMustMatch: s.note_must_match } : {}),
      ...(s.note_hint ? { noteHint: s.note_hint } : {}),
    })),
  }));

  // latest row wins for append-only "current value" tables
  const latest = (rows, key) => { const m = new Map(); for (const r of rows) m.set(r[key], r); return m; };
  const reviews = latest(all('SELECT * FROM evidence_reviews ORDER BY rowid'), 'evidence_id');
  const signoffs = latest(all('SELECT * FROM signoffs ORDER BY rowid'), 'work_order_id');
  const recReviews = latest(all('SELECT * FROM record_reviews ORDER BY rowid'), 'work_order_id');
  const checklist = all('SELECT * FROM checklist_entries ORDER BY work_order_id, position');
  const notes = all('SELECT * FROM work_order_notes ORDER BY rowid');
  const evidence = all('SELECT * FROM evidence ORDER BY rowid');

  const workOrders = all('SELECT * FROM work_orders ORDER BY rowid').map((w) => {
    const so = signoffs.get(w.id);
    const rr = recReviews.get(w.id);
    return {
      id: w.id, number: w.number, customerId: w.customer_id, locationId: w.location_id, templateId: w.template_id,
      technicianId: w.technician_id, scheduledFor: w.scheduled_for, status: w.status, priority: w.priority, demo: !!w.is_demo,
      ...(w.created_at ? { createdAt: w.created_at } : {}),
      ...(w.submitted_at ? { submittedAt: w.submitted_at } : {}),
      visit: { checkInAt: w.check_in_at, checkOutAt: w.check_out_at },
      checklist: checklist.filter((c) => c.work_order_id === w.id).map((c) => ({ stepId: c.step_id, status: c.status, completedAt: c.completed_at, note: c.note })),
      notes: notes.filter((n) => n.work_order_id === w.id).map((n) => ({ text: n.body, recordedAt: n.recorded_at })),
      evidence: evidence.filter((e) => e.work_order_id === w.id).map((e) => {
        const r = reviews.get(e.id);
        return {
          id: e.id, kind: e.kind, filename: e.filename, caption: e.caption, stepId: e.step_id, url: e.url,
          ...(e.storage_key ? { storageKey: e.storage_key } : {}),
          capturedAt: e.captured_at, capturedAtSource: e.captured_at_source, uploadedAt: e.uploaded_at, sha256: e.sha256,
          classification: pj(e.classification), demo: !!e.is_demo,
          review: r && r.status !== 'pending' ? { status: r.status, by: r.reviewer, at: r.decided_at, comment: r.comment || '' }
            : r?.decided_at ? { status: 'pending', by: r.reviewer, at: r.decided_at, comment: '' } : { status: 'pending' },
        };
      }),
      signoff: so ? (so.status === 'captured'
        ? { status: so.status, signerName: so.signer_name, capturedAt: so.captured_at, method: so.method, ...(so.signature_url ? { signatureUrl: so.signature_url } : {}) }
        : { status: so.status, reason: so.reason, capturedAt: so.captured_at }) : null,
      review: rr ? { decision: rr.decision, reviewer: rr.reviewer, decidedAt: rr.decided_at, comment: rr.comment || '', acknowledgedWarnings: pj(rr.acknowledged_warnings, []) } : null,
    };
  });

  const events = all('SELECT * FROM dispute_events ORDER BY dispute_id, seq');
  const disputes = all('SELECT * FROM disputes ORDER BY raised_at DESC').map((d) => ({
    id: d.id, workOrderId: d.work_order_id, status: d.status, demo: !!d.is_demo, raisedBy: d.raised_by, raisedAt: d.raised_at,
    channel: d.channel, claim: d.claim, requestedOutcome: d.requested_outcome || '',
    ...(d.prior_status ? { priorStatus: d.prior_status } : {}),
    timeline: events.filter((e) => e.dispute_id === d.id).map((e) => ({ at: e.created_at, by: e.author, text: e.body })),
    resolution: pj(d.resolution),
  }));

  return {
    meta, counters,
    templates: tpls,
    customers: all('SELECT * FROM customers ORDER BY rowid').map((c) => ({ id: c.id, name: c.name, contact: c.contact, email: c.email, segment: c.segment })),
    locations: all('SELECT * FROM locations ORDER BY rowid').map((l) => ({ id: l.id, customerId: l.customer_id, name: l.name, address: l.address })),
    technicians: all('SELECT * FROM technicians ORDER BY rowid').map((t) => ({ id: t.id, name: t.name, skills: pj(t.skills, []), region: t.region, phone: t.phone })),
    workOrders,
    disputes,
    reports: all('SELECT * FROM reports ORDER BY created_at DESC').map((r) => ({ id: r.id, workOrderId: r.work_order_id, number: r.number, createdAt: r.created_at, status: r.status, generator: r.generator, snapshot: pj(r.snapshot) })),
    leads: all('SELECT * FROM leads ORDER BY created_at DESC').map((l) => ({ id: l.id, name: l.name, email: l.email, company: l.company, industry: l.industry, fleetSize: l.fleet_size, message: l.message, createdAt: l.created_at })),
    integrationLog: all('SELECT * FROM integration_log ORDER BY at DESC, rowid DESC LIMIT 200').map((e) => ({ id: e.id, at: e.at, service: e.service, action: e.action, detail: e.detail, simulated: !!e.simulated })),
  };
}

// ------------------------------------------------------------------ save
export function save() {
  sql.exec('BEGIN');
  try {
    for (const [key, value] of Object.entries(db.meta || {})) upsert('meta', ['key'], { key, value: j(value) });
    for (const [kind, value] of Object.entries(db.counters || {})) upsert('counters', ['kind'], { kind, value });
    for (const c of db.customers) upsert('customers', ['id'], { id: c.id, name: c.name, contact: c.contact || null, email: c.email || null, segment: c.segment || null });
    for (const l of db.locations) upsert('locations', ['id'], { id: l.id, customer_id: l.customerId, name: l.name, address: l.address });
    for (const t of db.technicians) upsert('technicians', ['id'], { id: t.id, name: t.name, skills: j(t.skills || []), region: t.region || null, phone: t.phone || null });
    for (const t of db.templates) {
      upsert('service_templates', ['id'], { id: t.id, name: t.name, service_type: t.serviceType, requires_signoff: b(t.requiresSignoff) });
      t.steps.forEach((s, i) => upsert('template_steps', ['template_id', 'id'], {
        id: s.id, template_id: t.id, position: i, label: s.label, stage: s.stage, requires_photo: b(s.requiresPhoto), requires_note: b(s.requiresNote),
        note_must_match: s.noteMustMatch || null, note_hint: s.noteHint || null,
      }));
    }
    for (const w of db.workOrders) {
      upsert('work_orders', ['id'], {
        id: w.id, number: w.number, customer_id: w.customerId, location_id: w.locationId, template_id: w.templateId,
        technician_id: w.technicianId || null, scheduled_for: w.scheduledFor, priority: w.priority || 'normal', status: w.status,
        check_in_at: w.visit?.checkInAt || null, check_out_at: w.visit?.checkOutAt || null, submitted_at: w.submittedAt || null,
        created_at: w.createdAt || null, is_demo: b(w.demo),
      });
      w.checklist.forEach((c, i) => upsert('checklist_entries', ['work_order_id', 'step_id'], {
        work_order_id: w.id, step_id: c.stepId, position: i, status: c.status, completed_at: c.completedAt || null, note: c.note || '',
      }));
      w.notes.forEach((n, i) => insertOnce('work_order_notes', { id: `${w.id}#${i}`, work_order_id: w.id, body: n.text, recorded_at: n.recordedAt || null }));
      for (const e of w.evidence) {
        insertOnce('evidence', {
          id: e.id, work_order_id: w.id, step_id: e.stepId || null, kind: e.kind, filename: e.filename, caption: e.caption || null,
          url: e.url, storage_key: e.storageKey || null, sha256: e.sha256, captured_at: e.capturedAt || null,
          captured_at_source: e.capturedAtSource || (e.capturedAt ? 'device-metadata' : 'unavailable'), uploaded_at: e.uploadedAt || null,
          classification: j(e.classification), is_demo: b(e.demo),
        });
        const r = e.review || { status: 'pending' };
        insertOnce('evidence_reviews', { id: reviewId(e.id, r), evidence_id: e.id, status: r.status, reviewer: r.by || null, comment: r.comment || null, decided_at: r.at || null });
      }
      if (w.signoff) insertOnce('signoffs', {
        id: signoffId(w.id, w.signoff), work_order_id: w.id, status: w.signoff.status, signer_name: w.signoff.signerName || null,
        signature_url: w.signoff.signatureUrl || null, method: w.signoff.method || null, reason: w.signoff.reason || null, captured_at: w.signoff.capturedAt || null,
      });
      if (w.review) insertOnce('record_reviews', {
        id: recordReviewId(w.id, w.review), work_order_id: w.id, decision: w.review.decision, reviewer: w.review.reviewer,
        comment: w.review.comment || null, acknowledged_warnings: j(w.review.acknowledgedWarnings || []), decided_at: w.review.decidedAt,
      });
    }
    for (const d of db.disputes) {
      upsert('disputes', ['id'], {
        id: d.id, work_order_id: d.workOrderId, status: d.status, raised_by: d.raisedBy, raised_at: d.raisedAt, channel: d.channel || null,
        claim: d.claim, requested_outcome: d.requestedOutcome || null, prior_status: d.priorStatus || null, resolution: j(d.resolution), is_demo: b(d.demo),
      });
      d.timeline.forEach((e, i) => insertOnce('dispute_events', { id: `${d.id}#${i}`, dispute_id: d.id, seq: i, author: e.by, body: e.text, created_at: e.at }));
    }
    for (const r of db.reports) insertOnce('reports', { id: r.id, work_order_id: r.workOrderId, number: r.number, status: r.status, generator: r.generator, created_at: r.createdAt, snapshot: j(r.snapshot) });
    for (const l of db.leads) insertOnce('leads', { id: l.id, name: l.name || null, email: l.email, company: l.company, industry: l.industry || null, fleet_size: l.fleetSize || null, message: l.message || null, created_at: l.createdAt });
    for (const e of db.integrationLog) insertOnce('integration_log', { id: e.id, at: e.at, service: e.service, action: e.action, detail: e.detail ?? null, simulated: b(e.simulated) });
    sql.exec('COMMIT');
  } catch (err) {
    sql.exec('ROLLBACK');
    throw err;
  }
}

export const get = () => db;

export function nextId(kind) {
  db.counters[kind] = (db.counters[kind] || 0) + 1;
  return db.counters[kind];
}

export function logIntegration(service, action, detail, simulated = true) {
  const entry = { id: `log-${Date.now()}-${++logSeq}`, at: new Date().toISOString(), service, action, detail, simulated };
  db.integrationLog.unshift(entry);
  db.integrationLog = db.integrationLog.slice(0, 200);
  return entry;
}

export const dbFile = DB_FILE;
