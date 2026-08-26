/**
 * Sổ đăng ký phần system prompt.
 *
 * Vì sao cần: `buildSystemPrompt` cũ liệt kê tool bằng văn xuôi viết tay. Đếm
 * thật thì nó nói với model là có **9 tool** trong khi runner đăng ký **13** —
 * `vault_list`, `search_memory`, `computer_use`, `delegate_task` model không hề
 * biết là có, nên chúng nằm đó không bao giờ được dùng. Đây là kiểu lệch không
 * ai phát hiện được vì cả hai phía đều "đúng" khi nhìn riêng.
 *
 * Cách chữa: phần liệt kê tool **dựng từ sổ đăng ký**, nên thêm tool là prompt
 * tự biết. Không còn hai nguồn sự thật để lệch nhau.
 */
import type { Context, Disposer, Plugin } from './types.js';

export interface PromptSection {
  /** Định danh để plugin khác thay thế hoặc gỡ đúng phần của mình. */
  readonly id: string;
  /** Nhỏ hơn thì đứng trước. Phần cùng số thì xếp theo thứ tự đăng ký. */
  readonly order: number;
  /** Trả chuỗi rỗng nghĩa là lượt này không có gì để nói. */
  render(): string;
}

declare module './types.js' {
  interface Context {
    /** Sổ đăng ký phần prompt. Do plugin `prompt` gắn lên. */
    prompt: PromptRegistry;
  }
}

export interface PromptRegistry {
  register(section: PromptSection): Disposer;
  /** Ghép mọi phần theo thứ tự, bỏ phần rỗng. */
  build(): string;
  /** Tên các phần đang có, theo thứ tự ghép. Dùng để soi và để kiểm chứng. */
  sectionIds(): string[];
}

export const promptPlugin: Plugin = {
  name: 'prompt',
  setup(ctx: Context) {
    const sections: Array<{ section: PromptSection; seq: number }> = [];
    let seq = 0;

    const ordered = () =>
      [...sections]
        .sort((a, b) => a.section.order - b.section.order || a.seq - b.seq)
        .map((entry) => entry.section);

    ctx.provide('prompt', {
      register(section) {
        if (sections.some((entry) => entry.section.id === section.id)) {
          throw new Error(`phần prompt "${section.id}" đã được đăng ký rồi`);
        }
        const entry = { section, seq: seq++ };
        sections.push(entry);
        return ctx.effect(() => {
          const at = sections.indexOf(entry);
          if (at >= 0) sections.splice(at, 1);
        });
      },

      build() {
        return ordered()
          .map((section) => section.render().trim())
          .filter(Boolean)
          .join('\n\n');
      },

      sectionIds() {
        return ordered().map((section) => section.id);
      },
    });
  },
};

/**
 * Phần liệt kê tool, dựng từ sổ đăng ký.
 *
 * Đây là phần vá đúng lỗi lệch: danh sách đi thẳng từ `ctx.tools`, nên không
 * thể sót tool nào, và tool gỡ ra thì prompt cũng thôi nhắc tới.
 */
export const toolListSectionPlugin: Plugin = {
  name: 'prompt-tool-list',
  dependencies: ['prompt', 'tools'],
  setup(ctx: Context) {
    ctx.prompt.register({
      id: 'tool-list',
      order: 20,
      render() {
        const lines = ctx.tools.list().map((tool) => {
          // Nhắc rõ tool nào sẽ hỏi người dùng, để model biết đường xin duyệt
          // trước thay vì gọi rồi nhận về lỗi APPROVAL_REQUIRED.
          const mark = tool.requiresApproval ? ' [phải xin duyệt trước]' : '';
          return `- ${tool.name}: ${tool.description}${mark}`;
        });
        if (!lines.length) return '';
        return [
          'Bạn có các công cụ sau:',
          ...lines,
          '',
          'Bảo mật Vault: không bao giờ in vault-entry:* refs, {{credential:*}} placeholders, token, password hoặc ID nội bộ Vault ra câu trả lời cho người dùng. Chỉ mô tả bằng tên tài khoản thân thiện.',
          'Khi người dùng đã duyệt một capability nhạy cảm và prompt có CALL_APPROVED_CAPABILITY:<tool>, hãy gọi đúng tool đó (trực tiếp hoặc qua execute_capability) với approved=true; không xin duyệt lại cùng hành động.',
        ].join('\n');
      },
    });
  },
};
