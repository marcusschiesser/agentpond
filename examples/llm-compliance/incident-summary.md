# Incident summary: delayed workspace sync

## Observed issue

Several sync jobs for workspace analytics completed more slowly than usual after the 2026-06-18 deployment.

## Evidence

The p95 sync duration increased from roughly 45 seconds to 6 minutes between 09:20 and 10:05 UTC. Worker logs show repeated retries around object-store manifest reads.

## Impact

Some users may have seen stale trace lists during the incident window.

## Mitigation status

The deployment was rolled back at 10:15 UTC and queue latency returned to normal by 10:32 UTC.

## Next action

Add a regression check for manifest read retries and review object-store timeout settings.
