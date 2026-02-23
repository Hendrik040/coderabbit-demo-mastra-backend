import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { mastra } from "../mastra/index.js";

const app = express();
app.use(cors());
app.use(express.json());

// ─── OpenAPI spec ─────────────────────────────────────────────────────────────

const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "Release Notes Generator API",
    version: "1.0.0",
    description:
      "Runs the Mastra multi-step release notes workflow. " +
      "Pass a commit range and optional instructions; receive polished Markdown release notes.",
  },
  servers: [{ url: "http://localhost:3001", description: "Local dev server" }],
  paths: {
    "/api/query": {
      post: {
        summary: "Generate release notes",
        description:
          "Triggers the 6-step Mastra workflow: parse → categorize → parallel enrich → draft → quality-branch → finalize.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["commitLog"],
                properties: {
                  commitLog: {
                    type: "string",
                    description:
                      "Commit range and optional instructions.",
                    example: "commits f59ffed..9f130dd",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Release notes generated successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    result:  { type: "string", description: "Markdown release notes" },
                    version: { type: "string", example: "v2.1.0" },
                    refined: { type: "boolean", description: "True if a refinement pass was applied" },
                  },
                },
              },
            },
          },
          400: { description: "Missing or invalid commitLog field" },
          500: { description: "Workflow execution failed" },
        },
      },
    },
  },
};

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/", (_req, res) => res.redirect("/api-docs"));

app.post("/api/query", async (req, res) => {
  const { commitLog } = req.body as { commitLog?: string };

  if (!commitLog || typeof commitLog !== "string") {
    return res.status(400).json({ error: "commitLog is required" });
  }

  try {
    const workflow = mastra.getWorkflow("releaseNotesWorkflow");
    const run      = await workflow.createRun();
    const output   = await run.start({ inputData: { commitLog } as any });

    // Unwrap Mastra result envelope if present
    const result = (output as any)?.result ?? output;
    res.json(result);
  } catch (error) {
    console.error("[workflow] execution failed:", error);
    res.status(500).json({ error: "Workflow execution failed" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3001;
app.listen(Number(PORT), () => {
  console.log(`Release Notes API  →  http://localhost:${PORT}`);
  console.log(`Swagger UI         →  http://localhost:${PORT}/api-docs`);
  console.log(`Mastra Studio      →  run "npm run dev" for the workflow diagram`);
});
