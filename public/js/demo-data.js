// Fictional scenario for the public website demonstration.
// Times are generated relative to the visitor's clock so that anything the
// visitor adds during the demo is stamped with the real current time and lands
// inside the (simulated) visit window. Nothing here describes a real job.

export const demoTemplate = {
  id: 'tpl-demo-pest',
  name: 'Restaurant Pest Control — Monthly Service',
  serviceType: 'pest-control',
  requiresSignoff: true,
  steps: [
    { id: 'd1', label: 'Inspect entry points and door sweeps', stage: 'before', requiresPhoto: true, requiresNote: false },
    { id: 'd2', label: 'Service bait stations (record count and activity)', stage: 'during', requiresPhoto: true, requiresNote: true },
    { id: 'd3', label: 'Interior treatment (product, EPA reg. no., amount)', stage: 'during', requiresPhoto: false, requiresNote: true, noteMustMatch: 'EPA\\s*Reg', noteHint: 'the product\'s EPA registration number' },
    { id: 'd4', label: 'Exterior perimeter treatment', stage: 'during', requiresPhoto: true, requiresNote: false },
    { id: 'd5', label: 'Sanitation and exclusion recommendations', stage: 'after', requiresPhoto: false, requiresNote: true },
  ],
};

export const demoPeople = {
  technician: { name: 'Alex Moreno (fictional technician)' },
  customer: { name: 'Bluebird Café (fictional customer)' },
  location: { name: 'Bluebird Café — Riverside', address: '14 Canal Row, Port Ellis (fictional)' },
};

export const rawNotes = `checked all doors, back door sweep has a gap maybe 1/4in. 10 stations serviced, #3 and #7 had chewed bait - replaced both. gel bait under dish pit and behind the line, didnt write product down yet. did the perimeter spray around dumpster pad + front planters. tell mgr to keep the back door closed during deliveries and fix that sweep.`;

const minsAgo = (base, m) => new Date(base - m * 60000).toISOString();

export function buildDemoWorkOrder(base = Date.now()) {
  return {
    id: 'wo-demo', number: 'WO-DEMO-7', demo: true, status: 'in_progress',
    templateId: demoTemplate.id,
    visit: { checkInAt: minsAgo(base, 68), checkOutAt: null },
    checklist: [
      { stepId: 'd1', status: 'done', completedAt: minsAgo(base, 61), note: '' },
      { stepId: 'd2', status: 'done', completedAt: minsAgo(base, 44), note: '' },
      { stepId: 'd3', status: 'done', completedAt: minsAgo(base, 30), note: '' },
      { stepId: 'd4', status: 'done', completedAt: minsAgo(base, 16), note: '' },
      { stepId: 'd5', status: 'not_done', completedAt: null, note: '' },
    ],
    notes: [{ text: rawNotes, recordedAt: minsAgo(base, 9) }],
    evidence: [
      { id: 'dev-1', kind: 'photo', filename: 'IMG_4471.jpg', caption: 'back door sweep gap', stepId: null, url: '/demo-img.svg?t=Back%20door%20sweep%20gap&tone=amber', capturedAt: minsAgo(base, 62), capturedAtSource: 'device-metadata', uploadedAt: minsAgo(base, 8), sha256: 'demo-a', review: { status: 'pending' } },
      { id: 'dev-2', kind: 'photo', filename: 'IMG_4475.jpg', caption: 'dumpster pad perimeter', stepId: null, url: '/demo-img.svg?t=Dumpster%20pad%20perimeter&tone=blue', capturedAt: minsAgo(base, 17), capturedAtSource: 'device-metadata', uploadedAt: minsAgo(base, 8), sha256: 'demo-b', review: { status: 'pending' } },
      { id: 'dev-3', kind: 'photo', filename: 'screenshot_0921.png', caption: 'kitchen', stepId: null, url: '/demo-img.svg?t=Kitchen%20(screenshot%2C%20no%20metadata)&tone=slate', capturedAt: null, capturedAtSource: 'unavailable', uploadedAt: minsAgo(base, 8), sha256: 'demo-c', review: { status: 'pending' } },
    ],
    signoff: null,
    review: null,
  };
}

// Keyword hints the simulated "record understanding" step uses to place free-text
// fragments and untagged photos onto checklist steps.
export const stepHints = {
  d1: /door|sweep|entry|gap|threshold/i,
  d2: /station|bait(?! under)|chewed|rodent/i,
  d3: /gel|interior|dish pit|behind the line|product|epa/i,
  d4: /perimeter|dumpster|planter|exterior/i,
  d5: /tell mgr|recommend|keep the|fix that|should/i,
};
