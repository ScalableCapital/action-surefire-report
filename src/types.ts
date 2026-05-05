export type MaybeArray<T> = T | T[];

export interface TestAnnotation {
    path: string;
    start_line: number;
    end_line: number;
    start_column: number;
    end_column: number;
    annotation_level: 'failure';
    title: string;
    message: string;
    raw_details: string;
}

export interface ParseResult {
    count: number;
    skipped: number;
    annotations: TestAnnotation[];
}

export interface ResolvedFileAndLine {
    filename: string;
    filenameWithPackage: string;
    line: number;
}

export type CheckConclusion = 'success' | 'failure';
export type ReportModeInput = 'auto' | 'check-run' | 'workflow';
export type ResolvedReportMode = 'check-run' | 'workflow';

export interface ReportTextNode {
    _attributes?: {
        message?: string;
    };
    _cdata?: MaybeArray<string>;
    _text?: MaybeArray<string>;
}

export interface ReportTestCase {
    _attributes: {
        name: string;
        file?: string;
        classname: string;
    };
    skipped?: unknown;
    failure?: ReportTextNode;
    flakyFailure?: ReportTextNode;
    error?: ReportTextNode;
}

export interface ReportTestSuite {
    testcase?: MaybeArray<ReportTestCase>;
}

export interface ParsedReport {
    testsuite?: ReportTestSuite;
    testsuites?: {
        testsuite?: MaybeArray<ReportTestSuite>;
    };
}

export interface ParsedActionInputs {
    reportPaths: string;
    githubToken: string;
    reportMode: ReportModeInput;
    createCheck: boolean;
    checkName: string;
    commit: string;
    failOnFailedTests: boolean;
    failIfNoTests: boolean;
    ignoreFlakyTests: boolean;
    skipPublishing: boolean;
    isFilenameInStackTrace: boolean;
    githubBaseUrl: string;
    customSummary: string;
}

export interface CheckOutput {
    title: string;
    summary: string;
    annotations: TestAnnotation[];
}

export interface CheckTarget {
    link: string;
    headSha: string;
}
