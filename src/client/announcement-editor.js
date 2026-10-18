import { announcementLink, renderAnnouncement, ANNOUNCEMENT_MAX_LENGTH } from "../shared/announcement-markdown";

const editor = document.querySelector("[data-announcement-editor]");
if (editor) {
  const content = editor.querySelector('[name="content"]');
  const title = editor.querySelector('[name="title"]');
  const preview = editor.querySelector("#announcement-preview");
  const toggle = editor.querySelector("[data-preview-toggle]");
  const status = editor.querySelector("[data-editor-status]");
  const linkPanel = editor.querySelector("#announcement-link");
  const linkOpen = editor.querySelector("[data-link-open]");
  const linkLabel = editor.querySelector("[data-link-label]");
  const linkUrl = editor.querySelector("[data-link-url]");
  let selection = [0, 0];
  const rememberSelection = () => (selection = [content.selectionStart, content.selectionEnd]);
  const markdownText = (text) => text.replace(/[\\`*_[\]<>#]/g, "\\$&");
  const updatePreview = () => {
    if (preview.hidden) return;
    editor.querySelector("[data-preview-title]").textContent = title.value || "未填写标题";
    const body = editor.querySelector("[data-preview-body]");
    body.innerHTML = renderAnnouncement(content.value, editor.dataset.publicOrigin);
    for (const link of body.querySelectorAll("a")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  };
  const insert = (text) => {
    if (content.value.length - (selection[1] - selection[0]) + text.length > ANNOUNCEMENT_MAX_LENGTH) {
      status.textContent = "插入后会超过 20,000 字符，请先精简正文。";
      return false;
    }
    content.setRangeText(text, ...selection, "end");
    content.focus();
    rememberSelection();
    updatePreview();
    return true;
  };
  const closeLink = () => {
    linkPanel.hidden = true;
    linkOpen.setAttribute("aria-expanded", "false");
    linkOpen.focus();
  };
  content.addEventListener("input", updatePreview);
  title.addEventListener("input", updatePreview);
  toggle.addEventListener("click", () => {
    preview.hidden = !preview.hidden;
    toggle.setAttribute("aria-expanded", String(!preview.hidden));
    toggle.textContent = preview.hidden ? "预览公告" : "收起预览";
    updatePreview();
    status.textContent = preview.hidden ? "已收起预览。" : "预览已显示在编辑区下方，继续编辑会同步更新。";
  });
  for (const button of editor.querySelectorAll("[data-format]")) {
    button.addEventListener("click", () => {
      rememberSelection();
      const selected = content.value.slice(...selection);
      const formats = {
        bold: `**${selected || "强调文字"}**`,
        heading: `\n\n## ${selected || "小标题"}\n\n`,
        list: `\n\n${(selected || "列表项目")
          .split("\n")
          .map((line) => `- ${line}`)
          .join("\n")}\n\n`,
      };
      if (insert(formats[button.dataset.format])) status.textContent = "已插入格式，可修改文字后预览。";
    });
  }
  linkOpen.addEventListener("click", () => {
    if (!linkPanel.hidden) return closeLink();
    rememberSelection();
    linkLabel.value = content.value.slice(...selection);
    linkUrl.value = "";
    linkPanel.hidden = false;
    linkOpen.setAttribute("aria-expanded", "true");
    (linkLabel.value ? linkUrl : linkLabel).focus();
  });
  editor.querySelector("[data-link-cancel]").addEventListener("click", closeLink);
  const insertLink = () => {
    const href = announcementLink(linkUrl.value.trim());
    const label = linkLabel.value.trim();
    if (!href || !label) {
      status.textContent = "请填写链接文字，以及 / 开头的本站路径、http/https 网址或 mailto 邮箱。";
      (!label ? linkLabel : linkUrl).focus();
      return;
    }
    if (!insert(`[${markdownText(label)}](<${href}>)`)) return;
    linkPanel.hidden = true;
    linkOpen.setAttribute("aria-expanded", "false");
    status.textContent = "链接已插入。点击预览可查看和试开链接。";
  };
  editor.querySelector("[data-link-insert]").addEventListener("click", insertLink);
  linkPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      if (event.key === "Escape") closeLink();
      else insertLink();
    }
  });

  // Detached template contents are inert: never append clipboard HTML to the
  // page. Convert a small set of semantic elements to Markdown, ignoring all
  // attributes except validated anchor hrefs. Plain-text paste stays native.
  content.addEventListener("paste", (event) => {
    const html = event.clipboardData?.getData("text/html");
    if (!html || html.length > 200000) return;
    const template = document.createElement("template");
    template.innerHTML = html;
    if (!template.content.querySelector("a[href]")) return;
    const convert = (node, depth = 0) => {
      if (node.nodeType === Node.TEXT_NODE) return markdownText(node.textContent || "");
      if (node.nodeType !== Node.ELEMENT_NODE || depth > 30) return "";
      const tag = node.tagName.toLowerCase();
      if (["script", "style", "iframe", "object", "svg", "math", "template", "input", "button"].includes(tag))
        return "";
      if (tag === "img") return markdownText(node.getAttribute("alt") || "");
      const children = () => [...node.childNodes].map((child) => convert(child, depth + 1)).join("");
      if (tag === "a") {
        const href = announcementLink(node.getAttribute("href") || "");
        return href ? `[${children().trim() || markdownText(href)}](<${href}>)` : children();
      }
      if (tag === "br") return "\n";
      if (["strong", "b"].includes(tag)) return `**${children().trim()}**`;
      if (["em", "i"].includes(tag)) return `*${children().trim()}*`;
      if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
      if (tag === "ul" || tag === "ol") {
        const items = [...node.children].filter((child) => child.tagName === "LI");
        return (
          "\n\n" +
          items
            .map((item, index) => {
              const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
              const text = convert(item, depth + 1)
                .trim()
                .replace(/\n/g, "\n" + " ".repeat(prefix.length));
              return prefix + text;
            })
            .join("\n") +
          "\n\n"
        );
      }
      if (["p", "div", "section", "article"].includes(tag)) return `\n\n${children()}\n\n`;
      return children();
    };
    const converted = [...template.content.childNodes]
      .map((node) => convert(node))
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!converted) return;
    event.preventDefault();
    rememberSelection();
    if (insert(converted)) status.textContent = "已将粘贴内容转换为 Markdown 并保留可用链接，请预览确认。";
  });
  editor.querySelector("[data-editor-tools]").hidden = false;
  toggle.hidden = false;
}
