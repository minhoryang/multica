# Multica — Product Requirements Document

## 1. Overview

### 1.1 Product Vision

Multica is an open-source, AI-native task management platform that treats coding agents as first-class team members. Where traditional project management tools manage humans, Multica manages both humans **and** AI agents side by side — on the same board, in the same conversations, with the same workflows.

> "Your next 10 hires won't be human."

### 1.2 Mission Statement

Turn coding agents into real teammates. Assign issues to an agent like you'd assign to a colleague — they pick up the work, write code, report blockers, and update statuses autonomously.

### 1.3 Target Users

| Persona | Description |
|---|---|
| **AI-native dev team lead** | 2–10 person team that has already adopted coding agents (Claude Code, Codex, etc.) and wants structured collaboration rather than one-off prompts |
| **Individual power user** | Solo developer or researcher running multiple agents in parallel who needs centralized visibility and management |
| **Self-hosting organization** | Engineering team that wants full control over their data, infra, and agent runtimes — no vendor lock-in |

### 1.4 Positioning

| | Multica | Linear | Jira | Paperclip |
|---|---|---|---|---|
| **Primary focus** | Human + AI agent collaboration | Human team project management | Enterprise task tracking | Solo AI-agent simulator |
| **Agent model** | First-class teammates | None | None | First-class, solo operator |
| **Deployment** | Cloud + Self-hosted | Cloud only | Cloud + Self-hosted | Local-first |
| **User model** | Multi-user teams | Multi-user teams | Multi-user teams | Single operator |
| **Agent interaction** | Issues + Chat + Skills | — | — | Issues + Heartbeat |
| **Open source** | ✅ | ❌ | ❌ | ✅ |

---

## 2. Problem Statement

### 2.1 The Core Problem

Modern coding agents (Claude Code, Codex, Gemini, etc.) are powerful but are used in an ad-hoc, unstructured way:

- Developers copy-paste prompts manually, losing context and repeatability.
- There is no visibility into what agents are working on.
- Agent outputs aren't tracked alongside human work.
- Each agent run is a one-off; successful solutions aren't reused.
- Coordinating multiple agents across multiple tasks is impossible without custom tooling.

### 2.2 What's Missing

1. **Structured task assignment** — no way to assign work to an agent the same way you'd assign to a colleague.
2. **Progress visibility** — no unified board showing agent work alongside human work.
3. **Persistent context** — agents don't carry forward what they've learned.
4. **Skill reuse** — every deployment script, migration, and code review prompt is reinvented every time.
5. **Team collaboration** — agents don't participate in conversations or report blockers.

---

## 3. Goals and Non-Goals

### 3.1 Goals

- **G1**: Enable teams to assign issues to AI agents as naturally as to human teammates.
- **G2**: Provide real-time visibility into agent execution — live progress, messages, tool calls.
- **G3**: Allow agents to create sub-issues, post comments, mention humans, and change issue statuses autonomously.
- **G4**: Build a skill system where reusable agent knowledge (scripts, prompts, instructions) compounds over time.
- **G5**: Support multiple agent providers (Claude Code, Codex, OpenClaw, OpenCode, Hermes, Gemini, Pi, Cursor Agent) without lock-in.
- **G6**: Enable autopilot automations — scheduled or webhook-triggered recurring agent tasks.
- **G7**: Offer a full self-hosting path with no external service dependencies (except chosen agent CLIs).
- **G8**: Provide a CLI and desktop app so developers can manage work from any interface.

### 3.2 Non-Goals

- Multica does not build or train its own AI models.
- Multica does not replace IDE plugins or code editors.
- Multica is not a CI/CD system (though agents may interact with CI/CD via tool calls).
- Multica does not enforce detailed governance — no budget tracking, approval chains, or org-chart hierarchies.

---

## 4. Feature Requirements

### 4.1 Workspace Management

**F-WS-1** Users can create and belong to multiple workspaces, each fully isolated (issues, agents, members).

**F-WS-2** Workspace roles: `owner`, `admin`, `member`. Role-based access control enforced on all operations.

**F-WS-3** Workspaces have a human-readable slug used for routing (e.g., `/my-team/issues`).

**F-WS-4** Workspace settings include: name, description, issue prefix (e.g., `JIA`), and integrations.

**F-WS-5** Workspace invitation flow: invite by email, accept via link, role assigned at invite time.

### 4.2 Issue Tracking

**F-IS-1** Issues have: title, rich-text description, status, priority, assignee (member or agent), labels, parent issue, project, due date, acceptance criteria, and context references.

**F-IS-2** Issue statuses: `backlog → todo → in_progress → in_review → done | blocked | cancelled`.

**F-IS-3** Issue priorities: `urgent`, `high`, `medium`, `low`, `none`.

**F-IS-4** Issues are identified by a workspace-scoped `PREFIX-NUMBER` identifier (e.g., `JIA-42`).

**F-IS-5** Agents and members can both create, comment on, and update issues.

**F-IS-6** Issues support reactions (emoji), threaded comments (one level), and file attachments.

**F-IS-7** Issue subscribers are auto-added when a user creates, is assigned, or comments on an issue. Subscribers receive inbox notifications.

**F-IS-8** Full-text search across issues and comments within a workspace.

**F-IS-9** Issues can be organized into Projects with their own status and lead.

**F-IS-10** Issues can express dependency relationships: `blocks`, `blocked_by`, `related`.

### 4.3 Agent Management

**F-AG-1** Agents are workspace-level entities with a name, avatar, description, and system instructions.

**F-AG-2** Agent runtime modes: `local` (via daemon) and `cloud`.

**F-AG-3** Supported agent providers: Claude Code, Codex, GitHub Copilot, OpenClaw, OpenCode, Hermes, Gemini, Pi, Cursor Agent.

**F-AG-4** Each agent is associated with a Runtime (a specific compute environment where it runs).

**F-AG-5** Agent visibility: `workspace` (visible to all members) or `private` (visible to owner only).

**F-AG-6** Agents can be archived (soft delete); archived agents stop accepting new tasks.

**F-AG-7** Agent configuration: max concurrent tasks, custom CLI args, custom environment variables, MCP (Model Context Protocol) server configuration.

**F-AG-8** Agents can have Skills assigned, which inject additional context/instructions at task execution time.

**F-AG-9** Agents post status updates to issues, creating comments with type `progress_update` or `status_change`.

### 4.4 Agent Task Execution

**F-TK-1** When an issue is assigned to an agent (or an agent is @-mentioned), a task is automatically enqueued in the `agent_task_queue`.

**F-TK-2** Task lifecycle: `queued → dispatched → running → completed | failed | cancelled`.

**F-TK-3** The daemon polls for queued tasks, claims them (atomic dispatch), and executes them using the appropriate agent CLI.

**F-TK-4** Task execution streams real-time messages (text, tool calls, tool results, status updates) to the server via WebSocket. These are persisted as `task_message` records.

**F-TK-5** Users can cancel an in-progress task from the UI or CLI.

**F-TK-6** Agents run inside a git-cloned working directory; the daemon manages repo caching across tasks.

**F-TK-7** Task execution generates token-level usage metrics (input/output/cache tokens per model).

**F-TK-8** Tasks may be resumed by specifying the previous agent session ID (for multi-turn tasks).

### 4.5 Runtimes (Daemon)

**F-RT-1** A "Runtime" is a registered compute environment (e.g., a developer's laptop or a cloud VM) that can execute agent tasks.

**F-RT-2** The `multica daemon` process runs locally, connects to the server via WebSocket, and is listed as an active Runtime in the workspace.

**F-RT-3** Runtimes auto-detect which agent CLIs are installed and available on their `PATH`, reporting them to the server.

**F-RT-4** Runtimes send periodic heartbeats; the server marks runtimes offline if heartbeats cease.

**F-RT-5** Multiple runtimes can be registered per workspace, each serving different agents.

**F-RT-6** Runtimes authenticate via a per-daemon token (not the user's personal token).

### 4.6 Skills System

**F-SK-1** Skills are workspace-level reusable knowledge units: a name, description, Markdown content (instructions/prompt), and optional file attachments.

**F-SK-2** Skills can be assigned to one or more agents. When an agent executes a task, its assigned skills are injected into the system prompt.

**F-SK-3** Skills can be created by any workspace member or by agents themselves.

**F-SK-4** Skills can include supporting files (e.g., a `deploy.sh` script) that are written to the agent's working directory at task start.

### 4.7 Autopilot (Automations)

**F-AP-1** An Autopilot is a recurring automation that dispatches work to an agent on a schedule, via webhook, or via API.

**F-AP-2** Autopilot execution modes:
- `create_issue`: creates a new issue assigned to the agent, then the agent works on it.
- `run_only`: directly enqueues a task (no issue created).

**F-AP-3** Autopilot triggers:
- `schedule`: cron expression + timezone.
- `webhook`: unique token, fire on HTTP POST.
- `api`: manual trigger via REST API.

**F-AP-4** Concurrency policies: `skip` (don't run if already running), `queue` (enqueue anyway), `replace` (cancel existing and start fresh).

**F-AP-5** Each Autopilot run is tracked in `autopilot_run` with status, linked issue, linked task, trigger payload, and result.

**F-AP-6** Autopilots can be paused, resumed, or archived.

### 4.8 Chat (Direct Agent Conversation)

**F-CH-1** Users can start a direct chat session with any non-archived workspace agent.

**F-CH-2** Chat sessions are private to their creator; other workspace members cannot see them.

**F-CH-3** Each user message in a chat session enqueues an agent task; the agent's response is streamed back.

**F-CH-4** Chat history is persisted and paginated; only one task can be active per session at a time.

**F-CH-5** Chat sessions track unread state; a badge appears when the agent has responded.

**F-CH-6** Users can cancel an in-progress chat task.

### 4.9 Inbox

**F-IN-1** Every workspace member has a personal Inbox that aggregates notifications relevant to them.

**F-IN-2** Inbox severity levels: `action_required`, `attention`, `info`.

**F-IN-3** Common inbox events: issue assigned to you, issue you're subscribed to changed status, you were @-mentioned, agent reported a blocker, autopilot run completed.

**F-IN-4** Inbox items can be marked read, archived, or bulk-actioned.

### 4.10 Real-Time Updates

**F-RT-1** All state changes (issue updates, comments, agent status, task progress) are broadcast to connected clients via WebSocket within the workspace scope.

**F-RT-2** WebSocket connections are workspace-scoped; clients only receive events for their active workspace.

**F-RT-3** Clients reconnect automatically on disconnect with exponential backoff.

### 4.11 CLI

**F-CLI-1** `multica login` — opens browser for OAuth/email-based authentication.

**F-CLI-2** `multica daemon start/stop/status` — manage the local agent runtime.

**F-CLI-3** `multica setup` — one-command setup: configure server, authenticate, start daemon.

**F-CLI-4** `multica setup self-host` — same, but for self-hosted server URLs.

**F-CLI-5** `multica issue list / create` — manage issues from the terminal.

**F-CLI-6** `multica update` — self-update to the latest binary.

**F-CLI-7** Multi-profile support via `--profile` flag (for users managing multiple Multica instances).

### 4.12 Desktop App

**F-DT-1** Electron desktop app providing the full Multica experience without a browser.

**F-DT-2** Multi-tab workspace navigation within the app.

**F-DT-3** macOS: immersive title bar, traffic-light accommodation, drag region.

**F-DT-4** Auto-update support.

### 4.13 Access Control

**F-AC-1** Workspace membership is required to access any workspace resource (enforced server-side).

**F-AC-2** Role hierarchy: `owner > admin > member`. Destructive operations (delete workspace, manage billing) require `owner` or `admin`.

**F-AC-3** Personal Access Tokens (PATs) for programmatic API access without interactive login.

**F-AC-4** Signup can be restricted to specific email addresses or domains via server configuration.

---

## 5. User Stories

### Onboarding

- As a new user, I can sign up with my email and be sent a verification code.
- As a new user, I can create my first workspace and start inviting teammates.
- As a team lead, I can run `multica setup` on my machine and have the daemon running in under 2 minutes.

### Day-to-Day Work

- As a developer, I can create an issue and assign it to an agent; the agent starts working immediately without any further intervention from me.
- As a developer, I can @-mention an agent in a comment to request its help on an existing issue.
- As a developer, I can watch live streaming output (text, tool calls) as the agent works in real time.
- As a developer, I can see all agent and human work on a unified board filtered by status, priority, and assignee.
- As a developer, I can cancel an agent task if it goes in the wrong direction.

### Skill Management

- As a tech lead, I can create a "deploy to staging" skill with step-by-step instructions and attach a deploy script.
- As a tech lead, I can assign this skill to all agents so they automatically know how to deploy without being told each time.

### Automation

- As a team lead, I can set up an Autopilot to run a "weekly security audit" agent task every Monday at 9 AM.
- As a product manager, I can create a webhook-triggered Autopilot so that a specific agent task fires whenever a new GitHub PR is merged.

### Collaboration

- As a team member, I can see agents' comments on issues alongside my colleagues' comments, with clear visual distinction.
- As a team member, I get an Inbox notification when an agent I assigned to a task reports a blocker and needs my input.
- As a team member, I can react to agent comments with emojis.

---

## 6. Success Metrics

| Metric | Target |
|---|---|
| Time from signup to first agent task running | < 5 minutes |
| Mean time for task dispatch after assignment | < 10 seconds |
| WebSocket event delivery latency (p95) | < 500 ms |
| Daemon uptime / reconnect success rate | > 99.5% |
| Skill reuse rate across agents in a workspace | > 30% of tasks use at least one skill |
| DAU/MAU retention at 30 days | > 40% |

---

## 7. Constraints and Assumptions

- **Agent CLIs are installed externally**: Multica does not ship or manage agent CLIs. Users are responsible for having `claude`, `codex`, etc. available on their PATH.
- **Network access required**: The daemon must have outbound network access to the Multica server (default port 8080).
- **PostgreSQL 17 with pgvector**: The only supported database.
- **Docker required for self-hosting**: The recommended self-hosting path uses Docker Compose.
- **Single-region for now**: No built-in multi-region or global CDN story; self-hosters are responsible for their own geo-distribution.
