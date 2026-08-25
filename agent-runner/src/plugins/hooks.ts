/**
 * Hooks Plugin — Lifecycle Extension Points for Agent Runner.
 *
 * Pattern inspired by learn-claude-code (s04_hooks) & DeepSeek Harness:
 * - Structured lifecycle events: UserPromptSubmit, PreToolUse, PostToolUse, TurnComplete.
 * - Clean interception mechanism allowing plugins to inspect, transform, or block operations.
 * - Integrated seamlessly into Kernel types via declaration merging.
 */
import type { Context, Disposer, Plugin } from '../kernel/types.js';
import type { ToolCall, ToolResult } from '../providers/types.js';

export type HookEventName = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'TurnComplete';

export interface UserPromptPayload {
  prompt: string;
  agentId?: string;
}

export interface PreToolUsePayload {
  toolName: string;
  args: Record<string, unknown>;
  goal?: string;
}

export interface PostToolUsePayload {
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  durationMs: number;
}

export interface TurnCompletePayload {
  agentId?: string;
  prompt: string;
  response?: string;
  toolCallsCount: number;
  tokensEstimate?: number;
}

export type HookCallback<T> = (payload: T) => void | string | Promise<void | string>;

declare module '../kernel/types.js' {
  interface Context {
    hooks: HookManager;
  }
  interface NotifyEvents {
    'hook/user-prompt-submit': (payload: UserPromptPayload) => void;
    'hook/post-tool-use': (payload: PostToolUsePayload) => void;
    'hook/turn-complete': (payload: TurnCompletePayload) => void;
  }
}

export interface HookManager {
  /**
   * Đăng ký hook lắng nghe sự kiện vòng đời. Trả về hàm gỡ Disposer.
   */
  register<T = unknown>(event: HookEventName, callback: HookCallback<T>): Disposer;
  /**
   * Kích hoạt hook. Đối với PreToolUse, nếu callback trả về một chuỗi string thì tool bị chặn với thông báo đó.
   */
  trigger(event: 'UserPromptSubmit', payload: UserPromptPayload): Promise<void>;
  trigger(event: 'PreToolUse', payload: PreToolUsePayload): Promise<string | null>;
  trigger(event: 'PostToolUse', payload: PostToolUsePayload): Promise<void>;
  trigger(event: 'TurnComplete', payload: TurnCompletePayload): Promise<void>;
}

export function createHooksPlugin(): Plugin {
  return {
    name: 'hooks',
    dependencies: [],
    setup(ctx: Context) {
      const callbacks = new Map<HookEventName, Set<HookCallback<any>>>();

      function getSet(event: HookEventName): Set<HookCallback<any>> {
        let set = callbacks.get(event);
        if (!set) {
          set = new Set();
          callbacks.set(event, set);
        }
        return set;
      }

      const hooks: HookManager = {
        register(event, callback) {
          const set = getSet(event);
          set.add(callback);
          return ctx.effect(() => {
            set.delete(callback);
          });
        },

        async trigger(event: HookEventName, payload: any): Promise<any> {
          const set = callbacks.get(event);
          if (!set || set.size === 0) return null;

          for (const cb of set) {
            const res = await cb(payload);
            if (event === 'PreToolUse' && typeof res === 'string') {
              return res; // Chặn thực thi tool nếu hook trả về thông báo lỗi
            }
          }
          return null;
        },
      };

      ctx.provide('hooks', hooks);

      // Tự động kết nối với thác nước tools/pre-execute của kernel nếu có
      ctx.intercept('tools/pre-execute', async (payload, next) => {
        const blockReason = await hooks.trigger('PreToolUse', {
          toolName: payload.tool.name,
          args: payload.args,
          goal: payload.goal,
        });

        if (blockReason) {
          return {
            tool_call_id: '',
            content: `Bị chặn bởi Hook (PreToolUse): ${blockReason}`,
            is_error: true,
          };
        }

        const start = Date.now();
        const result = await next();
        const durationMs = Date.now() - start;

        await hooks.trigger('PostToolUse', {
          toolName: payload.tool.name,
          args: payload.args,
          result,
          durationMs,
        });

        return result;
      });

      ctx.effect(() => {
        callbacks.clear();
      });
    },
  };
}
