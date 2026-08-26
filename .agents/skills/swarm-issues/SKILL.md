---
name: swarm-issues
description: Find issues marked todo in the given workspace or workspaces and delegate them to subagents.
disable-model-invocation: true
---

Find issues marked todo in the given workspace or workspaces and delegate them to subagents. Use the tracker MCP to find the issues.

## Rules

- Only delegate issues that are marked todo.
- Delegate the work so that related issues (or issues that will conflict) can be worked on by the same subagent preventing overlap.
- Don't give subagents too much context, likewise don't dig too deep. Only dig deep enough to understand which issues should be delegated to which subagents DO NOT GIVE RECOMMENDED SOLUTIONS allow the subagents to do that on their own
- Never automatically check for more issues, only check for the issues one time

## The flow

You
1. Find all the issues in the given workspace marked as "todo" using the tracker MCP
2. Evaluate the issues and determine which issues should be delegated to which subagents.
3. Delegate the issues to the subagents.

Subagent:
1. Receives the issue(s) to work on from you
2. Reads the issue(s) fresh to understand the issue(s)
3. Creates its own worktree for the issue(s) with the name `bee/<issue-number>` (ex: bee/ENG_123, bee/ENG-123/456)
4. Marks the issue(s) as "in progress" and assign them to yourself ("Claude", "Cursor", whatever agent you are authed as through the tracker MCP)
5. Create and commit changes
6. Creates a PR for the issue(s)
7. Once the PR has been created it links the PR to the issue(s)

