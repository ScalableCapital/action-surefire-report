import * as github from '@actions/github';
import nock from 'nock';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

const { coreMocks, mockParseTestReports } = vi.hoisted(() => ({
    coreMocks: (() => {
        const summary = {
            addHeading: vi.fn(),
            addRaw: vi.fn(),
            addLink: vi.fn(),
            write: vi.fn()
        };
        summary.addHeading.mockReturnValue(summary);
        summary.addRaw.mockReturnValue(summary);
        summary.addLink.mockReturnValue(summary);
        summary.write.mockResolvedValue(undefined);

        return {
            getInput: vi.fn(),
            setOutput: vi.fn(),
            setFailed: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            summary
        };
    })(),
    mockParseTestReports: vi.fn(),
}));

vi.mock('@actions/core', () => coreMocks);

vi.mock('./utils', () => ({
    parseTestReports: mockParseTestReports,
}));

import action from './action';
import {
    finishedWithFailures,
    finishedSuccess,
    mainSuccess,
    nothingFound,
    nothingFoundButSuccess
} from './action.test.fixtures';

type Inputs = Record<string, string>;
type Outputs = Record<string, string>;
type MutableGithubContext = typeof github.context & {
    payload: typeof github.context.payload & {
        pull_request?: {
            id: number;
            number: number;
            html_url: string;
            head: { sha: string };
        };
    };
    sha: string;
    ref: string;
    job?: string;
};

let inputs: Inputs;
let outputs: Outputs;
let failed: string | null;
let eventName = 'pull_request';
const context = github.context as MutableGithubContext;
const githubEnvNames = [
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ID',
    'GITHUB_SERVER_URL',
    'GITHUB_STEP_SUMMARY'
] as const;
const originalGithubEnv = Object.fromEntries(
    githubEnvNames.map(name => [name, process.env[name]])
);

function primeDefaultInputs(): void {
    inputs = {
        report_paths: '**/surefire-reports/TEST-*.xml, **/failsafe-reports/TEST-*.xml',
        github_token: 'GITHUB_TOKEN',
        check_name: 'Test Report',
        fail_if_no_tests: 'true',
        skip_publishing: 'false'
    };
}

function primeDefaultGithubContext(): void {
    context.payload.pull_request = {
        id: 1,
        number: 1,
        html_url: 'https://github.com/scacap/action-surefire-report',
        head: { sha: 'sha123' }
    };
    context.sha = 'sha123';
    context.ref = 'refs/pull/1/head';
    context.job = 'build';
}

beforeAll(() => {
    coreMocks.getInput.mockImplementation((name: string) => inputs[name] ?? '');
    coreMocks.setOutput.mockImplementation((name: string, value: string) => {
        outputs[name] = value;
    });
    coreMocks.setFailed.mockImplementation((reason: string | Error) => {
        failed = String(reason);
    });
    vi.spyOn(github.context, 'repo', 'get').mockImplementation(() => ({
        owner: 'scacap',
        repo: 'action-surefire-report'
    }));
    vi.spyOn(github.context, 'eventName', 'get').mockImplementation(() => eventName);
});

beforeEach(() => {
    primeDefaultInputs();
    primeDefaultGithubContext();
    eventName = 'pull_request';
    for (const name of githubEnvNames) {
        delete process.env[name];
    }
    outputs = {};
    failed = null;
    coreMocks.error.mockClear();
    coreMocks.warning.mockClear();
    coreMocks.info.mockClear();
    coreMocks.debug.mockClear();
    coreMocks.summary.addHeading.mockClear();
    coreMocks.summary.addRaw.mockClear();
    coreMocks.summary.addLink.mockClear();
    coreMocks.summary.write.mockClear();
    mockParseTestReports.mockReset();
    mockParseTestReports.mockResolvedValue({
        count: 20,
        skipped: 1,
        annotations: finishedWithFailures.output.annotations
    });
    nock.cleanAll();
});

afterEach(() => {
    nock.cleanAll();
});

afterAll(() => {
    for (const name of githubEnvNames) {
        const originalValue = originalGithubEnv[name];
        if (originalValue === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = originalValue;
        }
    }
    vi.restoreAllMocks();
});

describe('action', () => {
    it('should parse surefire reports and send a check run to GitHub', async () => {
        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual(finishedWithFailures);
        expect(mockParseTestReports).toHaveBeenCalledWith(
            '**/surefire-reports/TEST-*.xml\n**/failsafe-reports/TEST-*.xml',
            false,
            false
        );
        expect(outputs).toHaveProperty('conclusion', 'failure');
        expect(failed).toBeNull();
    });

    it('should send all ok if no tests were broken', async () => {
        inputs.report_paths = '**/surefire-reports/TEST-*AllOkTest.xml';
        mockParseTestReports.mockResolvedValue({
            count: 1,
            skipped: 0,
            annotations: []
        });

        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual(finishedSuccess);
        expect(outputs).toHaveProperty('conclusion', 'success');
        expect(failed).toBeNull();
    });

    it('should send all ok if tests were flaky and ignore_flaky_test is true', async () => {
        inputs.report_paths = '**/surefire-reports/TEST-*AllOkWithFlakesTest.xml';
        inputs.ignore_flaky_tests = 'true';
        mockParseTestReports.mockResolvedValue({
            count: 1,
            skipped: 0,
            annotations: []
        });

        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual(finishedSuccess);
        expect(mockParseTestReports).toHaveBeenCalledWith(
            '**/surefire-reports/TEST-*AllOkWithFlakesTest.xml',
            false,
            true
        );
        expect(outputs).toHaveProperty('conclusion', 'success');
        expect(failed).toBeNull();
    });

    it('should send failure if no test results were found', async () => {
        inputs.report_paths = '**/xxx/*.xml';
        mockParseTestReports.mockResolvedValue({
            count: 0,
            skipped: 0,
            annotations: []
        });

        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual(nothingFound);
        expect(outputs).toHaveProperty('conclusion', 'failure');
    });

    it('should send ok if no test results were found and fail_if_no_tests is false', async () => {
        inputs.report_paths = '**/xxx/*.xml';
        inputs.fail_if_no_tests = 'false';
        mockParseTestReports.mockResolvedValue({
            count: 0,
            skipped: 0,
            annotations: []
        });

        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual(nothingFoundButSuccess);
        expect(outputs).toHaveProperty('conclusion', 'success');
    });

    it('should send reports to sha if no pr detected', async () => {
        inputs.report_paths = '**/surefire-reports/TEST-*AllOkTest.xml';
        mockParseTestReports.mockResolvedValue({
            count: 1,
            skipped: 0,
            annotations: []
        });
        eventName = 'push';
        context.payload.pull_request = undefined;
        context.sha = 'mainSha123';
        context.ref = 'refs/heads/main';

        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual(mainSuccess);
    });

    it('should publish workflow annotations by default on workflow_dispatch', async () => {
        eventName = 'workflow_dispatch';
        context.payload.pull_request = undefined;
        context.sha = 'mainSha123';
        context.ref = 'refs/heads/main';
        process.env.GITHUB_STEP_SUMMARY = '/tmp/github-step-summary';

        await action();

        expect(coreMocks.error).toHaveBeenCalledTimes(
            finishedWithFailures.output.annotations.length
        );
        expect(coreMocks.error).toHaveBeenCalledWith(
            finishedWithFailures.output.annotations[0].message,
            {
                title: finishedWithFailures.output.annotations[0].title,
                file: finishedWithFailures.output.annotations[0].path,
                startLine: finishedWithFailures.output.annotations[0].start_line,
                endLine: finishedWithFailures.output.annotations[0].end_line
            }
        );
        expect(coreMocks.summary.addHeading).toHaveBeenCalledWith('Test Report', 2);
        expect(coreMocks.summary.addRaw).toHaveBeenCalledWith(
            '20 tests run, 1 skipped, 13 failed.\n\n'
        );
        expect(coreMocks.summary.addRaw).toHaveBeenCalledWith(
            'Published as workflow annotations on this job.\n'
        );
        expect(coreMocks.summary.write).toHaveBeenCalledOnce();
        expect(outputs).toHaveProperty('conclusion', 'failure');
        expect(failed).toBeNull();
    });

    it('should cap workflow annotations at 50', async () => {
        eventName = 'workflow_dispatch';
        context.payload.pull_request = undefined;
        context.sha = 'mainSha123';
        context.ref = 'refs/heads/main';
        const annotations = Array.from({ length: 60 }, (_, index) => ({
            path: `src/file-${index}.java`,
            start_line: index + 1,
            end_line: index + 1,
            start_column: 0,
            end_column: 0,
            annotation_level: 'failure',
            title: `Failure ${index}`,
            message: `Message ${index}`,
            raw_details: `Details ${index}`
        }));
        mockParseTestReports.mockResolvedValue({ count: 60, skipped: 0, annotations });

        await action();

        expect(coreMocks.error).toHaveBeenCalledTimes(50);
        expect(coreMocks.error).toHaveBeenNthCalledWith(1, 'Message 0', {
            title: 'Failure 0',
            file: 'src/file-0.java',
            startLine: 1,
            endLine: 1
        });
        expect(coreMocks.error).toHaveBeenNthCalledWith(50, 'Message 49', {
            title: 'Failure 49',
            file: 'src/file-49.java',
            startLine: 50,
            endLine: 50
        });
        expect(outputs).toHaveProperty('conclusion', 'failure');
        expect(failed).toBeNull();
    });

    it('should not claim workflow annotations were published when there are none', async () => {
        eventName = 'workflow_dispatch';
        inputs.report_paths = '**/surefire-reports/TEST-*AllOkTest.xml';
        mockParseTestReports.mockResolvedValue({
            count: 1,
            skipped: 0,
            annotations: []
        });
        context.payload.pull_request = undefined;
        context.sha = 'mainSha123';
        context.ref = 'refs/heads/main';
        process.env.GITHUB_STEP_SUMMARY = '/tmp/github-step-summary';

        await action();

        expect(coreMocks.error).not.toHaveBeenCalled();
        expect(coreMocks.summary.addHeading).toHaveBeenCalledWith('Test Report', 2);
        expect(coreMocks.summary.addRaw).toHaveBeenCalledWith(
            '1 tests run, 0 skipped, 0 failed.\n\n'
        );
        expect(coreMocks.summary.addRaw).not.toHaveBeenCalledWith(
            'Published as workflow annotations on this job.\n'
        );
        expect(coreMocks.summary.write).toHaveBeenCalledOnce();
        expect(outputs).toHaveProperty('conclusion', 'success');
        expect(failed).toBeNull();
    });

    it('should allow overriding workflow_dispatch back to check-run mode', async () => {
        eventName = 'workflow_dispatch';
        inputs.report_mode = 'check-run';
        inputs.report_paths = '**/surefire-reports/TEST-*AllOkTest.xml';
        mockParseTestReports.mockResolvedValue({
            count: 1,
            skipped: 0,
            annotations: []
        });
        context.payload.pull_request = undefined;
        context.sha = 'mainSha123';
        context.ref = 'refs/heads/main';
        process.env.GITHUB_SERVER_URL = 'https://github.com';
        process.env.GITHUB_REPOSITORY = 'scacap/action-surefire-report';
        process.env.GITHUB_RUN_ID = '123456789';
        process.env.GITHUB_STEP_SUMMARY = '/tmp/github-step-summary';

        const workflowRunUrl =
            'https://github.com/scacap/action-surefire-report/actions/runs/123456789';
        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual({
            ...mainSuccess,
            details_url: workflowRunUrl,
            output: {
                ...mainSuccess.output,
                summary: `Published from workflow run: [${workflowRunUrl}](${workflowRunUrl})`
            }
        });
        expect(outputs).toHaveProperty('conclusion', 'success');
        expect(failed).toBeNull();
    });

    it('should treat custom summary as a full override in check-run mode', async () => {
        eventName = 'workflow_dispatch';
        inputs.report_mode = 'check-run';
        inputs.custom_summary = 'Manual summary override';
        inputs.report_paths = '**/surefire-reports/TEST-*AllOkTest.xml';
        mockParseTestReports.mockResolvedValue({
            count: 1,
            skipped: 0,
            annotations: []
        });
        context.payload.pull_request = undefined;
        context.sha = 'mainSha123';
        context.ref = 'refs/heads/main';
        process.env.GITHUB_SERVER_URL = 'https://github.com';
        process.env.GITHUB_REPOSITORY = 'scacap/action-surefire-report';
        process.env.GITHUB_RUN_ID = '123456789';
        process.env.GITHUB_STEP_SUMMARY = '/tmp/github-step-summary';

        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual({
            ...mainSuccess,
            details_url: 'https://github.com/scacap/action-surefire-report/actions/runs/123456789',
            output: {
                ...mainSuccess.output,
                summary: 'Manual summary override'
            }
        });
        expect(coreMocks.summary.addHeading).toHaveBeenCalledWith('Test Report', 2);
        expect(coreMocks.summary.addRaw).toHaveBeenCalledWith(
            '1 tests run, 0 skipped, 0 failed.\n\n'
        );
        expect(coreMocks.summary.addRaw).toHaveBeenCalledWith('Manual summary override\n');
        expect(coreMocks.summary.addLink).not.toHaveBeenCalled();
        expect(coreMocks.summary.write).toHaveBeenCalledOnce();
        expect(outputs).toHaveProperty('conclusion', 'success');
        expect(failed).toBeNull();
    });

    it('should treat custom summary as a full override in workflow mode', async () => {
        eventName = 'workflow_dispatch';
        inputs.custom_summary = 'Manual workflow summary override';
        context.payload.pull_request = undefined;
        context.sha = 'mainSha123';
        context.ref = 'refs/heads/main';
        process.env.GITHUB_STEP_SUMMARY = '/tmp/github-step-summary';

        await action();

        expect(coreMocks.error).toHaveBeenCalledTimes(
            finishedWithFailures.output.annotations.length
        );
        expect(coreMocks.summary.addHeading).toHaveBeenCalledWith('Test Report', 2);
        expect(coreMocks.summary.addRaw).toHaveBeenCalledWith(
            '20 tests run, 1 skipped, 13 failed.\n\n'
        );
        expect(coreMocks.summary.addRaw).toHaveBeenCalledWith(
            'Manual workflow summary override\n'
        );
        expect(coreMocks.summary.addLink).not.toHaveBeenCalled();
        expect(coreMocks.summary.write).toHaveBeenCalledOnce();
        expect(outputs).toHaveProperty('conclusion', 'failure');
        expect(failed).toBeNull();
    });

    it('should link created check runs to the current workflow run', async () => {
        inputs.report_paths = '**/surefire-reports/TEST-*AllOkTest.xml';
        mockParseTestReports.mockResolvedValue({
            count: 1,
            skipped: 0,
            annotations: []
        });
        context.payload.pull_request = undefined;
        context.sha = 'mainSha123';
        context.ref = 'refs/heads/main';
        process.env.GITHUB_SERVER_URL = 'https://github.com';
        process.env.GITHUB_REPOSITORY = 'scacap/action-surefire-report';
        process.env.GITHUB_RUN_ID = '123456789';
        process.env.GITHUB_STEP_SUMMARY = '/tmp/github-step-summary';

        const workflowRunUrl =
            'https://github.com/scacap/action-surefire-report/actions/runs/123456789';
        const checkRunUrl =
            'https://github.com/scacap/action-surefire-report/runs/987654321';
        let request: unknown = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body;
                return true;
            })
            .reply(200, { html_url: checkRunUrl });

        await action();
        scope.done();

        expect(request).toStrictEqual({
            ...mainSuccess,
            details_url: workflowRunUrl,
            output: {
                ...mainSuccess.output,
                summary: `Published from workflow run: [${workflowRunUrl}](${workflowRunUrl})`
            }
        });
        expect(coreMocks.summary.addHeading).toHaveBeenCalledWith('Test Report', 2);
        expect(coreMocks.summary.addRaw).toHaveBeenCalledWith(
            '1 tests run, 0 skipped, 0 failed.\n\n'
        );
        expect(coreMocks.summary.addLink).toHaveBeenCalledWith(
            'View published check run',
            checkRunUrl
        );
        expect(coreMocks.summary.addLink).toHaveBeenCalledWith(
            'View workflow run',
            workflowRunUrl
        );
        expect(coreMocks.summary.write).toHaveBeenCalledOnce();
        expect(outputs).toHaveProperty('conclusion', 'success');
        expect(failed).toBeNull();
    });

    it('should not send a report when skip_publishing is true', async () => {
        inputs.skip_publishing = 'true';

        await action();

        expect(outputs).toHaveProperty('conclusion', 'failure');
        expect(failed).toBeNull();
    });

    it('should honor github_base_url when creating checks', async () => {
        inputs.github_base_url = 'https://ghe.example.test/api/v3';
        mockParseTestReports.mockResolvedValue({
            count: 1,
            skipped: 0,
            annotations: []
        });

        const scope = nock('https://ghe.example.test')
            .post('/api/v3/repos/scacap/action-surefire-report/check-runs')
            .reply(200, {});

        await action();
        scope.done();

        expect(outputs).toHaveProperty('conclusion', 'success');
        expect(failed).toBeNull();
    });

    it('should cap created check annotations at 50', async () => {
        const annotations = Array.from({ length: 60 }, (_, index) => ({
            path: `src/file-${index}.java`,
            start_line: index + 1,
            end_line: index + 1,
            start_column: 0,
            end_column: 0,
            annotation_level: 'failure',
            title: `Failure ${index}`,
            message: `Message ${index}`,
            raw_details: `Details ${index}`
        }));
        mockParseTestReports.mockResolvedValue({ count: 60, skipped: 0, annotations });

        let requestBody: {
            output: { annotations: typeof annotations };
        } | null = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                requestBody = body as {
                    output: { annotations: typeof annotations };
                };
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(requestBody).not.toBeNull();
        expect(requestBody!.output.annotations).toHaveLength(50);
        expect(requestBody!.output.annotations[0]).toStrictEqual(annotations[0]);
        expect(requestBody!.output.annotations[49]).toStrictEqual(annotations[49]);
        expect(outputs).toHaveProperty('conclusion', 'failure');
        expect(failed).toBeNull();
    });

    it('should include a custom summary when creating a check', async () => {
        inputs.custom_summary = 'Published from a follow-up workflow run.';

        let request: typeof finishedWithFailures | null = null;
        const scope = nock('https://api.github.com')
            .post('/repos/scacap/action-surefire-report/check-runs', (body: unknown) => {
                request = body as typeof finishedWithFailures;
                return true;
            })
            .reply(200, {});

        await action();
        scope.done();

        expect(request).toStrictEqual({
            ...finishedWithFailures,
            output: {
                ...finishedWithFailures.output,
                summary: 'Published from a follow-up workflow run.'
            }
        });
        expect(outputs).toHaveProperty('conclusion', 'failure');
        expect(failed).toBeNull();
    });

    describe('with option fail_on_test_failures', () => {
        it('should not fail on success', async () => {
            inputs.report_paths = '**/surefire-reports/TEST-*AllOkTest.xml';
            inputs.fail_on_test_failures = 'true';
            mockParseTestReports.mockResolvedValue({
                count: 1,
                skipped: 0,
                annotations: []
            });

            const scope = nock('https://api.github.com')
                .post('/repos/scacap/action-surefire-report/check-runs')
                .reply(200, {});

            await action();
            scope.done();

            expect(failed).toBeNull();
        });

        it('should fail on failures', async () => {
            inputs.fail_on_test_failures = 'true';

            const scope = nock('https://api.github.com')
                .post('/repos/scacap/action-surefire-report/check-runs')
                .reply(200, {});

            await action();
            scope.done();

            expect(failed).toBe('There were 13 failed tests');
        });
    });

    describe('with option create_check=false', () => {
        it('should parse surefire reports and update a check run', async () => {
            inputs.create_check = 'false';
            inputs.check_name = 'build';
            context.sha = 'sha123';
            context.job = 'build';

            let request: unknown = null;
            const getRuns = nock('https://api.github.com')
                .get('/repos/scacap/action-surefire-report/commits/sha123/check-runs?check_name=build&status=in_progress')
                .reply(200, {
                    check_runs: [
                        {
                            id: 123,
                            output: {
                                title: finishedWithFailures.output.title,
                                summary: 'Existing summary'
                            },
                            pull_requests: [{ id: 1 }]
                        }
                    ]
                });
            const patchRun = nock('https://api.github.com')
                .patch('/repos/scacap/action-surefire-report/check-runs/123', (body: unknown) => {
                    request = body;
                    return true;
                })
                .reply(200, {});

            await action();
            getRuns.done();
            patchRun.done();

            expect(request).toStrictEqual({
                output: {
                    ...finishedWithFailures.output,
                    summary: 'Existing summary'
                }
            });
            expect(outputs).toHaveProperty('conclusion', 'failure');
            expect(failed).toBeNull();
        });

        it('should override an existing check summary when a custom summary is provided', async () => {
            inputs.create_check = 'false';
            inputs.check_name = 'build';
            inputs.custom_summary = 'Updated summary from follow-up workflow.';
            context.sha = 'sha123';
            context.job = 'build';

            let request: unknown = null;
            const getRuns = nock('https://api.github.com')
                .get('/repos/scacap/action-surefire-report/commits/sha123/check-runs?check_name=build&status=in_progress')
                .reply(200, {
                    check_runs: [
                        {
                            id: 123,
                            output: {
                                title: finishedWithFailures.output.title,
                                summary: 'Existing summary'
                            },
                            pull_requests: [{ id: 1 }]
                        }
                    ]
                });
            const patchRun = nock('https://api.github.com')
                .patch('/repos/scacap/action-surefire-report/check-runs/123', (body: unknown) => {
                    request = body;
                    return true;
                })
                .reply(200, {});

            await action();
            getRuns.done();
            patchRun.done();

            expect(request).toStrictEqual({
                output: {
                    ...finishedWithFailures.output,
                    summary: 'Updated summary from follow-up workflow.'
                }
            });
            expect(outputs).toHaveProperty('conclusion', 'failure');
            expect(failed).toBeNull();
        });

        it('should link updated check runs to the current workflow run', async () => {
            inputs.create_check = 'false';
            inputs.check_name = 'build';
            context.sha = 'sha123';
            context.job = 'build';
            process.env.GITHUB_SERVER_URL = 'https://github.com';
            process.env.GITHUB_REPOSITORY = 'scacap/action-surefire-report';
            process.env.GITHUB_RUN_ID = '123456789';
            process.env.GITHUB_STEP_SUMMARY = '/tmp/github-step-summary';

            const existingSummary = 'Existing build summary';
            const workflowRunUrl =
                'https://github.com/scacap/action-surefire-report/actions/runs/123456789';
            const checkRunUrl =
                'https://github.com/scacap/action-surefire-report/runs/987654321';
            let request: unknown = null;
            const getRuns = nock('https://api.github.com')
                .get('/repos/scacap/action-surefire-report/commits/sha123/check-runs?check_name=build&status=in_progress')
                .reply(200, {
                    check_runs: [
                        {
                            id: 123,
                            output: {
                                title: finishedWithFailures.output.title,
                                summary: existingSummary
                            },
                            pull_requests: [{ id: 1 }]
                        }
                    ]
                });
            const patchRun = nock('https://api.github.com')
                .patch('/repos/scacap/action-surefire-report/check-runs/123', (body: unknown) => {
                    request = body;
                    return true;
                })
                .reply(200, { html_url: checkRunUrl });

            await action();
            getRuns.done();
            patchRun.done();

            expect(request).toStrictEqual({
                details_url: workflowRunUrl,
                output: {
                    ...finishedWithFailures.output,
                    summary: `${existingSummary}\n\nPublished from workflow run: [${workflowRunUrl}](${workflowRunUrl})`
                }
            });
            expect(coreMocks.summary.addHeading).toHaveBeenCalledWith('build', 2);
            expect(coreMocks.summary.addRaw).toHaveBeenCalledWith(
                '20 tests run, 1 skipped, 13 failed.\n\n'
            );
            expect(coreMocks.summary.addLink).toHaveBeenCalledWith(
                'View published check run',
                checkRunUrl
            );
            expect(coreMocks.summary.addLink).toHaveBeenCalledWith(
                'View workflow run',
                workflowRunUrl
            );
            expect(coreMocks.summary.write).toHaveBeenCalledOnce();
            expect(outputs).toHaveProperty('conclusion', 'failure');
            expect(failed).toBeNull();
        });

        it('should stop when no in-progress check run is found', async () => {
            inputs.create_check = 'false';
            inputs.check_name = 'build';
            inputs.fail_on_test_failures = 'true';
            context.sha = 'sha123';

            const getRuns = nock('https://api.github.com')
                .get('/repos/scacap/action-surefire-report/commits/sha123/check-runs?check_name=build&status=in_progress')
                .reply(200, { check_runs: [] });

            await action();
            getRuns.done();

            expect(outputs).not.toHaveProperty('conclusion');
            expect(failed).toBe("Did not find any in progress 'build' check for sha sha123");
        });
    });
});
