# RouteProof

Field-service verification and evidence management. Technicians capture checklists, notes, photos and sign-off; RouteProof organizes the record, flags what's missing or inconsistent, and produces customer-ready reports — keeping **submitted evidence** separate from **verified completion**.

## Run it

Requires Node 22.13+ (uses the built-in `node:sqlite`). No dependencies to install.

```bash
npm start
```

Then open:

- http://localhost:4180/ — public website with the interactive demo
- http://localhost:4180/app — operations dashboard
- http://localhost:4180/tech — mobile technician app (best at phone width)

Other commands: `npm test` (engine and database tests), `npm run reset` (restore demo data), or "Reset demo data" in the dashboard sidebar.

## What's in it

| Area | Where |
|---|---|
| Verification engine: completeness, exceptions, classification, summaries, reports, recurring issues | `public/js/engine.js` (shared by browser and server) |
| API + static server (zero-dependency Node) | `server/server.js` |
| S3 / Bedrock / Lambda / HubSpot adapters (simulated unless configured) | `server/integrations.js` |
| Fictional demo dataset | `server/seed.js`, `public/js/demo-data.js` |
| Website + interactive demo | `public/index.html`, `public/js/site.js` |
| Dashboard: work orders, verification queue, assignments, directory, history, reports, disputes, recurring issues, integrations | `public/app.html`, `public/js/app.js` |
| Technician app: check-in, checklist, notes, photo upload (EXIF capture time), signature, submit | `public/tech.html`, `public/js/tech.js` |
| Database: SQLite schema and store | `server/schema.sql`, `server/store.js` |
| Lambda handlers | `infra/lambda/` |
| Architecture & AI guardrails | `docs/ARCHITECTURE.md` |
| HubSpot CRM plan | `docs/HUBSPOT.md` |

## Integrity rules (enforced in code)

- The engine never sets "verified". Only a named reviewer can, and only when no required items are missing and every file has been approved or rejected. Warnings require a written explanation.
- Every system timestamp is set by the server at the moment of the action. Clients can't supply them.
- Photo capture time comes only from the file's EXIF metadata and is labelled "device metadata". If it's absent, it stays empty and is flagged.
- Sign-off requires a drawn signature and name, or an explicit "unavailable"/"refused" with a typed reason.
- Reports include only reviewer-approved evidence and are marked DRAFT until verified. Each one says that photos are supporting evidence, not proof the work was done correctly.
- Technicians can't edit a record once it's submitted. Rejections and returns need a reason.

## Demo data and simulated integrations

Everything in the seed data is fictional: companies, people, addresses, notes, signatures and timestamps. Demo photos are generated placeholder images labelled "DEMO PLACEHOLDER". Demo records show a **Demo** badge.

AWS and HubSpot run in simulated mode and are labelled that way in the UI (Integrations page). To connect real services, install the AWS SDK packages and set:

```
RP_S3_BUCKET=...                 # evidence storage
RP_BEDROCK_MODEL_ID=...          # evidence classification
RP_REPORT_LAMBDA=...             # report-generator function name
HUBSPOT_PRIVATE_APP_TOKEN=...    # demo-request sync
```

Data is stored in SQLite at `data/routeproof.db` (created and seeded on first run). Evidence, reviews, sign-offs, notes, dispute events and reports are append-only, enforced by database triggers. You can inspect it with `sqlite3 data/routeproof.db`.
