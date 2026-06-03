import * as core from '@actions/core';
import * as github from '@actions/github';
import { retry } from '@octokit/plugin-retry';
import { Octokit } from '@octokit/rest';

import { parseTestReports } from './utils';
import type {
    CheckConclusion,
    CheckOutput,
    CheckTarget,
    ParseResult,
    ParsedActionInputs,
    ReportModeInput,
    ResolvedReportMode,
    TestAnnotation
} from './types';

const RetryingOctokit = Octokit.plugin(retry);
const completedCheckStatus = 'completed' as const;
const defaultCreateCheck = true;
const defaultCheckName = 'Test Report';
const defaultReportMode = 'auto' as const;
const maxCheckAnnotations = 50;

function buildRetryingOctokitClient(
    githubToken: string,
    githubBaseUrl: string
): InstanceType<typeof RetryingOctokit> {
    const baseRequest: ConstructorParameters<typeof RetryingOctokit>[0] = {
        auth: githubToken,
        request: { retries: 3 }
    };

    if (githubBaseUrl) {
        baseRequest.baseUrl = githubBaseUrl;
    }

    return new RetryingOctokit(baseRequest);
}

function buildCheckOutput(
    title: string,
    summary: string,
    annotations: readonly TestAnnotation[]
): CheckOutput {
    return {
        title,
        summary,
        annotations: annotations.slice(0, maxCheckAnnotations)
    };
}

function appendWorkflowRunSummary(summary: string, detailsUrl?: string): string {
    if (!detailsUrl) {
        return summary;
    }

    const workflowRunSummary = `Published from workflow run: [${detailsUrl}](${detailsUrl})`;
    if (!summary) {
        return workflowRunSummary;
    }
    if (summary.includes(detailsUrl)) {
        return summary;
    }

    return `${summary}\n\n${workflowRunSummary}`;
}

function buildPublishedSummary(customSummary: string, fallbackSummary: string, detailsUrl?: string): string {
    if (customSummary) {
        return customSummary;
    }

    return appendWorkflowRunSummary(fallbackSummary, detailsUrl);
}

function resolveCurrentWorkflowRunUrl(): string | undefined {
    const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL } = process.env;

    if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID || !GITHUB_SERVER_URL) {
        return undefined;
    }

    return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

function resolveCheckTarget(
    commit: string,
    pullRequest: typeof github.context.payload.pull_request
): CheckTarget {
    return {
        link: pullRequest?.html_url || github.context.ref,
        headSha: String(commit || pullRequest?.head.sha || github.context.sha)
    };
}

function readBooleanInput(name: string, defaultValue = false): boolean {
    const rawValue = core.getInput(name);

    return rawValue ? rawValue === 'true' : defaultValue;
}

function readReportModeInput(): ReportModeInput {
    const rawValue = core.getInput('report_mode').trim();

    if (!rawValue) {
        return defaultReportMode;
    }

    if (rawValue === 'auto' || rawValue === 'check-run' || rawValue === 'workflow') {
        return rawValue;
    }

    throw new Error(
        `Invalid report_mode '${rawValue}'. Expected one of: auto, check-run, workflow.`
    );
}

function normalizeReportPaths(reportPaths: string): string {
    return reportPaths
        .split(',')
        .map(pathPattern => pathPattern.trim())
        .filter(Boolean)
        .join('\n');
}

function getParsedInputs(): ParsedActionInputs {
    return {
        reportPaths: normalizeReportPaths(core.getInput('report_paths')),
        githubToken: core.getInput('github_token'),
        reportMode: readReportModeInput(),
        createCheck: readBooleanInput('create_check', defaultCreateCheck),
        checkName: core.getInput('check_name') || defaultCheckName,
        commit: core.getInput('commit'),
        failOnFailedTests: readBooleanInput('fail_on_test_failures'),
        failIfNoTests: readBooleanInput('fail_if_no_tests'),
        ignoreFlakyTests: readBooleanInput('ignore_flaky_tests'),
        skipPublishing: readBooleanInput('skip_publishing'),
        isFilenameInStackTrace: readBooleanInput('file_name_in_stack_trace'),
        githubBaseUrl: core.getInput('github_base_url'),
        customSummary: core.getInput('custom_summary')
    };
}

function determineConclusion(
    { count, skipped, annotations }: ParseResult,
    failIfNoTests: boolean
): CheckConclusion {
    const foundResults = count > 0 || skipped > 0;

    if ((foundResults && annotations.length === 0) || (!foundResults && !failIfNoTests)) {
        return 'success';
    }

    return 'failure';
}

function buildResultTitle({ count, skipped, annotations }: ParseResult): string {
    const foundResults = count > 0 || skipped > 0;

    if (!foundResults) {
        return 'No test results found!';
    }

    return `${count} tests run, ${skipped} skipped, ${annotations.length} failed.`;
}

function resolveReportMode(reportMode: ReportModeInput): ResolvedReportMode {
    if (reportMode === 'auto') {
        return github.context.eventName === 'workflow_dispatch' ||
            github.context.eventName === 'schedule'
            ? 'workflow'
            : 'check-run';
    }

    return reportMode;
}

function publishWorkflowAnnotations(annotations: readonly TestAnnotation[]): void {
    for (const annotation of annotations.slice(0, maxCheckAnnotations)) {
        const columnProps =
            annotation.start_column > 0 && annotation.end_column > 0
                ? {
                      startColumn: annotation.start_column,
                      endColumn: annotation.end_column
                  }
                : {};

        core.error(annotation.message, {
            title: annotation.title,
            file: annotation.path,
            startLine: annotation.start_line,
            endLine: annotation.end_line,
            ...columnProps
        });
    }
}

interface PublishResultsOptions {
    annotations: readonly TestAnnotation[];
    conclusion: CheckConclusion;
    detailsUrl?: string;
    name: string;
    createCheck: boolean;
    githubBaseUrl: string;
    githubToken: string;
    headSha: string;
    link: string;
    title: string;
    customSummary: string;
}

interface PublishResultsResult {
    published: boolean;
    checkUrl?: string;
}

async function publishResults({
    annotations,
    conclusion,
    createCheck,
    detailsUrl,
    githubBaseUrl,
    githubToken,
    headSha,
    link,
    name,
    title,
    customSummary
}: PublishResultsOptions
): Promise<PublishResultsResult> {
    const octokit = buildRetryingOctokitClient(githubToken, githubBaseUrl);

    if (createCheck) {
        core.info(
            `Posting status '${completedCheckStatus}' with conclusion '${conclusion}' to ${link} (sha: ${headSha})`
        );
        const createCheckRequest = {
            ...github.context.repo,
            name,
            head_sha: headSha,
            status: completedCheckStatus,
            conclusion,
            output: buildCheckOutput(
                title,
                buildPublishedSummary(customSummary, '', detailsUrl),
                annotations
            ),
            ...(detailsUrl ? { details_url: detailsUrl } : {})
        };

        core.debug(JSON.stringify(createCheckRequest, null, 2));

        const createResponse = await octokit.rest.checks.create(createCheckRequest);
        const checkUrl = createResponse.data.html_url || undefined;
        if (checkUrl) {
            core.info(`Created '${name}' check run: ${checkUrl}`);
        }
        return { published: true, checkUrl };
    }

    const listResponse = await octokit.rest.checks.listForRef({
        ...github.context.repo,
        check_name: name,
        ref: headSha,
        status: 'in_progress'
    });
    const checkRuns = listResponse.data.check_runs;
    core.debug(JSON.stringify(checkRuns, null, 2));
    if (checkRuns.length === 0) {
        core.setFailed(`Did not find any in progress '${name}' check for sha ${headSha}`);
        return { published: false };
    }
    if (checkRuns.length !== 1) {
        core.setFailed(`Found multiple in progress '${name}' checks for sha ${headSha}`);
        return { published: false };
    }

    const checkRun = checkRuns[0];
    core.info(`Patching '${name}' check for ${link} (sha: ${headSha})`);
    const updateCheckRequest = {
        ...github.context.repo,
        check_run_id: checkRun.id,
        output: buildCheckOutput(
            checkRun.output.title || title,
            buildPublishedSummary(customSummary, checkRun.output.summary || '', detailsUrl),
            annotations
        ),
        ...(detailsUrl ? { details_url: detailsUrl } : {})
    };

    core.debug(JSON.stringify(updateCheckRequest, null, 2));

    const updateResponse = await octokit.rest.checks.update(updateCheckRequest);
    return { published: true, checkUrl: updateResponse.data.html_url || undefined };
}

async function writeStepSummary(
    name: string,
    title: string,
    checkUrl: string | undefined,
    detailsUrl: string | undefined,
    reportMode: ResolvedReportMode,
    customSummary: string,
    annotationCount = 0
): Promise<void> {
    if (!process.env.GITHUB_STEP_SUMMARY) {
        return;
    }

    try {
        const summary = core.summary.addHeading(name, 2).addRaw(`${title}\n\n`);

        if (customSummary) {
            await summary.addRaw(`${customSummary}\n`).write();
            return;
        }

        if (reportMode === 'workflow' && annotationCount > 0) {
            summary.addRaw('Published as workflow annotations on this job.\n');
        }

        if (checkUrl) {
            summary.addLink('View published check run', checkUrl).addRaw('\n\n');
        }

        if (detailsUrl) {
            summary.addLink('View workflow run', detailsUrl).addRaw('\n');
        }

        await summary.write();
    } catch (error) {
        core.warning(`Could not write test report step summary: ${String(error)}`);
    }
}

export default async function action(): Promise<void> {
    const inputs = getParsedInputs();
    core.info(`Going to parse results from ${inputs.reportPaths?.split("\n")}`);

    const result = await parseTestReports(
        inputs.reportPaths,
        inputs.isFilenameInStackTrace,
        inputs.ignoreFlakyTests
    );
    const conclusion = determineConclusion(result, inputs.failIfNoTests);

    if (inputs.skipPublishing) {
        core.info('Not publishing test result due to skip_publishing=true');
    } else {
        const title = buildResultTitle(result);
        const reportMode = resolveReportMode(inputs.reportMode);
        core.info(`Result: ${title}`);

        if (reportMode === 'workflow') {
            core.info(`Publishing results in workflow mode for event '${github.context.eventName}'`);
            publishWorkflowAnnotations(result.annotations);
            await writeStepSummary(
                inputs.checkName,
                title,
                undefined,
                undefined,
                reportMode,
                inputs.customSummary,
                result.annotations.length
            );
        } else {
            const { link, headSha } = resolveCheckTarget(
                inputs.commit,
                github.context.payload.pull_request
            );
            const detailsUrl = resolveCurrentWorkflowRunUrl();
            const published = await publishResults({
                annotations: result.annotations,
                conclusion,
                createCheck: inputs.createCheck,
                detailsUrl,
                githubBaseUrl: inputs.githubBaseUrl,
                githubToken: inputs.githubToken,
                headSha,
                link,
                name: inputs.checkName,
                title,
                customSummary: inputs.customSummary
            });
            if (!published.published) {
                return;
            }
            await writeStepSummary(
                inputs.checkName,
                title,
                published.checkUrl,
                detailsUrl,
                reportMode,
                inputs.customSummary
            );
        }
    }

    core.setOutput('conclusion', conclusion);

    if (inputs.failOnFailedTests && conclusion !== 'success') {
        core.setFailed(`There were ${result.annotations.length} failed tests`);
    }
}
