import { createStep, createWorkflow } from "@mastra/core/workflows";
import { openai } from "@ai-sdk/openai";
import { generateText, generateObject } from "ai";
import { z } from "zod";

// ─── Shared schemas ───────────────────────────────────────────────────────────

const commitSchema = z.object({
  sha: z.string(),
  type: z.enum(["feat", "fix", "perf", "chore", "docs", "refactor", "test"]),
  message: z.string(),
  breaking: z.boolean(),
});

const enrichedCommitSchema = z.object({
  sha: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  breaking: z.boolean(),
});

// Real commits from github.com/Hendrik040/n-aible_edtech_sims (Dec 2025 sprint)
const REPO_COMMITS = [
  { sha: "f59ffed", raw: "updated stuff" },
  { sha: "c300d63", raw: "added static worker ID logic for redis db caching" },
  { sha: "718bf11", raw: "removed Redis KEY logic" },
  { sha: "efc056f", raw: "adding some load testing" },
  { sha: "34deabf", raw: "added testing and password hash optimization" },
  { sha: "3583104", raw: "new database migration added" },
  { sha: "cfab29e", raw: "added new caching logic to optimize response time for chat experience" },
  { sha: "a23ebf4", raw: "oauth implementation" },
  { sha: "c41a2b0", raw: "fixed google oauth" },
  { sha: "d5f451b", raw: "big commit with heaps of changes (notification module)" },
  { sha: "dd8c5a2", raw: "Add load tests for simulation module" },
  { sha: "9f130dd", raw: "Merge PR #240: Optimize Database Connections & Queries" },
];

// ─── Step 1: Parse commits ────────────────────────────────────────────────────
// Extracts fromRef, toRef, and instructions from the raw query string,
// then asks an LLM to classify each commit into a structured object.

const parseCommitsStep = createStep({
  id: "parse-commits",
  description: "Parse the commit range query and classify commits by type using GPT-4o mini",
  inputSchema: z.object({
    query: z.string(),
  }),
  outputSchema: z.object({
    fromRef: z.string(),
    toRef: z.string(),
    instructions: z.string(),
    commits: z.array(commitSchema),
  }),
  execute: async ({ inputData }) => {
    const lines = inputData.query.split("\n");
    const refMatch = lines[0].match(/commits?\s+([a-f0-9]+)\.\.([a-f0-9]+)/i);
    const fromRef = refMatch?.[1] ?? "HEAD~12";
    const toRef = refMatch?.[2] ?? "HEAD";
    const instructions = lines
      .slice(1)
      .join("\n")
      .replace(/^Additional instructions:\s*/i, "")
      .trim();

    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: z.object({ commits: z.array(commitSchema) }),
      prompt: `You are processing git commit messages for n-aible, an AI-powered EdTech simulation platform.

Classify each commit into a structured object. Infer the conventional commit type from context:
- feat: new features or capabilities
- fix: bug fixes
- perf: performance improvements
- chore: maintenance, deps, migrations, infra
- docs: documentation
- refactor: code restructuring
- test: tests added or changed

Commits to classify:
${REPO_COMMITS.map((c) => `${c.sha}: ${c.raw}`).join("\n")}

For each commit return: sha, type, optional scope, cleaned message (readable, no "feat:" prefix), breaking (true only if explicitly breaking).`,
    });

    return { fromRef, toRef, instructions, commits: object.commits };
  },
});

// ─── Step 2: Categorize ───────────────────────────────────────────────────────
// Groups commits into feat/fix/perf/maintenance buckets and determines
// what semantic version bump this release warrants.

const categorizeStep = createStep({
  id: "categorize-commits",
  description: "Group commits by category and determine the semantic version bump",
  inputSchema: z.object({
    fromRef: z.string(),
    toRef: z.string(),
    instructions: z.string(),
    commits: z.array(commitSchema),
  }),
  outputSchema: z.object({
    fromRef: z.string(),
    toRef: z.string(),
    instructions: z.string(),
    features: z.array(commitSchema),
    fixes: z.array(commitSchema),
    performance: z.array(commitSchema),
    maintenance: z.array(commitSchema),
    versionBump: z.enum(["major", "minor", "patch"]),
    suggestedVersion: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { commits, fromRef, toRef, instructions } = inputData;

    const features    = commits.filter((c) => c.type === "feat");
    const fixes       = commits.filter((c) => c.type === "fix");
    const performance = commits.filter((c) => c.type === "perf");
    const maintenance = commits.filter((c) =>
      ["chore", "docs", "refactor", "test"].includes(c.type)
    );

    const hasBreaking     = commits.some((c) => c.breaking);
    const versionBump     = (hasBreaking ? "major" : features.length > 0 ? "minor" : "patch") as "major" | "minor" | "patch";
    const suggestedVersion = versionBump === "major" ? "v3.0.0"
      : versionBump === "minor" ? "v2.1.0"
      : "v2.0.1";

    return {
      fromRef, toRef, instructions,
      features, fixes, performance, maintenance,
      versionBump, suggestedVersion,
    };
  },
});

// ─── Step 3a: Enrich features (runs in parallel with 3b) ─────────────────────
// Rewrites raw feature commit messages into user-facing release note prose.

const enrichFeaturesStep = createStep({
  id: "enrich-features",
  description: "Rewrite feature commits into user-friendly release note entries",
  inputSchema: z.object({
    fromRef: z.string(),
    toRef: z.string(),
    instructions: z.string(),
    features: z.array(commitSchema),
    fixes: z.array(commitSchema),
    performance: z.array(commitSchema),
    maintenance: z.array(commitSchema),
    versionBump: z.enum(["major", "minor", "patch"]),
    suggestedVersion: z.string(),
  }),
  outputSchema: z.object({
    enrichedFeatures: z.array(enrichedCommitSchema),
  }),
  execute: async ({ inputData }) => {
    if (inputData.features.length === 0) return { enrichedFeatures: [] };

    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: z.object({ enrichedFeatures: z.array(enrichedCommitSchema) }),
      prompt: `You are writing release notes for n-aible, an AI-powered EdTech simulation platform.
Transform these feature commits into polished, user-friendly release note entries.
Write for a technical-but-product-aware audience. Be specific about user impact.
${inputData.instructions ? `\nAdditional instructions: ${inputData.instructions}` : ""}

Feature commits:
${inputData.features.map((c) => `${c.sha}: ${c.message}`).join("\n")}

For each commit, write:
- title: 3–6 words, no "feat:" prefix, title-case
- description: 1–2 sentences explaining the user value or impact`,
    });

    return object;
  },
});

// ─── Step 3b: Enrich fixes & perf (runs in parallel with 3a) ─────────────────
// Rewrites fix, perf, and chore commits into user-facing release note prose.

const enrichFixesStep = createStep({
  id: "enrich-fixes",
  description: "Rewrite fix, performance, and maintenance commits into release note entries",
  inputSchema: z.object({
    fromRef: z.string(),
    toRef: z.string(),
    instructions: z.string(),
    features: z.array(commitSchema),
    fixes: z.array(commitSchema),
    performance: z.array(commitSchema),
    maintenance: z.array(commitSchema),
    versionBump: z.enum(["major", "minor", "patch"]),
    suggestedVersion: z.string(),
  }),
  outputSchema: z.object({
    enrichedFixes: z.array(enrichedCommitSchema),
    enrichedPerformance: z.array(enrichedCommitSchema),
    enrichedMaintenance: z.array(enrichedCommitSchema),
  }),
  execute: async ({ inputData }) => {
    const all = [
      ...inputData.fixes.map((c) => ({ ...c, _bucket: "fix" })),
      ...inputData.performance.map((c) => ({ ...c, _bucket: "perf" })),
      ...inputData.maintenance.map((c) => ({ ...c, _bucket: "maintenance" })),
    ];
    if (all.length === 0) {
      return { enrichedFixes: [], enrichedPerformance: [], enrichedMaintenance: [] };
    }

    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: z.object({
        enrichedFixes:       z.array(enrichedCommitSchema),
        enrichedPerformance: z.array(enrichedCommitSchema),
        enrichedMaintenance: z.array(enrichedCommitSchema),
      }),
      prompt: `You are writing release notes for n-aible, an AI-powered EdTech simulation platform.
Transform these commits into polished release note entries. Group them correctly.
${inputData.instructions ? `\nAdditional instructions: ${inputData.instructions}` : ""}

Bug fixes [fix]:
${inputData.fixes.map((c) => `  ${c.sha}: ${c.message}`).join("\n") || "  (none)"}

Performance [perf]:
${inputData.performance.map((c) => `  ${c.sha}: ${c.message}`).join("\n") || "  (none)"}

Maintenance [chore/docs/refactor/test]:
${inputData.maintenance.map((c) => `  ${c.sha}: ${c.message}`).join("\n") || "  (none)"}

For each commit:
- title: 3–6 words, title-case, no prefix
- description: 1 sentence, technical but clear
Place each commit in the correct output array (enrichedFixes / enrichedPerformance / enrichedMaintenance).`,
    });

    return object;
  },
});

// ─── Step 4: Draft release notes ─────────────────────────────────────────────
// Assembles all enriched commits into a complete Markdown changelog.
// Also runs a quality check and returns isComplete + suggestions.

const draftStep = createStep({
  id: "draft-release-notes",
  description: "Assemble enriched commits into a Markdown changelog and run a quality check",
  inputSchema: z.object({
    "enrich-features": z
      .object({ enrichedFeatures: z.array(enrichedCommitSchema) })
      .optional(),
    "enrich-fixes": z
      .object({
        enrichedFixes:       z.array(enrichedCommitSchema),
        enrichedPerformance: z.array(enrichedCommitSchema),
        enrichedMaintenance: z.array(enrichedCommitSchema),
      })
      .optional(),
  }),
  outputSchema: z.object({
    draft:       z.string(),
    version:     z.string(),
    isComplete:  z.boolean(),
    suggestions: z.array(z.string()),
  }),
  execute: async ({ inputData, getInitData }) => {
    const init     = getInitData<{ query: string }>();
    const features    = inputData["enrich-features"]?.enrichedFeatures   ?? [];
    const fixes       = inputData["enrich-fixes"]?.enrichedFixes          ?? [];
    const perf        = inputData["enrich-fixes"]?.enrichedPerformance    ?? [];
    const maintenance = inputData["enrich-fixes"]?.enrichedMaintenance    ?? [];

    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: z.object({
        draft:       z.string().describe("Complete Markdown release notes"),
        version:     z.string().describe("Version string, e.g. v2.1.0"),
        isComplete:  z.boolean().describe("True if the notes are comprehensive and well-written"),
        suggestions: z.array(z.string()).describe("Improvement suggestions if isComplete is false"),
      }),
      prompt: `You are finalizing release notes for n-aible, an AI-powered EdTech simulation platform.

Assemble these enriched commits into polished Markdown release notes using this format:

## <version> — <Month Year>

### ✨ Features
- **Title**: Description.

### 🐛 Bug Fixes
- **Title**: Description.

### ⚡ Performance
- **Title**: Description.

### 🔧 Maintenance
- Item.

(Omit sections with no entries.)

Original request context: ${init?.query ?? ""}

Features:
${features.map((f) => `- ${f.title}: ${f.description}`).join("\n") || "(none)"}

Bug Fixes:
${fixes.map((f) => `- ${f.title}: ${f.description}`).join("\n") || "(none)"}

Performance:
${perf.map((f) => `- ${f.title}: ${f.description}`).join("\n") || "(none)"}

Maintenance:
${maintenance.map((f) => `- ${f.title}: ${f.description}`).join("\n") || "(none)"}

Use December 2025 as the release date.
Set isComplete: true if the notes are comprehensive and clear. Otherwise list specific suggestions.`,
    });

    return object;
  },
});

// ─── Step 5a: Pass through (branch: quality check passed) ────────────────────

const passThroughStep = createStep({
  id: "pass-through",
  description: "Quality check passed — forwarding draft to output unchanged",
  inputSchema: z.object({
    draft:       z.string(),
    version:     z.string(),
    isComplete:  z.boolean(),
    suggestions: z.array(z.string()),
  }),
  outputSchema: z.object({
    draft:   z.string(),
    version: z.string(),
    refined: z.literal(false),
  }),
  execute: async ({ inputData }) => ({
    draft:   inputData.draft,
    version: inputData.version,
    refined: false as const,
  }),
});

// ─── Step 5b: Refine notes (branch: quality check failed) ────────────────────
// Applies the LLM's own suggestions to improve the draft before outputting.

const refineStep = createStep({
  id: "refine-notes",
  description: "Improve draft release notes based on the quality review suggestions",
  inputSchema: z.object({
    draft:       z.string(),
    version:     z.string(),
    isComplete:  z.boolean(),
    suggestions: z.array(z.string()),
  }),
  outputSchema: z.object({
    draft:   z.string(),
    version: z.string(),
    refined: z.literal(true),
  }),
  execute: async ({ inputData }) => {
    const { text } = await generateText({
      model: openai("gpt-4o"),
      prompt: `Improve these release notes by addressing each suggestion below.
Keep the same Markdown format and version header. Return only the improved release notes.

Current release notes:
${inputData.draft}

Suggestions to address:
${inputData.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    });

    return { draft: text, version: inputData.version, refined: true as const };
  },
});

// ─── Step 6: Finalize output ──────────────────────────────────────────────────
// Merges the branch outputs and returns the final { result } the API serves.

const finalizeStep = createStep({
  id: "finalize-output",
  description: "Package the final release notes into the API response payload",
  inputSchema: z.object({
    "pass-through": z
      .object({ draft: z.string(), version: z.string(), refined: z.literal(false) })
      .optional(),
    "refine-notes": z
      .object({ draft: z.string(), version: z.string(), refined: z.literal(true) })
      .optional(),
  }),
  outputSchema: z.object({
    result:  z.string(),
    version: z.string(),
    refined: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const data = inputData["pass-through"] ?? inputData["refine-notes"];
    return {
      result:  data?.draft   ?? "## Release Notes\n\nNo content generated.",
      version: data?.version ?? "unknown",
      refined: data?.refined ?? false,
    };
  },
});

// ─── Workflow assembly ────────────────────────────────────────────────────────
//
//  start
//    → parse-commits          (classify raw commits with GPT-4o mini)
//    → categorize-commits     (group by type, determine semver bump)
//    → parallel([
//        enrich-features,     (GPT-4o: user-friendly feature descriptions)
//        enrich-fixes,        (GPT-4o: fix + perf + maintenance descriptions)
//      ])
//    → draft-release-notes    (GPT-4o: assemble Markdown + quality check)
//    → branch([
//        [isComplete=false → refine-notes],
//        [isComplete=true  → pass-through],
//      ])
//    → finalize-output
//  end

export const releaseNotesWorkflow = createWorkflow({
  id: "release-notes-workflow",
  description:
    "Multi-step AI workflow: parse commits → categorize → parallel enrich → draft → quality-review branch → finalize",
  inputSchema: z.object({
    query: z.string().describe("Commit range (e.g. 'f59ffed..9f130dd') plus optional instructions"),
  }),
  outputSchema: z.object({
    result:  z.string(),
    version: z.string(),
    refined: z.boolean(),
  }),
})
  .then(parseCommitsStep)
  .then(categorizeStep)
  .parallel([enrichFeaturesStep, enrichFixesStep])
  .then(draftStep)
  .branch([
    [async ({ inputData }: any) => !inputData.isComplete, refineStep],
    [async ({ inputData }: any) =>  inputData.isComplete, passThroughStep],
  ])
  .then(finalizeStep as any)
  .commit();
