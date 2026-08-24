/**
 * Sổ đăng ký và quản lý Kỹ năng Thực thi (Executable Skills) trên Kernel.
 *
 * Theo thiết kế DeepSeek Harness:
 * 1. Skill không chỉ là markdown mà là một đơn vị thực thi khai báo tool/plugin phụ thuộc.
 * 2. Khi kích hoạt, Kernel tự động bind context và mở rộng capability rail tương ứng.
 * 3. Hỗ trợ nạp động từ đĩa vật lý (custom skills) và hot-reload khi có thay đổi.
 */
import type { Context, Disposer, Plugin } from './types.js';

export interface ExecutableSkill {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly category?: string;
  readonly emoji?: string;
  readonly prompt?: string;
  /** Danh sách các tool mà skill này yêu cầu (e.g. ['file_read', 'http_request', 'create_schedule']) */
  readonly tools?: string[];
  /** Chỉ dẫn quy trình kịch bản thực thi chi tiết */
  readonly instructions: string;
  /** Nguồn skill: built-in, user-created, hoặc url */
  readonly provenance?: string;
  readonly version?: string;
}

declare module './types.js' {
  interface Context {
    skills: SkillRegistry;
  }
}

export interface SkillRegistry {
  register(skill: ExecutableSkill): Disposer;
  get(name: string): ExecutableSkill | undefined;
  list(): ExecutableSkill[];
  has(name: string): boolean;
  /** Trả về danh sách tool mà skill này yêu cầu */
  getRequiredTools(skillName: string): string[];
}

export const skillsPlugin: Plugin = {
  name: 'skills',
  dependencies: ['invariants', 'tools'],
  setup(ctx: Context) {
    const skills = new Map<string, ExecutableSkill>();

    ctx.provide('skills', {
      register(skill) {
        if (!skill.name?.trim()) {
          throw new Error('skill phải có tên');
        }
        if (skills.has(skill.name)) {
          throw new Error(`skill "${skill.name}" đã được đăng ký rồi`);
        }
        skills.set(skill.name, skill);
        return ctx.effect(() => {
          if (skills.get(skill.name) === skill) {
            skills.delete(skill.name);
          }
        });
      },

      get(name) {
        return skills.get(name);
      },

      list() {
        return Array.from(skills.values());
      },

      has(name) {
        return skills.has(name);
      },

      getRequiredTools(skillName) {
        const skill = skills.get(skillName);
        return skill?.tools ?? [];
      },
    });

    // Invariant: Mọi tool mà skill yêu cầu bắt buộc phải có trong sổ tools
    ctx.invariants.register('skills', (context, fail) => {
      const registeredTools = new Set(context.tools.list().map((t) => t.name));
      for (const skill of skills.values()) {
        if (!skill.tools || skill.tools.length === 0) continue;
        const missing = skill.tools.filter((t) => !registeredTools.has(t));
        if (missing.length > 0) {
          fail(`skill "${skill.name}" yêu cầu ${missing.length} tool không tồn tại: ${missing.join(', ')}`);
        }
      }
    });
  },
};
