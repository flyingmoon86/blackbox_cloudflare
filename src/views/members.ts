import { escapeHtml, message } from "./html";
import { layout } from "./layout";
import { YEARS, yearSelect, pagination, type PageInfo } from "./shared";
import type { MemberRow } from "../routes/members";
export function memberListPage(
  members: MemberRow[],
  years: number[],
  search: string,
  selectedYear: number | "missing" | null,
  admin: boolean,
  signedIn = true,
  page?: PageInfo,
): string {
  const memberContext = new URLSearchParams({ page: String(page?.page || 1) });
  if (search) memberContext.set("q", search);
  if (selectedYear !== null) memberContext.set("year", String(selectedYear));
  const cards = members.length
    ? members
        .map((member) => {
          const portrait = member.photo
            ? `<img class="member-card-media" src="/members/${member.id}/avatar" alt="${escapeHtml(member.name)}的头像">`
            : `<span class="member-card-art" aria-hidden="true">${escapeHtml(member.name.slice(0, 1) || "剧")}</span>`;
          return `<article class="member-card${member.photo ? "" : " member-card-empty"}"><a class="member-card-link" href="/members/${member.id}?${escapeHtml(memberContext.toString())}">${portrait}<span class="member-card-shade"></span><span class="member-card-copy"><span class="eyebrow">${escapeHtml(cohortLabel(member.cohort) || (member.join_year ? member.join_year + " 年入队" : "剧团成员"))}</span><strong>${escapeHtml(member.name)}</strong>${member.contributor ? '<span class="contributor-tag">网站贡献者</span>' : ""}<span class="member-card-details"><span>${escapeHtml(member.bio || "点击查看队员档案与舞台经历")}</span><small>🌸 ${member.flower_count} · 查看档案 →</small></span></span></a></article>`;
        })
        .join("")
    : '<p class="card">没有找到符合条件的队员。</p>';
  const options = YEARS.map(
    (year) => `<option value="${year}"${selectedYear === year ? " selected" : ""}>${year}</option>`,
  ).join("");
  const olderYear =
    typeof selectedYear === "number" && !YEARS.includes(selectedYear)
      ? `<option value="${selectedYear}" selected>${selectedYear}</option>`
      : "";
  return layout(
    "队员名录",
    `<section class="page-heading"><div class="member-heading-title"><p class="eyebrow">HALL OF FAME</p><h1>队员名录</h1></div>${admin ? '<p><a class="button" href="/admin/members/new">＋ 新建队员档案</a></p>' : ""}<form method="get" class="filters"><input name="q" value="${escapeHtml(search)}" aria-label="搜索队员" placeholder="搜索姓名、入学年级或作品"><select name="year" aria-label="入队年份"><option value="">全部入队年份</option><option value="missing"${selectedYear === "missing" ? " selected" : ""}>未填写入队年份</option>${olderYear}${options}</select><span class="filter-actions"><button>查找</button>${search || selectedYear !== null ? '<a href="/members">清除筛选</a>' : ""}</span></form></section><section class="card-grid member-grid" data-server-paged>${cards}</section>${pagination(page)}`,
    signedIn,
    admin,
  );
}

export function memberCreatePage(csrf: string, error = ""): string {
  return layout(
    "新建队员档案",
    `<section class="card auth"><p class="eyebrow">NEW MEMBER</p><h1>新建队员档案</h1>${message(error)}<p class="muted">先建立没有账号的历史或现役队员档案。队员注册后，可以申请绑定到这份档案。</p><form method="post" action="/admin/members/new"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>姓名<input name="name" maxlength="50" required></label><label>入队年份${yearSelect("join_year", "")}</label><label>入学年级${yearSelect("cohort", "")}<span class="hint">填写入校年份，显示为 2024 级。</span></label><label>个人简介<textarea name="bio" maxlength="5000" rows="7"></textarea></label><button>建立档案</button></form><p><a href="/members">返回队员名录</a></p></section>`,
    true,
    true,
  );
}

export function memberDetailPage(
  member: MemberRow,
  csrf: string,
  flower: string,
  own = false,
  admin = false,
  signedIn = true,
  navigation?: {
    back: string;
    query: string;
    previous?: { id: number; name: string };
    next?: { id: number; name: string };
  },
): string {
  const notice =
    flower === "sent"
      ? message("今天的花已送达。", "notice")
      : flower === "already"
        ? message("你今天已经送过花了，明天再来吧。")
        : "";
  const edit = admin
    ? `<a class="button secondary" href="/admin/members/${member.id}/edit">管理档案</a>`
    : own
      ? '<a class="button secondary" href="/profile/member">修改我的信息</a>'
      : "";
  const back = escapeHtml(navigation?.back || "/members");
  const neighbor = (row: { id: number; name: string } | undefined, previous: boolean) =>
    row
      ? `<a href="/members/${row.id}?${escapeHtml(navigation?.query || "")}" rel="${previous ? "prev" : "next"}"><span>${previous ? "← 上一位" : "下一位 →"}</span><small>${escapeHtml(row.name)}</small></a>`
      : `<span aria-disabled="true">${previous ? "已是第一位" : "已是最后一位"}</span>`;
  const experience = member.productions?.length
    ? `<ul class="dossier-credits">${member.productions.map((p) => `<li><span class="dossier-year">${p.year || "年份待补"}</span><a href="/productions/${p.id}${p.edition_id ? `?edition=${p.edition_id}#edition-${p.edition_id}` : ""}"><strong>${escapeHtml(p.title)}</strong>${p.edition_name ? `<span> / ${escapeHtml(p.edition_name)}</span>` : ""}<small>${p.kind === "crew" ? "幕后" : "演员"} · ${escapeHtml(p.role_name || "参与演出")}</small></a><span aria-hidden="true">→</span></li>`).join("")}</ul>`
    : '<p class="dossier-empty">暂无已关联的舞台经历。<br>审核通过的演职员记录会显示在这里。</p>';
  const senders = [...(member.flower_senders || [])].sort((a, b) => b.amount - a.amount).slice(0, 3);
  return layout(
    member.name,
    `<article class="profile-detail member-dossier">
    <div class="dossier-toolbar"><a data-member-return href="${back}">← 返回查找结果</a>${edit}</div>
    ${notice}<div class="dossier-grid">
    <header class="dossier-heading"><p class="eyebrow">队员档案</p><h1${member.name.length > 10 ? ' class="dossier-long-name"' : ""}>${escapeHtml(member.name)}</h1><div class="dossier-identity"><p>${escapeHtml(cohortLabel(member.cohort) || "剧团成员")}${member.join_year ? ` · ${member.join_year} 年入队` : ""}</p>${member.contributor ? '<span class="contributor-tag">网站贡献者</span>' : ""}</div>${member.bio ? `<p class="dossier-intro">${escapeHtml(member.bio.replace(/\s+/g, " ").slice(0, 72))}${member.bio.replace(/\s+/g, " ").length > 72 ? "…" : ""}</p>` : ""}</header>
    <figure class="dossier-portrait">${member.photo ? `<a href="/members/${member.id}/avatar?size=original" data-dossier-photo aria-label="放大查看${escapeHtml(member.name)}的头像"><img src="/members/${member.id}/avatar?size=original" alt="${escapeHtml(member.name)}的头像" fetchpriority="high"><span>放大查看 ↗</span></a>` : `<div class="dossier-placeholder"><span aria-hidden="true">${escapeHtml(member.name.slice(0, 1))}</span><p>照片待补充</p></div>`}</figure>
    <div class="dossier-content"><nav class="dossier-tabs" aria-label="队员资料栏目"><a id="tab-about" href="#member-about">关于 TA</a><a id="tab-stage" href="#member-stage">舞台经历</a><a id="tab-flowers" href="#member-flowers">送来的心意</a></nav>
    <div class="dossier-panels"><section id="member-about" class="dossier-panel" aria-labelledby="tab-about"><h2>关于 TA</h2><p class="preline">${escapeHtml(member.bio || "这位队员的故事，等待慢慢补充。")}</p></section>
    <section id="member-stage" class="dossier-panel" aria-labelledby="tab-stage"><h2>舞台经历</h2>${experience}</section>
    <section id="member-flowers" class="dossier-panel" aria-labelledby="tab-flowers"><h2>送来的心意</h2><p class="muted">共收到 ${member.flower_count} 朵花${senders.length ? " · 送花最多的前三位" : ""}</p><ul class="dossier-senders">${senders.map((sender) => `<li><span>${sender.member_id ? `<a href="/members/${sender.member_id}">${escapeHtml(sender.name)}</a>` : escapeHtml(sender.name)}</span><span>${sender.amount} 朵</span></li>`).join("")}</ul>${(member.flower_senders?.length || 0) > 3 || member.anonymous_flowers ? '<p class="muted">还有其他或匿名送来的心意。</p>' : ""}${!member.flower_count ? '<p class="dossier-empty">还没有收到花。送一朵，留下你的鼓励。</p>' : ""}</section>
    </div><p class="dossier-scroll-cue" hidden aria-hidden="true">向下查看更多 ↓</p><div class="dossier-flower-action"><form method="post" action="/members/${member.id}/flowers"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary"><svg class="dossier-flower-icon" viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="16" cy="16" r="3"/><path d="M13 12C5 9 12-1 16 7c4-8 11 2 3 5 9-3 11 9 3 9 7 6-4 12-6 4-2 8-13 2-6-4-8 0-6-12 3-9Z"/></svg><span>送 TA 一朵花</span></button></form><span><strong>${member.flower_count}</strong> 朵花</span></div></div></div>
    <nav class="dossier-neighbors" aria-label="切换队员">${neighbor(navigation?.previous, true)}<a data-member-return href="${back}">返回查找结果</a>${neighbor(navigation?.next, false)}</nav></article>`,
    signedIn,
    admin,
  );
}

export function memberEditPage(member: MemberRow, csrf: string, admin: boolean, saved: boolean, error = ""): string {
  const action = admin ? `/admin/members/${member.id}/edit` : "/profile/member";
  const identity = admin
    ? `<label>姓名<input name="name" maxlength="50" value="${escapeHtml(member.name)}" required></label><label>入队年份${yearSelect("join_year", member.join_year)}</label><label>入学年级${yearSelect("cohort", member.cohort)}</label>`
    : `<p class="muted">姓名需要修改时请联系管理员。</p><label>入队年份${yearSelect("join_year", member.join_year)}</label><label>入学年级${yearSelect("cohort", member.cohort)}<span class="hint">填入校年份，非毕业年份；留空保留原记录。</span></label>`;
  const avatarForm = admin
    ? member.photo
      ? `<form class="form-sep" method="post" action="/admin/members/${member.id}/avatar/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">移除当前头像</button></form>`
      : '<p class="muted">该队员尚未上传头像。</p>'
    : `<form class="form-sep" method="post" action="/profile/member/avatar" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>更换头像<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp,image/avif" required></label><span class="hint">支持 JPG、PNG、WebP、AVIF，最大 15MB。</span><button class="secondary">上传头像</button></form>`;
  return layout(
    admin ? "编辑队员档案" : "修改我的信息",
    `<section class="card auth"><p class="eyebrow">MEMBER PROFILE</p><h1>${admin ? "编辑队员档案" : "修改我的信息"}</h1>${message(error)}${saved ? `<p class="notice">${admin ? "队员档案" : "个人信息"}已保存。</p>` : ""}${member.photo ? `<img class="avatar avatar-large" src="/members/${member.id}/avatar" alt="当前头像">` : ""}<form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${identity}<label>个人简介<textarea name="bio" maxlength="5000" rows="7">${escapeHtml(member.bio)}</textarea></label><p class="hint">参与作品会根据已审核的演职员关系自动展示，无需重复填写。</p><button>${admin ? "保存档案" : "保存信息"}</button></form>${avatarForm}${admin ? `<aside class="danger-zone"><p class="eyebrow">DANGER ZONE</p><h2>删除队员档案</h2><p>删除后，关联账号会解除绑定，演职员、献花和队员资料关联会一并移除，头像会进入清理队列。</p><form method="post" action="/admin/members/${member.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>输入档案姓名“${escapeHtml(member.name)}”确认<input name="confirm_name" autocomplete="off" required></label><button class="danger">删除这份档案</button></form></aside>` : ""}<p><a href="/members/${member.id}">返回队员档案</a></p></section>`,
    true,
    admin,
  );
}

export function memberApplicationPage(
  csrf: string,
  mode: "bind" | "new",
  members: Array<{ id: number; name: string; cohort: string; join_year?: number | null }>,
  pending: unknown,
): string {
  if (pending)
    return layout(
      "队员认证",
      '<section class="card auth"><h1>申请等待审核</h1><p>管理员审核后，结果会显示在个人中心。暂时不需要重复提交。</p><a href="/profile">返回个人中心</a></section>',
      true,
    );
  const switcher =
    mode === "bind"
      ? "<p>先在已有队员档案中找到自己，再提交认证。</p>"
      : '<p>确认没有自己的档案后，再填写以下信息。<a href="?type=bind">返回查找已有档案</a></p>';
  const common = `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="apply_type" value="${mode}"><label>一句台词或参与经历<textarea name="identity_note" maxlength="1000" rows="4" required></textarea><span class="hint">也可以填写后台分工或排练经历，仅管理员可见。</span></label>`;
  const grouped = new Map<number, typeof members>();
  for (const member of members) {
    const year = /^\d{4}$/.test(member.cohort) ? Number(member.cohort) : member.join_year || 0;
    grouped.set(year, [...(grouped.get(year) || []), member]);
  }
  const choices = [...grouped]
    .sort(([a], [b]) => b - a)
    .map(
      ([year, rows]) =>
        `<optgroup label="${year ? year + " 年" : "年份待补充"}">${rows.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}${member.cohort ? "（" + escapeHtml(member.cohort) + "级）" : ""}</option>`).join("")}</optgroup>`,
    )
    .join("");
  const fields =
    mode === "bind"
      ? `<label>选择我的档案<select name="member_id" required><option value="">请选择</option>${choices}</select><span class="hint">按入学年份从新到旧排列，未填年级时使用入队年份。</span></label>`
      : `<label>姓名<input name="name" maxlength="50" required></label><label>入队年份${yearSelect("join_year", "")}</label><label>入学年级${yearSelect("cohort", "")}</label><label>简介<textarea name="bio" rows="4"></textarea></label>`;
  return layout(
    "队员认证",
    `<section class="card auth"><p class="eyebrow">MEMBER APPLICATION</p><h1>申请队员认证</h1>${switcher}<form method="post" action="/profile/member-application">${fields}${common}<button>提交申请</button></form>${mode === "bind" ? '<p><a href="?type=new">找不到我的档案，申请新建</a></p>' : ""}</section>`,
    true,
  );
}

export function cohortLabel(value: string): string {
  const v = String(value || "").trim();
  return /^[0-9]{4}$/.test(v) ? v + " 级" : v.includes("届") ? "入学年级待确认" : v;
}
