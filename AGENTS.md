# Repository workflow

- Read `docs/01-architecture.md`, your owner's plan, and `docs/15-delivery-and-codex.md`.
- P1 owns shell/components; P2 playback/downloads; P3 library/accounts/cloud; P4 catalog/social.
- P3 implementation lives in `packages/library` and `services/cloud`. Shared interfaces
  live in `packages/contracts`; request review by an affected owner for contract changes.
- Node 24/npm 11; pinned dependency versions and committed lockfile. `npm ci` installs.
- `npm run check` builds/types checks packages and runs deterministic tests.
- `npm run cloud:start`, `npm run cloud:reset`, `npm run test:integration` verify local
  database changes. Reset only the local development database. Never reset hosted data.
- Keep hosted tests separate (`npm run test:cloud`); missing credentials are a blocked
  check, not a passing or skipped cloud milestone. See `docs/16-person-3-foundation.md`.
- RLS authorization tests must use ordinary account clients. Privileged keys are only
  for server-side fixture provisioning and scoped cleanup; never renderer/library code.
- Use synthetic canonical IDs and rights-cleared fixtures. No stream URLs as identities,
  no committed credentials, and no device-local download paths in cloud data.
- Coordinate shared schema, lockfile and migration edits. Do not rewrite applied migrations.
