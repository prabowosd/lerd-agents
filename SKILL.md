---
name: lerd-agents
description: See which herdr and Orca coding agents are working in a lerd site and its worktrees. Use when asked what agents are running on a site, whether an agent finished, or which worktree an agent is in.
---
# agents

Call `agents_status` with the site name. It answers which tools are running (`tools.herdr`, `tools.orca`), the site's checkouts (`folders`: main checkout first, then each worktree with its branch) and every agent in them (`agents`: `tool`, `agent`, `branch`, `state`, `summary`).

States: `working` is busy, `blocked` waits for an approval or answer, `done` finished and has not been looked at, `idle` is ready. A tool missing from `tools` is not running, so its agents are unknown, not absent.
