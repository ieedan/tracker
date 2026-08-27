<img src="./assets/logo.svg" alt="" width="72" align="right">

# tracker — Claude Code / Cursor plugin

The [tracker](https://github.com/ieedan/tracker) MCP server, packaged so an
editor installs it with a name, a description and a logo instead of a URL
someone pasted into a JSON file.

One directory, two manifests. Claude Code reads `.claude-plugin/plugin.json`
and `.mcp.json`; Cursor reads `.cursor-plugin/plugin.json` and `mcp.json`.
Both point at the same endpoint and ask for the same one value.

## What it connects to

`POST <your tracker>/api/mcp` — Streamable HTTP, JSON-only, no session id, and
OAuth in front of it. There is no token to paste: the first call gets a 401
carrying `WWW-Authenticate: Bearer resource_metadata="…"`, the client follows it
to `/.well-known/oauth-protected-resource`, registers itself, and a person
approves the connection on tracker's consent screen. What it may do afterwards
is what they approved there — see [_Webhooks from an agent_ in the main
README](../README.md#webhooks-from-an-agent) for how a grant and a scope combine.

The tools cover issues (`list_issues`, `get_issue`, `create_issue`,
`update_issue`, `transfer_issue`, `comment_on_issue`, `read_attachment`,
`link_pull_request`), the workspace (`whoami`, `list_teams`, `list_members`,
`list_labels`, `create_label`, `list_repositories`), user feedback
(`list_feedback`, `update_feedback`, `convert_feedback_to_issue`), the inbox
(`list_notifications`), and webhooks (`list_webhooks`, `create_webhook`,
`test_webhook`, `list_webhook_deliveries`, …). The webhook tools need
`webhooks:write`, which is grantable but never handed out by default.

## The one setting

**tracker URL** — the origin of your instance, no trailing slash. The plugin
appends `/api/mcp`. It defaults to `https://tracker.implementjs.dev`, the hosted
one, so most people never answer it. Point it at your own deployment, or at
`http://localhost:5173` for a checkout running `pnpm dev`.

Claude Code prompts for it at install and substitutes it as
`${user_config.url}`. Cursor ships the hosted URL inlined in `mcp.json` (plugin
`${VAR}` defaults are not applied until someone opens **Plugins → Configure**,
which left a fresh install fetching the literal `${TRACKER_URL}` and failing).
For a self-hosted Cursor install, use the deeplink below or edit the URL by
hand. Nothing else is configurable, and no secret is stored — the OAuth flow
holds the credential, not this manifest.

## Install in Claude Code

```sh
/plugin marketplace add ieedan/tracker
/plugin install tracker@tracker
```

The marketplace manifest lives at [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)
in the repository root and points back at this directory, so the repository is
both the app and the marketplace that ships its plugin.

To try a change to the plugin before pushing it:

```sh
claude --plugin-dir ./plugin
claude plugin validate ./plugin
```

`validate` is the check that matters; neither manifest carries a `$schema`,
because the two published ones are behind their own documentation — schemastore's
copy of the plugin manifest is missing `icon` and `displayName`, and the
marketplace URL the docs print serves a docs page rather than a schema. Pointing
at either would red-underline a file that is in fact valid. Expect one warning
from `validate` on `icon` for the same reason: the field is documented, older
CLIs ignore it, and ignoring it costs the logo, not the install.

## Install in Cursor

Cursor plugins are installed from the marketplace, or from a checkout during
development. To skip the plugin and just add the server, the install deeplink
carries the config inline:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=tracker&config=eyJ1cmwiOiJodHRwczovL3RyYWNrZXIuaW1wbGVtZW50anMuZGV2L2FwaS9tY3AifQ==
```

That one is the `https://tracker.implementjs.dev` default. For your own instance,
the config is base64 of the same object with your origin in it:

```sh
node -e 'const c={url:process.argv[1]+"/api/mcp"};console.log("cursor://anysphere.cursor-deeplink/mcp/install?name=tracker&config="+Buffer.from(JSON.stringify(c)).toString("base64"))' https://tracker.acme.dev
```

Or write it by hand into `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a
project):

```json
{
	"mcpServers": {
		"tracker": {
			"url": "https://tracker.implementjs.dev/api/mcp"
		}
	}
}
```

## Editing it

The logo is `assets/logo.svg`, the same mark as the app's `static/favicon.svg`,
with `assets/logo.png` its 512×512 rasterisation for clients that want a bitmap.
A manifest may only reference paths inside its own plugin, so the mark is copied
here rather than shared; `pnpm verify:mcp` asserts the two SVGs still match, and
that both manifests still point at the route the app actually serves. Redraw one
and that check tells you about the other.
