// Integration adapters. Each one runs in SIMULATED mode unless real credentials
// and SDKs are configured. Simulated calls are logged with `simulated: true` and
// labelled in the UI — they never pretend to have reached AWS or HubSpot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logIntegration } from './store.js';
import { classifyEvidence, summarizeRecord } from '../public/js/engine.js';

const UPLOAD_DIR = path.resolve('uploads');

export const config = {
  storage: process.env.RP_S3_BUCKET ? 's3' : 'local',
  ai: process.env.RP_BEDROCK_MODEL_ID ? 'bedrock' : 'simulated',
  lambda: process.env.RP_REPORT_LAMBDA ? 'lambda' : 'simulated',
  hubspot: process.env.HUBSPOT_PRIVATE_APP_TOKEN ? 'hubspot' : 'simulated',
};

// ---------------------------------------------------------------- Storage (S3)
export async function putObject({ workOrderId, filename, buffer, contentType }) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const key = `evidence/${workOrderId}/${Date.now()}-${safe}`;

  if (config.storage === 's3') {
    // Requires `npm i @aws-sdk/client-s3`. Objects are private; the app serves
    // them through short-lived presigned URLs.
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({});
    await s3.send(new PutObjectCommand({
      Bucket: process.env.RP_S3_BUCKET, Key: key, Body: buffer, ContentType: contentType,
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      Metadata: { 'work-order': workOrderId, sha256 },
    }));
    logIntegration('Amazon S3', 'PutObject', key, false);
    return { key, sha256, url: `/api/evidence-object?key=${encodeURIComponent(key)}` };
  }

  const dest = path.join(UPLOAD_DIR, key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
  logIntegration('Amazon S3', 'PutObject (simulated → local disk)', key);
  return { key, sha256, url: `/uploads/${key}` };
}

// ---------------------------------------------------------------- AI (Bedrock)
const CLASSIFY_PROMPT = `You classify field-service evidence files. Given the service template,
the checklist step the technician attached the file to, the caption and filename${''
} (and the image, when provided), return JSON:
{"category": string, "stage": "before"|"during"|"after"|"unknown", "confidence": 0-1, "rationale": string}.
Describe only what is visible or stated. Never state that work was completed or done correctly.`;

export async function classify(evidence, template, imageBuffer) {
  if (config.ai === 'bedrock') {
    try {
      const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({});
      const step = template.steps.find((s) => s.id === evidence.stepId);
      const content = [{ text: `${CLASSIFY_PROMPT}\n\nTemplate: ${template.name}\nStep: ${step?.label || 'none'}\nCaption: ${evidence.caption}\nFilename: ${evidence.filename}` }];
      if (imageBuffer && /jpe?g|png|webp/i.test(evidence.filename))
        content.push({ image: { format: evidence.filename.match(/png$/i) ? 'png' : evidence.filename.match(/webp$/i) ? 'webp' : 'jpeg', source: { bytes: imageBuffer } } });
      const out = await client.send(new ConverseCommand({ modelId: process.env.RP_BEDROCK_MODEL_ID, messages: [{ role: 'user', content }] }));
      const text = out.output?.message?.content?.[0]?.text || '{}';
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      logIntegration('Amazon Bedrock', 'Converse (classify evidence)', evidence.filename, false);
      return { ...parsed, stepId: evidence.stepId, serviceType: template.serviceType, source: 'bedrock', note: 'Describes what the file appears to show. Not a determination that work was done.' };
    } catch (err) {
      logIntegration('Amazon Bedrock', 'Converse failed — fell back to simulated classifier', String(err.message || err));
    }
  }
  logIntegration('Amazon Bedrock', 'Classify evidence (simulated)', evidence.filename);
  return classifyEvidence(evidence, template);
}

export async function summarize(wo, template) {
  // A Bedrock implementation would send only technician-entered text and the
  // template, with instructions to quote/condense — never to add facts.
  return summarizeRecord(wo, template);
}

// ---------------------------------------------------------------- Lambda
export async function invokeReportLambda(payload) {
  if (config.lambda === 'lambda') {
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const client = new LambdaClient({});
    await client.send(new InvokeCommand({ FunctionName: process.env.RP_REPORT_LAMBDA, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
    logIntegration('AWS Lambda', 'Invoke report-generator', payload.workOrderNumber, false);
    return { queued: true, simulated: false };
  }
  logIntegration('AWS Lambda', 'report-generator (simulated, ran in-process)', payload.workOrderNumber);
  return { queued: false, simulated: true };
}

export function notify(event, detail) {
  // Production: Lambda "notifications" consumes these events (SES email / SNS SMS).
  logIntegration('AWS Lambda', `notifications: ${event} (simulated — nothing sent)`, detail);
}

// ---------------------------------------------------------------- HubSpot
export async function hubspotDemoRequest(lead) {
  if (config.hubspot === 'hubspot') {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { email: lead.email, firstname: lead.name, company: lead.company, rp_industry: lead.industry, rp_fleet_size: lead.fleetSize, lifecyclestage: 'lead' } }),
    });
    logIntegration('HubSpot', `Create contact (HTTP ${res.status})`, lead.company, false);
    return { simulated: false, status: res.status };
  }
  logIntegration('HubSpot', 'Create contact + "Demo request" deal in Sales pipeline (simulated — nothing sent)', `${lead.company} · ${lead.industry}`);
  return { simulated: true };
}
