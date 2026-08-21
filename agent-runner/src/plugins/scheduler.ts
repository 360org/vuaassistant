import type { Plugin } from '../kernel/types.js';
import { startScheduler } from '../scheduler/index.js';
import type { PollLoopConfig } from '../poll-loop.js';

declare module '../kernel/types.js' {
  interface Context {
    scheduler: {
      start(config: PollLoopConfig): void;
    };
  }
}

export function createSchedulerPlugin(): Plugin {
  return {
    name: 'scheduler',
    dependencies: [],
    async setup(ctx) {
      const abortController = new AbortController();

      ctx.provide('scheduler', {
        start(config: PollLoopConfig) {
          const configWithSignal = {
            ...config,
            signal: abortController.signal,
          };
          startScheduler(configWithSignal);
        },
      });

      ctx.effect(() => {
        abortController.abort();
      });
    },
  };
}
