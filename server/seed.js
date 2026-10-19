// RouteProof demonstration dataset.
// EVERYTHING in this file is fictional: companies, people, addresses, timestamps,
// notes, signatures and photographs. Demo photographs are rendered placeholders,
// not real images. Records are tagged `demo: true` and the UI labels them as such.

const TZ = '-04:00';
const at = (day, hh, mm = 0) =>
  `2026-10-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${TZ}`;

const img = (caption, tone = 'blue') =>
  `/demo-img.svg?t=${encodeURIComponent(caption)}&tone=${tone}`;

export const templates = [
  {
    id: 'tpl-pest',
    name: 'Commercial Pest Control — Quarterly Service',
    serviceType: 'pest-control',
    requiresSignoff: true,
    steps: [
      { id: 'pc1', label: 'Interior inspection of entry points', stage: 'before', requiresPhoto: true, requiresNote: false },
      { id: 'pc2', label: 'Inspect and service bait stations (record count)', stage: 'during', requiresPhoto: true, requiresNote: true },
      { id: 'pc3', label: 'Apply treatment per label (product, EPA reg. no., amount)', stage: 'during', requiresPhoto: false, requiresNote: true, noteMustMatch: 'EPA\\s*Reg', noteHint: 'the product\'s EPA registration number' },
      { id: 'pc4', label: 'Exterior perimeter treatment', stage: 'during', requiresPhoto: true, requiresNote: false },
      { id: 'pc5', label: 'Sanitation / exclusion recommendations', stage: 'after', requiresPhoto: false, requiresNote: true },
    ],
  },
  {
    id: 'tpl-clean',
    name: 'Commercial Deep Clean',
    serviceType: 'cleaning',
    requiresSignoff: true,
    steps: [
      { id: 'cl1', label: 'Pre-clean walkthrough', stage: 'before', requiresPhoto: true, requiresNote: false },
      { id: 'cl2', label: 'Restrooms cleaned and sanitized', stage: 'after', requiresPhoto: true, requiresNote: false },
      { id: 'cl3', label: 'Kitchen / breakroom cleaned', stage: 'after', requiresPhoto: true, requiresNote: false },
      { id: 'cl4', label: 'Floors vacuumed and mopped', stage: 'after', requiresPhoto: true, requiresNote: false },
      { id: 'cl5', label: 'Trash and recycling removed', stage: 'after', requiresPhoto: false, requiresNote: false },
      { id: 'cl6', label: 'Supplies restocked (list items)', stage: 'after', requiresPhoto: false, requiresNote: true },
    ],
  },
  {
    id: 'tpl-hvac',
    name: 'HVAC Preventive Maintenance',
    serviceType: 'maintenance',
    requiresSignoff: true,
    steps: [
      { id: 'hv1', label: 'Record unit model and serial number', stage: 'before', requiresPhoto: true, requiresNote: true },
      { id: 'hv2', label: 'Replace air filter', stage: 'during', requiresPhoto: true, requiresNote: false },
      { id: 'hv3', label: 'Inspect belts and coils', stage: 'during', requiresPhoto: false, requiresNote: true },
      { id: 'hv4', label: 'Check refrigerant pressures (record readings)', stage: 'during', requiresPhoto: false, requiresNote: true },
      { id: 'hv5', label: 'Test thermostat operation', stage: 'after', requiresPhoto: false, requiresNote: false },
      { id: 'hv6', label: 'Post-service condition photo', stage: 'after', requiresPhoto: true, requiresNote: false },
    ],
  },
  {
    id: 'tpl-repair',
    name: 'Plumbing Repair Visit',
    serviceType: 'repair',
    requiresSignoff: true,
    steps: [
      { id: 'rp1', label: 'Document reported issue', stage: 'before', requiresPhoto: true, requiresNote: false },
      { id: 'rp2', label: 'Diagnose and record cause', stage: 'during', requiresPhoto: false, requiresNote: true },
      { id: 'rp3', label: 'Perform repair', stage: 'after', requiresPhoto: true, requiresNote: false },
      { id: 'rp4', label: 'Leak / pressure test', stage: 'after', requiresPhoto: false, requiresNote: true },
      { id: 'rp5', label: 'Work area cleanup', stage: 'after', requiresPhoto: true, requiresNote: false },
    ],
  },
];

export const customers = [
  { id: 'cus-1', name: 'Harborview Dental Group', contact: 'Office Manager (demo contact)', email: 'ops@harborview-dental.example', segment: 'Healthcare' },
  { id: 'cus-2', name: 'Maple & Finch Bakery', contact: 'Owner (demo contact)', email: 'hello@maplefinch.example', segment: 'Food service' },
  { id: 'cus-3', name: 'Northgate Property Management', contact: 'Facilities Lead (demo contact)', email: 'facilities@northgate-pm.example', segment: 'Commercial real estate' },
  { id: 'cus-4', name: 'Ridgeline Fitness', contact: 'GM (demo contact)', email: 'gm@ridgeline-fit.example', segment: 'Fitness' },
];

export const locations = [
  { id: 'loc-1', customerId: 'cus-1', name: 'Harborview — Main Clinic', address: '120 Quay Street, Port Ellis' },
  { id: 'loc-2', customerId: 'cus-1', name: 'Harborview — Westside', address: '48 Alder Ave, Port Ellis' },
  { id: 'loc-3', customerId: 'cus-2', name: 'Maple & Finch — Production Kitchen', address: '9 Mill Lane, Port Ellis' },
  { id: 'loc-4', customerId: 'cus-3', name: 'Northgate Tower A', address: '700 Northgate Blvd, Port Ellis' },
  { id: 'loc-5', customerId: 'cus-3', name: 'Northgate Tower B', address: '702 Northgate Blvd, Port Ellis' },
  { id: 'loc-6', customerId: 'cus-4', name: 'Ridgeline Fitness — Downtown', address: '33 Summit Road, Port Ellis' },
];

export const technicians = [
  { id: 'tec-1', name: 'Dana Reyes', skills: ['pest-control'], region: 'North', phone: '555-0101' },
  { id: 'tec-2', name: 'Marcus Oyelaran', skills: ['cleaning'], region: 'Central', phone: '555-0102' },
  { id: 'tec-3', name: 'Priya Natarajan', skills: ['maintenance'], region: 'Central', phone: '555-0103' },
  { id: 'tec-4', name: 'Tomás Alvarez', skills: ['repair', 'maintenance'], region: 'South', phone: '555-0104' },
];

let evSeq = 0;
const ev = (stepId, caption, capturedAt, uploadedAt, opts = {}) => ({
  id: `ev-${++evSeq}`,
  kind: opts.kind || 'photo',
  filename: opts.filename || `${caption.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}.jpg`,
  caption,
  stepId,
  url: opts.url || img(caption, opts.tone),
  capturedAt,
  capturedAtSource: capturedAt ? 'device-metadata' : 'unavailable',
  uploadedAt,
  sha256: opts.sha || `demo-hash-${evSeq}`,
  classification: null, // filled in by the classifier at startup
  review: opts.review || { status: 'pending' },
  demo: true,
});

const done = (stepId, completedAt, note = '') => ({ stepId, status: 'done', completedAt, note });
const open = (stepId) => ({ stepId, status: 'not_done', completedAt: null, note: '' });
const approved = (day, hh, mm) => ({ status: 'approved', by: 'Jordan Kim (demo reviewer)', at: at(day, hh, mm) });

export function buildWorkOrders() {
  evSeq = 0;
  return [
    {
      id: 'wo-1041', number: 'WO-1041', customerId: 'cus-1', locationId: 'loc-1', templateId: 'tpl-pest', technicianId: 'tec-1',
      scheduledFor: at(6, 8), status: 'verified', priority: 'normal', demo: true,
      visit: { checkInAt: at(6, 8, 4), checkOutAt: at(6, 9, 12) },
      checklist: [
        done('pc1', at(6, 8, 15), 'No gaps found at rear door sweep.'),
        done('pc2', at(6, 8, 31), '12 stations serviced; 2 showed light rodent activity (stations 4 and 9).'),
        done('pc3', at(6, 8, 44), 'Applied Advion gel bait, EPA Reg. 352-652, 6 g total in breakroom cabinets.'),
        done('pc4', at(6, 8, 58), 'Perimeter granular treatment, front and rear beds.'),
        done('pc5', at(6, 9, 6), 'Recommend sealing 1/4" gap under loading door. Customer advised to store cardboard off floor.'),
      ],
      notes: [{ text: 'Front desk reported seeing droppings near supply closet last week. Inspected — consistent with station 4 activity.', recordedAt: at(6, 9, 8) }],
      evidence: [
        ev('pc1', 'Before: rear door sweep inspection', at(6, 8, 13), at(6, 8, 14), { review: approved(6, 15, 2) }),
        ev('pc2', 'Bait station 4 serviced', at(6, 8, 27), at(6, 8, 28), { review: approved(6, 15, 2) }),
        ev('pc4', 'Exterior perimeter treatment, rear beds', at(6, 8, 55), at(6, 8, 56), { review: approved(6, 15, 3) }),
      ],
      signoff: { status: 'captured', signerName: 'R. Okafor (Office Manager)', capturedAt: at(6, 9, 10), method: 'on-device signature' },
      review: { decision: 'verified', reviewer: 'Jordan Kim (demo reviewer)', decidedAt: at(6, 15, 5), comment: 'All required steps documented; sign-off on file.' },
    },
    {
      id: 'wo-1042', number: 'WO-1042', customerId: 'cus-3', locationId: 'loc-4', templateId: 'tpl-clean', technicianId: 'tec-2',
      scheduledFor: at(14, 18), status: 'submitted', priority: 'normal', demo: true,
      visit: { checkInAt: at(14, 18, 2), checkOutAt: at(14, 21, 40) },
      checklist: [
        done('cl1', at(14, 18, 10)),
        done('cl2', at(14, 19, 5)),
        done('cl3', at(14, 19, 50)),
        done('cl4', at(14, 21, 5)),
        done('cl5', at(14, 21, 20)),
        done('cl6', at(14, 21, 30), ''),
      ],
      notes: [{ text: 'Floor 3 restroom out of paper towels, restocked from janitor closet. Kitchen fridge had expired items — left in place per policy, customer should follow up.', recordedAt: at(14, 21, 35) }],
      evidence: [
        ev('cl1', 'Before: floor 3 open office', at(14, 18, 8), at(14, 18, 9)),
        ev('cl3', 'After: breakroom counters cleaned', at(14, 19, 48), at(14, 19, 49)),
        ev('cl4', 'After: lobby floor mopped', at(14, 21, 3), at(14, 21, 4)),
      ],
      signoff: { status: 'unavailable', reason: 'After-hours service; no customer representative on site.', capturedAt: at(14, 21, 38) },
      review: null,
    },
    {
      id: 'wo-1043', number: 'WO-1043', customerId: 'cus-4', locationId: 'loc-6', templateId: 'tpl-hvac', technicianId: 'tec-3',
      scheduledFor: at(15, 10), status: 'submitted', priority: 'high', demo: true,
      visit: { checkInAt: at(15, 10, 6), checkOutAt: at(15, 11, 50) },
      checklist: [
        done('hv1', at(15, 10, 15), 'Carrier 48TC, S/N 4419G2071X (demo)'),
        done('hv2', at(15, 10, 40)),
        done('hv3', at(15, 11, 2), 'Belt shows minor glazing; coils moderately dirty.'),
        done('hv4', at(15, 11, 20), ''),
        done('hv5', at(15, 11, 41)),
        open('hv6'),
      ],
      notes: [{ text: 'Recommend coil cleaning next visit. Customer reported uneven cooling in spin studio.', recordedAt: at(15, 11, 45) }],
      evidence: [
        ev('hv1', 'Unit nameplate RTU-2', at(15, 10, 14), at(15, 10, 15)),
        ev('hv2', 'New filter installed RTU-2', at(15, 10, 39), at(15, 10, 40)),
      ],
      // Sign-off recorded before the last checklist step was completed.
      signoff: { status: 'captured', signerName: 'T. Brandt (GM)', capturedAt: at(15, 11, 25), method: 'on-device signature' },
      review: null,
    },
    {
      id: 'wo-1044', number: 'WO-1044', customerId: 'cus-2', locationId: 'loc-3', templateId: 'tpl-repair', technicianId: 'tec-4',
      scheduledFor: at(16, 7), status: 'submitted', priority: 'urgent', demo: true,
      visit: { checkInAt: at(16, 7, 10), checkOutAt: at(16, 8, 35) },
      checklist: [
        done('rp1', at(16, 7, 18)),
        done('rp2', at(16, 7, 40), 'Compression fitting on dish sink supply line cracked.'),
        done('rp3', at(16, 8, 10)),
        done('rp4', at(16, 8, 20), 'Ran water 10 min at full pressure, no drips.'),
        done('rp5', at(16, 8, 30)),
      ],
      notes: [{ text: 'Replaced 1/2" compression fitting and 18" braided supply line.', recordedAt: at(16, 8, 32) }],
      evidence: [
        // Capture time is the previous day — outside the visit window.
        ev('rp1', 'Before: leak under dish sink', at(15, 16, 2), at(16, 7, 19), { tone: 'amber' }),
        // Same file hash as an approved photo on WO-1048 (different customer).
        ev('rp3', 'After: new supply line installed', at(16, 8, 9), at(16, 8, 11), { sha: 'demo-hash-shared-supplyline' }),
        ev('rp5', 'After: work area cleaned', null, at(16, 8, 31)),
      ],
      signoff: { status: 'captured', signerName: 'L. Finch (Owner)', capturedAt: at(16, 8, 33), method: 'on-device signature' },
      review: null,
    },
    {
      id: 'wo-1045', number: 'WO-1045', customerId: 'cus-1', locationId: 'loc-2', templateId: 'tpl-pest', technicianId: 'tec-1',
      scheduledFor: at(18, 9), status: 'in_progress', priority: 'normal', demo: true,
      visit: { checkInAt: at(18, 9, 3), checkOutAt: null },
      checklist: [done('pc1', at(18, 9, 12), 'Entry points sealed, no issues.'), open('pc2'), open('pc3'), open('pc4'), open('pc5')],
      notes: [],
      evidence: [ev('pc1', 'Before: front entrance threshold', at(18, 9, 10), at(18, 9, 11))],
      signoff: null,
      review: null,
    },
    {
      id: 'wo-1046', number: 'WO-1046', customerId: 'cus-3', locationId: 'loc-5', templateId: 'tpl-clean', technicianId: 'tec-2',
      scheduledFor: at(19, 18), status: 'scheduled', priority: 'normal', demo: true,
      visit: { checkInAt: null, checkOutAt: null },
      checklist: [], notes: [], evidence: [], signoff: null, review: null,
    },
    {
      id: 'wo-1047', number: 'WO-1047', customerId: 'cus-2', locationId: 'loc-3', templateId: 'tpl-pest', technicianId: 'tec-1',
      scheduledFor: at(17, 6), status: 'submitted', priority: 'normal', demo: true,
      visit: { checkInAt: at(17, 6, 1), checkOutAt: at(17, 7, 5) },
      checklist: [
        done('pc1', at(17, 6, 9)),
        done('pc2', at(17, 6, 25), '8 stations serviced, no activity.'),
        done('pc3', at(17, 6, 38), 'Crack-and-crevice: Alpine WSG, EPA Reg. 499-561, 0.5 oz in 1 gal, proofing room baseboards.'),
        done('pc4', at(17, 6, 52)),
        done('pc5', at(17, 7, 0), 'Recommend replacing worn door sweep on rear exit.'),
      ],
      notes: [{ text: 'Owner asked about fruit flies near floor drain — advised drain cleaning; no treatment applied to drain.', recordedAt: at(17, 7, 2) }],
      evidence: [
        ev('pc1', 'Before: rear exit door sweep gap', at(17, 6, 7), at(17, 6, 8)),
        ev('pc2', 'Bait station 3 inspection', at(17, 6, 22), at(17, 6, 23)),
        ev('pc4', 'Exterior perimeter, loading dock', at(17, 6, 50), at(17, 6, 51)),
        ev(null, 'Service ticket scan', null, at(17, 7, 4), { kind: 'document', filename: 'service_ticket_1047.pdf', tone: 'slate' }),
      ],
      signoff: { status: 'captured', signerName: 'L. Finch (Owner)', capturedAt: at(17, 7, 3), method: 'on-device signature' },
      review: null,
    },
    {
      id: 'wo-1048', number: 'WO-1048', customerId: 'cus-3', locationId: 'loc-4', templateId: 'tpl-repair', technicianId: 'tec-4',
      scheduledFor: at(9, 13), status: 'verified', priority: 'high', demo: true,
      visit: { checkInAt: at(9, 13, 5), checkOutAt: at(9, 14, 20) },
      checklist: [
        done('rp1', at(9, 13, 12)),
        done('rp2', at(9, 13, 30), 'Supply line to floor 2 restroom sink corroded at fitting.'),
        done('rp3', at(9, 13, 58)),
        done('rp4', at(9, 14, 5), 'Pressure held for 10 minutes, no leaks.'),
        done('rp5', at(9, 14, 12)),
      ],
      notes: [{ text: 'Replaced braided supply line and shut-off valve.', recordedAt: at(9, 14, 15) }],
      evidence: [
        ev('rp1', 'Before: corroded fitting floor 2', at(9, 13, 10), at(9, 13, 11), { review: approved(9, 16, 0) }),
        ev('rp3', 'After: new supply line installed', at(9, 13, 57), at(9, 13, 58), { sha: 'demo-hash-shared-supplyline', review: approved(9, 16, 0) }),
        ev('rp5', 'After: vanity area cleaned', at(9, 14, 11), at(9, 14, 12), { review: approved(9, 16, 1) }),
      ],
      signoff: { status: 'captured', signerName: 'S. Patel (Facilities Lead)', capturedAt: at(9, 14, 17), method: 'on-device signature' },
      review: { decision: 'verified', reviewer: 'Jordan Kim (demo reviewer)', decidedAt: at(9, 16, 4), comment: 'Complete.' },
    },
    {
      id: 'wo-1049', number: 'WO-1049', customerId: 'cus-1', locationId: 'loc-1', templateId: 'tpl-hvac', technicianId: 'tec-3',
      scheduledFor: at(8, 11), status: 'disputed', priority: 'normal', demo: true,
      visit: { checkInAt: at(8, 11, 2), checkOutAt: at(8, 12, 30) },
      checklist: [
        done('hv1', at(8, 11, 10), 'Trane Voyager, S/N 22917TQ (demo)'),
        done('hv2', at(8, 11, 31)),
        done('hv3', at(8, 11, 48), 'Belts good, coils clean.'),
        done('hv4', at(8, 12, 5), 'Suction 118 psi, discharge 312 psi, ambient 64°F.'),
        done('hv5', at(8, 12, 15)),
        done('hv6', at(8, 12, 22)),
      ],
      notes: [{ text: 'Unit operating normally at departure.', recordedAt: at(8, 12, 26) }],
      evidence: [
        ev('hv1', 'Unit nameplate RTU-1', at(8, 11, 9), at(8, 11, 10), { review: approved(8, 17, 0) }),
        ev('hv2', 'Filter installed RTU-1', at(8, 11, 30), at(8, 11, 31), { review: approved(8, 17, 0) }),
        ev('hv6', 'After: RTU-1 panel closed', at(8, 12, 21), at(8, 12, 22), { review: approved(8, 17, 1) }),
      ],
      signoff: { status: 'captured', signerName: 'R. Okafor (Office Manager)', capturedAt: at(8, 12, 28), method: 'on-device signature' },
      review: { decision: 'verified', reviewer: 'Jordan Kim (demo reviewer)', decidedAt: at(8, 17, 3), comment: 'Documentation complete at time of review.' },
    },
    {
      id: 'wo-1050', number: 'WO-1050', customerId: 'cus-4', locationId: 'loc-6', templateId: 'tpl-clean', technicianId: 'tec-2',
      scheduledFor: at(12, 21), status: 'needs_info', priority: 'normal', demo: true,
      visit: { checkInAt: at(12, 21, 0), checkOutAt: at(12, 23, 15) },
      checklist: [
        done('cl1', at(12, 21, 5)),
        done('cl2', at(12, 22, 0)),
        done('cl3', at(12, 22, 20)),
        done('cl4', at(12, 22, 55)),
        { stepId: 'cl5', status: 'na', completedAt: at(12, 23, 0), note: '' },
        done('cl6', at(12, 23, 5), 'Soap, paper towels, toilet paper.'),
      ],
      notes: [],
      evidence: [
        ev('cl1', 'Before: locker room', at(12, 21, 4), at(12, 21, 5)),
        ev('cl3', 'After: smoothie bar counter', at(12, 22, 19), at(12, 22, 20)),
        ev('cl4', 'After: studio floor', at(12, 22, 54), at(12, 22, 55)),
      ],
      signoff: { status: 'refused', reason: 'Night manager declined to sign: "not authorized".', capturedAt: at(12, 23, 12) },
      review: { decision: 'needs_info', reviewer: 'Jordan Kim (demo reviewer)', decidedAt: at(13, 9, 30), comment: 'Restroom photo missing; trash step marked N/A without reason.' },
    },
    {
      id: 'wo-1051', number: 'WO-1051', customerId: 'cus-3', locationId: 'loc-5', templateId: 'tpl-pest', technicianId: 'tec-1',
      scheduledFor: at(20, 7), status: 'scheduled', priority: 'normal', demo: true,
      visit: { checkInAt: null, checkOutAt: null },
      checklist: [], notes: [], evidence: [], signoff: null, review: null,
    },
    {
      id: 'wo-1052', number: 'WO-1052', customerId: 'cus-1', locationId: 'loc-2', templateId: 'tpl-clean', technicianId: 'tec-2',
      scheduledFor: at(16, 19), status: 'submitted', priority: 'normal', demo: true,
      visit: { checkInAt: at(16, 19, 0), checkOutAt: at(16, 20, 50) },
      checklist: [
        done('cl1', at(16, 19, 6)),
        done('cl2', at(16, 19, 40)),
        done('cl3', at(16, 20, 5)),
        done('cl4', at(16, 20, 30)),
        done('cl5', at(16, 20, 40)),
        done('cl6', at(16, 20, 45), 'Hand soap and seat covers restocked.'),
      ],
      notes: [{ text: 'Operatory 3 trash bin cracked — recommend replacement.', recordedAt: at(16, 20, 47) }],
      evidence: [
        ev('cl1', 'Before: waiting room', at(16, 19, 5), at(16, 19, 6)),
        ev('cl3', 'After: staff kitchen', at(16, 20, 4), at(16, 20, 5)),
        ev('cl4', 'After: hallway floors', at(16, 20, 29), at(16, 20, 30)),
      ],
      signoff: { status: 'captured', signerName: 'M. Duarte (Clinic Lead)', capturedAt: at(16, 20, 49), method: 'on-device signature' },
      review: null,
    },
  ];
}

export function buildDisputes() {
  return [
    {
      id: 'dsp-201', workOrderId: 'wo-1049', status: 'open', demo: true,
      raisedBy: 'Harborview Dental Group (demo)', raisedAt: at(17, 10, 15), channel: 'email',
      claim: 'Customer states the RTU-1 air filter was not replaced on Oct 8 — their own vendor found an old filter on Oct 16.',
      requestedOutcome: 'Credit for the maintenance visit.',
      timeline: [
        { at: at(17, 10, 15), by: 'System', text: 'Dispute logged from customer email (demo).' },
      ],
      resolution: null,
    },
    {
      id: 'dsp-200', workOrderId: 'wo-1048', status: 'resolved', demo: true,
      raisedBy: 'Northgate Property Management (demo)', raisedAt: at(10, 9, 0), channel: 'phone',
      claim: 'Tenant reported the floor 2 sink was still dripping the next morning.',
      requestedOutcome: 'Return visit at no charge.',
      timeline: [
        { at: at(10, 9, 0), by: 'System', text: 'Dispute logged from phone call (demo).' },
        { at: at(10, 11, 20), by: 'Jordan Kim (demo reviewer)', text: 'Record shows leak test documented by technician; photos show new line installed. Neither confirms the drip source. Scheduled return visit.' },
        { at: at(11, 14, 0), by: 'Jordan Kim (demo reviewer)', text: 'Return visit found a separate drip at the faucet cartridge, unrelated to WO-1048 repair. Customer accepted quote for cartridge replacement.' },
      ],
      resolution: { outcome: 'Resolved — separate issue identified', decidedAt: at(11, 14, 5), by: 'Jordan Kim (demo reviewer)' },
    },
  ];
}
