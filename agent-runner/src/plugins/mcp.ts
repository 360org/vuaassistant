import type { Plugin } from '../kernel/types.js';
import { mcpManager } from '../mcp-client/index.js';

declare module '../kernel/types.js' {
  interface Context {
    mcp: typeof mcpManager;
  }
}

export function createMcpPlugin(): Plugin {
  return {
    name: 'mcp-manager',
    dependencies: [],
    async setup(ctx) {
      ctx.provide('mcp', mcpManager);
      ctx.effect(() => mcpManager.shutdown());
    },
  };
}
