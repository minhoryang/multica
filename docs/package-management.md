# Package Management Guide

## Overview

Super Multica uses **pnpm workspaces** for monorepo management. This document covers package management, dependency handling, and merge conflict resolution.

---

## Directory Structure

```
super-multica/
├── apps/                    # Deployable applications
│   ├── cli/                 # @multica/cli
│   ├── desktop/             # @multica/desktop (Electron)
│   ├── gateway/             # @multica/gateway (NestJS WebSocket)
│   ├── server/              # @multica/server (NestJS REST)
│   ├── web/                 # @multica/web (Next.js)
│   └── mobile/              # @multica/mobile (React Native)
│
├── packages/                # Shared libraries
│   ├── core/                # @multica/core (agent, hub, channels)
│   ├── sdk/                 # @multica/sdk (gateway client)
│   ├── ui/                  # @multica/ui (shared components)
│   ├── store/               # @multica/store (Zustand)
│   ├── hooks/               # @multica/hooks (React hooks)
│   ├── types/               # @multica/types (TypeScript types)
│   └── utils/               # @multica/utils (utility functions)
│
├── skills/                  # Bundled agent skills
├── pnpm-workspace.yaml      # Workspace definition
├── pnpm-lock.yaml           # Lockfile (auto-generated)
└── .npmrc                   # pnpm configuration
```

---

## Key Configuration Files

### pnpm-workspace.yaml

Defines which directories are workspace packages:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### .npmrc

**Required configuration for Electron packaging:**

```ini
shamefully-hoist=true
```

**Why?** electron-builder requires all dependencies to be hoisted to the root `node_modules`. Without this, Electron builds will fail with "Cannot find module" errors.

### pnpm-lock.yaml

- Auto-generated lockfile
- **Never manually edit**
- Always regenerate on conflicts

---

## Common Commands

### Install Dependencies

```bash
# Install all workspace dependencies
pnpm install

# Clean install (after changing .npmrc or major updates)
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm pnpm-lock.yaml
pnpm install
```

### Add Dependencies

```bash
# Add to root (shared dev tools)
pnpm add -D typescript -w

# Add to specific package
pnpm add lodash --filter @multica/core

# Add dev dependency to specific package
pnpm add -D vitest --filter @multica/core

# Add workspace dependency (internal package)
pnpm add @multica/utils --filter @multica/core --workspace
```

### Update Dependencies

```bash
# Update all
pnpm update --recursive

# Update specific package
pnpm update lodash --filter @multica/core

# Interactive update
pnpm update --interactive --recursive
```

### Run Scripts

```bash
# Run script in specific package
pnpm --filter @multica/desktop dev
pnpm --filter @multica/core build

# Run script in all packages
pnpm --recursive run build

# Run script in root
pnpm multica --help
```

---

## Workspace Dependencies

### Internal References

Use `workspace:*` for internal dependencies:

```json
{
  "name": "@multica/desktop",
  "dependencies": {
    "@multica/core": "workspace:*",
    "@multica/ui": "workspace:*",
    "@multica/utils": "workspace:*"
  }
}
```

### Dependency Direction

```
apps/        → depends on → packages/
packages/ui  → depends on → packages/core
packages/core → depends on → packages/types, packages/utils

❌ Circular dependencies are forbidden
```

### Catalog (Shared Versions)

`pnpm-workspace.yaml` defines shared versions:

```yaml
catalog:
  react: "19.2.3"
  typescript: "^5.9.3"
```

Use in package.json:

```json
{
  "dependencies": {
    "react": "catalog:"
  }
}
```

---

## Branch Merge & Conflicts

### High-Conflict Files

| File | Conflict Type | Resolution Strategy |
|------|---------------|---------------------|
| `pnpm-lock.yaml` | Auto-generated | **Always regenerate** |
| `*/package.json` | Version/deps | Manual merge |
| `pnpm-workspace.yaml` | Catalog versions | Manual merge |
| `turbo.json` | Pipeline config | Manual merge |

### Resolving pnpm-lock.yaml Conflicts

**Never manually resolve `pnpm-lock.yaml` conflicts.** It's a machine-generated file with complex checksums.

```bash
# 1. Accept either version (doesn't matter which)
git checkout --theirs pnpm-lock.yaml
# or
git checkout --ours pnpm-lock.yaml

# 2. Delete and regenerate
rm pnpm-lock.yaml
pnpm install

# 3. Stage the new lockfile
git add pnpm-lock.yaml

# 4. Continue with merge
git merge --continue
# or
git commit
```

### Standard Merge Workflow

```bash
# 1. Fetch and merge
git fetch origin main
git merge origin/main

# 2. If conflicts in pnpm-lock.yaml:
git checkout --theirs pnpm-lock.yaml
rm pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml

# 3. Resolve other conflicts manually
# Edit conflicted files...
git add <resolved-files>

# 4. Complete merge
git commit

# 5. Verify build
pnpm build
pnpm test
```

### After Major Merges

Always verify:

```bash
pnpm install          # Ensure deps are correct
pnpm build            # Verify build works
pnpm test             # Run tests
pnpm typecheck        # Check types
```

---

## Troubleshooting

### "Cannot find module" in Electron Build

**Cause:** electron-builder can't find hoisted dependencies.

**Solution:**

```bash
# Ensure .npmrc has:
echo 'shamefully-hoist=true' > .npmrc

# Clean reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm pnpm-lock.yaml
pnpm install
```

### Workspace Protocol Not Resolved

**Cause:** workspace:* not resolving correctly.

**Solution:**

```bash
# Check pnpm-workspace.yaml includes the package
# Ensure package name matches exactly
pnpm install
```

### Peer Dependency Warnings

**Cause:** Missing peer dependencies.

**Solution:**

```bash
# Usually safe to ignore, but if causing issues:
pnpm add <missing-peer> --filter <package>
```

### Build Order Issues

**Cause:** Turborepo not building dependencies first.

**Solution:** Check `turbo.json` has correct `dependsOn`:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"]
    }
  }
}
```

---

## Best Practices

1. **Always use pnpm** — Don't mix npm/yarn
2. **Commit lockfile** — Always commit `pnpm-lock.yaml` changes
3. **Don't edit lockfile manually** — Regenerate on conflicts
4. **Use workspace:*** — For internal dependencies
5. **Use catalog:** — For shared version management
6. **Clean install after .npmrc changes** — Delete node_modules and lockfile
7. **Verify after merge** — Run build and tests
