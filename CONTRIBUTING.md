# Contributing

## Local Setup

Use the Node version from [`.nvmrc`](./.nvmrc). The repository uses pnpm, pinned by `packageManager` in [package.json](./package.json).

If pnpm is not installed, install it with the package-manager setup you normally use. For Node 24, Corepack is available and can install the pinned pnpm version from `packageManager`:

```sh
npm install --global corepack@latest
corepack enable pnpm
```

Node 25 and newer no longer bundle Corepack, so install Corepack first or install pnpm directly.

Then install dependencies:

```sh
pnpm install --frozen-lockfile
```

## Validation

Before opening a PR, run the checks that match your change. For normal code changes, run:

```sh
pnpm run eslint
pnpm run typecheck
pnpm run test
pnpm run package
```

The bundled [dist/index.js](./dist/index.js) required by [action.yml](./action.yml) is committed on the branch. CI runs `pnpm run package` and fails if packaging changes tracked files under `dist/`, so commit regenerated package output when dependency or runtime changes affect the bundle.

## Pull Requests

Prefer Conventional Commit prefixes in PR titles:

- `fix:` for backwards-compatible bug fixes
- `feat:` for backwards-compatible features
- `feat!:` or any `type!:` for breaking changes

This helps the release-label workflow infer changelog categories and semver impact from the PR title, branch name, body, and changed files.

PRs can have more than one release/changelog label. Release Drafter resolves the highest semver impact found across the labels:

- Major: `breaking`, `release:major`
- Minor: `enhancement`, `release:minor`
- Patch: `bug`, `release:patch`, `documentation`, `dependencies`, `security`

The release-label workflow tries to apply labels automatically. It fails only if none of the recognized release/changelog labels are present.

The repository intentionally does not use body-content issue labeling. Issue forms plus a default `triage` label keep incoming issue state predictable and avoid overfitting labels to partial text matches.

Maintainers can add the `package-pr` label to a same-repository pull request to run `pnpm run package` in CI and push a refreshed committed `dist/index.js` back to the PR branch. This label is command-style automation, not a release/changelog label.

## Issue Intake and Triage

New issues should come through the GitHub issue forms for:

- bug reports
- feature requests
- support questions

Those forms capture the minimum operating context for this action: action version, runner environment, workflow event, report type, expected behavior, actual behavior, reproduction steps, and relevant XML or log excerpts.

Opened and reopened issues automatically receive the `triage` label. Maintainers should remove `triage` only after deciding one of these paths:

- apply a final type/state label and work the item
- apply `needs-info` and request missing details
- apply `blocked` if an external dependency or platform constraint prevents progress
- close with `wontfix` when the request will not be implemented

Use `good first issue` and `help wanted` only after the scope is clear enough for contributors to act on it. Use `release-blocker` for items that must land before a release, and `keep-open` for accepted roadmap work that should stay out of stale handling even when quiet for a while.

## Stale Policy

Stale handling is configured conservatively from the start:

- issues: mark stale after 90 days, close after another 14 days
- pull requests: mark stale after 30 days, close after another 7 days
- exempt: all assigned work, all milestoned work, draft PRs, and anything labeled `blocked`, `keep-open`, `release-blocker`, or `security`
- rollout guardrail: `operations-per-run: 20` keeps the first runs bounded even though the workflow is live

If an issue or pull request should stay out of stale handling, add `keep-open`. If an issue is pinned in GitHub, also add `keep-open` so the stale workflow will continue to ignore it.

## Releases

Published GitHub releases and tags are the source of truth for released versions. Release Drafter keeps the next draft release aligned with merged PR labels, and the release-tag workflow verifies that the published exact tag already contains the reproducible bundled artifact before updating the moving minor and major compatibility tags.
