/**
 * Tool groups for policy-based filtering.
 *
 * Groups provide shortcuts for allowing/denying multiple tools at once.
 * Use "group:name" in allow/deny lists.
 */

/**
 * Tool name aliases for compatibility.
 * Maps alternative names to canonical tool names.
 */
export const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: "exec",
  shell: "exec",
  search: "web_search",
  fetch: "web_fetch",
};

/**
 * Tool groups - shortcuts for multiple tools.
 * Use "group:name" in allow/deny lists.
 */
export const TOOL_GROUPS: Record<string, string[]> = {
  // File system operations
  "group:fs": ["read", "write", "edit", "glob"],

  // Runtime/execution tools
  "group:runtime": ["exec", "process"],

  // Web tools
  "group:web": ["web_search", "web_fetch"],

  // Memory tools (requires profile)
  "group:memory": ["memory_search"],

  // Subagent tools
  "group:subagent": ["sessions_spawn", "sessions_list"],

  // Cron/scheduling tools
  "group:cron": ["cron"],

  // All core tools
  "group:core": [
    "read",
    "write",
    "edit",
    "glob",
    "exec",
    "process",
    "web_search",
    "web_fetch",
  ],
};

/**
 * Default tools denied for subagents.
 * Subagents should not have access to session management or system tools.
 */
export const DEFAULT_SUBAGENT_TOOL_DENY: string[] = [
  // Subagents cannot spawn subagents (no nested spawning)
  "sessions_spawn",
];

/**
 * Normalize a tool name to its canonical form.
 */
export function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

/**
 * Normalize a list of tool names.
 */
export function normalizeToolList(list?: string[]): string[] {
  if (!list) return [];
  return list.map(normalizeToolName).filter(Boolean);
}

/**
 * Expand group references in a tool list.
 * "group:fs" -> ["read", "write", "edit", "glob"]
 */
export function expandToolGroups(list?: string[]): string[] {
  const normalized = normalizeToolList(list);
  const expanded: string[] = [];

  for (const value of normalized) {
    const group = TOOL_GROUPS[value];
    if (group) {
      expanded.push(...group);
      continue;
    }
    expanded.push(value);
  }

  return Array.from(new Set(expanded));
}
