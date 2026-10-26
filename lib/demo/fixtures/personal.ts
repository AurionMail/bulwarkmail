/**
 * Nora's personal account (nora@lindqvist.example): family, friends, the
 * dentist, a parcel. It is a second login in the demo, so the account
 * switcher and the merged inbox have something to merge.
 */
import type { Email, Identity } from '@/lib/jmap/types';
import { ago, at, authPass, dayName, listHeaders, mail, mid } from './mail';
import { attachment } from './assets';
import { PMB } from './mailboxes';
import { addr, NORA_PERSONAL, SOFIA, ANNA, ELIAS, CARLOS, MARCUS, EMMA, DAVID, DANIEL, PERSONAL_DOMAIN } from './people';

const me = addr(NORA_PERSONAL);

export function createDemoPersonalIdentities(): Identity[] {
  return [{
    id: 'demo-identity-personal',
    name: 'Nora Lindqvist',
    email: NORA_PERSONAL.email,
    textSignature: 'Nora',
    htmlSignature: '<p>Nora</p>',
    mayDelete: false,
  }];
}

export function createDemoPersonalEmails(): Email[] {
  return [
    // ══ Inbox ═══════════════════════════════════════════════════
    mail({
      id: 'demo-personal-dhl', mailbox: PMB.inbox, date: ago(1, 20),
      from: { name: 'DHL', email: 'noreply@dhl.de' }, to: [me],
      subject: 'Your parcel arrives today between 14:00 and 17:00',
      text: 'Your parcel from Cooper Creative is out for delivery.\n\nTracking: JJD0002 2345 6789 01\nDelivery window: today, 14:00 to 17:00\n\nIf nobody is home, we will try again tomorrow or leave it at the Packstation on Torstraße.',
      headers: authPass('dhl.de'),
    }),

    // Mom, a thread with Nora's reply in Sent.
    mail({
      id: 'demo-personal-mom-3', thread: 'demo-thread-mom', mailbox: PMB.inbox, date: ago(2, 15),
      from: addr(SOFIA), to: [me],
      subject: 'Re: when are you coming home?',
      text: `Lemons are not a bribe, they are a fact. Twelve of them.\n\nAnna says she can do the weekend after your trip. Your father is already planning the menu, which should worry you. Tell me by ${dayName(4)} so I can tell him.\n\nMom`,
      keywords: ['$label:family'],
      headers: authPass('example.com'),
      inReplyTo: [mid('demo-personal-mom-2', PERSONAL_DOMAIN)], references: [mid('demo-personal-mom-1', 'example.com'), mid('demo-personal-mom-2', PERSONAL_DOMAIN)],
    }),
    mail({
      id: 'demo-personal-mom-1', thread: 'demo-thread-mom', mailbox: PMB.inbox, date: at(1, 20, 48),
      from: addr(SOFIA), to: [me],
      subject: 'when are you coming home?',
      text: `Hi sweetie,\n\nYour father and I were just talking, we miss you. Any chance you can come down for a weekend before the winter? Anna said she might manage the same one, it would be nice to all be in one place again.\n\nThe lemon tree finally fruited! Twelve lemons. I'll save you some.\n\nLove,\nMom`,
      keywords: ['$seen', '$label:family'],
      headers: authPass('example.com'),
    }),

    mail({
      id: 'demo-personal-anna', mailbox: PMB.inbox, date: at(1, 22, 31),
      from: addr(ANNA), to: [me],
      subject: 'photos from the wedding',
      text: 'ok finally got around to going through these. there are like 600 more on the drive but here are the highlights, the ones I\'d actually want to print.\n\nmom looked SO happy. dad cried during the speech btw, did you see?\n\nlet me know which ones you want full-res of\n\na',
      attachments: [attachment('demo-blob-wedding-1'), attachment('demo-blob-wedding-2'), attachment('demo-blob-wedding-3')],
      keywords: ['$label:family'],
      headers: authPass('example.com'),
    }),

    mail({
      id: 'demo-personal-daniel', mailbox: PMB.inbox, date: at(1, 14, 15),
      from: addr(DANIEL), to: [me],
      subject: 'Lemon Tree cover, draft 2',
      text: 'Hi Nora,\n\nDraft two attached. I made the sun bolder as you asked and moved the title down so it sits in the sea. Still not sure about the serif; a geometric sans would feel more modern but less like your mother.\n\nThe print proof is on its way to you, DHL says tomorrow.\n\nDaniel',
      attachments: [attachment('demo-blob-book-cover')],
      keywords: ['$seen', '$flagged', '$label:family'],
      headers: authPass('coopercreative.example'),
    }),

    mail({
      id: 'demo-personal-carlos', mailbox: PMB.inbox, date: at(2, 21, 10),
      from: addr(CARLOS), to: [me],
      subject: 'dinner moved to 19:30 (sorry!)',
      text: `Quick heads up, had to push dinner back half an hour. The bistro could only do the late seating.\n\nNew time: ${dayName(3)}, 19:30\nThe Garden Bistro, Oranienstraße 12\n\nReservation under my name, eight people. Let me know if that doesn't work and I'll try to wrangle something.\n\nCarlos`,
      keywords: ['$seen', '$flagged'],
      headers: authPass('example.com'),
    }),

    mail({
      id: 'demo-personal-bookclub', mailbox: PMB.inbox, date: at(1, 12, 40),
      from: addr(MARCUS), to: [me, addr(EMMA), addr(DAVID)],
      subject: `book club ${dayName(2)}: picking the next one`,
      text: `Reminder: 19:00 at mine. We finish off Le Guin and pick the next read.\n\nMy vote is the Calvino but I know Emma has been pushing for the Knausgaard. I'll bring wine, can someone else handle snacks?\n\nm`,
      headers: authPass('example.com'),
    }),

    mail({
      id: 'demo-personal-elias', mailbox: PMB.inbox, date: at(3, 18, 5),
      from: addr(ELIAS), to: [me, addr(ANNA)],
      subject: 'Christmas: Göteborg or Bologna?',
      text: 'Before Mom decides for us: do we do Christmas up here or down there this year? I can host, the flat finally has a table that seats six. Anna, your call since you travel furthest.\n\nE',
      keywords: ['$seen', '$label:family'],
      headers: authPass(PERSONAL_DOMAIN),
    }),

    mail({
      id: 'demo-personal-dentist', mailbox: PMB.inbox, date: at(1, 8, 0),
      from: { name: 'Zahnarztpraxis Dr. Weber', email: 'termine@dr-weber.example' }, to: [me],
      subject: `Appointment reminder: ${dayName(7)} at 10:00`,
      text: `Dear Ms Lindqvist,\n\nThis is a reminder of your appointment on ${dayName(7)} at 10:00 with Dr. Weber (check-up and cleaning).\n\nPractice: Kastanienallee 21, 10435 Berlin, 2nd floor\n\nTo reschedule, reply to this mail or call 030 555 0142.\n\nKind regards,\nZahnarztpraxis Dr. Weber`,
      headers: authPass('dr-weber.example'),
    }),

    // Spotify, HTML with a remote image.
    mail({
      id: 'demo-personal-spotify', mailbox: PMB.inbox, date: at(2, 9, 30),
      from: { name: 'Spotify', email: 'no-reply@spotify.com' }, to: [me],
      subject: 'New release from Big Thief',
      text: 'Big Thief just released a new album, "Double Infinity Sessions". Based on your listening, we think you\'ll like it.\n\nOpen Spotify to listen.',
      html: '<div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif;background:#121212;color:#fff;padding:24px;border-radius:8px"><img src="https://i.scdn.co/image/demo/big-thief-double-infinity.jpg" alt="Album cover" width="512" height="512" style="display:block;width:100%;height:auto;border-radius:4px"><h1 style="font-size:22px;margin:20px 0 6px">New release from Big Thief</h1><p style="color:#b3b3b3;margin:0 0 20px">"Double Infinity Sessions". Based on your listening, we think you\'ll like it.</p><a href="https://open.spotify.com/album/demo" style="display:inline-block;background:#1db954;color:#000;font-weight:700;padding:12px 28px;border-radius:999px;text-decoration:none">Listen now</a></div>',
      keywords: ['$seen'],
      headers: { ...authPass('spotify.com'), ...listHeaders('Spotify Releases', 'spotify.com') },
    }),

    mail({
      id: 'demo-personal-apple', mailbox: PMB.inbox, date: at(4, 16, 22),
      from: { name: 'Apple', email: 'no_reply@email.apple.com' }, to: [me],
      subject: 'Your receipt from Apple',
      text: 'Receipt\n\niCloud+ 200 GB, monthly · EUR 2.99\nBilled to: Visa ending 1187\n\nApple Distribution International Ltd.',
      keywords: ['$seen', '$label:finance'],
      headers: authPass('email.apple.com'),
    }),

    mail({
      id: 'demo-personal-marginalian', mailbox: PMB.inbox, date: at(5, 7, 15),
      from: { name: 'The Marginalian', email: 'newsletter@themarginalian.org' }, to: [me],
      subject: 'Ursula K. Le Guin on the art of growing older, and a forgotten astronomer',
      text: 'This week: Le Guin on the art of growing older, a forgotten astronomer who mapped the night sky by hand, and a children\'s book about a lighthouse.\n\nThe Marginalian is free and ad-free; it survives on donations.',
      keywords: ['$seen'],
      headers: { ...authPass('themarginalian.org'), ...listHeaders('The Marginalian', 'themarginalian.org') },
    }),

    // ══ Sent ═══════════════════════════════════════════════════
    mail({
      id: 'demo-personal-mom-2', thread: 'demo-thread-mom', mailbox: PMB.sent, date: at(1, 21, 30),
      from: me, to: [addr(SOFIA)],
      subject: 'Re: when are you coming home?',
      text: 'Mom, I miss you too. I\'m in Lisbon for work next week, but the weekend after could work. Let me check with Anna.\n\nLemons sound like a bribe and I will not pretend otherwise.\n\nLove you both.',
      keywords: ['$seen', '$label:family'],
      inReplyTo: [mid('demo-personal-mom-1', 'example.com')], references: [mid('demo-personal-mom-1', 'example.com')],
    }),
    mail({
      id: 'demo-personal-sent-daniel', mailbox: PMB.sent, date: at(4, 20, 5),
      from: me, to: [addr(DANIEL)],
      subject: 'Re: Lemon Tree cover, draft 1',
      text: 'Daniel, it\'s lovely. Two things: a bolder sun, and the title lower, into the sea. Keep the serif for now; it is her kind of book.\n\nNora',
      keywords: ['$seen', '$label:family'],
    }),

    // ══ Family folder ══════════════════════════════════════════
    mail({
      id: 'demo-personal-family-recipe', mailbox: PMB.family, date: at(30, 11, 0),
      from: addr(SOFIA), to: [me, addr(ANNA), addr(ELIAS)],
      subject: 'Nonna\'s lemon cake, finally written down',
      text: 'As promised, and before I forget it myself:\n\n4 eggs, 200 g sugar, 120 g butter, 250 g flour, zest and juice of two lemons (ours, when they come), a pinch of salt, 1 tsp baking powder.\n\nBeat eggs and sugar until pale. Everything else in, lemon last. 45 minutes at 170. Do not open the oven, Elias.\n\nMom',
      keywords: ['$seen', '$label:family'], headers: authPass('example.com'),
    }),

    // ══ Trash ══════════════════════════════════════════════════
    mail({
      id: 'demo-personal-trash', mailbox: PMB.trash, date: at(6, 12, 0),
      from: { name: 'Lieferando', email: 'noreply@lieferando.de' }, to: [me],
      subject: 'Your order is on its way',
      text: 'Your order from Thai Orchid is on its way and should arrive in about 25 minutes.',
      keywords: ['$seen'], headers: authPass('lieferando.de'),
    }),
  ];
}
