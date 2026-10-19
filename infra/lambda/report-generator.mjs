// AWS Lambda: report-generator
// Trigger: async invoke from the RouteProof API (server/integrations.js →
// invokeReportLambda). The API builds the report content from its SQLite
// database with the shared engine and sends it in the event, so this function
// needs no database access: it renders HTML, converts it to PDF and stores the
// PDF in S3.
//
// Event: { workOrderId, workOrderNumber, report }  (report = buildReport() output)
//
// Not deployed in the demo build — the API renders reports in-process and logs
// "Lambda simulated". To deploy, bundle public/js/engine.js alongside this file and:
//   npm i @aws-sdk/client-s3 @sparticuz/chromium puppeteer-core
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { renderReportHTML } from './engine.js';

const s3 = new S3Client({});

export async function handler(event) {
  const { workOrderId, report } = event;
  if (!report?.workOrder) throw new Error('Missing report content');

  const html = renderReportHTML(report);
  const pdf = await htmlToPdf(html);

  // Status is part of the key so a DRAFT can never overwrite a VERIFIED copy.
  const status = report.verification ? 'verified' : 'draft';
  const key = `reports/${workOrderId}/${Date.now()}-${status}.pdf`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.REPORT_BUCKET, Key: key, Body: pdf, ContentType: 'application/pdf',
    Metadata: { 'work-order': report.workOrder, 'report-status': status, demo: String(!!report.demo) },
  }));
  // The notifications function picks up the S3 event / EventBridge "report_ready"
  // and decides whether the customer is emailed (VERIFIED + opt-in only).
  return { key, status: report.reportStatus };
}

async function htmlToPdf(html) {
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } });
  } finally { await browser.close(); }
}
