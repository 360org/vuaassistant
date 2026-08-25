/**
 * Task System Plugin — Persistent Task Dependency Graph (DAG) for Agent Runner.
 *
 * Pattern inspired by learn-claude-code (s10_task_system) & DeepSeek Harness:
 * - Persistent JSON store in `.tasks/` workspace directory.
 * - Explicit dependency graph (`blockedBy` list) with transitive cycle detection.
 * - Task lifecycle: `pending` -> `in_progress` -> `completed`.
 * - Clean Kernel Plugin registration via `ctx.tools.register()` with Disposers.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Context, Disposer, Plugin } from '../kernel/types.js';
import type { ToolResult } from '../providers/types.js';
import { getDataDir } from '../util/data-dir.js';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  owner: string | null;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

const TASK_ID_PATTERN = /^task_[0-9a-f]{8}$/;

export class TaskStore {
  private directory: string;

  constructor(directory?: string) {
    if (directory) {
      this.directory = path.resolve(directory);
    } else {
      const workspace = process.env.VUA_AGENT_WORKSPACE || path.join(getDataDir(), 'workspace');
      this.directory = path.join(workspace, '.tasks');
    }
  }

  private ensureDir(): string {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }
    return this.directory;
  }

  private taskPath(taskId: string): string {
    if (!TASK_ID_PATTERN.test(taskId)) {
      throw new Error(`Mã task không hợp lệ: "${taskId}" (yêu cầu dạng task_xxxxxxxx)`);
    }
    return path.join(this.ensureDir(), `${taskId}.json`);
  }

  public exists(taskId: string): boolean {
    if (!TASK_ID_PATTERN.test(taskId)) return false;
    return fs.existsSync(path.join(this.directory, `${taskId}.json`));
  }

  public create(subject: string, description = ''): Task {
    const cleanSubject = (subject || '').trim();
    if (!cleanSubject) {
      throw new Error('Tiêu đề task không được để trống.');
    }

    this.ensureDir();
    const now = new Date().toISOString();

    for (let attempt = 0; attempt < 50; attempt++) {
      const id = `task_${crypto.randomBytes(4).toString('hex')}`;
      const filePath = path.join(this.directory, `${id}.json`);
      if (fs.existsSync(filePath)) continue;

      const task: Task = {
        id,
        subject: cleanSubject,
        description: (description || '').trim(),
        status: 'pending',
        owner: null,
        blockedBy: [],
        createdAt: now,
        updatedAt: now,
      };

      fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');
      return task;
    }

    throw new Error('Không thể tạo mã task duy nhất sau 50 lần thử.');
  }

  public get(taskId: string): Task | null {
    if (!this.exists(taskId)) return null;
    try {
      const content = fs.readFileSync(this.taskPath(taskId), 'utf8');
      const data = JSON.parse(content) as Task;
      if (data.id !== taskId) {
        throw new Error(`Nội dung tệp task không khớp với mã ${taskId}`);
      }
      return data;
    } catch {
      return null;
    }
  }

  public load(taskId: string): Task {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Không tìm thấy task "${taskId}".`);
    }
    return task;
  }

  public save(task: Task): void {
    task.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.taskPath(task.id), JSON.stringify(task, null, 2), 'utf8');
  }

  /** Kiểm tra quan hệ phụ thuộc bắc cầu (transitive dependency) để chống vòng lặp. */
  public dependsOn(taskId: string, targetId: string): boolean {
    const queue = [taskId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === targetId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const task = this.get(current);
      if (task && Array.isArray(task.blockedBy)) {
        queue.push(...task.blockedBy);
      }
    }
    return false;
  }

  public update(
    taskId: string,
    updates: {
      status?: TaskStatus;
      addBlockedBy?: string[];
      owner?: string | null;
      description?: string;
    },
  ): Task {
    const task = this.load(taskId);

    if (updates.status) {
      if (!['pending', 'in_progress', 'completed'].includes(updates.status)) {
        throw new Error(`Trạng thái không hợp lệ: "${updates.status}". Chỉ nhận: pending, in_progress, completed.`);
      }
      task.status = updates.status;
    }

    if (updates.owner !== undefined) {
      task.owner = updates.owner;
    }

    if (updates.description !== undefined) {
      task.description = updates.description.trim();
    }

    if (Array.isArray(updates.addBlockedBy) && updates.addBlockedBy.length > 0) {
      if (task.status !== 'pending') {
        throw new Error(`Chỉ có thể bổ sung quan hệ phụ thuộc khi task đang ở trạng thái "pending".`);
      }

      const uniqueDeps = Array.from(new Set(updates.addBlockedBy));
      for (const dep of uniqueDeps) {
        if (dep === taskId) {
          throw new Error(`Task "${taskId}" không thể phụ thuộc vào chính nó.`);
        }
        if (!this.exists(dep)) {
          throw new Error(`Task phụ thuộc "${dep}" không tồn tại.`);
        }
        if (!task.blockedBy.includes(dep) && this.dependsOn(dep, taskId)) {
          throw new Error(`Phát hiện chu trình phụ thuộc (Cycle): ${taskId} -> ${dep} -> ${taskId}`);
        }
        if (!task.blockedBy.includes(dep)) {
          task.blockedBy.push(dep);
        }
      }
    }

    this.save(task);
    return task;
  }

  public list(filter?: { status?: TaskStatus }): Task[] {
    if (!fs.existsSync(this.directory)) return [];
    try {
      const files = fs.readdirSync(this.directory).filter((f) => f.startsWith('task_') && f.endsWith('.json'));
      const tasks: Task[] = [];
      for (const file of files) {
        const id = file.replace(/\.json$/, '');
        const task = this.get(id);
        if (task) {
          if (!filter?.status || task.status === filter.status) {
            tasks.push(task);
          }
        }
      }
      return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
      return [];
    }
  }

  /** Task có thể bắt đầu khi tất cả task phụ thuộc trong `blockedBy` đều đã hoàn thành. */
  public canStart(taskId: string): boolean {
    const task = this.get(taskId);
    if (!task) return false;
    if (task.status === 'completed') return false;
    for (const depId of task.blockedBy) {
      const dep = this.get(depId);
      if (!dep || dep.status !== 'completed') {
        return false;
      }
    }
    return true;
  }
}

declare module '../kernel/types.js' {
  interface Context {
    tasks: TaskStore;
  }
}

export function createTaskSystemPlugin(customDirectory?: string): Plugin {
  return {
    name: 'tasks',
    dependencies: ['tools'],
    setup(ctx: Context) {
      const store = new TaskStore(customDirectory);
      ctx.provide('tasks', store);

      // 1. task_create
      ctx.tools.register(
        {
          name: 'task_create',
          description:
            'Tạo một tác vụ mới trong đồ thị công việc (Task DAG). Trả về mã task_xxxxxxxx để thiết lập phụ thuộc.',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Tiêu đề ngắn gọn của tác vụ.' },
              description: { type: 'string', description: 'Mô tả chi tiết và tiêu chí hoàn thành.' },
            },
            required: ['subject'],
          },
          sideEffect: true,
          requiresApproval: false,
          execute(args) {
            try {
              const subject = String(args.subject || '');
              const description = String(args.description || '');
              const task = store.create(subject, description);
              return {
                tool_call_id: '',
                content: JSON.stringify(task, null, 2),
              };
            } catch (err) {
              return {
                tool_call_id: '',
                content: `Lỗi tạo task: ${err instanceof Error ? err.message : String(err)}`,
                is_error: true,
              };
            }
          },
        },
        'native',
      );

      // 2. task_update
      ctx.tools.register(
        {
          name: 'task_update',
          description:
            'Cập nhật trạng thái (pending, in_progress, completed), người phụ trách hoặc thêm quan hệ phụ thuộc (blockedBy).',
          input_schema: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'Mã task cần cập nhật (dạng task_xxxxxxxx).' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Trạng thái mới của task.',
              },
              add_blocked_by: {
                type: 'array',
                items: { type: 'string' },
                description: 'Danh sách mã task_xxxxxxxx mà task này cần chờ hoàn thành trước.',
              },
              owner: { type: 'string', description: 'Tên Agent hoặc người thực hiện.' },
              description: { type: 'string', description: 'Mô tả cập nhật.' },
            },
            required: ['task_id'],
          },
          sideEffect: true,
          requiresApproval: false,
          execute(args) {
            try {
              const taskId = String(args.task_id || '');
              const status = args.status as TaskStatus | undefined;
              const addBlockedBy = Array.isArray(args.add_blocked_by)
                ? (args.add_blocked_by as string[])
                : undefined;
              const owner = args.owner !== undefined ? String(args.owner) : undefined;
              const description = args.description !== undefined ? String(args.description) : undefined;

              const task = store.update(taskId, {
                status,
                addBlockedBy,
                owner,
                description,
              });

              return {
                tool_call_id: '',
                content: JSON.stringify(task, null, 2),
              };
            } catch (err) {
              return {
                tool_call_id: '',
                content: `Lỗi cập nhật task: ${err instanceof Error ? err.message : String(err)}`,
                is_error: true,
              };
            }
          },
        },
        'native',
      );

      // 3. task_get
      ctx.tools.register(
        {
          name: 'task_get',
          description: 'Xem chi tiết một tác vụ theo mã task_xxxxxxxx kèm trạng thái phụ thuộc can_start.',
          input_schema: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'Mã task (task_xxxxxxxx).' },
            },
            required: ['task_id'],
          },
          sideEffect: false,
          requiresApproval: false,
          execute(args) {
            try {
              const taskId = String(args.task_id || '');
              const task = store.load(taskId);
              const canStart = store.canStart(taskId);
              return {
                tool_call_id: '',
                content: JSON.stringify({ ...task, canStart }, null, 2),
              };
            } catch (err) {
              return {
                tool_call_id: '',
                content: `Lỗi đọc task: ${err instanceof Error ? err.message : String(err)}`,
                is_error: true,
              };
            }
          },
        },
        'native',
      );

      // 4. task_list
      ctx.tools.register(
        {
          name: 'task_list',
          description: 'Liệt kê danh sách tác vụ trong hệ thống kèm trạng thái can_start.',
          input_schema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Lọc theo trạng thái.',
              },
            },
          },
          sideEffect: false,
          requiresApproval: false,
          execute(args) {
            try {
              const status = args.status as TaskStatus | undefined;
              const list = store.list({ status });
              const result = list.map((t) => ({
                ...t,
                canStart: store.canStart(t.id),
              }));
              return {
                tool_call_id: '',
                content: JSON.stringify(result, null, 2),
              };
            } catch (err) {
              return {
                tool_call_id: '',
                content: `Lỗi liệt kê task: ${err instanceof Error ? err.message : String(err)}`,
                is_error: true,
              };
            }
          },
        },
        'native',
      );
    },
  };
}
