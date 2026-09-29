import { escapeHtml as e } from "../views";

export const systemSections = {
  architecture: "系统架构",
  flows: "业务流程",
  database: "数据库结构",
  storage: "文件存储",
} as const;
export type SystemSection = keyof typeof systemSections;

const chapters: Record<SystemSection, { caption: string; introduction: string; mark: string }> = {
  architecture: {
    caption: "看清幕后连接",
    introduction: "从一次访问开始，看清页面、接口与存储如何协作。",
    mark: "01",
  },
  flows: {
    caption: "沿着业务前行",
    introduction: "一份资料、一次认证，沿着各自的路径进入档案。",
    mark: "02",
  },
  database: {
    caption: "追溯档案关系",
    introduction: "作品与队员，资料与记录。每一处关联都有来处。",
    mark: "03",
  },
  storage: {
    caption: "了解文件去向",
    introduction: "让舞台上的片刻留存。查看文件存放与访问的方式。",
    mark: "04",
  },
};

// Original stage-plan motif. Decorative geometry never represents live system data.
function stageMark(section: SystemSection) {
  const drawings = {
    architecture:
      '<path d="M34 91 115 43 231 109 150 158Z M34 91v42l116 65 81-47v-42 M150 158v40 M115 43v40l116 68 M75 112v-37l40-24 40 23v39l-40 23Z"/><path d="m176 140 37-21v-35l-37 20Z"/>',
    flows:
      '<path d="M35 161 86 132 139 163 224 113 M86 132V83l55-31 44 25v50 M139 163v-43l46-27"/><circle cx="35" cy="161" r="8"/><circle cx="141" cy="52" r="8"/><circle cx="224" cy="113" r="8"/>',
    database:
      '<path d="M40 70h70v48H40Z M160 35h64v43h-64Z M160 135h64v43h-64Z M110 94h25V57h25 M135 94v62h25"/><path d="M51 83h43 M51 96h28 M171 49h37 M171 148h37 M171 162h24"/>',
    storage:
      '<ellipse cx="137" cy="60" rx="69" ry="24"/><path d="M68 60v104c0 32 138 32 138 0V60 M68 94c0 32 138 32 138 0 M68 129c0 32 138 32 138 0"/><path d="m43 187 95 29 92-30"/>',
  };
  return `<svg class="chapter-art" viewBox="0 0 270 235" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.3">${drawings[section]}</g><g fill="currentColor"><circle cx="35" cy="29" r="2"/><circle cx="232" cy="200" r="2"/></g><path d="M19 25v190h232 M19 214l7-7m-7 7 7 7" fill="none" stroke="currentColor" opacity=".24"/></svg>`;
}

export function systemChapterStart(section: SystemSection) {
  const current = chapters[section];
  return `<section class="system-dossier" data-system-theme="${section}">
    <header class="dossier-heading">
      <div class="dossier-introduction"><a class="dossier-return" href="/admin">← 管理员工作台</a>
      <p class="dossier-kicker"><span>黑匣子 · 幕后档案</span><span>只读系统信息</span></p>
      <h1>${systemSections[section]}</h1><p class="dossier-deck">${current.introduction}</p></div>
      <div class="dossier-emblem" aria-hidden="true">${stageMark(section)}<span>${current.mark}<small> / 04</small></span></div>
    </header>
    <div class="dossier-layout"><nav class="system-directory" aria-label="系统信息主题"><p class="chapter-index-label">主题索引</p>${Object.entries(
      systemSections,
    )
      .map(([key, title]) => {
        const item = chapters[key as SystemSection];
        return `<a href="/admin/system/${key}"${key === section ? ' aria-current="page"' : ""}><span class="chapter-index" aria-hidden="true">${item.mark}</span><span class="chapter-name"><strong>${title}</strong><small>${item.caption}</small></span><span class="chapter-indicator" aria-hidden="true">${key === section ? "●" : "↗"}</span></a>`;
      })
      .join(
        "",
      )}<p class="chapter-reading-note">按主题查阅<br>所有操作入口仍在后台导航</p></nav><div class="dossier-content">`;
}

export function systemChapterEnd(section: SystemSection) {
  const keys = Object.keys(systemSections) as SystemSection[];
  const index = keys.indexOf(section);
  const adjacent = (key: SystemSection, previous: boolean) =>
    `<a href="/admin/system/${key}" rel="${previous ? "prev" : "next"}"><span>${previous ? "← 上一主题" : "下一主题 →"}</span><strong>${e(systemSections[key])}</strong></a>`;
  return `</div></div><nav class="chapter-pagination" aria-label="相邻系统主题">${adjacent(keys[(index + 3) % 4], true)}<span class="chapter-position">${chapters[section].mark} <span>/ 04</span></span>${adjacent(keys[(index + 1) % 4], false)}</nav></section>`;
}
