module.exports = async ({ github, context, env }) => {
    const { CHECK_NAME, EXPECTED_CONCLUSION, HEAD_SHA } = env;
    let matchingRuns = [];

    for (let attempt = 1; attempt <= 10; attempt++) {
        const response = await github.rest.checks.listForRef({
            ...context.repo,
            ref: HEAD_SHA,
            check_name: CHECK_NAME,
            filter: 'latest'
        });
        matchingRuns = response.data.check_runs.filter(run => run.name === CHECK_NAME);
        const completedRun = matchingRuns.find(run => run.status === 'completed');

        if (completedRun) {
            if (completedRun.conclusion !== EXPECTED_CONCLUSION) {
                throw new Error(
                    `Expected '${CHECK_NAME}' conclusion '${EXPECTED_CONCLUSION}', got '${completedRun.conclusion}'`
                );
            }

            return;
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    throw new Error(
        `Did not observe a completed '${CHECK_NAME}' check run for ${HEAD_SHA}. Found: ${JSON.stringify(
            matchingRuns.map(run => ({
                id: run.id,
                status: run.status,
                conclusion: run.conclusion
            }))
        )}`
    );
};
