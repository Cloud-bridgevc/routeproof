import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// The store writes to ./data — run it inside a throwaway directory.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-store-'));
process.chdir(tmp);
const store = await import('../server/store.js');
const { buildWorkOrders } = await import('../server/seed.js');

test('seeded data round-trips through SQLite unchanged', () => {
  const db = store.load({ reset: true });
  const seeded = buildWorkOrders();
  assert.equal(db.workOrders.length, seeded.length);
  for (const s of seeded) {
    const w = db.workOrders.find((x) => x.id === s.id);
    assert.deepEqual(w.visit, s.visit);
    assert.deepEqual(w.checklist, s.checklist);
    assert.deepEqual(w.notes, s.notes);
    assert.deepEqual(w.signoff ?? null, s.signoff ?? null);
    assert.deepEqual(w.evidence.map((e) => [e.id, e.capturedAt, e.sha256, e.review.status]), s.evidence.map((e) => [e.id, e.capturedAt, e.sha256, e.review.status]));
  }
});

test('a re-review adds a row and the latest one is current', () => {
  let db = store.load();
  const ev = db.workOrders.find((w) => w.id === 'wo-1047').evidence[0];
  ev.review = { status: 'approved', by: 'T', at: '2026-10-19T10:00:00.000Z', comment: '' };
  store.save();
  ev.review = { status: 'rejected', by: 'T', at: '2026-10-19T10:05:00.000Z', comment: 'blurry' };
  store.save();
  db = store.load();
  assert.equal(db.workOrders.find((w) => w.id === 'wo-1047').evidence[0].review.status, 'rejected');
  const raw = new DatabaseSync(store.dbFile);
  assert.equal(raw.prepare('SELECT count(*) n FROM evidence_reviews WHERE evidence_id = ?').get(ev.id).n, 3);
  raw.close();
});

test('evidentiary tables reject updates and deletes', () => {
  const raw = new DatabaseSync(store.dbFile);
  assert.throws(() => raw.exec("UPDATE evidence SET captured_at = '2026-01-01' WHERE id = 'ev-1'"), /append-only/);
  assert.throws(() => raw.exec("DELETE FROM signoffs"), /append-only/);
  raw.close();
});
