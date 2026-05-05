# AGENTS.md

## Project Snapshot

- This repository builds a GitHub Action that parses Maven Surefire, Failsafe, Gradle, Pytest, Go, and other JUnit-compatible XML reports, then publishes GitHub check runs and annotations.
- The public action contract lives in `action.yml`. Preserve existing inputs, output behavior, check publishing semantics, and default values unless the task explicitly changes the action API.
- Runtime source lives in `src/`. TypeScript compiles to ignored `lib/`, and `@vercel/ncc` bundles `lib/index.js` into the committed `dist/index.js` used by `action.yml`.
- Keep XML report parsing tolerant at the `xml-js` boundary. Different producers emit different JUnit-like shapes, so avoid overfitting the parser to one schema.

## Build, Test, And Development Commands

- Use the Node version from `.nvmrc` and the pnpm version pinned by `packageManager` in `package.json`.
- Run commands from the repository root.
- Install dependencies with `pnpm install --frozen-lockfile`.
- If pnpm is missing, use Corepack with Node 24 or install the pinned pnpm version directly.

- Lint: `pnpm run eslint`
- Typecheck source and tests: `pnpm run typecheck`
- Run unit tests: `pnpm run test`
- Run one focused Vitest file: `pnpm exec vitest run src/action.test.ts`
- Build the shipped action bundle: `pnpm run package`

For normal source, dependency, or workflow changes, run:

```sh
pnpm run eslint
pnpm run typecheck
pnpm run test
pnpm run package
```

Run the smallest meaningful check set for the change. For normal source, dependency, or workflow changes, use the full command group above.

## Code And Test Conventions

- Prefer small TypeScript changes that match the existing helper boundaries in `src/action.ts`, `src/utils.ts`, and `src/types.ts`.
- Keep tests near the source files they validate. Shared XML fixtures belong under `test-fixtures/reports/`; executable integration examples belong under `integration-tests/`.
- Add or update tests when behavior changes, especially for report parsing, path resolution, action input parsing, check publication, or output conclusions.
- The action currently emits the `conclusion` output and the workflows assert it. Do not rename outputs casually; check `action.yml`, README examples, tests, and workflows together when touching outputs.
- Preserve the 50-annotation publishing limit unless the task explicitly changes GitHub check annotation behavior.

## PR And Commit Conventions

- Prefer Conventional Commit style PR titles and commits: `fix:`, `feat:`, `feat!:`, `docs:`, `chore:`, `test:`, `ci:`, or another clear conventional type.
- Release labels drive Release Drafter. Ensure each non-draft PR has at least one recognized release or changelog label.
- Keep changes focused. Do not create commits, push, merge, squash, or move tags unless explicitly asked.

## Constraints And Non-Negotiables

- Do not weaken, remove, or bypass existing tests without explicit instruction.
- Do not commit secrets, credentials, local profiles, logs, or temporary reports.
- Do not hand-edit generated `lib/` or `dist/` output. Run `pnpm run package` and commit regenerated `dist/index.js` whenever source, dependency, or runtime changes affect the bundle.
- Prefer existing dependencies and helpers. Ask before adding new runtime dependencies.
- Ask before changing the public action API, release/tag strategy, supported report formats, or fork-PR permission behavior.

## Workflow Rules

- `.github/workflows/build.yml` intentionally keeps one workflow file split into `Validate` plus per-language integration jobs.
- The Maven, Pytest, and Go examples intentionally fail and are treated as positive assertions. Preserve `continue-on-error`, reporter-output assertions, and same-repo GitHub Checks API assertions when editing these jobs.
- Fork PR paths must parse reports with `skip_publishing=true` because forked PRs may not have write-capable check permissions.
- Keep `checks: write` scoped to jobs that publish or assert check runs.

## Release Rules

- Published GitHub releases and tags are the source of truth for released versions.
- The exact release tag must already contain the reproducible bundled `dist/index.js`; the release-tag workflow verifies this and then moves the `v<major>` and `v<major>.<minor>` compatibility tags.
- The active compatibility line is `v2`. Keep repository metadata, README examples, and release configuration aligned with the `v2`/`v2.0.0` release line.

## Review Expectations

- Before finishing, review the diff for accidental API changes, generated-file drift, broad rewrites, and test gaps.
- Report which checks you ran. If a relevant check was skipped, state why.
- Keep documentation changes self-contained. Do not require future agents to read migration-planning files under `docs/` to work on normal repository tasks.
