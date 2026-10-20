# Message drag regression tests

The maintained drag tests use synthetic JMAP sessions and message bytes with real
JMAP URL expansion, authentication and blob-fetch code. They verify:

- Primary, directly shared and secondary-login message routing; each mixed-owner
  ZIP entry uses its originating client and owner, including colliding IDs.
- Account-aware selection and expanded-thread members, filenames and drag payloads.
- Pointer entry on actual message rows and thread headers prepares drag content
  while retaining working hover actions.
- Cache identity across clients, owners, messages and blobs; stable-context
  pending fetches can warm a retry after dragend, while changed contexts and
  unmounted rows cannot publish stale content. Retired object URLs retain the
  60-second cleanup grace period.

Run from the repository root with dependencies installed:

```sh
./node_modules/.bin/vitest run \
  hooks/__tests__/use-email-drag.test.tsx \
  hooks/__tests__/use-email-drag-routing.test.tsx
```

## Limitations

`DownloadURL` must be available synchronously at dragstart. Hover preparation or
a later attempt may be necessary when the cache is cold. Fetch completion never
adds a file to a drag already in progress. Ready single-message caches are
retired on dragend, so another hover may be needed before a later attempt.

ZIP export silently omits failed fetches, messages without blob IDs and messages
whose source login is unavailable. An archive can contain fewer entries than its
filename suggests, or be empty if every eligible fetch fails. Partial or failed
bundle builds remain cached until their cache key changes; the same selection
is not automatically retried.

## Manual desktop verification

DataTransfer, object URLs and browser user agents are mocked under jsdom. Tests
check payload construction, synthetic message/ZIP bytes and URL lifetime; these
assertions do not establish native desktop file creation.

1. In a supported desktop Chromium browser, hover a message row, confirm its
   hover actions still work, then drag its sender/subject area to the desktop.
   Confirm that an `.eml` file is created. Repeat for primary, shared and
   secondary-login messages using controlled test data.
2. Try a cold-cache drag. If no file is created, allow preparation to complete,
   hover again and retry. Check file creation separately from the drag preview
   and successful network responses.
3. Select controlled messages from multiple clients/owners, allow preparation,
   and drag them to the desktop. Confirm that a ZIP file is created; separately
   inspect its expected entry count and message contents.

Record the browser version, operating system, file-creation results and whether
ZIP entry contents were actually inspected. Observing a payload or a successful
GET alone is not a successful native desktop check.
