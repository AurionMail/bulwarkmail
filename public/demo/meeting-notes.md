# Beacon weekly · 17 Oct 2026

Attendees: Alice, Bob, Priya, Ahmed, Lisa, Nora

## Decisions
- Canary stays at 5% for a full 24 h, not 12. Priya wants one night of traffic.
- Webhook signing keys rotate every 90 days; the old key stays valid for 48 h.
- Rachel gets the changelog draft by 22 Oct 2026.

## Open
- [ ] Rollback runbook: Nora, review by Bob and Ahmed
- [ ] Long-poll reconnect test on the staging tenant: Lisa
- [ ] Status page component for Beacon: Ahmed

## Notes
Load test held at 3× peak for 48 h without a retry-budget breach. p95 184 ms.
