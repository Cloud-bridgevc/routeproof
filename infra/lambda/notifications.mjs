// AWS Lambda: notifications
// Trigger: EventBridge rules on RouteProof domain events published by the API:
//   technician_assigned · record_submitted · technician_info_requested
//   record_verified · report_ready · dispute_opened
// Sends SMS via SNS to technicians and email via SES to office staff/customers.
// Customer-facing email is only sent for VERIFIED reports and only when the
// customer has opted in (customers.report_delivery = 'email').
//
// Not deployed in the demo build; the API logs these events as
// "notifications: … (simulated — nothing sent)" on the Integrations page.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const ses = new SESv2Client({});
const sns = new SNSClient({});
const FROM = process.env.FROM_EMAIL;

const TEMPLATES = {
  technician_assigned: (d) => ({ sms: `RouteProof: ${d.number} at ${d.locationName} assigned to you for ${d.scheduledLocal}.` }),
  technician_info_requested: (d) => ({ sms: `RouteProof: ${d.number} was returned by ${d.reviewer}: "${d.comment}". Open the app to update.` }),
  record_submitted: (d) => ({ email: { to: d.opsEmail, subject: `${d.number} submitted — ${d.blockers} missing item(s)`, text: `${d.technician} submitted ${d.number}. Automated checks: ${d.blockers} required item(s) missing, ${d.warnings} warning(s). This record is not verified until reviewed.` } }),
  record_verified: (d) => ({ email: { to: d.opsEmail, subject: `${d.number} verified by ${d.reviewer}`, text: `Verification confirms documentation completeness; it is not a site inspection.` } }),
  report_ready: (d) => (d.status === 'VERIFIED' && d.customerOptIn
    ? { email: { to: d.customerEmail, subject: `Service report — ${d.number}`, text: `Your service report for ${d.locationName} is attached / available here: ${d.reportUrl}` } }
    : {}),
  dispute_opened: (d) => ({ email: { to: d.opsEmail, subject: `Dispute opened on ${d.number}`, text: d.claim } }),
};

export async function handler(event) {
  const type = event['detail-type'];
  const detail = event.detail;
  const msg = TEMPLATES[type]?.(detail);
  if (!msg) return { skipped: type };
  if (msg.sms && detail.technicianPhone)
    await sns.send(new PublishCommand({ PhoneNumber: detail.technicianPhone, Message: msg.sms }));
  if (msg.email?.to)
    await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [msg.email.to] },
      Content: { Simple: { Subject: { Data: msg.email.subject }, Body: { Text: { Data: msg.email.text } } } },
    }));
  return { sent: type };
}
