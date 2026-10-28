/**
 * x:ArchivedItem answers for the tests. DERIVED, NOT RECORDED: no test server
 * has an Enterprise license, so these are built from the Stalwart source
 * (0.16.23 and the 1.0 checkout, identical here):
 * - the object: crates/registry/src/schema/structs_impl.rs, `impl IntoValue
 *   for ArchivedEmail` (from, subject, receivedAt, size, accountId,
 *   archivedAt, archivedUntil, blobId) inside `ArchivedItem`, tagged `@type`;
 *   dates are UTCDateTime's Display ("2026-10-20T08:00:00Z");
 * - `from` as crates/services/src/index_queue/index.rs builds it:
 *   "Name <address>", the address, or the name;
 * - the /set answer: crates/jmap/src/registry/mapping/archived_item.rs
 *   (`updated` with null, `notUpdated` with `notFound`).
 * The `forbidden` refusal is the one the unlicensed test servers really
 * send (local-data/org-features-facts.md §3).
 */

export const ACCOUNT = 'ci';

export const LICENSE_REFUSAL = {
  type: 'forbidden',
  description: 'This feature is only available in the Enterprise edition. Obtain your trial license at https://license.stalw.art/trial.',
};

export function archivedEmail(id: string, fields: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id,
    '@type': 'Email',
    from: 'Org Bob <org-bob@example.org>',
    subject: `Message ${id}`,
    receivedAt: '2026-10-01T09:00:00Z',
    size: 2048,
    accountId: ACCOUNT,
    archivedAt: '2026-10-20T08:00:00Z',
    archivedUntil: '2026-11-19T08:00:00Z',
    blobId: `blob-${id}`,
    ...fields,
  };
}

export const ARCHIVED_FILE = {
  id: 'f1',
  '@type': 'FileNode',
  name: 'plan.pdf',
  createdAt: '2026-10-01T09:00:00Z',
  accountId: ACCOUNT,
  archivedAt: '2026-10-21T08:00:00Z',
  archivedUntil: '2026-11-20T08:00:00Z',
  blobId: 'blob-f1',
};
