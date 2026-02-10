import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";

const MemorySearchSchema = Type.Object({
  query: Type.String({
    description: "Search query - keywords or phrases to find in memory files.",
  }),
  maxResults: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return. Defaults to 10.",
      minimum: 1,
      maximum: 50,
    }),
  ),
  caseSensitive: Type.Optional(
    Type.Boolean({
      description: "Whether the search is case-sensitive. Defaults to false.",
    }),
  ),
});

type MemorySearchArgs = {
  query: string;
  maxResults?: number;
  caseSensitive?: boolean;
};

export type MemorySearchMatch = {
  file: string;
  line: number;
  content: string;
  context: {
    before: string[];
    after: string[];
  };
};

export type MemorySearchResult = {
  matches: MemorySearchMatch[];
  totalMatches: number;
  filesSearched: number;
  truncated: boolean;
};

const DEFAULT_MAX_RESULTS = 10;
const CONTEXT_LINES = 2;

/**
 * Create a memory_search tool for searching memory files.
 *
 * @param profileDir - Profile directory containing memory.md and memory/ folder
 */
export function createMemorySearchTool(
  profileDir: string,
): AgentTool<typeof MemorySearchSchema, MemorySearchResult> {
  return {
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search through memory files (memory.md and memory/*.md) for keywords or phrases. " +
      "Use this before answering questions about prior work, decisions, dates, people, preferences, or todos. " +
      "Returns matching lines with context.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, args, _signal) => {
      const { query, maxResults, caseSensitive } = args as MemorySearchArgs;

      if (!query || query.trim() === "") {
        throw new Error("Query must not be empty");
      }

      const limit = Math.min(maxResults || DEFAULT_MAX_RESULTS, 50);
      const searchQuery = caseSensitive ? query : query.toLowerCase();

      // Find all memory files
      const memoryFiles = await findMemoryFiles(profileDir);

      if (memoryFiles.length === 0) {
        return {
          content: [{ type: "text", text: "No memory files found." }],
          details: {
            matches: [],
            totalMatches: 0,
            filesSearched: 0,
            truncated: false,
          },
        };
      }

      // Search each file
      const allMatches: MemorySearchMatch[] = [];

      for (const file of memoryFiles) {
        const matches = await searchFile(file, searchQuery, caseSensitive ?? false, profileDir);
        allMatches.push(...matches);
      }

      // Sort by relevance (files with more matches first, then by line number)
      allMatches.sort((a, b) => {
        if (a.file !== b.file) {
          // Count matches per file
          const aCount = allMatches.filter((m) => m.file === a.file).length;
          const bCount = allMatches.filter((m) => m.file === b.file).length;
          return bCount - aCount;
        }
        return a.line - b.line;
      });

      const totalMatches = allMatches.length;
      const truncated = allMatches.length > limit;
      const limitedMatches = allMatches.slice(0, limit);

      // Format output
      const output = formatSearchResults(limitedMatches, totalMatches, truncated, memoryFiles.length);

      return {
        content: [{ type: "text", text: output }],
        details: {
          matches: limitedMatches,
          totalMatches,
          filesSearched: memoryFiles.length,
          truncated,
        },
      };
    },
  };
}

/**
 * Find all memory files in the profile directory.
 */
async function findMemoryFiles(profileDir: string): Promise<string[]> {
  const files: string[] = [];

  // Check for memory.md in profile root
  const memoryMd = path.join(profileDir, "memory.md");
  try {
    await fs.access(memoryMd);
    files.push(memoryMd);
  } catch {
    // File doesn't exist
  }

  // Check for memory/*.md files
  const memoryDir = path.join(profileDir, "memory");
  try {
    await fs.access(memoryDir);
    const mdFiles = await fg("*.md", {
      cwd: memoryDir,
      onlyFiles: true,
      absolute: true,
    });
    files.push(...mdFiles);
  } catch {
    // Directory doesn't exist
  }

  return files;
}

/**
 * Search a single file for the query.
 */
async function searchFile(
  filePath: string,
  query: string,
  caseSensitive: boolean,
  profileDir: string,
): Promise<MemorySearchMatch[]> {
  const matches: MemorySearchMatch[] = [];

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const searchLine = caseSensitive ? line : line.toLowerCase();

      if (searchLine.includes(query)) {
        // Get context lines
        const beforeLines: string[] = [];
        const afterLines: string[] = [];

        for (let j = Math.max(0, i - CONTEXT_LINES); j < i; j++) {
          beforeLines.push(lines[j]!);
        }

        for (let j = i + 1; j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) {
          afterLines.push(lines[j]!);
        }

        // Get relative path for display
        const relativePath = path.relative(profileDir, filePath);

        matches.push({
          file: relativePath,
          line: i + 1, // 1-indexed
          content: line,
          context: {
            before: beforeLines,
            after: afterLines,
          },
        });
      }
    }
  } catch (err) {
    // Skip files that can't be read
    console.error(`Failed to read ${filePath}:`, err);
  }

  return matches;
}

/**
 * Format search results for display.
 */
function formatSearchResults(
  matches: MemorySearchMatch[],
  totalMatches: number,
  truncated: boolean,
  filesSearched: number,
): string {
  if (matches.length === 0) {
    return `No matches found in ${filesSearched} memory file(s).`;
  }

  const lines: string[] = [];
  lines.push(`Found ${totalMatches} match(es) in ${filesSearched} file(s):`);

  if (truncated) {
    lines.push(`(Showing first ${matches.length} results)`);
  }

  lines.push("");

  // Group by file
  const byFile = new Map<string, MemorySearchMatch[]>();
  for (const match of matches) {
    const existing = byFile.get(match.file) || [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  for (const [file, fileMatches] of byFile) {
    lines.push(`## ${file}`);
    lines.push("");

    for (const match of fileMatches) {
      lines.push(`**Line ${match.line}:**`);

      // Show context before
      if (match.context.before.length > 0) {
        for (const ctx of match.context.before) {
          lines.push(`  ${ctx}`);
        }
      }

      // Show matching line (highlighted)
      lines.push(`> ${match.content}`);

      // Show context after
      if (match.context.after.length > 0) {
        for (const ctx of match.context.after) {
          lines.push(`  ${ctx}`);
        }
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}
