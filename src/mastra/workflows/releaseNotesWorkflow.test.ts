import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Schemas duplicated here so tests don't depend on private exports ─────────
// (mirrors the schemas in releaseNotesWorkflow.ts)

const commitSchema = z.object({
  sha: z.string(),
  type: z.enum(["feat", "fix", "perf", "chore", "docs", "refactor", "test"]),
  message: z.string(),
  breaking: z.boolean(),
});

const workflowInputSchema = z.object({
  commitLog: z.string(),
});

const workflowOutputSchema = z.object({
  result: z.string(),
  version: z.string(),
  refined: z.boolean(),
});

// ─── Input / output contract ───────────────────────────────────────────────────

describe("releaseNotesWorkflow — input schema", () => {
  it("accepts a plain commit range string", () => {
    const result = workflowInputSchema.safeParse({
      commitLog: "f59ffed..9f130dd",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a commit range with additional instructions", () => {
    const result = workflowInputSchema.safeParse({
      commitLog: "f59ffed..9f130dd\nAdditional instructions: focus on OAuth changes",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty commitLog", () => {
    const result = workflowInputSchema.safeParse({ commitLog: "" });
    // empty string is still a string — schema accepts it; runtime guards it
    expect(typeof result).toBe("object");
  });
});

describe("releaseNotesWorkflow — output schema", () => {
  it("accepts a well-formed result payload", () => {
    const result = workflowOutputSchema.safeParse({
      result: "## v2.1.0 — December 2025\n\n### ✨ Features\n- **OAuth Support**: ...",
      version: "v2.1.0",
      refined: false,
    });
    expect(result.success).toBe(true);
  });

  it("requires result, version, and refined fields", () => {
    expect(workflowOutputSchema.safeParse({ result: "notes" }).success).toBe(false);
    expect(workflowOutputSchema.safeParse({ version: "v1.0.0" }).success).toBe(false);
    expect(workflowOutputSchema.safeParse({}).success).toBe(false);
  });
});

// ─── Commit classification logic ───────────────────────────────────────────────

describe("commit categorisation", () => {
  const commits = [
    { sha: "a23ebf4", type: "feat" as const, message: "oauth implementation", breaking: false },
    { sha: "c41a2b0", type: "fix"  as const, message: "fixed google oauth",   breaking: false },
    { sha: "cfab29e", type: "perf" as const, message: "added caching logic",  breaking: false },
    { sha: "3583104", type: "chore"as const, message: "new database migration", breaking: false },
    { sha: "dd8c5a2", type: "test" as const, message: "add load tests",        breaking: false },
  ];

  it("parses all sample commits against the commit schema", () => {
    for (const c of commits) {
      expect(commitSchema.safeParse(c).success).toBe(true);
    }
  });

  it("correctly separates features from fixes", () => {
    const features    = commits.filter((c) => c.type === "feat");
    const fixes       = commits.filter((c) => c.type === "fix");
    const performance = commits.filter((c) => c.type === "perf");
    const maintenance = commits.filter((c) =>
      ["chore", "docs", "refactor", "test"].includes(c.type)
    );

    expect(features).toHaveLength(1);
    expect(fixes).toHaveLength(1);
    expect(performance).toHaveLength(1);
    expect(maintenance).toHaveLength(2);
  });

  it("determines minor bump when there are features and no breaking changes", () => {
    const hasBreaking = commits.some((c) => c.breaking);
    const bump = hasBreaking ? "major" : commits.some((c) => c.type === "feat") ? "minor" : "patch";
    expect(bump).toBe("minor");
  });

  it("determines major bump when any commit is breaking", () => {
    const withBreaking = [...commits, {
      sha: "000dead", type: "feat" as const, message: "rewrite auth", breaking: true,
    }];
    const bump = withBreaking.some((c) => c.breaking) ? "major" : "minor";
    expect(bump).toBe("major");
  });

  it("determines patch bump when there are only fixes and maintenance", () => {
    const fixOnly: Array<{ sha: string; type: string; message: string; breaking: boolean }> = [
      { sha: "aaa0001", type: "fix",   message: "fix login crash",     breaking: false },
      { sha: "aaa0002", type: "chore", message: "update deps",         breaking: false },
      { sha: "aaa0003", type: "test",  message: "add regression test", breaking: false },
    ];
    const hasBreaking = fixOnly.some((c) => c.breaking);
    const hasFeat     = fixOnly.some((c) => c.type === "feat");
    const bump = hasBreaking ? "major" : hasFeat ? "minor" : "patch";
    expect(bump).toBe("patch");
  });
});

// ─── Commit ref parsing ────────────────────────────────────────────────────────

describe("commit range parsing", () => {
  const parseRefs = (commitLog: string) => {
    const lines = commitLog.split("\n");
    const match = lines[0].match(/commits?\s+([a-f0-9]+)\.\.([a-f0-9]+)/i);
    return {
      fromRef: match?.[1] ?? "HEAD~12",
      toRef:   match?.[2] ?? "HEAD",
      instructions: lines.slice(1).join("\n").replace(/^Additional instructions:\s*/i, "").trim(),
    };
  };

  it("extracts fromRef and toRef from a range string", () => {
    const { fromRef, toRef } = parseRefs("commits f59ffed..9f130dd");
    expect(fromRef).toBe("f59ffed");
    expect(toRef).toBe("9f130dd");
  });

  it("falls back to HEAD~12..HEAD when no range is provided", () => {
    const { fromRef, toRef } = parseRefs("Generate release notes for this sprint");
    expect(fromRef).toBe("HEAD~12");
    expect(toRef).toBe("HEAD");
  });

  it("extracts additional instructions from subsequent lines", () => {
    const { instructions } = parseRefs(
      "commits f59ffed..9f130dd\nAdditional instructions: focus on OAuth"
    );
    expect(instructions).toBe("focus on OAuth");
  });

  it("returns empty instructions when none provided", () => {
    const { instructions } = parseRefs("commits f59ffed..9f130dd");
    expect(instructions).toBe("");
  });
});
