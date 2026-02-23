// =============================================================================
// THIS FILE REPRESENTS THE STATE OF queryWorkflow.ts AFTER THE BREAKING-CHANGE PR
//
// In the demo, copy this content over queryWorkflow.ts and open a PR.
// CodeRabbit's multi-repo research agent should catch that the frontend
// still reads `data.result`, which becomes undefined once this ships.
// =============================================================================

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
  // CHANGED: flat { result } → nested { response: { text, metadata } }
  outputSchema: z.object({
    response: z.object({
      text: z.string(),
      metadata: z.object({
        model: z.string(),
        tokensUsed: z.number(),
      }),
    }),
  }),
  execute: async ({ context }) => {
    const agentResponse = await agent.generate(context.query);
    return {
      response: {
        text: agentResponse.text,
        metadata: {
          model: 'gpt-4o-mini',
          tokensUsed: agentResponse.usage?.completionTokens ?? 0,
        },
      },
    };
  },
});

export const queryWorkflow = createWorkflow({
  id: 'query-workflow',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({
    response: z.object({
      text: z.string(),
      metadata: z.object({
        model: z.string(),
        tokensUsed: z.number(),
      }),
    }),
  }),
})
  .then(processQueryStep)
  .commit();
