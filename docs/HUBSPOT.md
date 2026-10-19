# RouteProof — HubSpot CRM Plan

> Status: **planned / simulated.** In the demo build the website form saves leads locally and logs a simulated HubSpot call on the Integrations page. Nothing is sent to HubSpot unless `HUBSPOT_PRIVATE_APP_TOKEN` is set.

## Objects and custom properties

**Contact** (person requesting a demo or using the product)
- `rp_industry` — cleaning · pest-control · maintenance · repair · other
- `rp_fleet_size` — 1–10 · 11–50 · 51–200 · 200+
- `rp_role` — owner · ops manager · field supervisor · technician · other
- `rp_demo_source` — website form · interactive demo completed · referral · event

**Company** (service business = RouteProof customer account)
- `rp_org_id` — RouteProof organization UUID (written back once provisioned)
- `rp_plan` — trial · starter · growth · enterprise
- `rp_active_technicians`, `rp_work_orders_30d`, `rp_verification_rate_30d` — synced nightly from the RouteProof database
- `rp_onboarding_stage` — mirrors onboarding pipeline stage

**Deal** — one per sales opportunity; **Ticket** — onboarding tasks and support.

## Pipelines

### 1. Sales pipeline — "RouteProof New Business"
| Stage | Entry criteria | Automation |
|---|---|---|
| Demo requested | Website form submitted | Create contact + company (domain match) + deal; assign owner by `rp_industry` round-robin; send confirmation email with scheduling link |
| Demo scheduled | Meeting booked | Reminder sequence; share interactive-demo link |
| Demo completed | Meeting outcome = completed | Task: send recap with industry template examples |
| Trial / pilot | Trial workspace provisioned | `hubspot-sync` Lambda writes `rp_org_id`; enroll in trial nurture |
| Proposal | Quote sent | — |
| Closed won | Contract signed | Create onboarding deal in pipeline 2; set `rp_plan` |
| Closed lost | Lost reason required | 90-day re-engagement list |

### 2. Customer onboarding pipeline — "RouteProof Onboarding"
| Stage | Exit criteria (from product data) |
|---|---|
| Kickoff | Kickoff meeting held |
| Templates configured | ≥1 service template published |
| Directory imported | Customers & locations imported |
| Technicians invited | ≥80% of licensed technicians logged in |
| First verified job | First `record_reviews.decision = 'verified'` |
| Live | 20 verified jobs in 14 days |

The `hubspot-sync` Lambda listens to EventBridge (`template_published`, `technician_activated`, `record_verified`) and advances the onboarding deal stage automatically.

## Workflows

1. **Inbound demo request** (trigger: form submission) → set lifecycle = Lead → create deal in Sales pipeline → rotate owner → internal Slack/email notification → confirmation email.
2. **Interactive demo engagement** (trigger: custom behavioral event `rp_demo_completed` sent from the website when a visitor reaches step 6) → bump lead score; if no form submitted in 2 days, enroll in a 3-email nurture by industry.
3. **Trial health** (trigger: company property changes, nightly) → if `rp_work_orders_30d` = 0 after 7 days → CSM task; if verification rate < 50% → share "reducing missing evidence" guide.
4. **Closed won → onboarding** → create onboarding deal, kickoff ticket, assign CSM.
5. **Renewal risk** (trigger: open disputes > N or verification rate drop > 20%) → CSM task. Uses aggregate counts only — no job-level customer data is copied into HubSpot.

## Data boundaries
- HubSpot receives account-level and contact-level data only. Work-order details, photos, signatures and end-customer records stay in RouteProof/AWS.
- Sync is one-way (RouteProof → HubSpot) for product metrics; HubSpot → RouteProof only for account provisioning (company name, plan, owner).
- Demo/fictional records (`is_demo = true`) are never synced.

## API calls (production)
- `POST /crm/v3/objects/contacts` (or `/crm/v3/objects/contacts/batch/upsert` by email)
- `POST /crm/v3/objects/deals` + association to contact/company
- `PATCH /crm/v3/objects/companies/{id}` for nightly metrics
- `POST /events/v3/send` for `rp_demo_completed`
