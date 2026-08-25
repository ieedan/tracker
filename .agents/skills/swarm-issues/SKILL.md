---
name: swarm-issues
description: Authenticate as a tracker OAuth agent, fetch the issues the user wants worked, and deploy a swarm of sub-agents to solve each issue individually. Use when the user asks to swarm issues, work a batch of tracker issues, or invoke this skill by name.
disable-model-invocation: true
---

# Swarm issues

Look at the issues the user wants you to work on and then deploy a swarm of sub-agents to solve each issue individually.

This app is a Linear-style tracker. Coding agents do **not** sign in as humans and do **not** use API keys (`trk_…`). They register as an OAuth client, a person authorizes them into one workspace via the device flow, and they call `/api/v1` as a bot member.

## Origin

The app must be running. Origin is `BETTER_AUTH_URL` in `.env`, default `http://localhost:5173`.

```
ORIGIN=http://localhost:5173
AUTH=$ORIGIN/api/auth
API=$ORIGIN/api/v1
```

If `TRACKER_ACCESS_TOKEN` is already set in the environment, skip registration and go to [Confirm the token](#confirm-the-token). Never write tokens into the repo.

## Authenticate

Humans get sessions and API keys. Agents get an **opaque** OAuth access token. The token is not a JWT — do not decode it. Prefix `trk_` means an API key; anything else in `Authorization: Bearer` is treated as an agent token.

An agent is a bot user plus a grant: it is a workspace member under its own name, capped below admin, and only as capable as the person who approved it. Writes (issues, comments) are stamped as the bot. The grant covers **one workspace**. Acting in any other slug 404s.

Do **not** poll `$AUTH/device/token`. That mints a first-party session. Agents poll `$AUTH/oauth2/token`.

### 1. Register a public client

Open registration (RFC 7591). Consent is never skipped. Ask only for grantable agent scopes — `openid` / `offline_access` are rejected at registration.

```sh
curl -sS -X POST "$AUTH/oauth2/register" \
  -H "content-type: application/json" \
  -d '{
    "client_name": "Coding agent",
    "application_type": "native",
    "token_endpoint_auth_method": "none",
    "grant_types": ["urn:ietf:params:oauth:grant-type:device_code"],
    "scope": "issues:read issues:write workspace:read"
  }'
```

Save `client_id`. Reuse it for later device runs in this session. Default grant_types is `authorization_code`, which requires redirect URIs and is the wrong grant — always send `device_code` explicitly.

Grantable scopes are `<resource>:<action>` over `issues`, `workspace`, `members`, `webhooks`, `feedback`, `notifications`. Agents cannot register or be granted `members:write`, `webhooks:read`, `webhooks:write`, or `workspace:write`.

For this skill request at least:

| Scope            | Why                                       |
| ---------------- | ----------------------------------------- |
| `issues:read`    | List and load issues and comments         |
| `issues:write`   | Update status, comment, create if asked   |
| `workspace:read` | Resolve the workspace slug and list teams |

`issues:write` implies read. `members:read` is optional (assignees).

### 2. Request a device code

```sh
curl -sS -X POST "$AUTH/device/code" \
  -H "content-type: application/json" \
  -d "{\"client_id\":\"$CLIENT_ID\",\"scope\":\"issues:read issues:write workspace:read\"}"
```

Response:

```json
{
	"device_code": "…",
	"user_code": "ABCD-EFGH",
	"verification_uri": "http://localhost:5173/device",
	"verification_uri_complete": "http://localhost:5173/device?user_code=ABCDEFGH",
	"expires_in": 1800,
	"interval": 5
}
```

Show the user `verification_uri_complete` and `user_code`. They must be signed in (seeded demo is `demo@tracker.dev` / `password123`), pick the **workspace**, and click Authorize. That is when the bot member is created.

### 3. Poll for the access token

Wait `interval` seconds (default 5). Poll `$AUTH/oauth2/token`, not `$AUTH/device/token`.

```sh
curl -sS -X POST "$AUTH/oauth2/token" \
  -H "content-type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=$DEVICE_CODE&client_id=$CLIENT_ID"
```

| `error`                 | What to do                                     |
| ----------------------- | ---------------------------------------------- |
| `authorization_pending` | Keep polling at `interval`                     |
| `slow_down`             | Add 5s to the interval, then keep polling      |
| `expired_token`         | Start again from step 2                        |
| `access_denied`         | Stop — the user cancelled                      |
| `invalid_grant`         | Wrong client, or the code was already consumed |

On success:

```json
{ "access_token": "…", "token_type": "Bearer", "expires_in": 3600, "scope": "…" }
```

Tokens last one hour. There is no refresh token on this path. If a call 401s, run the device flow again and pass the new token to still-running sub-agents.

Use this header on every API request:

```
Authorization: Bearer <access_token>
```

### Confirm the token

```sh
curl -sS "$API/me" -H "Authorization: Bearer $TOKEN"
```

Expect `authVia: "oauth"`, `user.type: "agent"`, and `agent.workspaceId`. `workspaceId` is an internal id, not the slug.

```sh
curl -sS "$API/workspaces" -H "Authorization: Bearer $TOKEN"
```

That returns the one workspace this grant covers (`slug`, `name`). Seeded demo slug is `acme`. If the user already named a slug, use it.

## Call the issues API

Full contract: `$ORIGIN/openapi.json`. Paths below are under `$API/workspaces/<slug>`.

Identifiers are what people say out loud: `ENG-42`. Parse is case-insensitive; the key is stored uppercase. Moving teams reallocates the number, so the identifier can change.

Statuses: `backlog`, `todo`, `in_progress`, `done`, `canceled`.
Priorities: `none`, `urgent`, `high`, `medium`, `low`.

### List

`GET …/issues`

Query: `team` (e.g. `ENG`), `status` (repeat: `?status=todo&status=in_progress`), `priority`, `assignee` (user id, or `none`), `q` (title/description search), `repository` (id).

A `team` that does not exist is 404, not an empty list.

### Read one

`GET …/issues/<identifier>` — full issue (title, description, status, priority, assignee, labels, team, repository, pull request, feedback link).

`GET …/issues/<identifier>/comments` — oldest first.

### Update

`PATCH …/issues/<identifier>` — JSON, any subset of:

```json
{
	"title": "…",
	"description": "…",
	"status": "in_progress",
	"priority": "high",
	"assigneeId": null,
	"labelIds": ["…"],
	"teamKey": "ENG",
	"repositoryId": null
}
```

`POST …/issues/<identifier>/comments` — `{ "body": "…" }` (1–10_000 chars). The author is this agent.

`POST …/issues` — create, requires `teamKey` and `title`. Only if the user asked to file new work.

`POST …/issues/<identifier>/pull-request` — `{ "reference": "https://github.com/org/repo/pull/12" }` (URL, `owner/name#12`, or `#12` when the issue is already scoped). One PR per issue.

Do not `DELETE` an issue unless the user asked.

### Errors

| Status | Meaning                                                            |
| ------ | ------------------------------------------------------------------ |
| 401    | Missing or expired token                                           |
| 403    | Scope too narrow, or an admin-only action                          |
| 404    | Unknown slug, identifier, or a workspace this grant does not cover |

## Swarm

Copy this checklist:

```
- [ ] Authenticated (token + slug)
- [ ] Issue list resolved
- [ ] One sub-agent launched per issue
- [ ] Each issue updated when that agent finishes
```

1. Resolve which issues. If the user named identifiers (`ENG-2`, `PRD-1`), fetch those. If they said “open”, “todo”, or similar, list with `status=todo` / `status=in_progress` / `status=backlog` as they meant. Skip `done` and `canceled` unless they asked to include them.
2. Load each issue and its comments **before** launching. Pass that snapshot into the sub-agent so it does not have to rediscover the API.
3. Launch **one sub-agent per issue, in parallel**. Each prompt must be self-contained — sub-agents do not see this conversation. Include:
   - `ORIGIN`, `TOKEN`, `SLUG`, identifier
   - title, description, comments, labels, repository if any
   - implement this issue in the local repo; use the **implementjs** / **implementjs-kit** skills for UI and routing work
   - do not commit unless the parent asked for commits
   - when starting: `PATCH` `{ "status": "in_progress" }`
   - when finished: `PATCH` `{ "status": "done" }` and `POST` a comment summarizing what changed (files, behavior)
   - if blocked: comment with the blocker, leave status `in_progress`, do not mark done
4. After all return, report per issue: identifier, outcome, and the comment you left. Re-auth and retry only the failures if the token expired mid-flight.

Do not share the token in commits, tracked files, or user-visible issue comments.
