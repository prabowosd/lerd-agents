# Agents

Shows the coding agents that [herdr](https://herdr.dev) and [Orca](https://github.com/stablyai/orca) run in each site and its worktrees, opens a checkout in either tool, and tells you when an agent finishes. Each part works with whichever of the two tools is running; the other is skipped.

## Use

- **Agents tab** on a site: every agent in the site's checkouts with its state and last message, refreshed every five seconds, and a herdr and an Orca button per checkout.
- **Overview card**: a count of agents per state. Switch it on from the plugin icon in the site's header, or `lerd plugin card agents on` in the project.
- **Commands menu**: **Open in herdr** focuses the herdr workspace already in the selected checkout, or creates one. **Open in Orca** adds the site's repository to Orca when it is missing, then switches to a terminal in the checkout, creating one when it has none.
- `lerd agents:status [site]` lists the agents in the terminal; assistants get the same through the `agents_status` tool.

## Worktrees

When lerd sees a new worktree, the plugin creates a herdr workspace for it in the background and makes Orca list worktrees it did not create for that repository. When the worktree goes, the herdr workspace the plugin created is closed, unless an agent in it is still working or waiting.

## Notifications

`lerd agents:watch` checks both tools every five seconds and sends a lerd notification when an agent goes from working to done, or starts waiting for input. It runs in the foreground until stopped, so keep it in a herdr or Orca pane. Set `AGENTS_WATCH_INTERVAL` (seconds) to change the pace.

Allow the plugin's notifications when lerd asks, or later with `lerd plugin notifications agents on`.

## Requirements

`herdr`, and Orca's CLI: `orca` on macOS, `orca-ide` on Linux (bare `orca` there is GNOME's screen reader, so the plugin never runs it). Set `HERDR_BIN` or `ORCA_BIN` when they live somewhere unusual. herdr needs its server running (an open herdr session); Orca needs the app or `orca serve` running.
