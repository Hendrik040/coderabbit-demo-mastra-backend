import { Mastra } from '@mastra/core';
import { queryWorkflow } from '../workflows/queryWorkflow';

export const mastra = new Mastra({
  workflows: { queryWorkflow },
});
