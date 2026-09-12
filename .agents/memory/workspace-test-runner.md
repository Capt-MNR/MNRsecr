---
name: Workspace test runner
description: Environment-specific behavior when running TypeScript tests directly in the pnpm workspace
---

Direct `node --experimental-strip-types --test` execution can fail before a test starts when a workspace package imports a directory such as the database schema barrel. This is a module-resolution limitation of the direct runner, not evidence that the API build or workflow is broken.

**Why:** The project uses workspace package exports and source barrels that are resolved correctly by the normal build/workflow toolchain but are not always resolved by Node's direct TypeScript runner.

**How to apply:** Check the package's supported test/build command first. If a direct test invocation fails at module resolution, report it separately from feature failures and do not change workspace imports just to satisfy that ad-hoc runner.