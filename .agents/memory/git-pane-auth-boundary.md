---
name: Git pane authentication boundary
description: Replit GitHub API OAuth can work while Git pane HTTPS push remains unauthenticated.
---

GitHub connector access and Replit Git pane Git transport authentication are separate paths; a healthy OAuth connection does not prove that HTTPS push credentials in the Git pane have refreshed.

**Why:** A repository read through the GitHub connector succeeded while both shell `git push` and the Git pane continued returning `Invalid username or token` after reauthorization.

**How to apply:** Do not repeatedly reauthorize or ask for a token. Keep local merge work and backups intact, have the user repair the Git pane session manually, and only consider an API-based branch/PR snapshot after explicit approval because it changes commit history.