/**
 * Tool policy system for filtering tools based on configuration.
 *
 * Supports 3 layers of filtering:
 * 1. Global allow/deny - user customization
 * 2. Provider-specific - different rules for different LLM providers
 * 3. Subagent restrictions - limited tools for spawned agents
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  expandToolGroups,
  normalizeToolName,
  DEFAULT_SUBAGENT_TOOL_DENY,
} from "./groups.js";

/**
 * Tool policy configuration.
 */
export interface ToolPolicy {
  /** Allow list - only these tools are available (supports group:* syntax) */
  allow?: string[];
  /** Deny list - these tools are blocked (takes precedence over allow) */
  deny?: string[];
}

/**
 * Full tool configuration from config file.
 */
export interface ToolsConfig {
  /** Tools to allow (supports group:* syntax) */
  allow?: string[];
  /** Tools to deny (takes precedence over allow) */
  deny?: string[];
  /** Provider-specific overrides */
  byProvider?: Record<string, ToolPolicy>;
}

// ============================================================================
// Pattern Matching
// ============================================================================

type CompiledPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "regex"; value: RegExp };

function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeToolName(pattern);
  if (!normalized) return { kind: "exact", value: "" };
  if (normalized === "*") return { kind: "all" };
  if (!normalized.includes("*")) return { kind: "exact", value: normalized };

  // Convert wildcard to regex
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    kind: "regex",
    value: new RegExp(`^${escaped.replace(/\\\*/g, ".*")}$`),
  };
}

function compilePatterns(patterns?: string[]): CompiledPattern[] {
  if (!Array.isArray(patterns)) return [];
  return expandToolGroups(patterns)
    .map(compilePattern)
    .filter((pattern) => pattern.kind !== "exact" || pattern.value);
}

function matchesAny(name: string, patterns: CompiledPattern[]): boolean {
  for (const pattern of patterns) {
    if (pattern.kind === "all") return true;
    if (pattern.kind === "exact" && name === pattern.value) return true;
    if (pattern.kind === "regex" && pattern.value.test(name)) return true;
  }
  return false;
}

// ============================================================================
// Policy Matching
// ============================================================================

/**
 * Create a matcher function for a policy.
 * Returns true if the tool is allowed, false if denied.
 */
function createPolicyMatcher(policy: ToolPolicy): (name: string) => boolean {
  const deny = compilePatterns(policy.deny);
  const allow = compilePatterns(policy.allow);
  // Check if allow was explicitly set (even if empty)
  const hasAllowList = Array.isArray(policy.allow);

  return (name: string) => {
    const normalized = normalizeToolName(name);

    // Deny takes precedence
    if (matchesAny(normalized, deny)) return false;

    // If no allow list configured, allow all
    if (!hasAllowList) return true;

    // If allow list is empty, deny all (explicit restriction)
    if (allow.length === 0) return false;

    // Check if in allow list
    return matchesAny(normalized, allow);
  };
}

/**
 * Check if a tool is allowed by a policy.
 */
export function isToolAllowed(name: string, policy?: ToolPolicy): boolean {
  if (!policy) return true;
  return createPolicyMatcher(policy)(name);
}

/**
 * Filter tools by a policy.
 */
export function filterToolsByPolicy<T extends { name: string }>(
  tools: T[],
  policy?: ToolPolicy,
): T[] {
  if (!policy) return tools;
  const matcher = createPolicyMatcher(policy);
  return tools.filter((tool) => matcher(tool.name));
}

// ============================================================================
// Policy Resolution
// ============================================================================

/**
 * Merge allow lists (union).
 */
function mergeAllow(base?: string[], extra?: string[]): string[] | undefined {
  if (!extra || extra.length === 0) return base;
  if (!base || base.length === 0) return extra;
  return Array.from(new Set([...base, ...extra]));
}

/**
 * Merge deny lists (union).
 */
function mergeDeny(base?: string[], extra?: string[]): string[] | undefined {
  if (!extra || extra.length === 0) return base;
  if (!base || base.length === 0) return extra;
  return Array.from(new Set([...base, ...extra]));
}

/**
 * Resolve provider-specific policy.
 */
function resolveProviderPolicy(
  byProvider?: Record<string, ToolPolicy>,
  provider?: string,
): ToolPolicy | undefined {
  if (!provider || !byProvider) return undefined;

  const normalized = provider.trim().toLowerCase();
  return byProvider[normalized];
}

/**
 * Get subagent tool policy.
 */
export function getSubagentPolicy(extraDeny?: string[]): ToolPolicy {
  const deny = mergeDeny(DEFAULT_SUBAGENT_TOOL_DENY, extraDeny);
  if (deny) {
    return { deny };
  }
  return {};
}

// ============================================================================
// Main Filter Function
// ============================================================================

export interface FilterToolsOptions {
  /** Tool configuration */
  config?: ToolsConfig | undefined;
  /** Current LLM provider (for provider-specific rules) */
  provider?: string | undefined;
  /** Whether this is a subagent (applies subagent restrictions) */
  isSubagent?: boolean | undefined;
}

/**
 * Filter tools through the 3-layer policy system.
 *
 * Layer 1: Global allow/deny
 * Layer 2: Provider-specific
 * Layer 3: Subagent restrictions
 */
export function filterTools(
  tools: AgentTool<any>[],
  options: FilterToolsOptions = {},
): AgentTool<any>[] {
  const { config, provider, isSubagent } = options;

  let filtered = tools;

  // Layer 1: Global allow/deny
  if (config?.allow || config?.deny) {
    const globalPolicy: ToolPolicy = {};
    if (config.allow) {
      globalPolicy.allow = config.allow;
    }
    if (config.deny) {
      globalPolicy.deny = config.deny;
    }
    filtered = filterToolsByPolicy(filtered, globalPolicy);
  }

  // Layer 2: Provider-specific
  if (provider && config?.byProvider) {
    const providerPolicy = resolveProviderPolicy(config.byProvider, provider);
    if (providerPolicy) {
      filtered = filterToolsByPolicy(filtered, providerPolicy);
    }
  }

  // Layer 3: Subagent restrictions
  if (isSubagent) {
    const subagentPolicy = getSubagentPolicy();
    filtered = filterToolsByPolicy(filtered, subagentPolicy);
  }

  return filtered;
}

/**
 * Merge two ToolsConfig objects.
 * The override config takes precedence:
 * - allow: union of both
 * - deny: union of both
 * - byProvider: deep merge with override taking precedence
 */
export function mergeToolsConfig(
  base?: ToolsConfig,
  override?: ToolsConfig,
): ToolsConfig | undefined {
  if (!base && !override) return undefined;
  if (!base) return override;
  if (!override) return base;

  const result: ToolsConfig = {};

  // allow: union
  const allow = mergeAllow(base.allow, override.allow);
  if (allow) {
    result.allow = allow;
  }

  // deny: union
  const deny = mergeDeny(base.deny, override.deny);
  if (deny) {
    result.deny = deny;
  }

  // byProvider: deep merge
  if (base.byProvider || override.byProvider) {
    const providers = new Set([
      ...Object.keys(base.byProvider ?? {}),
      ...Object.keys(override.byProvider ?? {}),
    ]);

    const byProvider: Record<string, ToolPolicy> = {};
    for (const provider of providers) {
      const basePolicy = base.byProvider?.[provider];
      const overridePolicy = override.byProvider?.[provider];

      if (basePolicy && overridePolicy) {
        const merged: ToolPolicy = {};
        const pAllow = mergeAllow(basePolicy.allow, overridePolicy.allow);
        if (pAllow) {
          merged.allow = pAllow;
        }
        const pDeny = mergeDeny(basePolicy.deny, overridePolicy.deny);
        if (pDeny) {
          merged.deny = pDeny;
        }
        byProvider[provider] = merged;
      } else {
        byProvider[provider] = overridePolicy ?? basePolicy!;
      }
    }
    result.byProvider = byProvider;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Check if a specific tool would be allowed given the options.
 */
export function wouldToolBeAllowed(
  toolName: string,
  options: FilterToolsOptions = {},
): boolean {
  const { config, provider, isSubagent } = options;

  // Layer 1: Global allow/deny
  if (config?.allow || config?.deny) {
    const globalPolicy: ToolPolicy = {};
    if (config.allow) {
      globalPolicy.allow = config.allow;
    }
    if (config.deny) {
      globalPolicy.deny = config.deny;
    }
    if (!isToolAllowed(toolName, globalPolicy)) {
      return false;
    }
  }

  // Layer 2: Provider-specific
  if (provider && config?.byProvider) {
    const providerPolicy = resolveProviderPolicy(config.byProvider, provider);
    if (providerPolicy && !isToolAllowed(toolName, providerPolicy)) {
      return false;
    }
  }

  // Layer 3: Subagent restrictions
  if (isSubagent) {
    const subagentPolicy = getSubagentPolicy();
    if (!isToolAllowed(toolName, subagentPolicy)) {
      return false;
    }
  }

  return true;
}
