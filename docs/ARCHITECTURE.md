# RouteProof — AWS Architecture

## Overview

```
 Technician app (PWA)     Ops dashboard          Public website ──► HubSpot (forms, CRM)
        │                       │                        │
        └──────── HTTPS ────────┴──── API Gateway / ALB ─┘
                                   │
                         RouteProof API (single EC2 / Lightsail instance)
                         · checklist rules · verification engine · audit log
             ┌──────────────┬──────┴───────┬────────────────┬──────────────────┐
             ▼              ▼              ▼                ▼                  ▼
     SQLite file       Amazon S3      Amazon Bedrock    EventBridge bus    Cognito
     (node:sqlite,     evidence +     (Converse API)    domain events      (auth, roles)
     on EBS volume)    report PDFs    classify/summary        │
          │ Litestream WAL replication ─► S3 (backups / point-in-time restore)
                                                              ├──► Lambda: report-generator ──► S3 (PDF) + reports row
                                                              ├──► Lambda: notifications ─────► SES email / SNS SMS
                                                              └──► Lambda: hubspot-sync ──────► HubSpot CRM API
```

## Components

| Concern | Service | Notes |
|---|---|---|
| Work orders, checklists, reviews, disputes | **SQLite** via Node's built-in `node:sqlite` | Schema in `server/schema.sql`, file at `data/routeproof.db` (WAL mode) on the API host's EBS volume. Evidence, reviews, sign-offs, notes, dispute events and reports are append-only (enforced by triggers); a new review or sign-off is a new row and the latest row is current. Continuous backup to S3 with Litestream. |
| Photos, documents, signatures, report PDFs | **Amazon S3** | Private bucket, SSE-KMS, block public access. Uploads via presigned PUT with `x-amz-checksum-sha256`; the SHA-256 is stored in `evidence.sha256` for duplicate detection. Optional S3 Object Lock (governance mode) for evidence retention. Reads via short-lived presigned GET. |
| Evidence classification, record summaries, recurring-issue narrative | **Amazon Bedrock** | Converse API with a multimodal model. Every call stores `model_id`, prompt version and raw response in `evidence_classifications`. |
| Report generation | **AWS Lambda** `report-generator` | The API builds report content from SQLite with the shared engine and sends it in the event; the Lambda renders HTML → PDF (headless Chromium layer) → S3. It needs no database access. |
| Notifications | **AWS Lambda** `notifications` | EventBridge-driven; SES for email, SNS for technician SMS. Customer email only for VERIFIED reports with opt-in. |
| CRM | **AWS Lambda** `hubspot-sync` | See `docs/HUBSPOT.md`. |
| Auth | Amazon Cognito | Roles: admin, dispatcher, reviewer, technician. Reviewer identity on every decision comes from the token, not a form field. |

## AI usage and guardrails

The AI layer **describes and organizes**; it never decides that work happened.

1. **Service record understanding** — input: technician-entered text + template. Prompt instructs the model to map sentences to steps and extract materials/readings/follow-ups *quoting the technician*, never adding facts. Output is shown with the caveat "as reported, not independently confirmed."
2. **Checklist completeness** — deterministic rules (`analyzeRecord`), not an LLM. Requirements come from the versioned template.
3. **Evidence classification** — model returns `{category, stage, confidence, rationale}`. Instruction: "Describe only what is visible or stated. Never state that work was completed or done correctly." Low-confidence or stage-mismatch results become *info* exceptions for the reviewer.
4. **Exception detection** — deterministic: missing steps/photos/notes/sign-off, N/A without reason, step or photo times outside the visit, capture-after-upload, sign-off before last step, byte-identical files across work orders.
5. **Report generation** — template-driven; includes only reviewer-approved evidence; status is DRAFT unless a `record_reviews` row with `decision = 'verified'` exists.
6. **Recurring issue analysis** — aggregation of exceptions by step/technician/customer/location; Bedrock writes the narrative from those counts only. Framed as documentation patterns, not performance judgments.

## Integrity model

| Field | Source | If missing |
|---|---|---|
| Check-in/out, step completion, note time, upload time, sign-off time | Server clock at the API call | Shown as "Not recorded"; flagged |
| Photo capture time | EXIF `DateTimeOriginal` read on device, labelled "device metadata" | Stored as NULL, flagged as info; never backfilled from upload time |
| Signature | Drawn on device by the signer, stored as PNG in S3 | Sign-off must be `unavailable`/`refused` with a typed reason |
| Verification | `record_reviews` row with named reviewer | Record remains "Submitted — unverified" |

Status vocabulary used everywhere: **Submitted → Checked (automated) → Evidence reviewed → Verified (by reviewer)**. Verification attests that the documentation met the template at review time; it is not a site inspection.

## Why SQLite

- Runs inside the Node process: no database server to provision, patch or pay for, and nothing to install (`node:sqlite` ships with Node 22.13+).
- Field-service record volume (thousands of jobs, tens of thousands of evidence rows per tenant) is well within a single SQLite file; file blobs live in S3, not the database.
- Triggers, CHECK constraints, foreign keys and transactions give the same integrity guarantees the evidence model needs.
- Limit: one writer host. Scale by running one API instance per tenant group (one database file each) rather than many instances sharing one file. If a shared multi-writer database is ever needed, the store is isolated in `server/store.js`.

## Demo build vs production

| | Demo build (this repo) | Production |
|---|---|---|
| Database | SQLite at `data/routeproof.db` | Same SQLite schema on the API host, replicated to S3 with Litestream |
| Evidence storage | `uploads/` on local disk (logged as "S3 simulated") | S3 (`RP_S3_BUCKET`) — adapter in `server/integrations.js` |
| AI | Rules engine in `engine.js` (logged as simulated) | Bedrock (`RP_BEDROCK_MODEL_ID`) — adapter in `server/integrations.js` |
| Lambda | In-process; logged as simulated | `RP_REPORT_LAMBDA`; handlers in `infra/lambda/` |
| HubSpot | Leads stored locally; logged as simulated | `HUBSPOT_PRIVATE_APP_TOKEN` |
| Auth | "Reviewing as" text field | Cognito JWT |

Setting the env vars switches each adapter to the real service (the AWS SDK packages must be installed: `@aws-sdk/client-s3`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-lambda`).
