/**
 * Loads the app's skills from `skills/<name>/SKILL.md` at build time.
 *
 * Each skill is a standard Agent Skills directory
 * (https://agentskills.io/specification): YAML frontmatter with `name` and
 * `description`, plus app-specific display fields under `metadata` using
 * `vua-`-prefixed keys. The markdown body holds the instructions an engine
 * uses when the skill runs.
 */

export interface AgentSkill {
  /** Spec `name` — also the directory name and the app-level id. */
  name: string;
  /** Spec `description` — what the skill does and when to use it. */
  description: string;
  metadata: Record<string, string>;
  /** Tools/plugins explicitly required by this skill (e.g. ['file_read', 'http_request', 'schedule_task']) */
  tools?: string[];
  /** Markdown body: the instructions loaded when the skill activates. */
  instructions: string;
}

export interface SkillTemplate {
  id: string;
  name: string;
  emoji: string;
  category: string;
  description: string;
  /** Pre-filled into the chat composer when the user clicks Use. */
  prompt: string;
  /** Tools required by the skill */
  tools?: string[];
  /** Full instruction body, for the engine once real providers are wired. */
  instructions: string;
  /** Nguồn skill: built-in, URL, hoặc skill tự tạo local. */
  provenance: string;
  /** Version tuỳ chọn từ metadata, dùng cho kiểm tra cập nhật sau này. */
  version?: string;
}

/**
 * Minimal frontmatter parser covering the subset of YAML the spec examples
 * use: top-level `key: value` pairs and one level of nested mapping
 * (`metadata:`). Double-quoted values may contain JSON-style escapes.
 */
export function parseSkillMd(raw: string): AgentSkill {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error("SKILL.md is missing YAML frontmatter");
  const body = raw.slice(match[0].length).trim();

  const top: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  let inMetadata = false;
  let inTools = false;
  const tools: string[] = [];

  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indented = /^\s/.test(line);
    const entry = line.trim().match(/^([\w-]+):\s*(.*)$/);
    if (!entry) {
      // Check list item (e.g. tools item under tools:)
      const listItem = line.trim().match(/^-\s+(.+)$/);
      if (listItem && inTools) {
        tools.push(unquote(listItem[1].trim()));
      }
      continue;
    }
    const [, key, rawValue] = entry;
    if (!indented) {
      inMetadata = key === "metadata" && rawValue === "";
      inTools = key === "tools" && rawValue === "";
      if (key === "tools" && rawValue) {
        // inline list e.g. tools: [a, b]
        const clean = rawValue.replace(/^\[|\]$/g, "").split(",").map((s) => unquote(s.trim())).filter(Boolean);
        tools.push(...clean);
      } else if (!inMetadata && !inTools) {
        top[key] = unquote(rawValue);
      }
    } else if (inMetadata) {
      metadata[key] = unquote(rawValue);
    }
  }

  if (!top.name) throw new Error("SKILL.md frontmatter is missing `name`");
  if (!top.description) {
    throw new Error(`skill ${top.name}: frontmatter is missing \`description\``);
  }
  return { name: top.name, description: top.description, metadata, tools: tools.length ? tools : undefined, instructions: body };
}

/**
 * Flexible Skill parser that handles standard AgentSkill YAML frontmatter
 * as well as plain markdown fallback files (like GitHub README.md or custom skills).
 */
export function smartParseSkill(raw: string, fallbackName = "custom-skill"): AgentSkill {
  try {
    return parseSkillMd(raw);
  } catch {
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const rawName = titleMatch
      ? titleMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      : fallbackName;
    const name = rawName || fallbackName;

    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("<!"));
    const description = lines[0] || `Custom skill: ${name}`;

    return {
      name,
      description,
      metadata: {
        "vua-title": titleMatch ? titleMatch[1].trim() : name,
        "vua-emoji": "⚡",
        "vua-category": "Custom",
      },
      instructions: raw,
    };
  }
}

/**
 * Normalizes GitHub folder/file web URLs into candidate raw content download URLs.
 */
export function normalizeGithubSkillUrls(inputUrl: string): string[] {
  const target = inputUrl.trim();

  if (target.includes("raw.githubusercontent.com")) {
    return [target];
  }

  const ghMatch = target.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(tree|blob)\/([^/]+)\/(.+)$/);
  if (ghMatch) {
    const [, owner, repo, , branch, filePath] = ghMatch;
    const cleanPath = filePath.replace(/\/$/, "");

    if (cleanPath.endsWith(".md")) {
      return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}`];
    }

    return [
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}/SKILL.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}/skill.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}/README.md`,
    ];
  }

  const rootMatch = target.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (rootMatch) {
    const [, owner, repo] = rootMatch;
    return [
      `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/skill.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`,
    ];
  }

  return [target];
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

const files: Record<string, string> =
  typeof import.meta !== "undefined" && typeof (import.meta as unknown as { glob?: unknown }).glob === "function"
    ? import.meta.glob<string>("../../skills/*/SKILL.md", {
        query: "?raw",
        import: "default",
        eager: true,
      })
    : {};

/** Maps a parsed Agent Skill onto the app's card/template shape. */
export function toTemplate(skill: AgentSkill, provenance = "built-in"): SkillTemplate {
  return {
    id: skill.name,
    name: skill.metadata["vua-title"] ?? skill.name,
    emoji: skill.metadata["vua-emoji"] ?? "🧩",
    category: skill.metadata["vua-category"] ?? "General",
    description: skill.metadata["vua-tagline"] ?? skill.description,
    prompt: skill.metadata["vua-prompt"] ?? "",
    tools: skill.tools,
    instructions: skill.instructions,
    provenance,
    version: skill.metadata["vua-version"] ?? skill.metadata.version,
  };
}

export const SKILLS: SkillTemplate[] = Object.entries(files)
  .map(([path, raw]) => {
    const skill = parseSkillMd(raw);
    const parts = path.split("/");
    const dir = parts[parts.length - 2];
    if (dir !== skill.name) {
      throw new Error(`skill directory "${dir}" must match name "${skill.name}"`);
    }
    return {
      order: Number(skill.metadata["vua-order"] ?? 999),
      template: toTemplate(skill),
    };
  })
  .sort((a, b) => a.order - b.order)
  .map((s) => s.template);
