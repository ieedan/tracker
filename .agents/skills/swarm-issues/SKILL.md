---
name: swarm-issues
description: Fetch the issues the user wants worked from the tracker's MCP server, then deploy a swarm of sub-agents to solve each issue individually. Use when the user asks to swarm issues, work a batch of tracker issues, or invoke this skill by name.
disable-model-invocation: true
---

# Swarm issues

Look at the issues the user wants you to work on and then deploy a swarm of sub-agents to solve each issue individually.

This app is a Linear-style tracker. You reach it over **MCP** — there is no token to fetch, no key to paste, and nothing to put in an `Authorization` header. Your harness holds the credential and renews it on its own.

## Connect

Look for the tracker's tools in your available tools. If they are there, you are connected — go to [What you are](#what-you-are).

If they are missing, the server has not been added yet. Ask the user to add it once:

```sh
claude mcp add --transport http tracker http://localhost:5173/api/mcp
```

Origin is `BETTER_AUTH_URL` in `.env`, default `http://localhost:5173`; the app must be running. Other harnesses take the same URL as JSON:

```json
{ "mcpServers": { "tracker": { "type": "http", "url": "http://localhost:5173/api/mcp" } } }
```

The first connection opens a browser. The user signs in (seeded demo is `demo@tracker.dev` / `password123`), confirms which agent you are, and clicks Authorize. That is the only time they are asked; after that the connection persists until they disconnect it under Settings → Account. The exact instructions are also in the app, under Settings → Account → Connect agent.

Do **not** try to register an OAuth client, run a device flow, or call `/api/auth/*` yourself. The harness does that, and doing it by hand creates a second identity.

Do **not** use an API key (`trk_…`) or the REST API directly. Keys belong to people, so a key would attribute your work to whoever minted it.

## What you are

Read the tool descriptions before you start — they are the contract, and they are more current than this file. There is a tool that reports who you are; call it if anything is unclear.

You are a **bot member** with your own name, not the person who authorized you:

- Issues you file and comments you write are attributed to **you**, and carry your agent's mark in the UI.
- You can never do more than the person who authorized you, and you are **never an administrator**. Managing teams, members, webhooks and workspace settings all fail — that is the design, not a bug to work around.
- You reach **every workspace that person belongs to**, including ones they join later.

## Workspaces

A tool that acts inside a workspace takes a workspace slug (e.g. `acme`). Omit it when you can only reach one and it is filled in for you. If you can reach several and omit it, the error names them — pass one and retry. There is a tool that lists your reach. If the user named a slug, use it.

## Working with issues

Identifiers are what people say out loud: `ENG-42`. Case-insensitive on the way in. Moving an issue between teams reallocates its number, so the identifier can change — the response carries the new one.

Statuses: `backlog`, `todo`, `in_progress`, `done`, `canceled`.
Priorities: `none`, `urgent`, `high`, `medium`, `low`.

Prefer a search argument over listing everything and filtering yourself. A team key that does not exist is an error, not an empty list. Do not delete an issue unless the user asked.

Failures come back as tool errors with the reason in them. Read the message rather than retrying blindly: it distinguishes "your scopes are too narrow", "that is admin-only", and "no such issue or workspace", which need different responses.

## Swarm

Copy this checklist:

```
- [ ] Connected (tracker tools available)
- [ ] Workspace resolved
- [ ] Issue list resolved
- [ ] One sub-agent launched per issue
- [ ] Each issue updated when that agent finishes
```

1. **Resolve which issues.** If the user named identifiers (`ENG-2`, `PRD-1`), fetch those. If they said "open", "todo" or similar, list by the statuses they meant. Skip `done` and `canceled` unless they asked to include them.

2. **Load each issue and its comments before launching.** Pass that snapshot into the sub-agent so it does not have to rediscover anything.

3. **Launch one sub-agent per issue, in parallel.** Each prompt must be self-contained — sub-agents do not see this conversation. Include:
   - the workspace slug and the issue identifier
   - title, description, comments, labels, and repository if any
   - implement this issue in the local repo; use the **implementjs** / **implementjs-kit** skills for UI and routing work
   - do not commit unless the parent asked for commits
   - when starting: set the issue's status to `in_progress`
   - when finished: set it to `done`, leave a comment summarising what changed (files, behaviour), and link the pull request if one was opened
   - if blocked: comment with the blocker, leave the status `in_progress`, do not mark it done

   Sub-agents inherit the same MCP connection, so there is nothing to hand them — no token, no origin, no headers. Tell them to use the tracker's tools and let them read the descriptions.

4. **Report per issue** once they return: identifier, outcome, and the comment left. If a sub-agent could not reach the tracker, the connection dropped rather than expired — ask the user to check Settings → Account, then retry only the failures.
