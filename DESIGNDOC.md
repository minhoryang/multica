# Multica — Technical Design Document

## 1. System Overview

Multica is composed of four main runtime components that work together:

```
┌──────────────────────────────────────────────────────────────────┐
│  Clients (Web / Desktop / CLI)                                   │
│  Next.js (App Router)  │  Electron (electron-vite)  │  cobra CLI │
└────────────────┬─────────────────────────┬───────────┬───────────┘
                 │ HTTP + WebSocket         │ HTTP + WS │ HTTP
                 ▼                         │           │
┌───────────────────────────────────────┐  │           │
│  Go Backend  (Chi router, port 8080)  │◄─┘           │
│  - REST API handlers                  │◄─────────────┘
│  - WebSocket hub (gorilla/websocket)  │
│  - Event bus (in-process pub/sub)     │
│  - Task queue service                 │
│  - Autopilot cron service             │
│  - Email service (Resend)             │
│  - File storage (S3 / local)          │
└────────────┬──────────────────────────┘
             │ pgx/v5
             ▼
┌──────────────────────────────┐
│  PostgreSQL 17 + pgvector    │
│  (managed by sqlc-generated  │
│   queries + goose migrations)│
└──────────────────────────────┘
             ▲
             │ HTTP + WebSocket (task:dispatch, task:progress…)
┌────────────┴──────────────────────────────────────────────────┐
│  Agent Daemon  (runs on developer's machine or cloud VM)       │
│  - polls server for queued tasks                              │
│  - executes: claude / codex / copilot / opencode / openclaw   │
│              hermes / gemini / pi / cursor-agent              │
│  - streams progress back over WebSocket                       │
│  - manages git repo cache                                     │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Backend (Go)

### 2.1 Entry Points

| Binary | Path | Purpose |
|---|---|---|
| `server` | `server/cmd/server/` | Main HTTP/WS API server |
| `multica` | `server/cmd/multica/` | CLI + daemon launcher |
| `migrate` | `server/cmd/migrate/` | Database migration runner |

### 2.2 Router Structure (`server/internal/handler/`)

The HTTP server uses [Chi](https://github.com/go-chi/chi) for routing. All workspace-scoped routes are protected by two middleware layers:

1. **Auth middleware** — validates the JWT from `Authorization: Bearer <token>` or the `session` cookie. Resolves to a `user_id` and sets `X-User-ID` on the request context.
2. **Workspace middleware** (`server/internal/middleware/workspace.go`) — resolves `X-Workspace-Slug` or `X-Workspace-ID` header to a workspace UUID, verifies the authenticated user is a member of that workspace, and sets both into the request context.

**Public routes** (no auth):
- `POST /api/auth/signup`, `/api/auth/login`, `/api/auth/verify`, `/api/auth/refresh`
- `GET /api/workspaces/slug-available`
- `POST /api/webhooks/autopilot/:token`
- `GET /health`

**Authenticated routes** (auth only, no workspace):
- `GET /api/workspaces` — list user's workspaces
- `POST /api/workspaces` — create workspace
- `GET /api/user/me` — current user profile
- `POST /api/daemon/register` — daemon registration
- `DELETE /api/daemon/deregister` — daemon deregistration
- `POST /api/upload-file` — file upload

**Workspace-scoped routes** (auth + workspace membership):
- Issues: `GET|POST /api/issues`, `GET|PUT|DELETE /api/issues/:issueId`
- Comments: `GET|POST /api/issues/:issueId/comments`, …
- Agents: `GET|POST /api/agents`, `GET|PUT|DELETE /api/agents/:agentId`
- Skills: `GET|POST /api/skills`, `GET|PUT|DELETE /api/skills/:skillId`
- Tasks: `GET /api/tasks/:taskId`, `POST /api/tasks/:taskId/cancel`
- Chat: `POST /api/chat/sessions`, `GET|POST /api/chat/sessions/:sessionId/messages`
- Autopilots: `GET|POST /api/autopilots`, …
- Runtimes: `GET /api/runtimes`, `POST /api/runtimes/:runtimeId/ping`
- Projects: `GET|POST /api/projects`, …
- Inbox: `GET /api/inbox`, `POST /api/inbox/:itemId/read`, …
- Members: `GET /api/members`, `PUT|DELETE /api/members/:memberId`

**WebSocket endpoint:**
- `GET /ws` — clients authenticate and receive all workspace-scoped real-time events

**Daemon WebSocket endpoint:**
- `GET /api/daemon/ws` — daemon connects, receives `task:dispatch` events, sends `task:progress`/`task:completed`/`task:failed`

### 2.3 Database Layer (`server/pkg/db/`)

- **ORM**: [sqlc](https://sqlc.dev/) generates type-safe Go code from raw SQL queries in `server/pkg/db/queries/*.sql`.
- **Driver**: [pgx/v5](https://github.com/jackc/pgx) with connection pool (`pgxpool`).
- **Migrations**: [goose](https://github.com/pressly/goose)-compatible sequential SQL files in `server/migrations/`. 49 migrations as of this writing.
- **Extensions**: `pgcrypto` (UUID generation), `pgvector` (available for semantic search future work).

The generated `db.Queries` struct is injected into all handlers and services.

### 2.4 Event System (`server/internal/events/`)

An in-process publish/subscribe bus (`events.Bus`) decouples domain events from HTTP handlers. When an HTTP handler needs to broadcast a real-time event (e.g., issue updated), it calls `h.publish(eventType, workspaceID, actorType, actorID, payload)`, which enqueues the event on the bus.

The WebSocket hub subscribes to the bus and fans out events to all connected clients in the target workspace.

**Event types** (defined in `server/pkg/protocol/events.go`):

| Domain | Events |
|---|---|
| Issues | `issue:created`, `issue:updated`, `issue:deleted` |
| Comments | `comment:created`, `comment:updated`, `comment:deleted` |
| Reactions | `reaction:added`, `reaction:removed`, `issue_reaction:added`, `issue_reaction:removed` |
| Agents | `agent:status`, `agent:created`, `agent:archived`, `agent:restored` |
| Tasks | `task:dispatch`, `task:progress`, `task:completed`, `task:failed`, `task:message`, `task:cancelled` |
| Inbox | `inbox:new`, `inbox:read`, `inbox:archived`, `inbox:batch-read`, `inbox:batch-archived` |
| Workspace | `workspace:updated`, `workspace:deleted` |
| Members | `member:added`, `member:updated`, `member:removed` |
| Skills | `skill:created`, `skill:updated`, `skill:deleted` |
| Chat | `chat:message`, `chat:done`, `chat:session_read` |
| Projects | `project:created`, `project:updated`, `project:deleted` |
| Autopilot | `autopilot:created`, `autopilot:updated`, `autopilot:deleted`, `autopilot:run_start`, `autopilot:run_done` |
| Pins | `pin:created`, `pin:deleted` |
| Invitations | `invitation:created`, `invitation:accepted`, `invitation:declined`, `invitation:revoked` |
| Subscribers | `subscriber:added`, `subscriber:removed` |
| Daemon | `daemon:heartbeat`, `daemon:register` |
| Activity | `activity:created` |

### 2.5 Real-Time Hub (`server/internal/realtime/hub.go`)

The hub manages all active WebSocket connections. Each connection is keyed on `(workspaceID, userID)`. When an event arrives from the bus:

1. The event payload is serialized to JSON.
2. All connections matching the event's `workspaceID` receive the message.

The hub enforces:
- **54-second write ping interval** — keeps connections alive through NAT and load balancers.
- **60-second pong wait timeout** — closes connections that don't respond.
- **Per-connection write buffer** — 256-byte read buffer, 1024-byte write buffer.

### 2.6 Task Service (`server/internal/service/task.go`)

The `TaskService` is the central orchestrator for agent task lifecycle:

- `EnqueueTaskForIssue(issue)` — creates a `queued` task record when an issue is assigned to an agent.
- `EnqueueTaskForMention(agentID, issue)` — creates a task when an agent is @-mentioned.
- `EnqueueChatTask(session)` — creates a task for a chat session message.
- `CancelTask(taskID)` — marks a `queued`/`dispatched`/`running` task as `cancelled`, broadcasts `task:cancelled`.
- Optimistic locking guards prevent double-dispatch: a task can only be claimed once (enforced by DB unique index on pending tasks per issue/agent).

### 2.7 Autopilot Service (`server/internal/service/autopilot.go`)

The `AutopilotService` drives scheduled and webhook-triggered automations:

- `DispatchAutopilot(autopilot, triggerID, source, payload)` — creates a run record, then:
  - In `create_issue` mode: creates an issue with the title template, assigns the agent, enqueues a task.
  - In `run_only` mode: directly enqueues a task with the autopilot description as the prompt.
- `service/cron.go` provides `ComputeNextRun(cronExpr, timezone)` via `robfig/cron/v3`.

A background cron goroutine (`server/internal/service/cron.go`) wakes every minute, queries for `autopilot_trigger` records where `next_run_at <= now()`, and fires them.

### 2.8 Authentication (`server/internal/auth/`)

- **JWT**: short-lived access tokens (15-minute default) + longer-lived refresh tokens stored in `httpOnly` cookies.
- **Email verification**: 6-digit codes with rate-limiting (max attempts per window) stored in `verification_code` table.
- **Personal Access Tokens (PATs)**: hash-stored in `personal_access_token` table, bearer-token auth for API clients.
- **Daemon tokens**: single-use token per daemon instance stored in `daemon_token`, separate from user tokens.
- **CloudFront signed URLs**: optional CDN-level access control for file storage (`server/internal/auth/cf_signer.go`).

### 2.9 File Storage (`server/internal/storage/`)

Storage is abstracted behind a `Storage` interface with two backends:
- **Local**: writes files to disk (for development / self-hosting without S3).
- **S3**: AWS S3 (or compatible) with optional CloudFront signed URL generation.

Uploads go through a two-step flow: client requests a presigned upload URL, uploads directly to S3, then notifies the server of the completed upload.

### 2.10 Actor Model (Polymorphic Identity)

Throughout the codebase, actions can be performed by either a `member` (human) or an `agent`. This is encoded as `(actor_type TEXT, actor_id UUID)` pairs on issues, comments, inbox items, and activity logs.

Agents authenticate as an actor by including `X-Agent-ID` and optionally `X-Task-ID` headers in API requests. The handler's `resolveActor()` function validates these headers against the DB before granting agent identity.

---

## 3. Database Schema

### 3.1 Core Tables

```
user              — human accounts (id, name, email, avatar_url)
workspace         — isolated team contexts (id, slug, name, issue_prefix)
member            — user ↔ workspace with role (owner/admin/member)
agent             — AI agents (id, workspace_id, runtime_id, provider, status, instructions)
runtime           — compute environments (id, workspace_id, daemon_uuid, available CLIs)
```

### 3.2 Issue Domain

```
issue             — work items (id, workspace_id, title, status, priority, assignee_type+id,
                    parent_issue_id, project_id, acceptance_criteria[], context_refs[])
issue_label       — label definitions per workspace
issue_to_label    — issue ↔ label M:N
issue_dependency  — issue ↔ issue (blocks/blocked_by/related)
comment           — thread items (type: comment/status_change/progress_update/system)
issue_reaction    — emoji reactions on issues
reaction          — emoji reactions on comments
subscriber        — users/agents subscribed to issue notifications
attachment        — file attachments on issues
```

### 3.3 Task Execution

```
agent_task_queue  — task records (queued→dispatched→running→completed/failed/cancelled)
                    links to: agent, runtime, issue OR chat_session OR autopilot_run
task_message      — streaming messages during execution (text/tool_use/tool_result/status/error)
task_usage        — token usage per task (input/output/cache tokens per model)
```

### 3.4 Skills

```
skill             — reusable knowledge unit (name, description, markdown content, config JSONB)
skill_file        — supporting files attached to a skill (path + content)
agent_skill       — agent ↔ skill M:N association
```

### 3.5 Automation

```
autopilot         — recurring automation definition (title, assignee, execution_mode, priority)
autopilot_trigger — how it fires (schedule/webhook/api) with cron + next_run_at
autopilot_run     — execution record per trigger fire (linked to issue + task)
```

### 3.6 Chat

```
chat_session      — user ↔ agent conversation (status: active/archived, has_unread)
chat_message      — individual messages (role: user/assistant, content, linked task_id)
```

### 3.7 Supporting Tables

```
inbox_item            — per-recipient notifications (severity, type, read, archived)
activity_log          — audit trail of workspace actions
personal_access_token — PAT records (hashed)
daemon_token          — per-daemon auth tokens
verification_code     — email login codes
workspace_invitation  — pending join invitations
project               — issue groupings (status, lead)
pinned_item           — user-pinned issues/projects per workspace
```

### 3.8 Indexing Strategy

All major query patterns are covered by composite indexes:

- Issues: `(workspace_id, status)`, `(assignee_type, assignee_id)`, `(parent_issue_id)`, `(project_id)`
- Full-text: `tsvector` indexes on `issue.title + description` and `comment.content` (GIN indexes from migrations 032/033)
- Tasks: `(agent_id, status)`, `(issue_id)` for queue lookups
- Inbox: `(recipient_type, recipient_id, read)` for per-user queries
- Autopilot triggers: `(next_run_at)` WHERE enabled=true AND kind='schedule' (partial index)

---

## 4. Frontend Architecture

### 4.1 Monorepo Structure (pnpm workspaces + Turborepo)

```
apps/
  web/          — Next.js 16 App Router (cloud + self-hosted web UI)
  desktop/      — Electron + electron-vite (desktop app)
  docs/         — documentation site
packages/
  core/         — headless business logic (zero react-dom)
  ui/           — atomic UI components (zero business logic)
  views/        — shared page components (zero next/* or react-router-dom)
  tsconfig/     — shared TypeScript configuration
```

**Internal packages pattern**: all packages export raw `.ts`/`.tsx` source files. The consuming app's bundler (Next.js / Vite) compiles them directly. This gives zero-config HMR and instant go-to-definition without pre-compilation steps.

### 4.2 `packages/core/` — Headless Business Logic

**Rules**: zero `react-dom`, zero `localStorage`, zero `process.env`, zero UI libraries.

| Directory | Contents |
|---|---|
| `api/` | `ApiClient` (fetch wrapper), `WsClient` (WebSocket), typed API methods |
| `auth/` | Auth queries, mutations, store |
| `workspace/` | Workspace queries, mutations, Zustand store |
| `issues/` | Issue queries, mutations, Zustand stores (scope filter, view mode, draft, recent) |
| `agents/` | Agent queries, mutations |
| `runtimes/` | Runtime queries |
| `skills/` | Skill queries, mutations |
| `chat/` | Chat session/message queries, mutations, Zustand store |
| `inbox/` | Inbox queries, mutations |
| `autopilots/` | Autopilot queries, mutations |
| `projects/` | Project queries, mutations |
| `pins/` | Pin queries, mutations |
| `realtime/` | `useRealtimeSync` — maps WS events to Query cache invalidation |
| `platform/` | `CoreProvider`, `NavigationAdapter` interface, storage adapters |
| `navigation/` | Navigation store (`lastPath`) |
| `modals/` | Modal Zustand store |

### 4.3 State Management

#### Server State: TanStack Query

All data fetched from the API lives exclusively in the Query cache. Key conventions:

- Query keys are workspace-scoped: e.g., `["issues", wsId, { status, priority }]`.
- `staleTime: Infinity` (data never goes stale on its own — WebSocket events drive invalidation).
- `refetchOnWindowFocus: false` (by design; WS events are the update mechanism).
- Mutations are optimistic by default: apply locally, send to server, roll back on error, invalidate on settle.

#### Client State: Zustand

Pure UI state that doesn't come from the server. All stores live in `packages/core/` (never in apps or views). Key stores:

| Store | Purpose |
|---|---|
| `useWorkspaceStore` | Active workspace identity, `switchWorkspace()` |
| `useIssuesScopeStore` | Current board filter (status, priority, assignee) |
| `useIssueViewStore` | Board vs list view mode |
| `useIssueDraftStore` | Draft issue being composed |
| `useRecentIssuesStore` | Recently viewed issues for quick-jump |
| `myIssuesViewStore` | "My issues" view filter |
| `useChatStore` | Active chat session, message draft |
| `useNavigationStore` | `lastPath` per workspace (for resume on re-open) |
| `useModalStore` | Which modal is open and its props |

Stores that persist across sessions use `createWorkspaceAwareStorage` — the localStorage key includes the `wsId` suffix so switching workspaces automatically loads the right state.

#### WebSocket → Query Cache Pipeline

1. `WsClient` receives a JSON event message.
2. `useRealtimeSync` (in `packages/core/realtime/`) matches the event type.
3. For each event type, it calls `queryClient.invalidateQueries({ queryKey: ... })` with the appropriate scoped key.
4. React Query automatically re-fetches any components that subscribe to that key.

This one-way flow (WS event → invalidate → re-fetch) keeps the cache as single source of truth and avoids write-then-read races.

### 4.4 `packages/ui/` — Atomic UI Components

**Rules**: zero `@multica/core` imports, zero business logic.

Built on [shadcn/ui](https://ui.shadcn.com/) with **Base UI** primitives (`@base-ui/react`) instead of Radix. All components use semantic design tokens (`bg-background`, `text-muted-foreground`), never hardcoded Tailwind colors.

Component additions: `pnpm ui:add <component>` from project root (runs shadcn CLI targeting `packages/ui/components.json`).

### 4.5 `packages/views/` — Shared Page Components

**Rules**: zero `next/*` imports, zero `react-router-dom`, zero stores. Navigation via `useNavigation()` from `@multica/core` (returns a `NavigationAdapter` provided by the consuming app).

Major view domains:

| Directory | Views |
|---|---|
| `issues/` | Issue board, issue detail, create/edit modals |
| `agents/` | Agent list, agent settings |
| `runtimes/` | Runtime list |
| `skills/` | Skill list, skill editor |
| `chat/` | Chat panel, message list |
| `autopilots/` | Autopilot list, create/edit |
| `inbox/` | Inbox feed |
| `projects/` | Project list, project detail |
| `settings/` | Workspace/profile settings tabs |
| `layout/` | `AppSidebar`, `DashboardGuard`, `MainTopBar` |
| `auth/` | Login, signup, verification pages |
| `invite/` | Accept-invitation page |
| `search/` | Global search results |

### 4.6 Platform Layer (Per-App Wiring)

Each app provides its own platform bridge:

**`apps/web/platform/`** (Next.js):
- `NavigationAdapter` wrapping `next/navigation` `useRouter` + `usePathname`.
- Auth utilities (cookies, redirects).
- `CoreProvider` wrapping the headless provider with Next.js-specific config.

**`apps/desktop/src/renderer/src/platform/`** (React Router v7):
- `NavigationAdapter` wrapping React Router `useNavigate`.
- Desktop-specific overlay system for pre-workspace flows (create workspace, accept invite) via `WindowOverlay`.
- Tab system (`stores/tab-store.ts`) — tabs grouped per workspace; cross-workspace `push()` is intercepted and translated to `switchWorkspace()`.

### 4.7 CSS Architecture

Both apps import the shared stylesheet foundation from `packages/ui/styles/`:
- `globals.css` — CSS custom properties (design tokens), base layer resets, scrollbar styles, keyframe animations.
- `@source` directives in both apps' Tailwind configs ensure all class names from shared packages are included in the generated stylesheet.

---

## 5. Agent Daemon

### 5.1 Overview

The `multica daemon` is a long-running Go process that:

1. Authenticates with the Multica server using a daemon token.
2. Registers one or more Runtimes (one per workspace it discovers).
3. Polls for `queued` tasks assigned to its registered runtimes.
4. Claims and executes tasks using the appropriate agent backend.
5. Streams execution progress back to the server.
6. Manages a local git repository cache.

### 5.2 Task Execution Flow

```
Server: creates task record (status=queued)
         │
         ▼ task:dispatch WS event
Daemon: receives dispatch event
         │
         ▼ atomic claim (DB update queued→dispatched)
Daemon: clones/updates repo into working directory
         │
         ▼
Daemon: builds prompt (issue content + skills + instructions)
         │
         ▼
Daemon: executes agent backend (claude/codex/etc.) as subprocess
         │
         ├──► streams Message events → POST /api/tasks/:id/messages
         │    (text, tool_use, tool_result, status, error)
         │
         ├──► streams progress → WebSocket task:progress events
         │
         ▼
Daemon: agent exits
         │
         ├── success → PATCH task status=completed
         └── failure → PATCH task status=failed + error message
```

### 5.3 Agent Backends (`server/pkg/agent/`)

Each supported agent CLI has its own backend implementation in `server/pkg/agent/`:

| File | Agent | Transport |
|---|---|---|
| `claude.go` | Claude Code (`claude`) | stream-json subprocess |
| `codex.go` | Codex (`codex`) | app-server subprocess |
| `copilot.go` | GitHub Copilot (`copilot`) | json subprocess |
| `cursor.go` | Cursor Agent (`cursor-agent`) | stream-json subprocess |
| `gemini.go` | Gemini CLI (`gemini`) | stream-json subprocess |
| `hermes.go` | Hermes (`hermes`) | ACP protocol subprocess |
| `openclaw.go` | OpenClaw (`openclaw`) | json subprocess |
| `opencode.go` | OpenCode (`opencode`) | json subprocess |
| `pi.go` | Pi (`pi`) | json subprocess |

All backends implement the `Backend` interface:

```go
type Backend interface {
    Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}
```

`ExecOptions` includes: working directory, model, system prompt, max turns, timeout, session resume ID, custom CLI args, and MCP config.

The returned `Session` exposes:
- `Messages <-chan Message` — streaming events (text, tool calls, etc.)
- `Result <-chan Result` — final outcome (status, output, error, token usage, session ID)

### 5.4 Prompt Construction

The daemon builds the agent prompt by combining:
1. **Issue content**: title, description, acceptance criteria, context references.
2. **Skill instructions**: content from all skills assigned to the agent.
3. **Agent instructions**: the agent's custom system instructions field.
4. **Task context**: workspace context, available tools (multica CLI commands the agent can call back).

The agent is given access to the `multica` CLI binary, enabling it to:
- Read issue details: `multica issue get <id>`
- Update issue status: `multica issue update <id> --status in_progress`
- Create sub-issues: `multica issue create --parent <id>`
- Post comments: `multica issue comment <id>`
- Report blockers: `multica issue block <id>`

### 5.5 Repository Cache (`server/internal/daemon/repocache/`)

The daemon maintains a local cache of git repositories to avoid cloning from scratch for every task:
- Each workspace can configure allowed repository URLs.
- The cache stores bare or worktree clones; each task gets an isolated working directory.
- Cache is GC'd on a schedule to remove repos no longer in use.

### 5.6 Daemon Lifecycle

- **Startup**: resolve auth → sync workspaces → register runtimes → start loops.
- **Poll loop**: every few seconds, calls `GET /api/tasks/pending` for its runtimes; claims and handles each.
- **Heartbeat loop**: periodic pings to the server to keep runtimes marked online.
- **Workspace sync loop**: every 30 seconds, re-fetches workspaces from the API and registers new runtimes for any new workspaces.
- **GC loop**: periodic cleanup of old working directories and repo cache entries.
- **Self-update**: `multica update` downloads a new binary, the daemon restarts itself.
- **Graceful shutdown**: deregisters all runtimes on process exit.

---

## 6. Security Design

### 6.1 Authentication

- **JWT access tokens**: HS256-signed, 15-minute expiry, include `user_id` claim.
- **Refresh tokens**: longer-lived, stored in `httpOnly` `SameSite=Strict` cookies.
- **Email verification codes**: 6 digits, rate-limited attempts (column `attempts` with max), TTL-enforced.
- **PATs**: client sees the token once on creation; server stores only the SHA-256 hash.
- **Daemon tokens**: single-use bootstrap tokens; the daemon exchanges them for a session token.

### 6.2 Authorization

- All workspace-scoped endpoints require verified workspace membership (checked server-side via the workspace middleware, not just trusting headers).
- Role hierarchy enforced: owner-only and admin-only operations are explicitly gated with `requireWorkspaceRole()`.
- Agent impersonation (`X-Agent-ID` header) is validated against the DB: the agent must exist in the workspace, and if `X-Task-ID` is provided, the task must belong to that agent.
- Issues and tasks are only accessible within their workspace; cross-workspace data leakage is prevented by always filtering by `workspace_id`.

### 6.3 Input Sanitization

- `server/internal/sanitize/` uses [bluemonday](https://github.com/microcosm-cc/bluemonday) for HTML sanitization on rich-text fields (issue descriptions, comment content).
- `server/pkg/redact/` handles redaction of sensitive fields (custom env vars, MCP configs) in API responses — callers with insufficient permissions receive a `*_redacted: true` flag instead of the raw values.

### 6.4 CORS

Configured via `go-chi/cors` to allow the web frontend origin and restrict methods/headers.

### 6.5 File Upload Security

- File uploads go through presigned S3 URLs; the server never proxies file content.
- CloudFront signed URLs can be enabled for access control on file downloads.
- Content-type and size limits enforced at the S3 policy level.

---

## 7. WebSocket Protocol

### 7.1 Client Connection (Browser / Desktop)

1. Client connects to `GET /ws` with an `Authorization: Bearer <token>` header (or equivalent cookie).
2. Server authenticates, resolves workspace from `X-Workspace-Slug` or `X-Workspace-ID` header.
3. Server registers the connection in the hub keyed on `(workspaceID, userID)`.
4. Server sends a JSON ping every 54 seconds; client must respond with a pong.
5. All subsequent messages from the server are JSON-encoded `{ type, workspace_id, actor_type, actor_id, payload }` objects.

### 7.2 Daemon Connection

1. Daemon connects to `GET /api/daemon/ws` with its daemon token.
2. Server authenticates daemon and resolves its registered runtimes.
3. Server sends `task:dispatch` events when a new task is ready for the daemon's runtimes.
4. Daemon sends `task:progress`, `task:message`, `task:completed`, `task:failed` events as the task runs.
5. Daemon sends `daemon:heartbeat` events periodically.

### 7.3 Client-Side WebSocket (`packages/core/api/ws-client.ts`)

- Auto-reconnect on close with 3-second delay.
- Workspace subscription: sends `{ type: "subscribe", workspace_id }` after connecting.
- Messages dispatched to registered handlers by event type.

**Known limitation**: no application-level heartbeat on the client side. If the underlying TCP connection is silently severed (half-open), the browser's `readyState` remains `OPEN` and `onclose` does not fire, causing missed events until the user refreshes. (See `HANDOFF_ARCHITECTURE_AUDIT.md` Task 1 for the proposed fix.)

---

## 8. CLI Architecture

The `multica` CLI is built with [Cobra](https://github.com/spf13/cobra) and organized as subcommands:

```
multica
├── login            — open browser, exchange auth code for token
├── logout           — clear local token
├── setup            — configure + login + start daemon (cloud)
│   └── self-host    — configure + login + start daemon (self-hosted)
├── daemon
│   ├── start        — launch daemon in foreground or background
│   ├── stop         — stop running daemon
│   └── status       — check daemon health
├── issue
│   ├── list         — list issues
│   ├── get          — get issue details
│   ├── create       — create new issue
│   ├── update       — update issue fields
│   ├── comment      — post a comment
│   └── block        — mark issue as blocked
├── workspace
│   ├── list         — list workspaces
│   └── switch       — change active workspace
├── config           — view/edit CLI config
└── update           — self-update binary
```

CLI config is stored in `~/.config/multica/config.json` (or `XDG_CONFIG_HOME`). Multi-profile support via `--profile` flag.

The daemon binary (`multica daemon start`) launches the same `Daemon` struct from `server/internal/daemon/`.

---

## 9. Desktop App Architecture

### 9.1 Stack

- **Electron** with **electron-vite** (Vite-based build, HMR in dev).
- **React Router v7** (memory router, no URL bar) for in-app navigation.
- **Renderer process**: `apps/desktop/src/renderer/` — React app identical to web but with desktop-specific platform layer.
- **Main process**: `apps/desktop/src/main/` — Electron main, window management, IPC, auto-updater.

### 9.2 Tab System

- Multiple workspace "tabs" can be open simultaneously (like browser tabs).
- Tabs are grouped per workspace in `stores/tab-store.ts`.
- Each tab has its own memory router instance; cross-workspace `push()` is intercepted by the navigation adapter and translated to `switchWorkspace()`.
- Tab state persists across app restarts (stored in localStorage).

### 9.3 Window Overlay

Pre-workspace flows (create workspace, accept invitation) are not routes — they are `WindowOverlay` states rendered as full-screen overlays over the tab system. This avoids polluting the route namespace with one-shot flows.

### 9.4 Workspace Identity

`setCurrentWorkspace(slug, uuid)` in `@multica/core/platform` is the single source of truth for the active workspace. It updates:
1. The API client's `X-Workspace-Slug` header.
2. Zustand per-workspace storage namespace.
3. App chrome gating (sidebar visibility, tab labels).

Destructive operations (leave/delete workspace) must call `setCurrentWorkspace(null, null)` before navigating away to prevent race conditions with the realtime handler.

---

## 10. Self-Hosting

### 10.1 Docker Compose

`docker-compose.selfhost.yml` runs:
- `server` — Go backend
- `web` — Next.js frontend
- `postgres` — PostgreSQL 17 with pgvector

### 10.2 Environment Variables (Key)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | HMAC secret for JWT signing |
| `SERVER_URL` | Public URL of the Go backend |
| `WEB_URL` | Public URL of the Next.js frontend |
| `ALLOW_SIGNUP` | `true`/`false` — open registration |
| `ALLOWED_EMAILS` | Comma-separated email whitelist |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated domain whitelist |
| `STORAGE_TYPE` | `local` or `s3` |
| `S3_BUCKET`, `S3_REGION`, etc. | S3 configuration |
| `RESEND_API_KEY` | Email delivery via Resend |
| `CLOUDFRONT_*` | Optional CDN signed URL config |

### 10.3 Release Process

- Releases are cut by pushing a git tag (`v0.x.x`) to `main`.
- GitHub Actions (`release.yml`) runs GoReleaser, producing multi-platform binaries.
- Binaries are published to GitHub Releases and the Homebrew tap (`multica-ai/tap`).

---

## 11. Known Issues and Technical Debt

### 11.1 WebSocket Half-Open Detection (P0)

**Problem**: The client WS has no application-level heartbeat. Silent TCP severing (NAT/laptop sleep) leaves `readyState=OPEN` but stops delivering events. The Query cache (with `staleTime: Infinity`) goes stale silently.

**Proposed fix**: 
- Short-term: add `visibilitychange` listener in `CoreProvider` to trigger `invalidateQueries` on tab re-focus.
- Long-term: add a server-sent heartbeat message and client-side last-message-time checker that forces `ws.close()` after N seconds of silence.

### 11.2 Workspace Not in URL (P1)

**Problem**: All routes are workspace-implicit (`/issues`, `/issues/:id`). Sharing a link sends a recipient to the wrong workspace. Mobile users cannot switch workspaces (no sidebar).

**Proposed fix**: Migrate to `/[workspaceSlug]/issues` URL prefix scheme. ~50–100 files affected, mostly route file relocations.

### 11.3 Navigation Store Not Workspace-Isolated (P1)

**Problem**: `useNavigationStore` (which persists `lastPath`) uses global localStorage rather than workspace-scoped storage. Switching workspaces may restore the path from the wrong workspace.

**Proposed fix**: Change `useNavigationStore` to use `createWorkspaceAwareStorage` and register it for workspace rehydration. ~3 lines of code.

### 11.4 Workspace Lifecycle Side Effects (P2)

Several workspace lifecycle operations have race conditions or missing navigation:
- **Create workspace**: two `onSuccess` callbacks race, causing a flash of `/issues` before navigating to `/onboarding`.
- **Delete workspace**: user is not navigated away after deletion.
- **Join via sidebar**: sidebar "Join" button doesn't switch to the joined workspace.
