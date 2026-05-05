import * as core from '@actions/core';
import * as glob from '@actions/glob';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as parser from 'xml-js';

import type {
    MaybeArray,
    ParsedReport,
    ParseResult,
    ReportTestCase,
    ReportTestSuite,
    ReportTextNode,
    ResolvedFileAndLine,
    TestAnnotation
} from './types';

const resolvedPathCache = new Map<string, Promise<string>>();
const ignoredDirectoryNames = new Set(['.git', 'dist', 'lib', 'node_modules']);
let workspaceFileIndexPromise: Promise<string[]> | undefined;
const fallbackLineNumber = 1;

function toArray<T>(value: MaybeArray<T> | undefined): T[] {
    if (!value) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

function getTestsuites(report: ParsedReport): ReportTestSuite[] {
    if (report.testsuite) {
        return [report.testsuite];
    }

    return toArray(report.testsuites?.testsuite);
}

function getTestcases(testsuite: ReportTestSuite): ReportTestCase[] {
    return toArray(testsuite.testcase);
}

function getFailureDetails(
    testcase: ReportTestCase,
    ignoreFlakyTests?: boolean
): ReportTextNode | undefined {
    if (testcase.failure) {
        return testcase.failure;
    }

    if (testcase.flakyFailure && !ignoreFlakyTests) {
        return testcase.flakyFailure;
    }

    if (testcase.error) {
        return testcase.error;
    }

    return undefined;
}

function getTextContent(node: ReportTextNode): string {
    return toArray(node._cdata ?? node._text)
        .join('')
        .trim();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLineNumber(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? '', 10);

    return Number.isNaN(parsed) ? fallbackLineNumber : parsed;
}

export const resolveFileAndLine = (
    file: string | null | undefined,
    classname: string,
    output: string,
    isFilenameInOutput?: boolean
): ResolvedFileAndLine => {
    let filename: string;
    let filenameWithPackage: string;

    if (isFilenameInOutput) {
        filename = output.split(':')[0].trim();
        filenameWithPackage = filename;
    } else {
        filename = file || classname.split('.').at(-1)?.split('(')[0] || '';
        filenameWithPackage = classname.replace(/\./g, '/');
    }

    const escapedFilename = escapeRegExp(filename);
    const matches = output.match(new RegExp(String.raw`${escapedFilename}.*?:\d+`, 'g'));

    if (!matches) {
        return { filename, filenameWithPackage, line: fallbackLineNumber };
    }

    const [lastItem] = matches.slice(-1);
    const [, line] = lastItem.split(':');
    core.debug(
        `Resolved file ${filenameWithPackage} with name ${filename} and line ${line}`
    );

    return { filename, filenameWithPackage, line: parseLineNumber(line) };
};

export const resolvePath = async (filenameWithPackage: string): Promise<string> => {
    const cached = resolvedPathCache.get(filenameWithPackage);
    if (cached) {
        return cached;
    }

    const resolutionPromise = resolvePathUncached(filenameWithPackage);
    resolvedPathCache.set(filenameWithPackage, resolutionPromise);
    return resolutionPromise;
};

async function resolvePathUncached(filenameWithPackage: string): Promise<string> {
    core.debug(`Resolving path for ${filenameWithPackage}`);
    const results = await findMatchingWorkspaceFiles(filenameWithPackage);
    core.debug(`Matched files: ${results}`);

    const resolvedPath =
        results.find(
            result => !result.includes('__pycache__') && !result.endsWith('.class')
        ) ?? filenameWithPackage;
    core.debug(`Resolved path: ${resolvedPath}`);

    const canonicalPath = resolvedPath.replaceAll('\\', '/');
    core.debug(`Canonical path: ${canonicalPath}`);

    return canonicalPath;
}

async function findMatchingWorkspaceFiles(
    filenameWithPackage: string
): Promise<string[]> {
    const workspaceFiles = await getWorkspaceFileIndex();
    const normalizedNeedle = filenameWithPackage.replaceAll('\\', '/');

    return workspaceFiles.filter(relativePath => {
        if (relativePath === normalizedNeedle) {
            return true;
        }

        if (relativePath.startsWith(`${normalizedNeedle}.`)) {
            return true;
        }

        return (
            relativePath.endsWith(`/${normalizedNeedle}`) ||
            relativePath.includes(`/${normalizedNeedle}.`)
        );
    });
}

async function getWorkspaceFileIndex(): Promise<string[]> {
    workspaceFileIndexPromise ??= listWorkspaceFiles(process.cwd(), '');

    return workspaceFileIndexPromise;
}

async function listWorkspaceFiles(
    absoluteDirectory: string,
    relativeDirectory: string
): Promise<string[]> {
    const directoryEntries = await fs.readdir(absoluteDirectory, {
        withFileTypes: true
    });
    const files: string[] = [];

    for (const entry of directoryEntries) {
        const entryAbsolutePath = path.join(absoluteDirectory, entry.name);
        const entryRelativePath = relativeDirectory
            ? `${relativeDirectory}/${entry.name}`
            : entry.name;

        if (entry.isDirectory()) {
            if (ignoredDirectoryNames.has(entry.name) || entry.name === '__pycache__') {
                continue;
            }

            files.push(
                ...(await listWorkspaceFiles(entryAbsolutePath, entryRelativePath))
            );
            continue;
        }

        files.push(entryRelativePath.replaceAll('\\', '/'));
    }

    return files;
}

export async function parseFile(
    file: string,
    isFilenameInStackTrace?: boolean,
    ignoreFlakyTests?: boolean
): Promise<ParseResult> {
    core.debug(`Parsing file ${file}`);
    let count = 0;
    let skipped = 0;
    const annotations: TestAnnotation[] = [];

    const report = JSON.parse(
        parser.xml2json(await fs.readFile(file, 'utf8'), { compact: true })
    ) as ParsedReport;
    core.debug(`parsed report: ${JSON.stringify(report)}`);

    const testsuites = getTestsuites(report);
    core.debug(`test suites: ${JSON.stringify(testsuites)}`);

    for (const testsuite of testsuites) {
        for (const testcase of getTestcases(testsuite)) {
            count++;
            if (testcase.skipped) {
                skipped++;
            }

            const failureDetails = getFailureDetails(testcase, ignoreFlakyTests);
            if (!failureDetails) {
                continue;
            }

            const stackTrace = getTextContent(failureDetails);

            const message = (
                failureDetails._attributes?.message ||
                stackTrace.split('\n').slice(0, 2).join('\n') ||
                testcase._attributes.name
            ).trim();

            const { filename, filenameWithPackage, line } = resolveFileAndLine(
                testcase._attributes.file,
                testcase._attributes.classname,
                stackTrace,
                isFilenameInStackTrace
            );

            const path = await resolvePath(filenameWithPackage);
            const title = `${filename}.${testcase._attributes.name}`;
            core.info(`${path}:${line} | ${message.replaceAll('\n', ' ')}`);

            annotations.push({
                path,
                start_line: line,
                end_line: line,
                start_column: 0,
                end_column: 0,
                annotation_level: 'failure',
                title,
                message,
                raw_details: stackTrace
            });
        }
    }

    return { count, skipped, annotations };
}

export const parseTestReports = async (
    reportPaths: string,
    isFilenameInStackTrace?: boolean,
    ignoreFlakyTests?: boolean
): Promise<ParseResult> => {
    const globber = await glob.create(reportPaths, { followSymbolicLinks: false });
    let annotations: TestAnnotation[] = [];
    let count = 0;
    let skipped = 0;

    for await (const file of globber.globGenerator()) {
        const parsed = await parseFile(
            file,
            isFilenameInStackTrace,
            ignoreFlakyTests
        );
        if (parsed.count === 0) {
            continue;
        }
        count += parsed.count;
        skipped += parsed.skipped;
        annotations = annotations.concat(parsed.annotations);
    }

    return { count, skipped, annotations };
};
