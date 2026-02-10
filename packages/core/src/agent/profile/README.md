# Agent Profile System

The Agent Profile system allows you to define and manage agent personalities, capabilities, and configurations. Each profile is a collection of markdown files and a JSON configuration file stored in a directory.

## Directory Structure

```
~/.super-multica/agent-profiles/
└── <profile-id>/
    ├── soul.md          # Personality constraints and behavior style
    ├── identity.md      # Agent's name and self-awareness
    ├── tools.md         # Custom tool usage instructions
    ├── memory.md        # Persistent knowledge base
    ├── bootstrap.md     # Guidance for each conversation start
    └── config.json      # Profile configuration (tools, provider, model)
```

## Profile Files

### soul.md
Defines the agent's personality constraints and behavior boundaries.

```markdown
# Soul

You are a helpful AI assistant. Follow these guidelines:

- Be concise and direct in your responses
- Ask clarifying questions when requirements are ambiguous
- Admit when you don't know something
```

### identity.md
Contains the agent's identity information.

```markdown
# Identity

- Name: CodeBot
- Role: Software development assistant
```

### tools.md
Custom instructions for tool usage (appended to the system prompt).

### memory.md
Persistent knowledge base that survives across conversations.

### bootstrap.md
Guidance information provided at the start of each conversation.

### config.json
JSON configuration for the profile:

```json
{
  "tools": {
    "profile": "coding",
    "allow": ["web_fetch"],
    "deny": ["exec"]
  },
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "thinkingLevel": "medium"
}
```

## Configuration Options

### tools
Tool policy configuration. See [Tools README](../tools/README.md) for details.

| Field | Type | Description |
|-------|------|-------------|
| `profile` | string | Base profile: `minimal`, `coding`, `web`, `full` |
| `allow` | string[] | Additional tools to allow (supports `group:*` syntax) |
| `deny` | string[] | Tools to block (takes precedence over allow) |
| `byProvider` | object | Provider-specific tool rules |

Example configurations:

```json
// Minimal - only file operations
{
  "tools": {
    "profile": "minimal",
    "allow": ["group:fs"]
  }
}

// Coding without web access
{
  "tools": {
    "profile": "coding",
    "deny": ["group:web"]
  }
}

// Full access except shell execution
{
  "tools": {
    "deny": ["exec", "process"]
  }
}
```

### provider
Default LLM provider for this profile.

### model
Default model ID for this profile.

### thinkingLevel
Default thinking level: `none`, `low`, `medium`, `high`.

## Usage

### CLI

```bash
# Use a specific profile
pnpm agent:cli --profile my-agent "Hello"

# Profile with custom base directory
pnpm agent:cli --profile my-agent --profile-dir /path/to/profiles "Hello"
```

### Programmatic

```typescript
import { ProfileManager } from "./profile/index.js";

// Load existing profile
const manager = new ProfileManager({
  profileId: "my-agent",
  baseDir: "/custom/path",  // optional
});

// Get profile (returns undefined if not exists)
const profile = manager.getProfile();

// Get or create with defaults
const profile = manager.getOrCreateProfile(true);  // useTemplates

// Build system prompt from profile
const systemPrompt = manager.buildSystemPrompt();

// Get tools configuration
const toolsConfig = manager.getToolsConfig();

// Get full profile config
const config = manager.getProfileConfig();
```

## Config Priority

When using a profile, configurations are merged with CLI options:

1. **Profile config.json** - Base configuration
2. **CLI options** - Override profile settings

```bash
# Profile has tools.profile = "coding"
# CLI adds --tools-deny exec
# Result: coding profile without exec tool
pnpm agent:cli --profile my-agent --tools-deny exec "list files"
```

The merge behavior:
- `profile`: CLI wins if specified
- `allow`: Union of both lists
- `deny`: Union of both lists
- `byProvider`: Deep merge with CLI taking precedence

## Creating a Profile

### Manual Creation

1. Create directory: `mkdir -p ~/.super-multica/agent-profiles/my-agent`
2. Create markdown files (soul.md, identity.md, etc.)
3. Create config.json with your settings

### Programmatic Creation

```typescript
import { createAgentProfile } from "./profile/index.js";

// Create with default templates
const profile = createAgentProfile("my-agent", {
  useTemplates: true,  // Fill with default content
});

// Create empty profile
const profile = createAgentProfile("minimal-agent", {
  useTemplates: false,
});
```
