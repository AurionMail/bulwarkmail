import type { SieveScript, SieveCapabilities } from '@/lib/jmap/sieve-types';

export function createDemoSieveCapabilities(): SieveCapabilities {
  return {
    implementation: 'Demo Sieve Engine',
    maxSizeScript: 65536,
    sieveExtensions: ['fileinto', 'reject', 'vacation', 'imap4flags', 'comparator-i;ascii-casemap', 'body', 'envelope', 'mailbox', 'variables'],
    notificationMethods: [],
    externalLists: [],
  };
}

export function createDemoSieveScripts(): SieveScript[] {
  return [
    {
      id: 'demo-sieve-1',
      name: 'Inbox rules',
      blobId: 'demo-sieve-blob-1',
      isActive: true,
    },
  ];
}

// Sieve script content keyed by blobId. The rules match the folders and the
// mail in the fixtures, so the filter editor shows something coherent.
export function createDemoSieveContent(): Record<string, string> {
  return {
    'demo-sieve-blob-1': [
      'require ["fileinto", "imap4flags", "mailbox"];',
      '',
      '# Newsletters out of the inbox',
      'if exists "List-Unsubscribe" {',
      '  if address :domain :is "from" ["github.com", "linear.app"] { keep; stop; }',
      '  fileinto "Newsletters";',
      '  stop;',
      '}',
      '',
      '# Receipts and invoices',
      'if anyof (address :is "from" ["billing@hetzner.com", "receipts@stripe.com", "billing@github.com", "support@porkbun.com"],',
      '          header :contains "subject" ["receipt", "invoice"]) {',
      '  fileinto :create "Receipts";',
      '  stop;',
      '}',
      '',
      '# Travel confirmations',
      'if address :domain :is "from" ["lufthansa.com", "booking.com", "bahn.de"] {',
      '  fileinto "Travel";',
      '  stop;',
      '}',
      '',
      '# Flag anything from Alice',
      'if address :is "from" "alice.johnson@meridianlabs.example" {',
      '  addflag "\\\\Flagged";',
      '}',
      '',
      '# Beacon mail gets its label',
      'if header :contains "subject" ["Beacon", "BEA-"] {',
      '  addflag "$label:beacon";',
      '}',
    ].join('\n'),
  };
}
