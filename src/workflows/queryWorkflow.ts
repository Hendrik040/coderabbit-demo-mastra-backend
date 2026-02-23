import { createWorkflow, createStep } from '@mastra/core/workflows';
import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';

const agent = new Agent({
  name: 'query-agent',
  instructions: "You are a helpful assistant. Answer the user's query concisely.",
  model: openai('gpt-4o-mini'),
});

const processQueryStep = createStep({
  id: 'process-query',
  inputSchema: z.object({
    query: z.string().describe('The user query to process'),
  }),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: async ({ context }) => {
    const response = await agent.generate(context.query);
    return { result: response.text };
  },
});

export const queryWorkflow = createWorkflow({
  id: 'query-workflow',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ result: z.string() }),
})
  .then(processQueryStep)
  .commit();
