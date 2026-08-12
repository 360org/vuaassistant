/**
 * Nhập Agent từ Markdown "The Agency" (msitarzewski/agency-agents) và các
 * persona markdown tương tự.
 *
 * Mỗi file là một persona chuyên gia: frontmatter (name/description/emoji/vibe)
 * + các mục ## (Mission, Rules, Workflow, Communication…). Ta ánh xạ thẳng sang
 * một Agent (vai trò) của VuaAssistant:
 *   - name/description/emoji  → danh tính vai trò
 *   - vibe + Communication + Identity → Soul (tính cách)
 *   - Mission + Rules + Workflow + Deliverables + Advanced → Instructions
 * Nhờ đó vai trò nhập vào dùng chung cơ chế cô lập memory/knowledge sẵn có.
 */

export interface ImportedAgent {
  id: string;
  name: string;
  description: string;
  emoji: string;
  soul: string;
  instructions: string;
  /** Nguồn (URL) để tránh nhập trùng và cho phép cập nhật. */
  source?: string;
}

/** Tạo slug id từ tên vai trò. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `agent-${Date.now().toString(36)}`
  );
}

/** Bỏ emoji và các từ đưa đẩy ("your") khỏi tiêu đề để so khớp theo từ khóa. */
function normalizeHeading(h: string): string {
  return h
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\byour\b/gi, "")
    .replace(/[^a-z0-9 ]/gi, " ")
    .trim()
    .toLowerCase();
}

interface Section {
  key: string;
  body: string;
}

/** Tách phần thân thành các mục theo tiêu đề `##`. */
function splitSections(body: string): Section[] {
  const lines = body.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { key: normalizeHeading(m[1]), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ key: s.key, body: s.body.trim() }));
}

/** Đọc một trường frontmatter đơn giản `key: value`. */
function frontField(front: string, key: string): string {
  const m = front.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

const SOUL_KEYS = ["communication", "identity", "personality", "vibe"];

/**
 * Phân tích một persona markdown thành ImportedAgent. Trả về null nếu không có
 * frontmatter hợp lệ hoặc thiếu tên.
 */
export function parseAgencyAgent(md: string, source?: string): ImportedAgent | null {
  const fm = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return null;
  const front = fm[1];
  const body = md.slice(fm[0].length);

  const name = frontField(front, "name");
  if (!name) return null;
  const description = frontField(front, "description");
  const emoji = frontField(front, "emoji") || "🤖";
  const vibe = frontField(front, "vibe");

  const sections = splitSections(body);
  const soulParts: string[] = [];
  const instructionParts: string[] = [];
  if (vibe) soulParts.push(vibe);
  for (const s of sections) {
    if (!s.body) continue;
    const isSoul = SOUL_KEYS.some((k) => s.key.includes(k));
    (isSoul ? soulParts : instructionParts).push(s.body);
  }

  return {
    id: slugify(name),
    name,
    description,
    emoji,
    soul: soulParts.join("\n\n").trim(),
    // Nếu không tách được mục nào, dùng toàn bộ thân làm hướng dẫn.
    instructions: (instructionParts.join("\n\n").trim() || body.trim()),
    source,
  };
}

/** Tải một persona từ URL và phân tích. */
export async function importAgentFromUrl(url: string): Promise<ImportedAgent> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được (HTTP ${res.status}).`);
  const md = await res.text();
  const agent = parseAgencyAgent(md, url);
  if (!agent) throw new Error("File không có frontmatter agent hợp lệ (thiếu name).");
  return agent;
}
