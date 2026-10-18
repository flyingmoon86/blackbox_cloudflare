import { Marked, Renderer } from "marked";
import { escapeHtml } from "./html";

export const ANNOUNCEMENT_MAX_LENGTH = 20000;

// Explicit allowlist: HTML entities, backslashes and controls cannot hide a
// protocol. Root-relative links always point to the public site in the preview.
export function announcementLink(href: string): string | null {
  if (!href || /[\s\\<>\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^\/(?!\/)/.test(href) || /^#[^#]/.test(href)) return href;
  if (!/^(https?:\/\/|mailto:)/i.test(href)) return null;
  try {
    const url = new URL(href);
    if (url.username || url.password) return null;
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

// Never accept raw HTML or image embeds. Only Marked's fixed markup plus the
// escaped, allowlisted links below can reach innerHTML. No plug-ins are loaded.
const markdown = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safe = announcementLink(href);
      return safe ? `<a href="${escapeHtml(safe)}">${label}</a>` : label;
    },
    image({ text }) {
      return escapeHtml(text);
    },
    heading({ depth, tokens }) {
      const level = Math.max(2, depth);
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
    },
    table(token) {
      return `<div class="announcement-table">${Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
});

export function renderAnnouncement(content: string, publicOrigin = ""): string {
  try {
    return markdown.parse(content, { async: false }).replaceAll('<a href="/', `<a href="${escapeHtml(publicOrigin)}/`);
  } catch {
    // Legacy content and unexpected parser failures remain readable.
    return `<p>${escapeHtml(content).replace(/\r?\n/g, "<br>")}</p>`;
  }
}

export function announcementExcerpt(content: string): string {
  return renderAnnouncement(content)
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      if (entity[0] !== "#") return named[entity.toLowerCase()] || whole;
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
