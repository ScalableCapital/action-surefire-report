const LABEL_DEFINITIONS = [
    {
        name: 'triage',
        color: 'd4c5f9',
        description: 'New issue or reopened work awaiting maintainer triage'
    },
    {
        name: 'needs-info',
        color: 'fbca04',
        description: 'More information is required before work can continue'
    },
    {
        name: 'bug',
        color: 'd73a4a',
        description: 'Bug report or backwards-compatible bug fix'
    },
    {
        name: 'enhancement',
        color: '1d76db',
        description: 'Feature request or backwards-compatible feature'
    },
    {
        name: 'documentation',
        color: '0075ca',
        description: 'Documentation-only change or docs-related issue'
    },
    {
        name: 'question',
        color: 'cc317c',
        description: 'Support or usage question'
    },
    {
        name: 'good first issue',
        color: '7057ff',
        description: 'Good entry point for a first-time contributor'
    },
    {
        name: 'help wanted',
        color: '008672',
        description: 'Maintainers welcome external help on this item'
    },
    {
        name: 'blocked',
        color: '5319e7',
        description: 'Work is blocked by an external dependency or pending decision'
    },
    {
        name: 'wontfix',
        color: 'ffffff',
        description: 'This request will not be implemented'
    },
    {
        name: 'stale',
        color: 'f9d0c4',
        description: 'Inactive issue or pull request selected by stale automation'
    },
    {
        name: 'keep-open',
        color: '0e8a16',
        description: 'Exempt from stale automation until a maintainer removes this label'
    },
    {
        name: 'release-blocker',
        color: 'b60205',
        description: 'Must be resolved before the next release can ship'
    },
    {
        name: 'package-pr',
        color: 'bfd4f2',
        description: 'Command: run pnpm package for this PR and push the refreshed dist artifact'
    },
    {
        name: 'dependencies',
        color: '0366d6',
        description: 'Patch: dependency update'
    },
    {
        name: 'security',
        color: 'ee0701',
        description: 'Patch: security or guardrail change'
    },
    {
        name: 'release:patch',
        color: '0e8a16',
        description: 'Patch: backwards-compatible maintenance change'
    },
    {
        name: 'release:minor',
        color: '5319e7',
        description: 'Minor: explicit minor-version change'
    },
    {
        name: 'release:major',
        color: 'b60205',
        description: 'Major: explicit major-version change'
    },
    {
        name: 'breaking',
        color: 'b60205',
        description: 'Major: breaking change'
    }
];

async function upsertLabel({ github, context, label }) {
    try {
        await github.rest.issues.getLabel({
            ...context.repo,
            name: label.name
        });
        await github.rest.issues.updateLabel({
            ...context.repo,
            ...label,
            new_name: label.name
        });
    } catch (error) {
        if (error.status !== 404) {
            throw error;
        }

        await github.rest.issues.createLabel({
            ...context.repo,
            ...label
        });
    }
}

async function syncLabels({ github, context }) {
    for (const label of LABEL_DEFINITIONS) {
        await upsertLabel({ github, context, label });
    }
}

module.exports = syncLabels;
module.exports.LABEL_DEFINITIONS = LABEL_DEFINITIONS;
