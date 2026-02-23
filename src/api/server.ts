// =============================================================================
// THIS FILE REPRESENTS THE STATE OF server.ts AFTER THE BREAKING-CHANGE PR
//
// In the demo, copy this content over server.ts alongside the workflow change.
// =============================================================================

import express from 'express';
import { mastra } from '../mastra';

const app = express();
app.use(express.json());

app.post('/api/query', async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    const workflow = mastra.getWorkflow('query-workflow');
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { query } });

    // CHANGED: returns { response: { text, metadata } } instead of { result }
    res.json({ response: result.response });
  } catch (error) {
    console.error('Workflow execution failed:', error);
    res.status(500).json({ error: 'Workflow execution failed' });
  }
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Mastra API running on http://localhost:${PORT}`);
});
