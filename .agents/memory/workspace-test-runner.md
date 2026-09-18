---
name: Workspace test runner
description: Environment-specific behavior when running TypeScript tests directly in the pnpm workspace
---

Direct `node --experimental-strip-types --test` execution can fail before a test starts when a workspace package imports a directory such as the database schema barrel. TypeScript API tests also rely on the repository-local `scripts/node_modules/.bin/tsx` runner when invoked from the workspace root. These are runner/module-resolution limitations, not evidence that the API build or workflow is broken.

**Why:** The project uses workspace package exports and source barrels that are resolved correctly by the normal build/workflow toolchain but are not always resolved by Node's direct TypeScript runner.

**How to apply:** Check the package's supported test/build command first; use `scripts/node_modules/.bin/tsx --test <workspace-test-path>` for TypeScript API tests. If a direct test invocation fails at module resolution, report it separately from feature failures and do not change workspace imports just to satisfy that ad-hoc runner.