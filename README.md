# GitHub Action: Surefire Report

[![build](https://github.com/scacap-labs/action-surefire-report-v2/actions/workflows/build.yml/badge.svg)](https://github.com/scacap-labs/action-surefire-report-v2/actions/workflows/build.yml)

> [!IMPORTANT]
> Version 2 is the active release line for this action.
>
> Use `ScalableCapital/action-surefire-report@v2` and review the migration notes below if you are moving from `ScaCap/action-surefire-report@v1`.

This action processes Maven Surefire, Failsafe, Gradle, Pytest, Go, and other JUnit-compatible XML reports and publishes the results as either a GitHub check run or workflow-native annotations with a job summary.

![Screenshot](./screenshot.png)

## What Is New In v2

- Workflow-native reporting with `report_mode: workflow`, which keeps results on the current workflow run page instead of relying only on a separate check run.
- Better default behavior for `workflow_dispatch` and `schedule`: `report_mode: auto` now publishes workflow-native annotations and a job summary on those events.
- Clearer fork-PR usage: if a workflow cannot create or update check runs, `report_mode: workflow` avoids the Checks API requirement and still surfaces failures on the run page.
- `custom_summary`, which lets follow-up workflows or custom publishing flows override the published markdown summary.
- Stable migration path: the v2 goal is to preserve the existing action contract where possible while improving reporting behavior and maintainability.

## Migrating From v1

For most users, the main change is the action reference:

```yaml
# v1
- uses: ScaCap/action-surefire-report@v1

# v2
- uses: ScalableCapital/action-surefire-report@v2
```

When moving from v1 to v2, review these points:

1. Keep your existing inputs unless you want the new reporting behavior. The v2 release line is intended to keep the existing action contract stable where possible.
2. Review `report_mode` if you run on `workflow_dispatch`, `schedule`, or fork PRs. Those are the cases where v2's workflow-native reporting is the biggest improvement.
3. Use `report_mode: workflow` explicitly if your fork-PR token cannot create or update check runs.
4. Review `custom_summary` if you update an in-progress check with `create_check: false` or want a custom link back to another workflow or report surface.

## Example Usage

```yml
name: build
on:
  pull_request:

jobs:
  build:
    name: Build and Run Tests
    runs-on: ubuntu-latest
    permissions:
      checks: write
      contents: read
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4
      - name: Build and Run Tests
        run: mvn test --batch-mode --fail-at-end
      - name: Publish Test Report
        if: success() || failure()
        uses: ScalableCapital/action-surefire-report@v2
```

## Inputs

| Input                      | Required | Default                                                          | Description                                                                                                                                              |
|----------------------------|----------|------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `github_token`             | No       | `${{ github.token }}`                                            | GitHub token used to publish checks and annotations. Usually set as `github_token: ${{ secrets.GITHUB_TOKEN }}`.                                         |
| `report_paths`             | No       | `**/surefire-reports/TEST-*.xml, **/failsafe-reports/TEST-*.xml` | [Glob](https://github.com/actions/toolkit/tree/main/packages/glob) expression for surefire, failsafe, or JUnit-compatible XML report paths.              |
| `report_mode`              | No       | `auto`                                                           | Reporting mode. `auto` uses check runs for PR/push-style flows and workflow-native annotations plus step summary for `workflow_dispatch` and `schedule`. |
| `create_check`             | No       | `true`                                                           | When `report_mode` resolves to `check-run`, set to `false` to update an in-progress check instead of creating a separate check run.                      |
| `check_name`               | No       | `Test Report`                                                    | Check name to use when creating a check run.                                                                                                             |
| `commit`                   | No       |                                                                  | Commit SHA to update the status for. This is useful when running with `workflow_run`.                                                                    |
| `fail_on_test_failures`    | No       | `false`                                                          | Fail the action run if there are test failures.                                                                                                          |
| `fail_if_no_tests`         | No       | `true`                                                           | Fail the action run if no tests were found.                                                                                                              |
| `ignore_flaky_tests`       | No       | `false`                                                          | Set to `true` to consider flaky tests as success.                                                                                                        |
| `skip_publishing`          | No       | `false`                                                          | Skip test report publishing and check run creation.                                                                                                      |
| `file_name_in_stack_trace` | No       | `false`                                                          | Set to `true` to get the file name from the stack trace.                                                                                                 |
| `github_base_url`          | No       |                                                                  | GitHub Enterprise API URL, for example `https://github.myorg.com/api/v3`.                                                                                |
| `custom_summary`           | No       |                                                                  | Custom markdown summary text for the published check output, useful when linking report publication back to another workflow or context.                 |

## Tips For Gradle

As Gradle uses a different build directory than Maven by default, you might need to set the `report_paths` variable:

```yaml
    report_paths: '**/build/test-results/test/TEST-*.xml'
```

You also need to enable JUnit XML reports as shown below.

```groovy
test {
  reports {
    junitXml.enabled = true
  }
}
```

## Workflow-Native Reporting

`report_mode: auto` is the default. On `workflow_dispatch` or `schedule`, the action now publishes workflow-native annotations and a job summary instead of creating a separate check run by default. This keeps the results on the current workflow run page, which is where users expect to find them on manual and scheduled runs.

If you still want a separate check run on those events, set:

```yaml
    report_mode: check-run
```

If you want workflow-native reporting on any event, set:

```yaml
    report_mode: workflow
```

Tip: if your fork-PR workflow cannot create or update GitHub check runs, set `report_mode: workflow` explicitly. `report_mode: auto` does not currently switch to workflow reporting just because a pull request comes from a fork, so this makes the action publish workflow annotations and a job summary on the current run instead of relying on the Checks API.

## Contributing

Development setup, validation commands, release labels, and packaging guidance live in [CONTRIBUTING.md](./CONTRIBUTING.md).
