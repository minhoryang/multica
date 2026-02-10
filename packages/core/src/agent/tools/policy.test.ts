import { describe, it, expect } from "vitest";
import { filterTools } from "./policy.js";
import { expandToolGroups } from "./groups.js";

// Mock tools for testing
const mockTools = [
  { name: "read" },
  { name: "write" },
  { name: "edit" },
  { name: "exec" },
  { name: "process" },
  { name: "glob" },
  { name: "web_fetch" },
  { name: "web_search" },
] as any[];

describe("tool groups", () => {
  it("expandToolGroups: group:fs", () => {
    const expanded = expandToolGroups(["group:fs"]);
    expect(expanded.sort()).toEqual(["edit", "glob", "read", "write"]);
  });

  it("expandToolGroups: group:runtime", () => {
    const expanded = expandToolGroups(["group:runtime"]);
    expect(expanded.sort()).toEqual(["exec", "process"]);
  });

  it("expandToolGroups: group:web", () => {
    const expanded = expandToolGroups(["group:web"]);
    expect(expanded.sort()).toEqual(["web_fetch", "web_search"]);
  });

  it("expandToolGroups: mixed groups and tools", () => {
    const expanded = expandToolGroups(["group:runtime", "web_fetch"]);
    expect(expanded.sort()).toEqual(["exec", "process", "web_fetch"]);
  });
});

describe("filterTools", () => {
  it("no config returns all tools", () => {
    const filtered = filterTools(mockTools, {});
    expect(filtered.length).toBe(mockTools.length);
  });

  it("deny specific tool", () => {
    const filtered = filterTools(mockTools, { config: { deny: ["exec"] } });
    const names = filtered.map((t) => t.name);
    expect(names.includes("exec")).toBe(false);
    expect(names.length).toBe(mockTools.length - 1);
  });

  it("allow specific tools", () => {
    const filtered = filterTools(mockTools, {
      config: { allow: ["read", "write"] },
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["read", "write"]);
  });

  it("deny takes precedence over allow", () => {
    const filtered = filterTools(mockTools, {
      config: { allow: ["read", "write", "exec"], deny: ["exec"] },
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["read", "write"]);
  });

  it("allow with group:* syntax", () => {
    const filtered = filterTools(mockTools, {
      config: { allow: ["group:fs", "group:runtime"] },
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["edit", "exec", "glob", "process", "read", "write"]);
  });

  it("deny with group:* syntax", () => {
    const filtered = filterTools(mockTools, {
      config: { deny: ["group:web"] },
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["edit", "exec", "glob", "process", "read", "write"]);
  });
});

describe("provider-specific filtering", () => {
  it("provider-specific deny", () => {
    const filtered = filterTools(mockTools, {
      config: {
        byProvider: {
          google: { deny: ["exec", "process"] },
        },
      },
      provider: "google",
    });
    const names = filtered.map((t) => t.name);
    expect(names.includes("exec")).toBe(false);
    expect(names.includes("process")).toBe(false);
    expect(names.length).toBe(mockTools.length - 2);
  });

  it("provider not matching does not apply", () => {
    const filtered = filterTools(mockTools, {
      config: {
        byProvider: {
          google: { deny: ["exec", "process"] },
        },
      },
      provider: "openai",
    });
    expect(filtered.length).toBe(mockTools.length);
  });
});

describe("subagent restrictions", () => {
  it("subagent restrictions apply", () => {
    const filtered = filterTools(mockTools, { isSubagent: true });
    expect(filtered.length).toBe(mockTools.length);
  });
});

describe("combined filtering", () => {
  it("allow + deny", () => {
    const filtered = filterTools(mockTools, {
      config: {
        allow: ["group:fs", "group:runtime"],
        deny: ["exec"],
      },
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["edit", "glob", "process", "read", "write"]);
  });

  it("allow + provider deny", () => {
    const filtered = filterTools(mockTools, {
      config: {
        allow: ["group:fs", "group:runtime", "group:web"],
        byProvider: {
          google: { deny: ["exec"] },
        },
      },
      provider: "google",
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual([
      "edit",
      "glob",
      "process",
      "read",
      "web_fetch",
      "web_search",
      "write",
    ]);
  });
});
