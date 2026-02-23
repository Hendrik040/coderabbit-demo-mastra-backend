import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { releaseNotesWorkflow } from "./workflows/releaseNotesWorkflow.js";

const storage = new LibSQLStore({
  id: "main",
  url: "file:local.db",
});

export const mastra = new Mastra({
  workflows: { releaseNotesWorkflow },
  storage,
});
