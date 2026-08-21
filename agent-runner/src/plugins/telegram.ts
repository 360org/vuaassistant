import type { Plugin } from '../kernel/types.js';
import { startTelegramChannel } from '../channels/telegram.js';
import type { PollLoopConfig } from '../poll-loop.js';

declare module '../kernel/types.js' {
  interface Context {
    telegram: {
      start(config: PollLoopConfig): void;
    };
  }
}

export function createTelegramPlugin(): Plugin {
  return {
    name: 'telegram',
    dependencies: [],
    async setup(ctx) {
      const abortController = new AbortController();

      ctx.provide('telegram', {
        start(config: PollLoopConfig) {
          const configWithSignal = {
            ...config,
            signal: abortController.signal,
          };
          startTelegramChannel(configWithSignal);
        },
      });

      ctx.effect(() => {
        abortController.abort();
      });
    },
  };
}
