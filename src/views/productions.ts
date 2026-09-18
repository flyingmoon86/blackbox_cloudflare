import { reviewQueue, reviewAttributes } from "./review-queue";
import { archiveTabs, pagination, type PageInfo, yearSelect, icon } from "./shared";
import type {
  CreditRow,
  EditionRow,
  MemberChoice,
  ProductionJoinRequestRow,
  ProductionResourceRow,
  ProductionRow,
  ResourceChoice,
} from "../routes/productions";
import type { UserSession } from "../types";
import { escapeHtml, layout } from "../views";
import { resourceCardArtwork } from "./resource-preview";

export function productionListPage(
  items: ProductionRow[],
  user: UserSession | null,
  deleted = false,
  page?: PageInfo,
): string {
  const admin = user?.role === "admin";
  const contributionActions = (item: ProductionRow): string => {
    const joinLink = user?.member_id
      ? `<a class="button secondary" href="/productions/${item.id}#join-production">我是主创！</a>`
      : admin
        ? `<a class="button secondary" href="/productions/${item.id}#manage-credits">管理主创</a>`
        : "";
    return `<div class="production-actions">${joinLink}<a class="button" href="/resources/submit?production_id=${item.id}">我要补充资料！</a></div>`;
  };
  let groupKey = "";
  const cards = items.length
    ? items
        .map((item) => {
          const key = item.featured ? "精选作品" : String(item.year || "年份待补");
          const heading =
            key !== groupKey
              ? `<h2 class="production-year-heading">${escapeHtml(key)}${item.featured || !item.year ? "" : " 年"}</h2>`
              : "";
          groupKey = key;
          if (item.feature_layout === "overlay" && item.cover_id) {
            return (
              heading +
              `<article class="card production-card production-stage-card ratio-${item.cover_ratio === "portrait" ? "portrait" : "landscape"}${item.featured ? " production-featured-card" : ""}"><img class="production-stage-image" src="/productions/${item.id}/cover?v=${item.cover_id}" alt="${escapeHtml(item.title)}封面"><span class="production-stage-shade" aria-hidden="true"></span><div class="production-stage-copy"><p class="eyebrow">${escapeHtml(item.year || "作品档案")} · ${item.edition_count || 1} 个版本</p><h2><a class="production-stage-title" href="/productions/${item.id}">${escapeHtml(item.title)}</a></h2><div class="production-stage-details"><div><p class="production-stage-intro">${escapeHtml(item.promo || item.synopsis || "暂无介绍")}</p>${contributionActions(item)}</div></div></div></article>`
            );
          }
          return (
            heading +
            `<article class="card production-card ratio-${item.cover_ratio === "portrait" ? "portrait" : "landscape"}${item.featured ? " production-featured-card" : ""}">${item.cover_id ? `<img class="production-cover" src="/productions/${item.id}/cover?v=${item.cover_id}" alt="${escapeHtml(item.title)}封面">` : ""}<p class="eyebrow">${escapeHtml(item.year || "作品档案")} · ${item.edition_count || 1} 个版本</p><h2><a href="/productions/${item.id}">${escapeHtml(item.title)}</a></h2><p>${escapeHtml(item.promo || item.synopsis || "暂无介绍")}</p>${contributionActions(item)}</article>`
          );
        })
        .join("")
    : page?.query
      ? '<p class="card">没有找到符合条件的作品。请换个关键词试试，或清除搜索。</p>'
      : '<p class="card">还没有作品档案。</p>';
  return layout(
    "作品",
    `${archiveTabs("productions")}<section class="page-heading"><p class="eyebrow">PRODUCTIONS</p><h1>作品档案</h1><form method="get" action="/productions" class="filters" role="search"><input type="search" name="q" maxlength="80" aria-label="搜索作品" value="${escapeHtml(page?.query || "")}" placeholder="搜索作品名称、简介、版本或年份"><button>查找</button>${page?.query ? '<a href="/productions">清除搜索</a>' : ""}</form>${deleted ? '<p class="notice">作品已删除，原有资料已转入“其他资料”。</p>' : ""}<p>浏览剧团作品，进入作品可查看演职员与已经审核入库的相关资料。</p>${admin ? '<a class="button" href="/admin/productions/new">＋ 创建作品</a>' : !admin ? '<a class="button" href="/suggestions?type=production&source=productions">申请创建作品</a>' : ""}</section><section class="card-grid production-grid" data-server-paged>${cards}</section>${pagination(page)}`,
    Boolean(user),
    admin,
  );
}

export function productionDetailPage(
  item: ProductionRow,
  credits: CreditRow[],
  resources: ProductionResourceRow[],
  members: MemberChoice[],
  user: UserSession | null,
  myRequests: Array<{ status: string; kind: string; role_name: string; admin_note: string; edition_id?: number }>,
  csrf: string,
  resourcePage?: PageInfo,
  editions: EditionRow[] = [],
  movable: Array<{ id: number; title: string; edition_id: number; edition_name: string; year: number | null }> = [],
): string {
  const admin = user?.role === "admin";
  const editionLabel = (id?: number | null) => {
    const v = editions.find((v) => v.id === id);
    return v ? `${v.year || "年份待补"} · ${v.name}` : "初始版本";
  };
  const versionSelect = `<label>演出版本<select name="edition_id" required><option value="">请选择版本</option>${editions.map((v) => `<option value="${v.id}">${escapeHtml(v.year || "年份待补")} · ${escapeHtml(v.name)}</option>`).join("")}</select></label>`;
  const moveForm =
    admin && movable.length
      ? `<details class="edition-editor"><summary>从其他版本选择资料并移动</summary><form data-move-resources method="post" action="/admin/productions/${item.id}/move-resources"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${versionSelect}<p class="hint">选择目标版本和资料，确认后资料会离开原版本，审核状态与原文件不变。</p><div class="check-list">${movable.map((r) => `<label data-source-edition="${r.edition_id}"><input type="checkbox" name="resource_ids" value="${r.id}">${escapeHtml(r.year || "年份待补")} · ${escapeHtml(r.edition_name)} — ${escapeHtml(r.title)}</label>`).join("")}</div><button>确认移动到所选版本</button></form></details>`
      : "";
  const creditRow = `<div class="credit-row" data-credit-row><label>搜索队员<input type="search" data-member-search placeholder="输入姓名或年级" autocomplete="off"></label><label>选择队员<select name="member_id" required><option value="">请选择</option>${members.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}${m.cohort ? `（${escapeHtml(m.cohort)}）` : ""}</option>`).join("")}</select></label><label>类别<select name="kind"><option value="cast">演员</option><option value="crew">后台与创作</option></select></label><label>角色或分工<input name="role_name" maxlength="80" required></label><button type="button" class="secondary" data-remove-credit>移除这行</button></div>`;
  const group = (kind: "cast" | "crew", editionId?: number) => {
    const roles = new Map<string, CreditRow[]>();
    for (const credit of credits.filter(
      (entry) => entry.kind === kind && (editionId === undefined || entry.edition_id === editionId),
    )) {
      const key = credit.role_name.trim().toLocaleLowerCase();
      roles.set(key, [...(roles.get(key) || []), credit]);
    }
    return (
      [...roles.values()]
        .map((entries) => {
          const people = entries
            .map(
              (credit) =>
                `<span class="credit-person"><a href="/members/${credit.member_id}">${escapeHtml(credit.member_name)}</a>${admin ? `<form class="inline" method="post" action="/admin/productions/${item.id}/credits/${credit.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="link-button" aria-label="删除${escapeHtml(credit.member_name)}的${escapeHtml(credit.role_name)}记录">删除</button></form>` : ""}</span>`,
            )
            .join("、");
          const shared =
            entries.length > 1
              ? `<span class="role-badge">${kind === "cast" ? "多人饰演 / AB角" : "共同分工"}</span>`
              : "";
          return `<li class="role-credit"><strong>${escapeHtml(entries[0].role_name)}</strong>${shared}<span>${people}</span></li>`;
        })
        .join("") || "<li>暂无记录</li>"
    );
  };
  const resourceLabels: Record<string, string> = {
    video: "视频",
    script: "剧本",
    photo: "剧照",
    audio: "音频",
    other: "其他",
  };
  const renderArchive = (collection: ProductionResourceRow[]) => {
    const photos = collection.filter((resource) => resource.res_type === "photo");
    const otherResources = collection.filter((resource) => resource.res_type !== "photo");
    const gallery = photos.length
      ? `<article class="card photo-archive"><p class="eyebrow">剧照 · ${photos.length} 张</p><h4>剧照集</h4><p class="photo-archive-hint">点开剧照可直接浏览；仍可进入详情页查看资料信息。</p><div class="photo-grid">${photos.map((photo, index) => `<a data-photo-lightbox href="/resources/${photo.id}?origin=${photo.id}&amp;page=${resourcePage?.page || 1}" data-preview="/resources/${photo.id}/preview" data-caption="${escapeHtml(photo.title)}" title="${escapeHtml(photo.title)}" aria-label="打开《${escapeHtml(item.title)}》第 ${index + 1} 张剧照"><img src="/resources/${photo.id}/preview" alt="${escapeHtml(item.title)}剧照 ${index + 1}" loading="lazy" decoding="async"></a>`).join("")}</div></article>`
      : "";
    const archive = otherResources.length
      ? otherResources
          .map(
            (resource) =>
              `<article class="resource-card type-${escapeHtml(resource.res_type)}"><a class="resource-card-link" href="/resources/${resource.id}">${resourceCardArtwork(resource)}<span class="resource-card-shade"></span><span class="resource-card-copy"><span class="eyebrow">${escapeHtml(resourceLabels[resource.res_type] || resource.res_type)}</span><strong>${escapeHtml(resource.title)}</strong><span>${escapeHtml(resource.description || resource.original_name || "点击查看资料")}</span></span></a></article>`,
          )
          .join("")
      : "";
    return gallery || archive ? `${gallery}${archive}` : '<p class="muted">当前资料页暂无资料。</p>';
  };
  let join = "";
  if (user?.role === "member" || (admin && user?.member_id)) {
    const mine = user?.member_id ? credits.filter((credit) => credit.member_id === user?.member_id) : [];
    const current = mine.length
      ? `<p class="notice">你已登记：${mine.map((credit) => `${escapeHtml(editionLabel(credit.edition_id))} · ${credit.kind === "crew" ? "后台与创作" : "演员"} · ${escapeHtml(credit.role_name)}`).join("；")}。你仍可申请其他角色或分工。</p>`
      : "";
    const pending = myRequests.filter((request) => request.status === "pending");
    const pendingNotice = pending.length
      ? `<div class="pending-roles"><strong>等待审核：</strong>${pending.map((request) => `<span>${escapeHtml(editionLabel(request.edition_id))} · ${request.kind === "crew" ? "后台与创作" : "演员"} · ${escapeHtml(request.role_name)}</span>`).join("")}</div>`
      : "";
    const rejected = myRequests.find((request) => request.status === "rejected");
    const roleCounts = Object.fromEntries(
      editions.map((v) => [
        v.id,
        credits
          .filter((c) => c.edition_id === v.id)
          .reduce<Record<string, Record<string, number>>>(
            (all, credit) => {
              const key = credit.role_name.trim().toLocaleLowerCase();
              all[credit.kind][key] = (all[credit.kind][key] || 0) + 1;
              return all;
            },
            { cast: {}, crew: {} },
          ),
      ]),
    );
    join = `<section id="join-production" class="join-production" data-role-counts="${escapeHtml(JSON.stringify(roleCounts))}"><h2>我是主创</h2><p class="muted">可以自由填写，也可以选择已有角色。同一角色允许多人饰演，提交后会作为 AB 角或轮换演员保留；一位队员也可以分别申请多个角色或分工。</p>${current}${pendingNotice}${rejected ? `<p class="alert">最近一次未通过：${escapeHtml(editionLabel(rejected.edition_id))} · ${escapeHtml(rejected.kind === "crew" ? "后台与创作" : "演员")} · ${escapeHtml(rejected.role_name)}。${escapeHtml(rejected.admin_note || "请联系管理员了解原因。")}</p>` : ""}<form class="credit-form" method="post" action="/productions/${item.id}/join"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${versionSelect}<label>我是演员/后台与创作<select name="kind" data-role-kind><option value="cast">演员</option><option value="crew">后台与创作</option></select></label><label>角色或分工<input name="role_name" maxlength="80" required list="production-role-options" data-role-name placeholder="如：哈姆雷特、灯光、舞台监督"><span class="hint" data-role-hint>填写新角色，或从已有角色中选择。</span></label><datalist id="production-role-options"></datalist><button>提交加入申请</button></form></section>`;
  }
  return layout(
    item.title,
    `${archiveTabs("productions")}<p class="back-links"><a href="/productions">← 返回作品档案</a></p><article class="card production-detail work-detail ratio-${item.cover_ratio === "portrait" ? "portrait" : "landscape"}"><header class="production-hero">${item.cover_id ? `<img class="production-cover" decoding="async" fetchpriority="high" src="/productions/${item.id}/cover?v=${item.cover_id}" alt="${escapeHtml(item.title)}封面">` : ""}<div class="production-hero-copy"><p class="eyebrow">${escapeHtml(item.year || "PRODUCTION")} · ${editions.length} 个版本</p><h1>${escapeHtml(item.title)}</h1><p class="lead">${escapeHtml(item.promo)}</p><a class="production-hero-next" href="#versions">查看演出版本 <span aria-hidden="true">↓</span></a></div></header><p class="production-synopsis">${escapeHtml(item.synopsis || "暂无剧情介绍")}</p>
    <nav class="edition-nav" id="versions" aria-label="演出版本"><span class="edition-nav-label">选择演出版本</span><div class="edition-tabs">${editions.map((v) => `<a href="/productions/${item.id}?edition=${v.id}#edition-${v.id}"${v.id === (resourcePage?.edition || editions[0]?.id) ? ' aria-current="page"' : ""}>${escapeHtml(editionLabel(v.id))}</a>`).join("")}</div></nav>
    ${editions
      .filter((v) => v.id === (resourcePage?.edition || editions[0]?.id))
      .map((v) => {
        const editionCredits = credits.filter((credit) => credit.edition_id === v.id);
        const castCount = new Set(
          editionCredits.filter((credit) => credit.kind === "cast").map((credit) => credit.member_id),
        ).size;
        const crewCount = new Set(
          editionCredits.filter((credit) => credit.kind === "crew").map((credit) => credit.member_id),
        ).size;
        const editionResources = resources.filter((resource) => resource.edition_id === v.id);
        return `<section class="production-edition" id="edition-${v.id}"><header class="edition-heading"><p class="edition-year">${escapeHtml(v.year || "年份待补")}</p><div class="edition-heading-copy"><p class="eyebrow">当前演出版本</p><h2>${escapeHtml(v.name)}</h2>${v.description ? `<p class="edition-description">${escapeHtml(v.description)}</p>` : ""}<ul class="edition-facts" aria-label="版本概览"><li><strong>${castCount}</strong><span>位演员</span></li><li><strong>${crewCount}</strong><span>位幕后成员</span></li><li><strong>${editionResources.length}</strong><span>份资料</span></li></ul></div></header>${admin ? `<details class="edition-editor"><summary>编辑这个版本</summary><form method="post" action="/admin/productions/${item.id}/editions/${v.id}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>版本名称<input name="name" maxlength="80" required value="${escapeHtml(v.name)}"></label><label>演出年份${yearSelect("year", v.year)}</label><label>版本介绍<textarea name="description" maxlength="10000">${escapeHtml(v.description)}</textarea></label><button>保存版本</button></form></details>` : ""}<div class="two-column edition-credits"><section class="credit-panel"><header><h3>${icon("members")}演员</h3><span>${castCount} 位</span></header><ul>${group("cast", v.id)}</ul></section><section class="credit-panel"><header><h3>${icon("productions")}后台与创作</h3><span>${crewCount} 位</span></header><ul>${group("crew", v.id)}</ul></section></div><section class="edition-resources" aria-labelledby="edition-${v.id}-resources"><header><div><p class="eyebrow">版本资料</p><h3 id="edition-${v.id}-resources">${editionResources.length ? `${editionResources.length} 份已入库资料` : "暂未收录资料"}</h3></div><a class="edition-resource-action" href="/resources/submit?production_id=${item.id}&amp;edition_id=${v.id}">补充资料 <span aria-hidden="true">→</span></a></header><div class="card-grid edition-resource-grid">${renderArchive(editionResources)}</div></section></section>`;
      })
      .join("")}
    <dialog class="photo-lightbox" data-photo-dialog aria-labelledby="photo-lightbox-caption"><div class="photo-lightbox-bar"><p><span data-photo-position></span><strong id="photo-lightbox-caption" data-photo-caption></strong></p><button class="photo-lightbox-close" type="button" data-photo-close aria-label="关闭剧照浏览">关闭 <span aria-hidden="true">×</span></button></div><div class="photo-lightbox-stage"><button type="button" data-photo-prev aria-label="上一张剧照">←</button><figure><img data-photo-image alt=""><figcaption data-photo-error hidden>这张剧照暂时无法载入，你仍可进入详情页查看。</figcaption></figure><button type="button" data-photo-next aria-label="下一张剧照">→</button></div><div class="photo-lightbox-actions"><a class="button secondary" data-photo-detail href="/resources">查看资料详情</a><span>可用方向键切换，Esc 关闭</span></div></dialog>
    <section class="production-archive">${pagination(resourcePage)}</section>${moveForm}
    ${join}
    ${admin ? `<section id="manage-credits"><p><a href="/admin/productions/${item.id}/edit">编辑作品资料</a></p><form class="batch-credit-form" method="post" action="/admin/productions/${item.id}/credits"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${versionSelect}<div data-credit-rows>${creditRow}</div><template data-credit-template>${creditRow}</template><button type="button" class="secondary" data-add-credit>＋ 添加演职人员</button><button>确认提交演职人员</button></form><h3>添加演出版本</h3><form method="post" action="/admin/productions/${item.id}/editions"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>版本名称<input name="name" maxlength="80" required placeholder="如：毕业演出版"></label><label>演出年份${yearSelect("year", 2026)}</label><label>版本介绍<textarea name="description" maxlength="10000"></textarea></label><button>添加版本</button></form></section>` : ""}</article>`,
    Boolean(user),
    admin,
    item.id,
  );
}

export function productionFormPage(
  item: ProductionRow | null,
  csrf: string,
  covers: Array<{ id: number; title: string }>,
  resources: ResourceChoice[],
): string {
  const action = item ? `/admin/productions/${item.id}/edit` : "/admin/productions/new";
  const coverSelect = item
    ? `<label>作品封面<select name="cover_id"><option value="">暂不设置</option>${covers.map((cover) => `<option value="${cover.id}"${item.cover_id === cover.id ? " selected" : ""}>${escapeHtml(cover.title)}</option>`).join("")}</select><span class="hint">这里只显示已归入本作品且审核通过的剧照。</span></label>`
    : "";
  const labels: Record<string, string> = { video: "视频", script: "剧本", photo: "剧照", audio: "音频", other: "其他" };
  const resourceImport = resources.length
    ? `<fieldset><legend>关联 ARCHIVE 资料</legend><p class="hint">这里显示尚未归类的待审核或已入库资料，以及本作品现有资料。关联不会自动通过审核。</p><div class="check-list">${resources.map((resource) => `<label><input type="checkbox" name="resource_ids" value="${resource.id}"${resource.production_id === item?.id ? " checked" : ""}>${resource.status === "pending" ? "待审核" : "已入库"} · ${escapeHtml(labels[resource.res_type] || resource.res_type)} · ${escapeHtml(resource.title)}</label>`).join("")}</div></fieldset>`
    : '<p class="muted">当前没有可导入的已审核资料。</p>';
  return layout(
    item ? "编辑作品" : "创建作品",
    `<section class="card auth wide"><p class="eyebrow">PRODUCTION EDITOR</p><h1>${item ? "编辑作品" : "创建作品"}</h1><form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>作品名称<input name="title" maxlength="100" value="${escapeHtml(item?.title)}" required></label>${item ? `<p>版本年份请在作品详情的版本区域管理，列表按最新版本排序。</p>` : `<fieldset data-edition-fields><legend>演出版本</legend><p>每个版本独立演职人员，同一年可添加多个版本。</p><div data-edition-row><label>版本名称<input name="edition_name" maxlength="80" value="首演版" required></label><label>年份${yearSelect("edition_year", 2026)}</label></div><button type="button" data-add-edition>＋ 添加一个版本</button></fieldset>`}<label>首页短介绍<input name="promo" maxlength="300" value="${escapeHtml(item?.promo)}"></label><label>剧情与作品介绍<textarea name="synopsis" rows="8">${escapeHtml(item?.synopsis)}</textarea></label>${coverSelect}${resourceImport}<label>作品主题色<input name="theme_color" value="${escapeHtml(item?.theme_color || "")}" pattern="#[0-9a-fA-F]{6}" maxlength="7" placeholder="留空沿用全站"><span class="hint">仅作用于该作品详情页，留空沿用网站颜色。</span></label><label>选择作品颜色<input type="color" data-production-color value="${escapeHtml(item?.theme_color || "#536c57")}"></label><label>封面比例<select name="cover_ratio"><option value="landscape"${item?.cover_ratio !== "portrait" ? " selected" : ""}>横版</option><option value="portrait"${item?.cover_ratio === "portrait" ? " selected" : ""}>竖版</option></select></label><label>作品卡片布局<select name="feature_layout"><option value="split"${item?.feature_layout !== "overlay" ? " selected" : ""}>图文并列</option><option value="overlay"${item?.feature_layout === "overlay" ? " selected" : ""}>文字叠加</option></select><span class="hint">同时用于作品档案列表和首页精选区。图文并列保持现有排版；文字叠加使用剧照卡片，悬停展开简介和操作，手机直接显示。需要先选择展示图。</span></label><button>保存作品</button></form>${item ? `<aside class="danger-zone"><p class="eyebrow">DANGER ZONE</p><h2>删除作品</h2><p>演职员和待审核加入申请会一并移除；已上传资料不会删除，而会转入“其他资料”。</p><form method="post" action="/admin/productions/${item.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>输入作品名“${escapeHtml(item.title)}”确认<input name="confirm_title" autocomplete="off" required></label><button class="danger">删除这部作品</button></form></aside>` : ""}</section>`,
    true,
    true,
  );
}

export function productionRequestsPage(rows: ProductionJoinRequestRow[], csrf: string): string {
  const requests = rows.length
    ? rows
        .map(
          (row) =>
            `<article class="card" ${reviewAttributes(row.id, row.kind === "crew" ? "后台与创作" : "演员", [row.production_title, row.edition_name, row.member_name, row.username, row.role_name].join(" "))}><p class="eyebrow">${escapeHtml(row.production_title)} · ${escapeHtml(row.edition_name || "原有版本")}</p><h2>${escapeHtml(row.member_name)}申请${row.kind === "crew" ? "后台与创作" : "演员"}</h2><p>角色或分工：${escapeHtml(row.role_name)}</p>${row.existing_names ? `<p class="notice">相同角色或分工已有：${escapeHtml(row.existing_names)}。通过后会共同列入，不会覆盖原记录。</p>` : '<p class="muted">这是当前名单中的新角色或分工。</p>'}<p class="muted">账号：${escapeHtml(row.username)} · ${escapeHtml(row.created_at.slice(0, 16))}</p><form method="post" action="/admin/production-requests/${row.id}/review"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>审核说明<input name="admin_note" maxlength="1000" placeholder="驳回时必填"></label><button name="decision" value="approve">通过并加入名单</button> <button class="secondary" name="decision" value="reject">驳回</button></form></article>`,
        )
        .join("")
    : '<p class="card">当前没有待审核的作品加入申请。</p>';
  return layout(
    "作品加入审核",
    `<section class="page-heading"><p class="eyebrow">PRODUCTION REQUESTS</p><h1>作品加入审核</h1></section>${reviewQueue("production", requests)}`,
    true,
    true,
  );
}
