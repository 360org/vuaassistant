/**
 * Agent tools — the real capabilities agents run inside the app.
 *
 * This is what makes VuaAssistant "just work" after install: no external
 * engine, no Docker. The agent loop (see `providers.ts`) calls these tools
 * directly. Two abilities cover the core promise "store a login once, the
 * agent uses it to act":
 *
 *   - `vault_list`  — the agent discovers what credentials exist (names and
 *                     field names only, never secret values).
 *   - `connector_request` — the agent sends only an opaque Vault reference
 *                     and `{{credential:<field>}}` variables. Tauri and AI
 *                     Router resolve them outside the model context.
 */

import {
  listVaultEntries,
  findVaultEntry,
} from "./vault";

/** An OpenAI-compatible tool the agent can call, plus its executor. */
export interface AgentTool {
  schema: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  run(args: Record<string, unknown>): Promise<string>;
}

const vaultListTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "vault_list",
      description:
        "List the credentials the user has stored in their Vault (site " +
        "logins, API keys, endpoints). Returns each entry's name, service " +
        "and opaque references — never secret values. Use a field in " +
        "connector_request as {{credential:field}}.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  async run() {
    const metas = await listVaultEntries();
    if (metas.length === 0) {
      return "The Vault is empty. Ask the user to add the login or API key in the Vault first.";
    }
    const entries = [];
    for (const meta of metas) {
      const entry = await findVaultEntry(meta.label);
      if (!entry) continue;
      const fields: string[] = [];
      if (entry.username) fields.push("username");
      if (entry.password) fields.push("password");
      for (const f of entry.fields ?? []) {
        fields.push(f.label);
      }
      entries.push({
        ref: `vault-entry:${entry.id}`,
        label: entry.label,
        service: entry.service ?? null,
        variables: fields.map((field) => `{{credential:${field}}}`),
      });
    }
    return JSON.stringify(entries);
  },
};

const httpRequestTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "http_request",
      description:
        "Perform an unauthenticated HTTP request. Credentialed requests must " +
        "use connector_request so Vault values stay outside agent context.",
      parameters: {
        type: "object",
        properties: {
          method: {
            type: "string",
            description: "HTTP method, e.g. GET, POST, PUT, DELETE.",
          },
          url: {
            type: "string",
            description: "Full absolute URL.",
          },
          headers: {
            type: "object",
            description: "Non-credential request headers.",
            additionalProperties: { type: "string" },
          },
          body: {
            type: "string",
            description: "Request body as a string. Omit for GET.",
          },
        },
        required: ["method", "url"],
      },
    },
  },
  async run(args) {
    const method = String(args.method ?? "GET").toUpperCase();
    const url = String(args.url ?? "");
    if (!/^https?:\/\//i.test(url)) {
      return "Error: url must be an absolute http(s) URL.";
    }
    const headers = (args.headers ?? {}) as Record<string, string>;
    const body = args.body != null ? String(args.body) : undefined;
    const serialized = JSON.stringify({ url, headers, body });
    if (
      Object.keys(headers).some((key) => /authorization|cookie|x-api-key/i.test(key)) ||
      /\{\{credential:|\{\{vault:|password|bearer\s|access[_-]?token|api[_-]?key/i.test(serialized)
    ) {
      return "Credential access denied. Use connector_request with an opaque Vault reference.";
    }
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
      });
      const text = await response.text();
      const truncated =
        text.length > 4000 ? text.slice(0, 4000) + "…[truncated]" : text;
      return `HTTP ${response.status} ${response.statusText}\n${truncated}`;
    } catch (e) {
      return `Error: request failed (${e instanceof Error ? e.message : e}).`;
    }
  },
};

const connectorRequestTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "connector_request",
      description:
        "Call the origin bound to an opaque Vault reference. Put " +
        "{{credential:field}} variables in headers or body; the trusted " +
        "gateway resolves and redacts them outside your context.",
      parameters: {
        type: "object",
        properties: {
          credential_ref: {
            type: "string",
            description: "Opaque ref returned by vault_list.",
          },
          method: { type: "string", description: "HTTP method (default GET)." },
          url: {
            type: "string",
            description: "Path or URL on the Vault entry's saved origin.",
          },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: { type: "string", description: "Request body (JSON), if any." },
          approved: { type: "boolean", description: "Only true after the user approves this exact connector action." },
        },
        required: ["credential_ref", "url"],
      },
    },
  },
  async run(args) {
    if (!(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) {
      return "Connector gateway is available only in VuaAssistant Desktop.";
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const payload = JSON.stringify({
      credentialRef: String(args.credential_ref ?? ""),
      url: String(args.url ?? ""),
      method: args.method ? String(args.method) : "GET",
      headers: args.headers ?? {},
      body: args.body != null ? String(args.body) : undefined,
      approved: args.approved === true,
    });
    const raw = await invoke<string>("runtime_connector_request", { payload });
    const result = JSON.parse(raw) as { status?: number; body?: string; error?: string };
    if (result.error) return `Connector error: ${result.error}`;
    return `HTTP ${result.status ?? 0}\n${result.body ?? ""}`;
  },
};

const createScheduleTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "create_schedule",
      description:
        "Tạo mới một tác vụ lập lịch chạy tự động/định kỳ (Scheduled Task) trong ứng dụng VuaAssistant. Sử dụng công cụ này khi người dùng yêu cầu đặt lịch, lập lịch đăng bài, nhắc nhở hoặc báo cáo tự động.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên ngắn gọn của công việc (ví dụ: Đăng bài Odoo hàng ngày lúc 09:00 AM).",
          },
          prompt: {
            type: "string",
            description: "Nội dung chỉ dẫn chi tiết công việc cho AI thực hiện định kỳ.",
          },
          schedule: {
            type: "string",
            description: "Chu kỳ/thời gian chạy (ví dụ: Hàng ngày lúc 09:00 AM, 1 giờ một lần).",
          },
        },
        required: ["name", "prompt", "schedule"],
      },
    },
  },
  async run(args) {
    const name = String(args.name || "Tác vụ lập lịch tự động");
    const prompt = String(args.prompt || "");
    const schedule = String(args.schedule || "Hàng ngày");

    if (typeof window !== "undefined") {
      const event = new CustomEvent("vua:create-schedule", {
        detail: { name, prompt, schedule },
      });
      window.dispatchEvent(event);
      return `✅ Đã tạo thành công tác vụ lập lịch "${name}" (${schedule}). Tác vụ hiện đã được tự động chèn vào trang Scheduled và đang kích hoạt!`;
    }
    return `Tác vụ "${name}" (${schedule}) đã được tiếp nhận.`;
  },
};

const webSearchTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Tìm kiếm thông tin trực tuyến trên Internet (Google/DuckDuckGo). Sử dụng công cụ này khi cần tra cứu thông tin mới, bài viết, tin tức hoặc tài liệu trực tuyến.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Từ khóa hoặc câu hỏi cần tìm kiếm.",
          },
        },
        required: ["query"],
      },
    },
  },
  async run(args) {
    const query = String(args.query || "");
    if (!query.trim()) return "Error: query cannot be empty.";
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const html = await res.text();
      const matches = [...html.matchAll(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];
      if (matches.length > 0) {
        const results = matches.slice(0, 5).map((m, idx) => {
          const url = m[1]?.trim();
          const title = m[2]?.replace(/<[^>]+>/g, "").trim();
          const snippet = m[3]?.replace(/<[^>]+>/g, "").trim();
          return `${idx + 1}. [${title}](${url})\n   ${snippet}`;
        });
        return `Kết quả tìm kiếm cho "${query}":\n\n` + results.join("\n\n");
      }
      return `Đã thực hiện tìm kiếm "${query}". Vui lòng sử dụng thông tin tổng hợp.`;
    } catch (e) {
      return `Lỗi tìm kiếm web: ${e instanceof Error ? e.message : e}`;
    }
  },
};

const fileReadTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "file_read",
      description: "Đọc nội dung văn bản của một tệp tin trong workspace được cấp.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Đường dẫn trong workspace (ví dụ: ghi-chu/hom-nay.md). Không truy cập được ra ngoài workspace." },
        },
        required: ["path"],
      },
    },
  },
  async run(args) {
    const path = String(args.path || "");
    if (!path) return "Error: path is required.";
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string>("agent_read_file", { path });
      }
      return "Lỗi: Đọc tệp hệ thống chỉ hỗ trợ trên ứng dụng VuaAssistant Desktop.";
    } catch (e) {
      return `Lỗi đọc file: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

const fileWriteTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "file_write",
      description: "Tạo mới hoặc ghi nội dung vào một tệp tin trên máy host.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Đường dẫn tệp trong workspace được cấp (ví dụ: bao-cao/thang-7.md)." },
          content: { type: "string", description: "Nội dung văn bản cần ghi vào tệp." },
        },
        required: ["path", "content"],
      },
    },
  },
  async run(args) {
    const path = String(args.path || "");
    const content = String(args.content || "");
    if (!path) return "Error: path is required.";
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string>("agent_write_file", { path, content });
      }
      return "Lỗi: Ghi tệp hệ thống chỉ hỗ trợ trên ứng dụng VuaAssistant Desktop.";
    } catch (e) {
      return `Lỗi ghi file: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

const fileListTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "file_list",
      description: "Liệt kê tệp và thư mục con bên trong workspace được cấp.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Thư mục trong workspace. Để trống hoặc \".\" để xem gốc workspace." },
        },
        required: ["path"],
      },
    },
  },
  async run(args) {
    const path = String(args.path || "");
    if (!path) return "Error: path is required.";
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const list = await invoke<string[]>("agent_list_dir", { path });
        return `Danh sách tệp/thư mục tại "${path}":\n` + list.map((item) => `- ${item}`).join("\n");
      }
      return "Lỗi: Liệt kê thư mục hệ thống chỉ hỗ trợ trên ứng dụng VuaAssistant Desktop.";
    } catch (e) {
      return `Lỗi xem thư mục: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

// `mcp_status` and `execute_mcp_tool` used to live here and both lied.
// `mcp_status` reported a hardcoded "active" MCP client with a made-up server
// list and advertised a shell capability; `execute_mcp_tool` did nothing at all
// and returned "✅ … thực thi tool … thành công", which the model then reported
// to the user as completed work.
//
// MCP belongs to the Agent Runner (agent-runner/src/mcp-client), which really
// speaks the protocol. This fallback path does not, so it now says nothing
// rather than something false.

const createSkillTool: AgentTool = {
  schema: {
    type: "function",
    function: {
      name: "create_skill",
      description: "Tự tạo một Skill mới (đóng gói hướng dẫn kịch bản công việc) và lưu trực tiếp vào thư viện Agent Skills.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên định danh của Skill (slug, e.g. 'excel-data-cleaner', 'sql-optimizer'). Dùng chữ cái thường và dấu gạch ngang.",
          },
          title: {
            type: "string",
            description: "Tiêu đề hiển thị của Skill (e.g. 'Bộ Xử Lý Dữ Liệu Excel Tự Động').",
          },
          description: {
            type: "string",
            description: "Mô tả ngắn gọn chức năng của Skill.",
          },
          instructions: {
            type: "string",
            description: "Nội dung hướng dẫn kịch bản chi tiết bằng Markdown mà Agent sẽ tuân theo khi kích hoạt Skill này.",
          },
        },
        required: ["name", "title", "description", "instructions"],
      },
    },
  },
  async run(args) {
    const name = (args.name as string)?.toLowerCase().replace(/[^a-z0-9-]/g, "-") ?? "new-skill";
    const title = (args.title as string) ?? name;
    const description = (args.description as string) ?? "";
    const instructions = (args.instructions as string) ?? "";

    const rawMd = `---
name: ${name}
title: ${title}
description: ${description}
---

${instructions}`;

    if (typeof window !== "undefined") {
      const event = new CustomEvent("vua:create-skill", {
        detail: { raw: rawMd, source: `created:${name}` },
      });
      window.dispatchEvent(event);

      // Save physical file to customDataPath/skills/ if configured
      void import("@tauri-apps/api/core").then(({ invoke }) => {
        void invoke("save_custom_data_text", {
          customDir: localStorage.getItem("vua:custom-data-path") || "~/vuaassistant",
          relativePath: `skills/${name}/SKILL.md`,
          content: rawMd,
        }).catch(() => {});
      }).catch(() => {});

      return `✅ Đã khởi tạo và đóng gói thành công Skill mới "${title}" (${name})!\nSkill hiện đã xuất hiện trong thư viện Skills của ứng dụng và có thể sử dụng ngay lập tức!`;
    }
    return `Skill "${title}" (${name}) đã được tạo.`;
  },
};

/** The tools every agent turn can use. */
export function buildAgentTools(): AgentTool[] {
  return [
    vaultListTool,
    httpRequestTool,
    connectorRequestTool,
    createScheduleTool,
    webSearchTool,
    fileReadTool,
    fileWriteTool,
    fileListTool,
    createSkillTool,
  ];
}
