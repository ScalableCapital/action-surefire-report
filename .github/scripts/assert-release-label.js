const RELEASE_LABEL_COMMENT_HEADER = '<!-- action-surefire-report:release-label-check -->';

async function findReleaseLabelComments({ github, context, pullNumber }) {
    const comments = await github.paginate(github.rest.issues.listComments, {
        ...context.repo,
        issue_number: pullNumber,
        per_page: 100
    });

    return comments.filter(comment => comment.body && comment.body.includes(RELEASE_LABEL_COMMENT_HEADER));
}

function isCommentPermissionError(error) {
    return error.status === 403 && error.message === 'Resource not accessible by integration';
}

async function deleteReleaseLabelComments({ github, context, pullNumber }) {
    const comments = await findReleaseLabelComments({ github, context, pullNumber });

    await Promise.all(comments.map(comment => github.rest.issues.deleteComment({
        ...context.repo,
        comment_id: comment.id
    })));
}

async function upsertReleaseLabelComment({ github, context, pullNumber, body }) {
    const comments = await findReleaseLabelComments({ github, context, pullNumber });
    const [firstComment, ...staleComments] = comments;

    await Promise.all(staleComments.map(comment => github.rest.issues.deleteComment({
        ...context.repo,
        comment_id: comment.id
    })));

    if (firstComment) {
        await github.rest.issues.updateComment({
            ...context.repo,
            comment_id: firstComment.id,
            body
        });
        return;
    }

    await github.rest.issues.createComment({
        ...context.repo,
        issue_number: pullNumber,
        body
    });
}

function formatReleaseLabelComment({ message }) {
    return `${RELEASE_LABEL_COMMENT_HEADER}
### ❌ Release label check failed

${message}`
}

async function tryUpdateReleaseLabelComment({ github, context, pullNumber, body }) {
    try {
        await upsertReleaseLabelComment({ github, context, pullNumber, body });
    } catch (error) {
        if (!isCommentPermissionError(error)) {
            throw error;
        }

        console.warn(`Could not update release-label PR comment: ${error.message}`);
    }
}

module.exports = async ({ github, context, env }) => {
    const configuredLabels = (env.RELEASE_LABELS || '')
        .split(',')
        .map(label => label.trim())
        .filter(Boolean);

    if (!context.payload.pull_request) {
        throw new Error('This script only supports pull_request or pull_request_target events.');
    }

    if (configuredLabels.length === 0) {
        throw new Error('RELEASE_LABELS must list the allowed release/changelog labels.');
    }

    const response = await github.rest.pulls.get({
        ...context.repo,
        pull_number: context.payload.pull_request.number
    });
    const presentLabels = response.data.labels.map(label => label.name);
    const matchedLabels = configuredLabels.filter(label => presentLabels.includes(label));

    if (matchedLabels.length > 0) {
        await deleteReleaseLabelComments({ github, context, pullNumber: response.data.number });
        console.log(`Validated release labels '${matchedLabels.join(', ')}' on PR #${response.data.number}.`);
        return;
    }

    const labelList = configuredLabels.join(', ');
    const currentLabels = presentLabels.length > 0 ? presentLabels.join(', ') : '(none)';

    const message = `PR #${response.data.number} must have at least one release/changelog label (${labelList}). Current labels: ${currentLabels}`;
    await tryUpdateReleaseLabelComment({
        github,
        context,
        pullNumber: response.data.number,
        body: formatReleaseLabelComment({ message })
    });
    throw new Error(message);
};
