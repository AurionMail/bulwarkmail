/**
 * Mail in Nora's work account. One busy week around the Beacon launch: the
 * team, a designer's invoice, a trip to a conference, receipts, newsletters,
 * and the usual noise. See people.ts for who everyone is.
 *
 * Dates float with the clock: `ago()` for today, `at(daysAgo, h, m)` for
 * earlier days. Body text never names a weekday directly; it uses dayName().
 */
import type { Email } from '@/lib/jmap/types';
import { ago, at, authFail, authPass, dayLabel, dayName, listHeaders, mail, mid } from './mail';
import { attachment } from './assets';
import { MB } from './mailboxes';
import {
  addr, NORA, NORA_ALIAS, ALICE, BOB, PRIYA, AHMED, JAMES, MICHAEL, RACHEL, WEI, MARIA, LISA,
  SARAH, OLIVIA, JENNIFER, KENJI, TOMAS, WORK_DOMAIN,
} from './people';

const me = addr(NORA);
const alice = addr(ALICE);
const bob = addr(BOB);
const priya = addr(PRIYA);
const ahmed = addr(AHMED);
const lisa = addr(LISA);
const michael = addr(MICHAEL);
const beaconTeam = [me, alice, bob, priya, ahmed, lisa];

const company = authPass(WORK_DOMAIN);

/** Blob id of the go/no-go invitation; the client serves the ICS and parses it. */
export const GONOGO_INVITE_BLOB = 'demo-blob-invite-gonogo';
export const GONOGO_UID = 'beacon-gonogo-2026@meridianlabs.example';

export function createDemoEmails(): Email[] {
  return [
    // ══ Inbox ═══════════════════════════════════════════════════

    // A verification code, 12 minutes old: the list shows it as a chip.
    mail({
      id: 'demo-email-github-code', mailbox: MB.inbox, date: ago(0, 12),
      from: { name: 'GitHub', email: 'noreply@github.com' },
      subject: '482913 is your GitHub authentication code',
      text: 'Here is your GitHub authentication code: 482913\n\nThis code expires in 10 minutes. If you did not try to sign in, change your password now.\n\nThanks,\nThe GitHub Team',
      headers: authPass('github.com'),
    }),

    // Bob: short, unread, a reply in the rollback thread (3 messages).
    mail({
      id: 'demo-email-rollback-3', thread: 'demo-thread-rollback', mailbox: MB.inbox, date: ago(0, 38),
      from: bob, to: [me], cc: [alice],
      subject: 'Re: Rollback plan for the Beacon launch',
      text: `+1 on the draft, two comments:\n\n1. Step 3 (drain the queue) should say who watches the dashboard while it drains. I'd put Ahmed's name there.\n2. The signing-key question at the end: I asked the auditor, we keep rotating during a rollback. Nothing to change.\n\nI'll sign off once those are in. Nice work, it's half the length I feared.\n\nBob`,
      keywords: ['$label:beacon'],
      headers: company,
      inReplyTo: [mid('demo-email-rollback-2')], references: [mid('demo-email-rollback-1'), mid('demo-email-rollback-2')],
    }),

    // Alice opened the thread, mentioning Nora and Bob with @ links. The
    // viewer turns those into contact chips.
    mail({
      id: 'demo-email-rollback-1', thread: 'demo-thread-rollback', mailbox: MB.inbox, date: at(1, 10, 2),
      from: alice, to: [me, bob], cc: [ahmed],
      subject: 'Rollback plan for the Beacon launch',
      text: `Hi both,\n\nMichael wants a written rollback plan before the go/no-go, one page, no slides. @Nora can you own it? You know the tenant router best. @Bob please review for anything the auditor would flag.\n\nWhat it needs: when we roll back (numbers, not feelings), the steps, who does what, and what customers see. Ahmed has the dashboards ready if you need numbers.\n\nEnd of ${dayName(1)} would be ideal so it can go out with the agenda.\n\nThanks,\nAlice`,
      html: `<p>Hi both,</p><p>Michael wants a written rollback plan before the go/no-go, one page, no slides. <a href="mailto:${NORA.email}">@Nora</a> can you own it? You know the tenant router best. <a href="mailto:${BOB.email}">@Bob</a> please review for anything the auditor would flag.</p><p>What it needs: when we roll back (numbers, not feelings), the steps, who does what, and what customers see. Ahmed has the dashboards ready if you need numbers.</p><p>End of ${dayName(1)} would be ideal so it can go out with the agenda.</p><p>Thanks,<br>Alice</p>`,
      keywords: ['$seen', '$label:beacon'],
      headers: company,
    }),

    // The go/no-go invitation. The .ics is served by the client; the banner
    // offers Accept / Tentative / Decline.
    mail({
      id: 'demo-email-gonogo-invite', mailbox: MB.inbox, date: at(1, 9, 48),
      from: alice, to: beaconTeam, cc: [michael],
      subject: `Invitation: Beacon go / no-go review, ${dayName(1)} 14:00`,
      text: `You are invited to "Beacon go / no-go review".\n\nWhen: ${dayName(1)}, ${dayLabel(1)}, 14:00 to 15:00 (Europe/Berlin)\nWhere: Room Spree, 4th floor, and Zoom\n\nAgenda:\n1. Soak test results (Ahmed)\n2. Rollback plan (Nora)\n3. Open bugs, BEA-412 in particular (Priya)\n4. Decision\n\nPlease respond so I know who is in the room and who dials in.`,
      attachments: [{ partId: 'ics-gonogo', blobId: GONOGO_INVITE_BLOB, size: 1480, name: 'invite.ics', type: 'text/calendar; method=REQUEST' }],
      keywords: ['$label:beacon'],
      headers: company,
    }),

    mail({
      id: 'demo-email-coffee', mailbox: MB.inbox, date: ago(1, 2),
      from: bob,
      subject: 'Coffee before the go/no-go?',
      text: `Kranzler at 13:15 ${dayName(1)}? I want to walk through the queue-drain step once more without six people watching.\n\nb`,
      headers: company,
    }),

    mail({
      id: 'demo-email-linear', mailbox: MB.inbox, date: ago(2, 3),
      from: { name: 'Linear', email: 'notifications@linear.app' },
      subject: 'BEA-412 was assigned to you - Webhook retries double delivery volume during a partial outage',
      text: 'Priya Sharma assigned BEA-412 to you.\n\nBEA-412 · Webhook retries double delivery volume during a partial outage\nPriority: High · Project: Beacon · Cycle 41\n\nWhen eu-2 is unreachable for more than 30 s, deliveries that already succeeded on eu-1 are retried from eu-2 once it is back. Customers see every webhook twice. The per-tenant budget caps it at 2x, which is the documented worst case, but the dedup key is not honoured across regions.\n\nOpen in Linear: https://linear.app/meridian/issue/BEA-412',
      html: '<table style="font-family:-apple-system,sans-serif;max-width:560px"><tr><td><div style="font-size:11px;color:#888;letter-spacing:0.08em;text-transform:uppercase">Linear · BEA-412</div><div style="font-size:18px;font-weight:600;margin-top:6px">Webhook retries double delivery volume during a partial outage</div><div style="margin-top:8px;color:#666"><strong>Priya Sharma</strong> assigned this issue to you · Priority <span style="color:#dc2626">High</span> · Cycle 41</div></td></tr><tr><td style="padding-top:16px;color:#444">When eu-2 is unreachable for more than 30 s, deliveries that already succeeded on eu-1 are retried from eu-2 once it is back. Customers see every webhook twice. The per-tenant budget caps it at 2x, which is the documented worst case, but the dedup key is not honoured across regions.</td></tr><tr><td style="padding-top:16px"><a href="https://linear.app/meridian/issue/BEA-412" style="background:#5e6ad2;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px;font-size:13px">Open in Linear</a></td></tr></table>',
      keywords: ['$label:beacon'],
      headers: authPass('linear.app'),
    }),

    mail({
      id: 'demo-email-github-pr', mailbox: MB.inbox, date: ago(2, 50),
      from: { name: 'Lisa Tanaka (via GitHub)', email: 'notifications@github.com' },
      replyTo: [{ name: 'meridianlabs/beacon', email: 'reply+AAZK3@reply.github.com' }],
      subject: '[meridianlabs/beacon] Signed webhook deliveries: rotate keys without a gap (#1284)',
      text: '@nora-lindqvist requested your review on this pull request.\n\nKeeps the previous signing key valid for 48 h after a rotation and adds the key id to the X-Beacon-Signature header, so receivers can verify during the overlap. Closes BEA-398.\n\n7 files changed, +412 -58.\n\nView it on GitHub:\nhttps://github.com/meridianlabs/beacon/pull/1284',
      html: '<table style="font-family:-apple-system,sans-serif"><tr><td><strong>@lisa-tanaka</strong> requested your review on this pull request.</td></tr><tr><td style="padding-top:12px">Keeps the previous signing key valid for 48 h after a rotation and adds the key id to the <code>X-Beacon-Signature</code> header, so receivers can verify during the overlap. Closes BEA-398.</td></tr><tr><td style="padding-top:12px;color:#666">7 files changed, <span style="color:#16a34a">+412</span> <span style="color:#dc2626">−58</span></td></tr><tr><td style="padding-top:16px"><a href="https://github.com/meridianlabs/beacon/pull/1284" style="background:#1f2328;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px">View on GitHub</a></td></tr></table>',
      keywords: ['$label:beacon'],
      headers: { ...authPass('github.com'), 'List-Id': 'meridianlabs/beacon <beacon.meridianlabs.github.com>' },
    }),

    mail({
      id: 'demo-email-datadog', mailbox: MB.inbox, date: at(1, 3, 12),
      from: { name: 'Datadog', email: 'alert@dtdg.co' },
      subject: '[Recovered] beacon-eu-2 p95 delivery latency above 400 ms',
      text: 'Monitor: beacon-eu-2 p95 delivery latency\nStatus: Recovered after 4 minutes\n\nPeak: 612 ms at 03:07, back under 200 ms at 03:11. The alert fired during the nightly key rotation; the overlap window in #1284 should remove the spike.\n\nNotified: @nora, @ahmed',
      keywords: ['$seen', '$label:beacon'],
      headers: authPass('dtdg.co'),
    }),

    // Sarah's invoice and prototype, the message the docs open in the inbox shot.
    mail({
      id: 'demo-email-sarah-invoice', mailbox: MB.inbox, date: at(1, 16, 5),
      from: addr(SARAH),
      subject: 'Invoice 2026-089 and landing-page prototype v3',
      text: `Hi Nora,\n\nAttached are the invoice for this month and a screenshot of the latest prototype. I went with option B for the hero (the asymmetric grid) since you said the symmetrical version felt too flat on our last call.\n\nIf the line items look off, ping me. I backed out the pre-payment for next month as agreed.\n\nBest,\nSarah`,
      attachments: [attachment('demo-blob-invoice-designco'), attachment('demo-blob-prototype')],
      keywords: ['$label:work', '$label:finance'],
      headers: authPass('designco.example'),
    }),

    mail({
      id: 'demo-email-lisa-longpoll', mailbox: MB.inbox, date: at(1, 17, 30),
      from: lisa, to: [me], cc: [bob],
      subject: 'Long-poll reconnect test: one weird thing',
      text: `The staging tenant reconnected fine at cutover, once, as planned. But three clients reconnected twice, about 90 s apart. Not harmful, they just see one empty response.\n\nI think it's the load balancer's idle timeout racing the first reconnect. I can extend the timeout on the LB or teach the client to back off. Preference? I'd rather not touch the client this close to launch.\n\nLisa`,
      keywords: ['$label:beacon'],
      headers: company,
    }),

    // Ahmed, with the dashboard screenshot and the numbers.
    mail({
      id: 'demo-email-soak', mailbox: MB.inbox, date: at(1, 18, 42),
      from: ahmed, to: beaconTeam,
      subject: 'Soak test passed: 48 h at 3x peak',
      text: 'Done. 48 hours at three times peak traffic on eu-1 and eu-2, no retry-budget breach, no manual intervention.\n\nDeliveries/s: 42,380 peak\np95 delivery latency: 184 ms\nErrors: 0.02%\nRetry budget used: 11% (worst tenant)\n\nDashboard screenshot and the hourly numbers attached. The dip around hour 31 is the key rotation, see BEA-398.\n\nI\'d call it a pass. Priya wants one more night at 1x on the canary tenants, which I agree with.\n\nAhmed',
      attachments: [attachment('demo-blob-soak-dashboard'), attachment('demo-blob-soak-metrics')],
      keywords: ['$seen', '$flagged', '$label:beacon'],
      headers: company,
    }),

    mail({
      id: 'demo-email-rachel-quote', mailbox: MB.inbox, date: at(1, 13, 20),
      from: addr(RACHEL),
      subject: 'Launch announcement draft: need a quote from you',
      text: `Hi Nora,\n\nThe blog post is drafted (link in Notion). I need one quote from engineering, two sentences, why Beacon matters to someone running webhooks today. Not "we are excited".\n\nCan I have it by ${dayName(3)}? Rachel`,
      keywords: ['$label:work', '$label:follow-up'],
      headers: company,
    }),

    mail({
      id: 'demo-email-vercel', mailbox: MB.inbox, date: at(1, 22, 15),
      from: { name: 'Vercel', email: 'notifications@vercel.com' },
      subject: 'Deployment failed: meridianlabs-website (main)',
      text: 'Your deployment of meridianlabs-website failed.\n\nBranch: main\nCommit: 7c21f3e "hero: switch to option B grid"\nError: Image optimisation failed for /hero/prototype-v3.png (file too large)\n\nView the build logs: https://vercel.com/meridianlabs/website/deployments/dpl_9x2',
      keywords: ['$label:work'],
      headers: authPass('vercel.com'),
    }),

    mail({
      id: 'demo-email-notion', mailbox: MB.inbox, date: at(1, 10, 5),
      from: { name: 'Olivia Bennett (via Notion)', email: 'notify@mail.notion.so' },
      subject: 'Olivia shared "Beacon onboarding flow, v2" with you',
      text: 'Olivia Bennett shared a page with you in the Northwind workspace.\n\n"Beacon onboarding flow, v2"\n\nOpen in Notion: https://notion.so/northwind/beacon-onboarding-v2',
      keywords: ['$seen', '$label:work'],
      headers: authPass('mail.notion.so'),
    }),

    mail({
      id: 'demo-email-techdigest', mailbox: MB.inbox, date: at(1, 6, 30),
      from: { name: 'TechDigest Weekly', email: 'newsletter@techdigest.example' },
      subject: 'Issue #231: RFC 9844, the second WebAssembly draft, and a quiet announcement from Mozilla',
      text: 'TechDigest #231\n\n- THE WEEK IN STANDARDS -\n\n1. RFC 9844: per-message TLS extensions are now official. The implications for SMTP delivery reports are surprisingly large.\n\n2. WebAssembly 2.0 (second public draft). Tail calls are in. SIMD is in. The component model is almost in but punted to a separate spec.\n\n3. Mozilla quietly shipped a privacy-preserving telemetry channel. No, it does not replace ad tracking. Yes, it is a real cryptographic system.\n\n- TOOLS -\n\n- Datasette 1.0 is out. Ten years from the first commit.\n- Fly.io published their object store, written in Go.\n\n- ESSAYS -\n\n* "Postgres is enough": a long-form rebuttal to microservices by default.\n\nManage your subscription at techdigest.example/manage.',
      html: '<div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif;line-height:1.5"><div style="border-bottom:2px solid #111;padding-bottom:16px"><div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#888">TechDigest · Issue #231</div><h1 style="font-size:22px;margin:4px 0 0">RFC 9844, the second WebAssembly draft, and a quiet announcement from Mozilla</h1></div><h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-top:24px">The week in standards</h2><p><strong>1.</strong> RFC 9844: per-message TLS extensions are now official. The implications for SMTP delivery reports are surprisingly large.</p><p><strong>2.</strong> WebAssembly 2.0 (second public draft). Tail calls are in. SIMD is in. The component model is <em>almost</em> in but punted to a separate spec.</p><p><strong>3.</strong> Mozilla quietly shipped a privacy-preserving telemetry channel. No, it does not replace ad tracking. Yes, it is a real cryptographic system.</p><h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-top:24px">Tools</h2><ul><li>Datasette 1.0 is out. Ten years from the first commit.</li><li>Fly.io published their object store, written in Go.</li></ul><h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-top:24px">Essays</h2><p>"Postgres is enough": a long-form rebuttal to microservices by default.</p><div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888">Manage your subscription at <a href="https://techdigest.example/manage" style="color:#888">techdigest.example/manage</a></div></div>',
      keywords: ['$seen'],
      headers: { ...authPass('techdigest.example'), ...listHeaders('TechDigest Weekly', 'techdigest.example') },
    }),

    // Michael asks for a read receipt; the viewer offers to send one.
    mail({
      id: 'demo-email-launch-plan', mailbox: MB.inbox, date: at(2, 9, 12),
      from: michael, to: beaconTeam, cc: [addr(JAMES), addr(RACHEL)],
      subject: 'Beacon launch plan v3 (please read before the go/no-go)',
      text: `Team,\n\nv3 of the launch plan is attached. Changes from v2: the canary runs 24 h instead of 12, the rollback runbook is a gate (Nora), and GA moves to ${dayLabel(8)} so the blog post and the changelog land on the same day.\n\nPlease read it before the review. If you disagree with a date, say so in the thread, not in the meeting.\n\nMichael`,
      attachments: [attachment('demo-blob-launch-plan')],
      keywords: ['$seen', '$label:beacon'],
      headers: { ...company, 'Disposition-Notification-To': `Michael Torres <${MICHAEL.email}>` },
    }),

    // Priya and Nora, a thread that spans Inbox and Sent.
    mail({
      id: 'demo-email-canary-3', thread: 'demo-thread-canary', mailbox: MB.inbox, date: at(1, 8, 55),
      from: priya, to: [me], cc: [ahmed],
      subject: 'Re: Canary length: 12 h or 24 h?',
      text: 'Agreed, 24 h and we pick the five tenants together on the day. I\'ll add the overnight check to the QA plan.\n\nOne more: I want BEA-412 fixed or explicitly accepted before the canary, not during. Can you raise it at the review?\n\nPriya',
      keywords: ['$seen', '$label:beacon'],
      headers: company,
      inReplyTo: [mid('demo-email-canary-2')], references: [mid('demo-email-canary-1'), mid('demo-email-canary-2')],
    }),
    mail({
      id: 'demo-email-canary-1', thread: 'demo-thread-canary', mailbox: MB.inbox, date: at(2, 14, 30),
      from: priya, to: [me], cc: [ahmed],
      subject: 'Canary length: 12 h or 24 h?',
      text: 'The plan says 12 h for the canary. That gives us one business-hours window and no night. Most of the retry weirdness we saw in the soak was at night, when the batch customers run.\n\nI\'d like 24 h. It costs one day on the schedule. Thoughts before I put it to Michael?\n\nPriya',
      keywords: ['$seen', '$label:beacon'],
      headers: company,
    }),

    mail({
      id: 'demo-email-docusign', mailbox: MB.inbox, date: at(2, 11, 25),
      from: { name: 'Michael Torres via DocuSign', email: 'dse@docusign.net' },
      subject: 'Please review and sign: Lumen Logistics service agreement',
      text: 'Michael Torres sent you a document to review and sign.\n\nLumen Logistics service agreement (Business plan, Beacon add-on)\n\nReview document: https://app.docusign.com/signing/9f3a2c\n\nThis is a demo of a signing request; the link does not go anywhere.',
      keywords: ['$label:work', '$label:follow-up'],
      headers: authPass('docusign.net'),
    }),

    mail({
      id: 'demo-email-tomas-po', mailbox: MB.inbox, date: at(4, 9, 50),
      from: addr(TOMAS), to: [me], cc: [michael],
      subject: 'Re: Beacon add-on for Lumen Logistics',
      text: 'Hi Nora,\n\nThank you for the walkthrough last week. Finance approved: the purchase order is attached, Business plan plus the Beacon add-on for fifty tenants. We would like to start on the canary if you will have us; our Lisbon team is used to being first.\n\nTomás\n\nTomás Ferreira · Head of Operations · Lumen Logistics S.A.',
      attachments: [attachment('demo-blob-po-lumen')],
      keywords: ['$seen', '$label:work', '$label:finance'],
      headers: authPass('lumenlogistics.example'),
    }),

    mail({
      id: 'demo-email-kenji', mailbox: MB.inbox, date: at(2, 16, 40),
      from: addr(KENJI),
      subject: 'Speaker logistics: your slot, the AV check and the dinner',
      text: `Dear Nora,\n\nThank you again for speaking at Infra Summit. The details:\n\nYour talk: "Rolling back without rolling over", ${dayName(11)} 11:30, Auditorium 2, 30 min plus 10 for questions.\nAV check: ${dayName(11)} 08:45 at the auditorium. Bring your own adapter if you need USB-C to HDMI, though we have a few.\nSpeakers' dinner: ${dayName(10)} 20:00 at Cervejaria Ramiro, five minutes from the venue.\n\nYour ticket is attached; it also covers the workshop day.\n\nSee you in Lisbon,\nKenji\n\nKenji Watanabe · Programme chair, Infra Summit`,
      attachments: [attachment('demo-blob-summit-ticket')],
      keywords: ['$seen', '$label:travel'],
      headers: authPass('infrasummit.example'),
    }),

    mail({
      id: 'demo-email-james', mailbox: MB.inbox, date: at(2, 19, 5),
      from: addr(JAMES),
      subject: 'Re: Board update',
      text: 'Nora, this was the clearest engineering update the board has had. Two questions came back, both about the migration tooling for long-poll customers, which tells me the rest landed. Thank you.\n\nJ',
      keywords: ['$seen', '$label:work'],
      headers: company,
      inReplyTo: [mid('demo-email-sent-board')], references: [mid('demo-email-sent-board')],
    }),

    mail({
      id: 'demo-email-sentry', mailbox: MB.inbox, date: at(2, 22, 40),
      from: { name: 'Sentry', email: 'noreply@md.getsentry.com' },
      subject: '[beacon-api] New issue: TypeError in WebhookSigner.sign (key id undefined)',
      text: 'A new issue was seen in beacon-api (production).\n\nTypeError: Cannot read properties of undefined (reading \'id\')\n  at WebhookSigner.sign (signer.ts:84)\n  at deliver (delivery.ts:211)\n\n3 events · 1 user · first seen 22:38\n\nView on Sentry: https://sentry.io/organizations/meridian/issues/51822',
      keywords: ['$seen', '$label:beacon'],
      headers: authPass('md.getsentry.com'),
    }),

    mail({
      id: 'demo-email-lufthansa', mailbox: MB.inbox, date: at(3, 12, 15),
      from: { name: 'Lufthansa', email: 'noreply@lufthansa.com' },
      subject: 'Your booking E7KQ2R: Berlin to Lisbon',
      text: `Thank you for your booking.\n\nLH 1796 · ${dayLabel(9)} · Berlin (BER) 08:35 to Lisbon (LIS) 11:20\nLH 1797 · ${dayLabel(12)} · Lisbon (LIS) 12:10 to Berlin (BER) 16:50\n\nPassenger: Nora Lindqvist · Seat 14A / 11F · Economy\nBooking reference: E7KQ2R\n\nYour e-ticket is attached. Online check-in opens 23 hours before departure.`,
      attachments: [attachment('demo-blob-boarding-pass', { name: 'E-ticket-E7KQ2R.pdf' })],
      keywords: ['$seen', '$label:travel'],
      headers: authPass('lufthansa.com'),
    }),

    // Booking.com: an HTML mail with a remote image, so the viewer asks before loading it.
    mail({
      id: 'demo-email-booking', mailbox: MB.inbox, date: at(3, 12, 40),
      from: { name: 'Booking.com', email: 'noreply@booking.com' },
      subject: 'Confirmation 4892.771.433: Hotel Tejo Vista, Lisbon',
      text: `Your booking is confirmed.\n\nHotel Tejo Vista, Rua do Alecrim 48, Lisbon\nCheck-in: ${dayLabel(9)}, from 15:00\nCheck-out: ${dayLabel(12)}, until 11:00\n\nSuperior double, river view, breakfast included\nTotal: EUR 486 (paid)\n\nConfirmation number: 4892.771.433 · PIN 2047\n\nYour voucher is attached. Show it at reception.`,
      html: `<div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif"><img src="https://cf.bstatic.com/static/img/demo/tejo-vista-hero.jpg" alt="Hotel Tejo Vista" width="560" height="280" style="display:block;width:100%;height:auto;border-radius:8px"><h1 style="font-size:20px;margin:20px 0 4px">Your booking is confirmed</h1><p style="color:#555;margin:0 0 20px">Hotel Tejo Vista, Rua do Alecrim 48, Lisbon</p><table style="width:100%;border-top:1px solid #eee"><tr><td style="padding:10px 0;color:#666">Check-in</td><td style="padding:10px 0;text-align:right">${dayLabel(9)}, from 15:00</td></tr><tr><td style="padding:10px 0;color:#666;border-top:1px solid #f4f4f4">Check-out</td><td style="padding:10px 0;text-align:right;border-top:1px solid #f4f4f4">${dayLabel(12)}, until 11:00</td></tr><tr><td style="padding:10px 0;color:#666;border-top:1px solid #f4f4f4">Room</td><td style="padding:10px 0;text-align:right;border-top:1px solid #f4f4f4">Superior double, river view</td></tr><tr><td style="padding:10px 0;color:#666;border-top:1px solid #f4f4f4">Total</td><td style="padding:10px 0;text-align:right;border-top:1px solid #f4f4f4;font-weight:600">EUR 486 (paid)</td></tr></table><p style="color:#666;font-size:13px;margin-top:20px">Confirmation number <strong>4892.771.433</strong> · PIN <strong>2047</strong>. Your voucher is attached.</p></div>`,
      attachments: [attachment('demo-blob-hotel-voucher')],
      keywords: ['$seen', '$label:travel'],
      headers: authPass('booking.com'),
    }),

    mail({
      id: 'demo-email-jennifer', mailbox: MB.inbox, date: at(3, 10, 10),
      from: addr(JENNIFER),
      subject: 'Head of Platform, Series B, Berlin or remote',
      text: 'Hi Nora,\n\nI came across your talk abstract for Infra Summit and thought of a client of mine: a Series B in real-time data infrastructure, 60 engineers, Berlin office with a remote-first culture. They are hiring a Head of Platform.\n\nStack is Rust and Postgres with a fair amount of Go. Compensation is in the range you would expect at that stage, with meaningful equity.\n\nWould you be open to a 15-minute call this week or next?\n\nBest,\nJennifer Hayes\nTalent Partners',
      headers: authPass('talent-partners.example'),
    }),

    mail({
      id: 'demo-email-maria', mailbox: MB.inbox, date: at(3, 9, 0),
      from: addr(MARIA), to: [{ name: 'All staff', email: `all@${WORK_DOMAIN}` }],
      subject: 'Reminder: Q4 development conversations',
      text: `Hi everyone,\n\nA reminder that Q4 development conversations run until the end of the month. Managers, please book the 45 minutes with each report by ${dayLabel(10)} and use the new template in Notion (it is shorter, you will like it).\n\nQuestions to me, as always.\n\nMaria\nPeople Ops`,
      keywords: ['$seen'],
      headers: company,
    }),

    mail({
      id: 'demo-email-ahmed-status', mailbox: MB.inbox, date: at(3, 16, 5),
      from: ahmed, to: [me, lisa],
      subject: 'Status page component for Beacon is on staging',
      text: 'https://status-staging.meridianlabs.example/beacon\n\nShows delivery success rate and p95 per region, 90 days. Lisa, the colours come from the website tokens so it should match the redesign. Tell me if the legend reads wrong on dark.\n\nA',
      keywords: ['$seen', '$label:beacon'],
      headers: company,
    }),

    mail({
      id: 'demo-email-wei', mailbox: MB.inbox, date: at(4, 15, 20),
      from: addr(WEI), to: [me, michael],
      subject: 'Beacon adoption model: early numbers',
      text: 'Quick one before the plan is final. Based on the beta cohort, 38% of tenants enable webhooks in the first week and 71% within a month. Long-poll usage drops to under 10% of requests by week six. So the migration window of a year is generous; six months would do.\n\nFull model in the Beacon folder. Wei',
      keywords: ['$seen', '$label:beacon'],
      headers: company,
    }),

    mail({
      id: 'demo-email-figma', mailbox: MB.inbox, date: at(5, 10, 30),
      from: { name: 'Figma', email: 'no-reply@figma.com' },
      subject: 'Sarah Kim invited you to "Meridian website redesign"',
      text: 'Sarah Kim (sarah@designco.example) invited you to edit the file "Meridian website redesign".\n\nOpen in Figma: https://www.figma.com/file/demo/meridian-website-redesign',
      keywords: ['$seen', '$label:work'],
      headers: authPass('figma.com'),
    }),

    mail({
      id: 'demo-email-aws', mailbox: MB.inbox, date: at(5, 8, 15),
      from: { name: 'Amazon Web Services', email: 'no-reply-aws@amazon.com' },
      subject: 'Your AWS invoice is available: USD 1,284.17',
      text: 'Your invoice for the previous billing period is now available.\n\nTotal this period: USD 1,284.17 (up USD 96.40, Beacon soak test)\n\nTop services:\n  Amazon EC2       USD 612.08\n  Amazon S3        USD 288.94\n  Amazon CloudFront USD 141.50\n  Amazon Route 53  USD 64.00\n  Other            USD 177.65\n\nView the full invoice in the Billing console.',
      keywords: ['$seen', '$label:finance'],
      headers: authPass('amazon.com'),
    }),

    mail({
      id: 'demo-email-1password', mailbox: MB.inbox, date: at(2, 7, 45),
      from: { name: '1Password', email: 'support@1password.com' },
      subject: 'Your 1Password Business subscription renews in 7 days',
      text: 'Hi Nora,\n\nYour 1Password Business subscription for Meridian Labs (24 seats) renews automatically in 7 days. The card on file ends in 4242.\n\nNothing to do unless you want to change the plan or the payment method.\n\nThe 1Password team',
      keywords: ['$seen', '$label:finance'],
      headers: authPass('1password.com'),
    }),

    mail({
      id: 'demo-email-linkedin', mailbox: MB.inbox, date: at(4, 11, 0),
      from: { name: 'LinkedIn', email: 'jobs-noreply@linkedin.com' },
      subject: '5 jobs matching "staff engineer · remote · eu", including one at Datadog',
      text: 'Based on your saved search "staff engineer · remote · eu":\n\n1. Staff Software Engineer, Datadog (Remote, EU)\n2. Principal Engineer, Platform, Sentry (Remote, EU)\n3. Staff Backend Engineer, Linear (Remote)\n4. Tech Lead, Infrastructure, Tailscale (Remote, EU)\n5. Staff Engineer, Mobile, Notion (Remote, EU)\n\nManage job alerts at linkedin.com/jobs/preferences.',
      keywords: ['$seen'],
      headers: { ...authPass('linkedin.com'), ...listHeaders('LinkedIn Job Alerts', 'linkedin.com') },
    }),

    mail({
      id: 'demo-email-github-key', mailbox: MB.inbox, date: at(4, 20, 12),
      from: { name: 'GitHub', email: 'noreply@github.com' },
      subject: '[GitHub] A new SSH key was added to your account',
      text: 'Hey nora-lindqvist,\n\nA new public key was added to your account:\n\n  nora@framework-16 (ED25519) SHA256:k9Qz...\n\nIf you believe this key was added in error, you can remove it in your SSH keys settings.\n\nThanks,\nThe GitHub Team',
      keywords: ['$seen'],
      headers: authPass('github.com'),
    }),

    mail({
      id: 'demo-email-dependabot', mailbox: MB.inbox, date: at(5, 6, 0),
      from: { name: 'dependabot[bot]', email: 'notifications@github.com' },
      subject: '[meridianlabs/beacon] Bump jsonwebtoken from 9.0.0 to 9.0.2 in /beacon-api (#1279)',
      text: 'Bumps jsonwebtoken from 9.0.0 to 9.0.2.\n\nRelease notes: fixes a verification bypass when the algorithm is not pinned (GHSA-8cf7-32gw-wr33).\n\nDependabot will resolve any conflicts with this PR as long as you don\'t alter it yourself.',
      keywords: ['$seen', '$label:beacon'],
      headers: { ...authPass('github.com'), 'List-Id': 'meridianlabs/beacon <beacon.meridianlabs.github.com>' },
    }),

    mail({
      id: 'demo-email-olivia-workshop', mailbox: MB.inbox, date: at(6, 14, 0),
      from: addr(OLIVIA),
      subject: 'Workshop at Northwind: two slots left',
      text: `Hi Nora,\n\nWe are running the onboarding workshop for Beacon design partners on ${dayLabel(13)}, two slots left. I kept one for Meridian in case you or Lisa want to sit in and hear what the first customers stumble over.\n\nSay the word and I'll put you down.\n\nOlivia`,
      keywords: ['$seen', '$label:work'],
      headers: authPass('northwind.example'),
    }),

    mail({
      id: 'demo-email-hetzner-maint', mailbox: MB.inbox, date: at(6, 9, 30),
      from: { name: 'Hetzner Cloud', email: 'noreply@hetzner.com' },
      subject: `Scheduled maintenance: Falkenstein network, ${dayLabel(5)} 02:00 to 04:00 CEST`,
      text: `Dear customer,\n\nWe will perform network maintenance in our Falkenstein data centre on ${dayLabel(5)} between 02:00 and 04:00 CEST. Affected: the load balancer lb-beacon-eu-1. Expect up to two minutes of packet loss.\n\nNo action is required on your side.\n\nHetzner Cloud`,
      keywords: ['$seen', '$label:beacon'],
      headers: authPass('hetzner.com'),
    }),

    // ══ Sent ═══════════════════════════════════════════════════
    mail({
      id: 'demo-email-rollback-2', thread: 'demo-thread-rollback', mailbox: MB.sent, date: at(1, 16, 20),
      from: me, to: [alice, bob], cc: [ahmed],
      subject: 'Re: Rollback plan for the Beacon launch',
      text: 'Draft attached, one page plus a table. The short version: we roll back on numbers (error rate above 0.5% for ten minutes, p95 above 1 s, or a retry-budget breach on three tenants), the on-call decides alone, and the whole thing is five steps.\n\nBob, the open question at the end is for you: do we keep rotating signing keys during a rollback window?\n\nNora',
      attachments: [attachment('demo-blob-runbook')],
      keywords: ['$seen', '$label:beacon'],
      inReplyTo: [mid('demo-email-rollback-1')], references: [mid('demo-email-rollback-1')],
    }),
    mail({
      id: 'demo-email-canary-2', thread: 'demo-thread-canary', mailbox: MB.sent, date: at(2, 15, 10),
      from: me, to: [priya], cc: [ahmed],
      subject: 'Re: Canary length: 12 h or 24 h?',
      text: '24 h. The night is where the batch customers live and that is exactly who we are nervous about. I\'ll tell Michael it costs a day and why; he will take it.\n\nCan we pick the five canary tenants together? I want Lumen in there, they asked to be first.\n\nNora',
      keywords: ['$seen', '$label:beacon'],
      inReplyTo: [mid('demo-email-canary-1')], references: [mid('demo-email-canary-1')],
    }),
    mail({
      id: 'demo-email-sent-board', mailbox: MB.sent, date: at(2, 18, 30),
      from: me, to: [addr(JAMES), michael],
      subject: 'Board update',
      text: 'James, Michael,\n\nThe quarterly report for the board pack is attached. Engineering section is two pages: uptime, latency, Beacon status, and what next quarter costs. I kept the migration tooling as an open item rather than promising a date.\n\nShout if anything needs softening before it goes out.\n\nNora',
      attachments: [attachment('demo-blob-quarterly-report')],
      keywords: ['$seen', '$label:work'],
    }),
    mail({
      id: 'demo-email-sent-kenji', mailbox: MB.sent, date: at(2, 17, 55),
      from: me, to: [addr(KENJI)],
      subject: 'Re: Speaker logistics: your slot, the AV check and the dinner',
      text: 'Dear Kenji,\n\nAll noted, thank you. I\'ll be at the AV check at 08:45 and I would love to join the dinner. One request: could my slides go on the venue machine as well? I have had a laptop die on stage once and would rather not repeat it.\n\nSee you in Lisbon,\nNora',
      keywords: ['$seen', '$label:travel'],
      inReplyTo: [mid('demo-email-kenji', 'infrasummit.example')], references: [mid('demo-email-kenji', 'infrasummit.example')],
    }),
    mail({
      id: 'demo-email-sent-sarah', mailbox: MB.sent, date: at(5, 11, 40),
      from: me, to: [addr(SARAH)],
      subject: 'Re: Prototype v2: hero options',
      text: 'Hi Sarah,\n\nOption B. The symmetrical one is calmer but it reads like every other developer-tool site this year. Go with the asymmetric grid, and let\'s see v3 with the real copy from Rachel.\n\nInvoice whenever you are ready; the pre-payment for next month can wait until the launch is out.\n\nThanks,\nNora',
      keywords: ['$seen', '$label:work'],
    }),

    // ══ Drafts ═════════════════════════════════════════════════
    mail({
      id: 'demo-email-draft-jennifer', mailbox: MB.drafts, date: at(1, 12, 10),
      from: me, to: [addr(JENNIFER)],
      subject: 'Re: Head of Platform, Series B, Berlin or remote',
      text: 'Hi Jennifer,\n\nThanks for reaching out. I am not looking right now; we are two weeks from a launch and I like where this is going. That said, I\'d be curious what "meaningful equity" means at Series B these days, so if you want to send the ',
      keywords: ['$seen', '$draft'],
    }),
    mail({
      id: 'demo-email-draft-lumen', mailbox: MB.drafts, date: at(1, 15, 45),
      from: me, to: [addr(TOMAS)], cc: [michael],
      subject: 'Lumen Logistics: kickoff and the canary',
      text: 'Hi Tomás,\n\nThank you for the PO, and yes: Lumen is on the canary list. Attached is the draft service agreement for your legal team to look at before DocuSign goes out; the SLA section is the one worth reading.\n\nFor the kickoff I would suggest ',
      attachments: [attachment('demo-blob-service-agreement')],
      keywords: ['$seen', '$draft', '$label:work'],
    }),
    // Scheduled: in Drafts with a pending submission (see demo-client).
    mail({
      id: 'demo-email-scheduled-prep', mailbox: MB.drafts, date: ago(0, 25),
      from: me, to: beaconTeam.filter((a) => a.email !== me.email),
      subject: 'Go/no-go prep: what I need from each of you by noon',
      text: `Morning all,\n\nBefore 14:00 today, please have ready:\n\n- Ahmed: the soak dashboard link and the hour-31 explanation\n- Priya: the open bug list with BEA-412 at the top\n- Lisa: the reconnect numbers from staging\n- Bob: your sign-off on the runbook, or what is missing\n\nI'll bring the rollback plan and the canary tenant list. Short meeting if we do this.\n\nNora`,
      keywords: ['$seen', '$draft', '$label:beacon'],
    }),

    // ══ Archive ════════════════════════════════════════════════
    mail({
      id: 'demo-email-archive-pto', mailbox: MB.archive, date: at(14, 9, 20),
      from: addr(MARIA), to: [{ name: 'All staff', email: `all@${WORK_DOMAIN}` }],
      subject: 'Updated leave policy, effective next quarter',
      text: 'Dear team,\n\nThe updated leave policy takes effect at the start of next quarter. Key changes: 28 days instead of 26, half days anywhere, and up to ten days roll over.\n\nThe full text is in Notion. Please acknowledge by replying to this mail.\n\nMaria\nPeople Ops',
      keywords: ['$seen'], headers: company,
    }),
    mail({
      id: 'demo-email-archive-hetzner-ticket', mailbox: MB.archive, date: at(21, 15, 4),
      from: { name: 'Hetzner Support', email: 'support@hetzner.com' },
      subject: 'Re: Ticket #2026101234: packet loss between fsn1 and hel1',
      text: 'Hello Nora,\n\nThank you for the traceroutes. We were able to reproduce the loss on one upstream path and have rerouted it. Please let us know if you see it again.\n\nTicket closed.\n\nBest regards,\nTobias, Hetzner Support',
      keywords: ['$seen'], headers: authPass('hetzner.com'),
    }),
    mail({
      id: 'demo-email-archive-linear-welcome', mailbox: MB.archive, date: at(26, 10, 0),
      from: { name: 'Linear', email: 'hello@linear.app' },
      subject: 'Welcome to Linear, Meridian Labs',
      text: 'Your workspace is ready. Invite your team, import from Jira if you must, and set up your first cycle.\n\nThe Linear team',
      keywords: ['$seen'], headers: authPass('linear.app'),
    }),
    mail({
      id: 'demo-email-archive-offsite', mailbox: MB.archive2025, date: at(120, 18, 30),
      from: addr(RACHEL), to: [{ name: 'All staff', email: `all@${WORK_DOMAIN}` }],
      subject: 'Offsite photos',
      text: 'The good one from the lake is attached; the rest are in the shared drive under Photos. Thank you all, that was a proper break.\n\nRachel',
      attachments: [attachment('demo-blob-team-photo')],
      keywords: ['$seen'], headers: company,
    }),
    mail({
      id: 'demo-email-archive-review', mailbox: MB.archive2025, date: at(200, 11, 15),
      from: alice,
      subject: 'Your development conversation: notes',
      text: 'Nora, thanks for a good conversation. The notes as promised: you want to lead a launch end to end, and you want to speak more outside the company. Both are on the plan for next year. Alice',
      keywords: ['$seen'], headers: company,
    }),
    mail({
      id: 'demo-email-archive-2024-welcome', mailbox: MB.archive2024, date: at(560, 9, 5),
      from: addr(MARIA),
      subject: 'Welcome to Meridian Labs',
      text: 'Hi Nora,\n\nWelcome aboard! Your laptop is on your desk, your accounts are set up, and Alice will meet you at 09:30 on your first day. Lunch is on us.\n\nMaria',
      keywords: ['$seen'], headers: company,
    }),
    mail({
      id: 'demo-email-archive-2024-laptop', mailbox: MB.archive2024, date: at(555, 14, 50),
      from: ahmed,
      subject: 'Your laptop: setup notes',
      text: 'Disk is encrypted, 1Password is installed, the VPN config is in your vault. Shout if anything does not work. Ahmed',
      keywords: ['$seen'], headers: company,
    }),

    // ══ Trash ══════════════════════════════════════════════════
    mail({
      id: 'demo-email-trash-promo', mailbox: MB.trash, date: at(5, 13, 0),
      from: { name: 'CloudConf', email: 'hello@cloudconf.example' },
      subject: 'Last chance: 40% off CloudConf tickets',
      text: 'Early-bird pricing ends at midnight. Use code LAST40 at checkout.',
      keywords: ['$seen'], headers: { ...authPass('cloudconf.example'), ...listHeaders('CloudConf News', 'cloudconf.example') },
    }),
    mail({
      id: 'demo-email-trash-calendar', mailbox: MB.trash, date: at(7, 8, 0),
      from: { name: 'Calendar', email: `calendar@${WORK_DOMAIN}` },
      subject: 'Reminder: Beacon weekly in 15 minutes',
      text: 'Beacon weekly starts at 10:00 in Room Spree and on Zoom.',
      keywords: ['$seen'],
    }),

    // ══ Spam ═══════════════════════════════════════════════════
    // Phishing: claims to be Meridian IT, fails DMARC, and the link text does
    // not match the link target.
    mail({
      id: 'demo-email-spam-phish', mailbox: MB.junk, date: at(1, 2, 3),
      from: { name: 'Meridian Labs IT', email: `it-helpdesk@${WORK_DOMAIN}` },
      subject: 'Action required: your mailbox password expires today',
      text: 'Your Meridian Labs mailbox password expires in 24 hours. To keep access to your email, verify your account now:\n\nhttps://meridianlabs-sso.verify-account.example/login\n\nIT Helpdesk',
      html: '<p>Your Meridian Labs mailbox password expires in <b>24 hours</b>. To keep access to your email, verify your account now:</p><p><a href="https://meridianlabs-sso.verify-account.example/login">https://sso.meridianlabs.example/password</a></p><p>IT Helpdesk</p>',
      headers: authFail(WORK_DOMAIN, 'verify-account.example', { spam: 12.4, llm: 'SPAM (Impersonates the recipient\'s own IT department, urges immediate action, and the link target does not match the link text.)' }),
    }),
    mail({
      id: 'demo-email-spam-prize', mailbox: MB.junk, date: at(2, 4, 40),
      from: { name: 'Prize Center', email: 'winner@totallylegit.example' },
      subject: 'Congratulations! You have been selected',
      text: 'Dear lucky winner,\n\nYou have been selected to receive a prize of considerable value. Click below to claim it immediately.\n\n[This is a demo spam message.]',
      headers: authFail('totallylegit.example', 'mailer-7.bulk-send.example', { spam: 9.8 }),
    }),
    mail({
      id: 'demo-email-spam-crypto', mailbox: MB.junk, date: at(3, 19, 15),
      from: { name: 'CryptoGrowth Daily', email: 'invest@cryptogrowth.example' },
      subject: 'The coin nobody is talking about yet',
      text: 'Three early backers turned a small stake into a fortune in 90 days. Limited spots. No experience needed.\n\n[Demo spam.]',
      headers: authFail('cryptogrowth.example', 'cryptogrowth.example', { spam: 7.2 }),
    }),

    // ══ Projects / Beacon ══════════════════════════════════════
    mail({
      id: 'demo-email-beacon-naming', mailbox: MB.beacon, date: at(9, 11, 30),
      from: michael, to: beaconTeam,
      subject: 'Naming decision: it stays "Beacon"',
      text: 'Legal cleared it, marketing likes it, and nobody could come up with anything better in three weeks. Beacon it is. Rename the internal repos when convenient, not before launch.\n\nM',
      keywords: ['$seen', '$pinned', '$label:beacon'], headers: company,
    }),
    mail({
      id: 'demo-email-beacon-rfc', mailbox: MB.beacon, date: at(12, 16, 20),
      from: bob, to: beaconTeam,
      subject: 'RFC: per-tenant retry budgets',
      text: 'The RFC is in the repo (docs/rfc/0007-retry-budgets.md). Summary: every tenant gets a budget of retries per hour proportional to its normal volume; when it is spent, retries queue instead of firing. It caps the worst case at 2x delivery volume and stops one customer\'s outage from costing everyone else.\n\nComments in the PR please. Bob',
      keywords: ['$seen', '$label:beacon'], headers: company,
    }),
    mail({
      id: 'demo-email-beacon-sprint', mailbox: MB.beacon, date: at(8, 9, 0),
      from: alice, to: beaconTeam,
      subject: 'Sprint 41 planning: agenda',
      text: '1. Soak test schedule (Ahmed)\n2. Signing key rotation, #1284 (Lisa)\n3. Launch checklist walkthrough (Nora)\n4. What we cut if the canary slips (everyone)\n\nCome with numbers. Alice',
      keywords: ['$seen', '$label:beacon'], headers: company,
    }),

    // ══ Projects / Website redesign ════════════════════════════
    mail({
      id: 'demo-email-website-feedback-2', thread: 'demo-thread-website-feedback', mailbox: MB.website, date: at(7, 15, 30),
      from: addr(SARAH),
      subject: 'Re: Design feedback, round 2',
      text: 'All taken on board. v3 of the prototype comes with the invoice this week; the hero has two options for you to pick from.\n\nSarah',
      keywords: ['$seen', '$label:work'], headers: authPass('designco.example'),
      inReplyTo: [mid('demo-email-website-feedback-1')], references: [mid('demo-email-website-feedback-1')],
    }),
    mail({
      id: 'demo-email-website-feedback-1', thread: 'demo-thread-website-feedback', mailbox: MB.website, date: at(8, 17, 10),
      from: me, to: [addr(SARAH)], cc: [addr(RACHEL)],
      subject: 'Design feedback, round 2',
      text: 'Hi Sarah,\n\nRound two, shorter than round one:\n\n- The pricing table is right. Ship it.\n- The docs navigation needs a search field above the tree, not below.\n- The hero still says "platform" four times. Rachel is rewriting the copy.\n\nNora',
      keywords: ['$seen', '$label:work'],
    }),

    // ══ Receipts ═══════════════════════════════════════════════
    mail({
      id: 'demo-email-receipt-hetzner', mailbox: MB.receipts, date: at(3, 7, 20),
      from: { name: 'Hetzner Online', email: 'billing@hetzner.com' },
      subject: 'Invoice R0012345678: EUR 51.71 (paid)',
      text: 'Your invoice R0012345678 for the current period is attached. EUR 51.71 was collected by SEPA direct debit.\n\nHetzner Online GmbH',
      attachments: [attachment('demo-blob-hetzner-invoice')],
      keywords: ['$seen', '$label:finance'], headers: authPass('hetzner.com'),
    }),
    mail({
      id: 'demo-email-receipt-stripe', mailbox: MB.receipts, date: at(1, 7, 2),
      from: { name: 'Stripe', email: 'receipts@stripe.com' },
      subject: 'Your receipt from Linear Inc. [#2451-9928]',
      text: 'Receipt from Linear Inc.\nAmount paid: USD 192.00\nPayment method: Visa ending 4242\n\nDescription: Linear Standard, 12 seats (monthly)\nReceipt #2451-9928\n\nThis charge will appear on your statement as LINEAR INC.',
      html: '<div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif"><div style="text-align:center;padding:24px 0"><div style="font-size:11px;letter-spacing:0.12em;color:#888;text-transform:uppercase">Receipt</div><div style="font-size:32px;font-weight:700;margin-top:4px">$192.00</div><div style="color:#666;margin-top:4px">Linear Inc.</div></div><table style="width:100%;border-top:1px solid #eee;border-bottom:1px solid #eee"><tr><td style="padding:10px 0;color:#666">Amount</td><td style="padding:10px 0;text-align:right">$192.00</td></tr><tr><td style="padding:10px 0;color:#666;border-top:1px solid #f4f4f4">Payment method</td><td style="padding:10px 0;text-align:right;border-top:1px solid #f4f4f4">Visa •••• 4242</td></tr><tr><td style="padding:10px 0;color:#666;border-top:1px solid #f4f4f4">Receipt number</td><td style="padding:10px 0;text-align:right;border-top:1px solid #f4f4f4;font-family:monospace">2451-9928</td></tr></table><p style="color:#666;font-size:13px;margin-top:24px">Description: Linear Standard, 12 seats (monthly). This charge will appear on your statement as LINEAR INC.</p></div>',
      keywords: ['$seen', '$label:finance'], headers: authPass('stripe.com'),
    }),
    mail({
      id: 'demo-email-receipt-github', mailbox: MB.receipts, date: at(11, 6, 10),
      from: { name: 'GitHub', email: 'billing@github.com' },
      subject: '[GitHub] Payment receipt for Meridian Labs',
      text: 'Thanks for your payment.\n\nGitHub Team, 18 seats · USD 72.00\nGitHub Actions, 4,200 minutes · USD 33.60\nTotal: USD 105.60 · Visa ending 4242',
      keywords: ['$seen', '$label:finance'], headers: authPass('github.com'),
    }),
    mail({
      id: 'demo-email-receipt-porkbun', mailbox: MB.receipts, date: at(18, 8, 0),
      from: { name: 'Porkbun', email: 'support@porkbun.com' },
      subject: 'Renewal confirmation: meridianlabs.example (1 year)',
      text: 'Your domain meridianlabs.example has been renewed for one year.\n\nAmount: USD 11.06\nAuto-renew: on\n\nReply to this mail if you need an invoice with your VAT id.',
      keywords: ['$seen', '$label:finance'], headers: authPass('porkbun.com'),
    }),

    // ══ Travel ═════════════════════════════════════════════════
    mail({
      id: 'demo-email-travel-accepted', mailbox: MB.travel, date: at(24, 10, 20),
      from: addr(KENJI),
      subject: 'Infra Summit Lisbon: your talk is accepted',
      text: 'Dear Nora,\n\nThe programme committee accepted "Rolling back without rolling over: safe launches for event platforms". Congratulations, it was one of the highest-rated proposals.\n\nWe cover travel and two hotel nights. Logistics follow closer to the date.\n\nKenji Watanabe\nProgramme chair',
      keywords: ['$seen', '$flagged', '$label:travel'], headers: authPass('infrasummit.example'),
    }),
    mail({
      id: 'demo-email-travel-db', mailbox: MB.travel, date: at(40, 19, 5),
      from: { name: 'Deutsche Bahn', email: 'noreply@bahn.de' },
      subject: 'Your ticket: Berlin Hbf to Hamburg Hbf',
      text: 'Thank you for your booking.\n\nICE 802 · Berlin Hbf 07:34 to Hamburg Hbf 09:21 · 2nd class, seat 42, coach 7\nReturn: ICE 1601 · Hamburg Hbf 18:46 to Berlin Hbf 20:35\n\nYour ticket is in the DB Navigator app.',
      keywords: ['$seen', '$label:travel'], headers: authPass('bahn.de'),
    }),

    // ══ Newsletters ════════════════════════════════════════════
    mail({
      id: 'demo-email-nl-substack', mailbox: MB.newsletters, date: at(2, 6, 12),
      from: { name: 'Robin Sloan', email: 'robin@substack.com' },
      subject: 'a small newsletter about a small forge',
      text: 'Hello, friends.\n\nI have been spending the slow weeks in the workshop, slowly forging a knife from a piece of railway track. It is going badly, in the way that is good for one\'s soul.\n\nWhat I\'m reading: Annie Dillard, again. "The Writing Life". Specifically the chapter about her cabin, which always makes me want to throw my laptop into the sea.\n\nUntil next month,\nR.',
      keywords: ['$seen'], headers: { ...authPass('substack.com'), ...listHeaders('Robin Sloan', 'substack.com') },
    }),
    mail({
      id: 'demo-email-nl-pragmatic', mailbox: MB.newsletters, date: at(4, 7, 0),
      from: { name: 'The Pragmatic Engineer', email: 'pragmaticengineer@substack.com' },
      subject: 'How launch reviews work at companies that ship well',
      text: 'This week: what a good go/no-go looks like, why the best teams write the rollback plan before the launch plan, and a reader question about canary sizes.\n\nRead online or reply with your own launch stories.',
      keywords: ['$seen'], headers: { ...authPass('substack.com'), ...listHeaders('The Pragmatic Engineer', 'substack.com') },
    }),
    mail({
      id: 'demo-email-nl-postgres', mailbox: MB.newsletters, date: at(6, 5, 45),
      from: { name: 'Postgres Weekly', email: 'postgres@cooperpress.com' },
      subject: '#612: Logical replication in 18, and a tale of two vacuums',
      text: 'Postgres Weekly #612\n\n- What changed in logical replication in Postgres 18\n- A tale of two vacuums: autovacuum tuning for append-mostly tables\n- pg_stat_io, one year on\n\nUnsubscribe or change your address at the link below.',
      keywords: ['$seen'], headers: { ...authPass('cooperpress.com'), ...listHeaders('Postgres Weekly', 'cooperpress.com') },
    }),

    // A mail to the alias, so the identity picker has something to show.
    mail({
      id: 'demo-email-alias', mailbox: MB.inbox, date: at(5, 14, 22),
      from: { name: 'Infra Summit', email: 'speakers@infrasummit.example' }, to: [addr(NORA_ALIAS)],
      subject: 'Speaker profile: please check your bio and photo',
      text: 'Your speaker profile is live at infrasummit.example/speakers/nora-lindqvist. Please check the bio and the photo; reply to this mail with changes by the end of the week.',
      keywords: ['$seen', '$label:travel'], headers: { ...authPass('infrasummit.example'), ...listHeaders('Infra Summit Speakers', 'infrasummit.example') },
    }),
  ];
}
