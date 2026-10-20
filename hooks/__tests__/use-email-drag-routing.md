# Message drag blob routing

- Worktree: `/home/billy/work/bulwark-deploy/bulwark-drag-out`
- Branch: `fix/message-drag-blob-routing`
- Audited base and unchanged HEAD: `640d4b8c2e44bcb61b099a5511e06dbd5d7ca537`.

Read repository guidance in `CONTRIBUTING.md`; no applicable `AGENTS.md` was
present. The worktree was clean before adding these changes. Before editing the
hook, verified that single-message prefetch and ZIP retrieval used the active
client without an owner account, and that cache keys omitted routing identity.

The hook now reuses `resolveEmailBlobContext` for each originating message.
Selections use the existing account-aware selection resolver, including loaded
expanded-thread members. Cache identity includes the authenticated client object,
login, owning JMAP account, message identity, blob ID and filename. Drag start
checks that identity again; obsolete asynchronous completions cannot replace the
current entry and their URLs receive the existing 60-second cleanup grace period.

`use-email-drag-routing.test.tsx` uses synthetic JMAP sessions and RFC 822 bytes
with the real JMAP connection, URL expansion, authentication and blob-fetch code.
Both logins use the same synthetic server to exercise authentication collisions.
The tests inspect single-message bytes and ZIP entry contents/counts. No real
messages or mail server are used. The existing `use-email-drag.test.tsx` assertions
are retained unchanged.

Run the maintained drag regressions with:

```sh
./node_modules/.bin/vitest run hooks/__tests__/use-email-drag.test.tsx hooks/__tests__/use-email-drag-routing.test.tsx --maxWorkers=1 --no-file-parallelism --reporter=verbose
```

Dependencies were installed from the existing lockfile using `npm ci --cache
/tmp/bulwark-drag-out-npm-cache --no-audit --no-fund --ignore-scripts`. Dependencies,
Vitest caches and Next build outputs belong to this worktree; no sibling
worktree or cache was modified.

## Row hover and lifecycle correction

Single-message rows and thread headers now call both the existing hover-action
handler and the hook's hover-prefetch handler. The maintained tests render the
real `ThreadListItem` and its real hover actions and drag hook, using synthetic
network responses with real JMAP URL/authentication code.

A single-message fetch that is still pending when dragend fires can finish into
the cache for a later drag. Completion checks both the current cache entry and
its freshly resolved client/owner/message identity. Navigation to another owner
or login, message/blob changes, and unmount cannot publish obsolete bytes.
Already-ready single-message URLs retain the existing dragend retirement and
60-second revocation grace period. ZIP caches still survive dragend.

## Remaining cold-cache limitation

`DownloadURL` is written only synchronously during dragstart when the matching
cache is ready. A cold first drag can still show the email preview and support
internal mailbox dragging while providing no desktop file. Fetch completion
never changes that drag's DataTransfer. If the pending request finishes after
dragend in the same context, the next drag can use it synchronously. If it
finishes before dragend, dragend retires that ready cache as before, so another
hover-prefetch must warm the row before a later attempt. No asynchronous
DataTransfer updates or native desktop delivery guarantees were added.

## Remaining failure-handling gap

ZIP retrieval still silently skips failed entries, messages without blob IDs and
messages whose source login is unavailable. An archive can contain fewer entries
than the selection count in its filename; if every eligible fetch fails it can
be empty. Failed/partial bundle builds remain cached until the selection/routing
key changes. The regression suite explicitly retains the existing partial-failure
behavior. No failure UI or unrelated export behavior was redesigned.

DataTransfer, object URLs and browser user agents are mocked under jsdom. These
checks verify payload construction, routing, archive bytes and URL retirement;
native browser/desktop drag-to-filesystem behavior has not been verified.

## Initial routing validation

- Exact final regression tests with only the hook replaced by the audited base:
  **20 failed, 4 passed**. Direct shared-folder requests used the primary owner;
  secondary-login requests used primary credentials; mixed ZIP contents were
  incorrect. The fixed hook was restored byte-for-byte after the replay.
- With the fix: **24/24 drag tests passed**, including the retained original test.
  The broader focused drag/blob/account-selection/thread run passed **138/138**
  tests across seven files.
- `npm run typecheck`: passed.
- `npm run lint`: passed; 16 warnings in unchanged files. Targeted lint on the
  changed hook/test passed without warnings.
- `npm run build`: passed; 16 filesystem-tracing warnings in unchanged files.
- `git diff --check`, plus whitespace checks on both new files: passed.
- `vitest run --maxWorkers=2`: **8,377 passed, 2 skipped, 1 failed**, across 783
  test files. The sole failure is `lib/__tests__/idn.test.ts:39`, where
  `toAsciiDomain('xn--zz.de')` returns the input instead of `null`. It also fails
  in isolation. Both the test and `lib/idn.ts` are byte-identical to the audited
  base; neither imports the drag hook. This unrelated behavior was left unchanged.

Session logs are in `/tmp/bulwark-drag-out-base-final-tests.log`,
`/tmp/bulwark-drag-out-focused.log`, `/tmp/bulwark-drag-out-unit-tests.log`,
`/tmp/bulwark-drag-out-final-drag-and-idn.log`, and the corresponding
`bulwark-drag-out-{typecheck,lint,build}.log` files. No integration suite, real
mailbox operation or native desktop drag verification was run. Nothing was
staged, committed, pushed or published.

## Row/lifecycle validation

Before correcting the current uncommitted routing patch, the extended routing
suite had **5 failures and 28 passes**. The failures were:

- Single-message row pointer entry did not start blob prefetch.
- Thread-header pointer entry did not start ZIP prefetch.
- Pointer entry on a selected real row did not prefetch the mixed-owner ZIP.
- A pending cold drag could not supply `DownloadURL` on a retry after dragend and
  fetch completion, both through direct hook handlers and through the real row.

After correction, the drag suites passed **34/34** tests, including all retained
original assertions. The focused row/drag/routing/selection/thread/context/JMAP
run passed **262/262** tests across **17 files**. `npm run typecheck` passed;
`npm run lint` passed with 16 warnings in unchanged files. Whitespace checks
passed. The prior full-suite and build results above describe the initial
routing validation; those broader checks were not repeated for this correction.

The before/after evidence is in `/tmp/bulwark-drag-out-lifecycle-before.log` and
`/tmp/bulwark-drag-out-lifecycle-after.log`; the focused, typecheck and lint logs
use the same prefix. The existing proxy, Next configuration, environment files,
package manifest and lockfile were preserved byte-for-byte. Dependencies were
unchanged. Native Chrome-to-Windows desktop file creation remains unverified
until manually tested. Nothing was staged, committed or pushed.
