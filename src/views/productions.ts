import type {
  CreditRow,
  MemberChoice,
  ProductionJoinRequestRow,
  ProductionResourceRow,
  ProductionRow,
  ResourceChoice,
} from "../routes/productions";
import type { UserSession } from "../types";
import { escapeHtml, layout } from "../views";
import { resourceCardArtwork } from "./resource-preview";

function archiveTabs(active: "productions" | "resources"): string {
  return `<nav class="section-tabs" aria-label="作品与资料"><a href="/productions"${active === "productions" ? ' class="active" aria-current="page"' : ""}>作品档案</a><a href="/resources"${active === "resources" ? ' class="active" aria-current="page"' : ""}>资料库</a></nav>`;
}

export function productionListPage(items: ProductionRow[], user: UserSession, deleted = false): string {
  const admin = user.role === "admin";
  const contributionActions = (item: ProductionRow): string => {
    if (user.role === "user")
      return '<p class="contribution-note"><a href="/profile/member-application">认证为队员后，可以申请加入主创并补充资料</a></p>';
    const joinLink = user.member_id
      ? `<a class="button secondary" href="/productions/${item.id}#join-production">我是主创！</a>`
      : admin
        ? `<a class="button secondary" href="/productions/${item.id}#manage-credits">管理主创</a>`
        : "";
    return `<div class="production-actions">${joinLink}<a class="button" href="/resources/submit?production_id=${item.id}">我要补充资料！</a></div>`;
  };
  const cards = items.length
    ? items
        .map((item) => {
          if (item.feature_layout === "overlay" && item.cover_id) {
            return `<article class="card production-card production-stage-card ratio-${item.cover_ratio === "portrait" ? "portrait" : "landscape"}"><img class="production-stage-image" src="/resources/${item.cover_id}/preview" alt="${escapeHtml(item.title)}封面"><span class="production-stage-shade" aria-hidden="true"></span><div class="production-stage-copy"><p class="eyebrow">${escapeHtml(item.year || "作品档案")}</p><h2><a class="production-stage-title" href="/productions/${item.id}">${escapeHtml(item.title)}</a></h2><div class="production-stage-details"><div><p class="production-stage-intro">${escapeHtml(item.promo || item.synopsis || "暂无介绍")}</p>${contributionActions(item)}</div></div></div></article>`;
          }
          return `<article class="card production-card ratio-${item.cover_ratio === "portrait" ? "portrait" : "landscape"}">${item.cover_id ? `<img class="production-cover" src="/resources/${item.cover_id}/preview" alt="${escapeHtml(item.title)}封面">` : ""}<p class="eyebrow">${escapeHtml(item.year || "作品档案")}</p><h2><a href="/productions/${item.id}">${escapeHtml(item.title)}</a></h2><p>${escapeHtml(item.promo || item.synopsis || "暂无介绍")}</p>${contributionActions(item)}</article>`;
        })
        .join("")
    : '<p class="card">还没有作品档案。</p>';
  return layout(
    "作品",
    `${archiveTabs("productions")}<section class="page-heading"><p class="eyebrow">PRODUCTIONS</p><h1>作品档案</h1>${deleted ? '<p class="notice">作品已删除，原有资料已转入“其他资料”。</p>' : ""}<p>浏览剧团作品，进入作品可查看演职员与已经审核入库的相关资料。</p>${admin ? '<a class="button" href="/admin/productions/new">＋ 创建作品</a>' : user.role === "member" ? '<a class="button" href="/suggestions?type=production&source=productions">申请创建作品</a>' : ""}</section><section class="card-grid production-grid">${cards}</section>`,
    true,
    admin,
  );
}

export function productionDetailPage(
  item: ProductionRow,
  credits: CreditRow[],
  resources: ProductionResourceRow[],
  members: MemberChoice[],
  user: UserSession,
  myRequests: Array<{ status: string; kind: string; role_name: string; admin_note: string }>,
  csrf: string,
): string {
  const admin = user.role === "admin";
  const group = (kind: "cast" | "crew") => {
    const roles = new Map<string, CreditRow[]>();
    for (const credit of credits.filter((entry) => entry.kind === kind)) {
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
  const photos = resources.filter((resource) => resource.res_type === "photo");
  const otherResources = resources.filter((resource) => resource.res_type !== "photo");
  const gallery = photos.length
    ? `<article class="card photo-archive"><p class="eyebrow">剧照 · ${photos.length} 张</p><h3>剧照集</h3><div class="photo-grid">${photos.map((photo) => `<a href="/resources/${photo.id}" title="${escapeHtml(photo.title)}"><img src="/resources/${photo.id}/preview" alt="${escapeHtml(photo.title)}"></a>`).join("")}</div></article>`
    : "";
  const archive = otherResources.length
    ? otherResources
        .map(
          (resource) =>
            `<article class="resource-card type-${escapeHtml(resource.res_type)}"><a class="resource-card-link" href="/resources/${resource.id}">${resourceCardArtwork(resource)}<span class="resource-card-shade"></span><span class="resource-card-copy"><span class="eyebrow">${escapeHtml(resourceLabels[resource.res_type] || resource.res_type)}</span><strong>${escapeHtml(resource.title)}</strong><span>${escapeHtml(resource.description || resource.original_name || "点击查看资料")}</span></span></a></article>`,
        )
        .join("")
    : "";
  const archiveContent =
    gallery || archive ? `${gallery}${archive}` : '<p class="muted">这部作品还没有已入库资料。</p>';
  let join = "";
  if (user.role === "member" || (admin && user.member_id)) {
    const mine = user.member_id ? credits.filter((credit) => credit.member_id === user.member_id) : [];
    const current = mine.length
      ? `<p class="notice">你已登记：${mine.map((credit) => `${credit.kind === "crew" ? "后台与创作" : "演员"} · ${escapeHtml(credit.role_name)}`).join("；")}。你仍可申请其他角色或分工。</p>`
      : "";
    const pending = myRequests.filter((request) => request.status === "pending");
    const pendingNotice = pending.length
      ? `<div class="pending-roles"><strong>等待审核：</strong>${pending.map((request) => `<span>${request.kind === "crew" ? "后台与创作" : "演员"} · ${escapeHtml(request.role_name)}</span>`).join("")}</div>`
      : "";
    const rejected = myRequests.find((request) => request.status === "rejected");
    const roleCounts = credits.reduce<Record<string, Record<string, number>>>(
      (all, credit) => {
        const key = credit.role_name.trim().toLocaleLowerCase();
        all[credit.kind][key] = (all[credit.kind][key] || 0) + 1;
        return all;
      },
      { cast: {}, crew: {} },
    );
    const knownRoles = [...new Set(credits.map((credit) => credit.role_name.trim()).filter(Boolean))];
    join = `<section id="join-production" class="join-production" data-role-counts="${escapeHtml(JSON.stringify(roleCounts))}"><h2>我是主创</h2><p class="muted">可以自由填写，也可以选择已有角色。同一角色允许多人饰演，提交后会作为 AB 角或轮换演员保留；一位队员也可以分别申请多个角色或分工。</p>${current}${pendingNotice}${rejected ? `<p class="alert">最近一次未通过：${escapeHtml(rejected.kind === "crew" ? "后台与创作" : "演员")} · ${escapeHtml(rejected.role_name)}。${escapeHtml(rejected.admin_note || "请联系管理员了解原因。")}</p>` : ""}<form class="credit-form" method="post" action="/productions/${item.id}/join"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>我想加入<select name="kind" data-role-kind><option value="cast">演员</option><option value="crew">后台与创作</option></select></label><label>角色或分工<input name="role_name" maxlength="80" required list="production-role-options" data-role-name placeholder="如：哈姆雷特、灯光、舞台监督"><span class="hint" data-role-hint>填写新角色，或从已有角色中选择。</span></label><datalist id="production-role-options">${knownRoles.map((role) => `<option value="${escapeHtml(role)}"></option>`).join("")}</datalist><button>提交加入申请</button></form></section>`;
  }
  return layout(
    item.title,
    `${archiveTabs("productions")}<p class="back-links"><a href="/productions">← 返回作品档案</a><a href="/resources">查看资料库</a></p><article class="card production-detail ratio-${item.cover_ratio === "portrait" ? "portrait" : "landscape"}">${item.cover_id ? `<img class="production-cover" src="/resources/${item.cover_id}/preview" alt="${escapeHtml(item.title)}封面">` : ""}<p class="eyebrow">${escapeHtml(item.year || "PRODUCTION")}</p><h1>${escapeHtml(item.title)}</h1><p class="lead">${escapeHtml(item.promo)}</p><p>${escapeHtml(item.synopsis || "暂无剧情介绍")}</p>
    <div class="two-column"><section><h2>演员</h2><ul>${group("cast")}</ul></section><section><h2>后台与创作</h2><ul>${group("crew")}</ul></section></div>
    <section class="production-archive"><h2>相关资料</h2><p class="muted">已由管理员审核入库的剧本、剧照、视频和其他档案。</p><div class="card-grid">${archiveContent}</div></section>
    ${join}
    ${admin ? `<section id="manage-credits"><p><a href="/admin/productions/${item.id}/edit">编辑作品资料</a></p><form class="credit-form" method="post" action="/admin/productions/${item.id}/credits"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>选择队员<select name="member_id" required><option value="">请选择</option>${members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}${member.cohort ? `（${escapeHtml(member.cohort)}）` : ""}</option>`).join("")}</select></label><label>类别<select name="kind"><option value="cast">演员</option><option value="crew">后台与创作</option></select></label><label>角色或分工<input name="role_name" maxlength="80" required></label><button>添加演职员</button></form></section>` : ""}</article>`,
    true,
    admin,
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
    `<section class="card auth wide"><p class="eyebrow">PRODUCTION EDITOR</p><h1>${item ? "编辑作品" : "创建作品"}</h1><form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>作品名称<input name="title" maxlength="100" value="${escapeHtml(item?.title)}" required></label><label>年份<input name="year" type="number" min="1" max="9999" value="${escapeHtml(item?.year)}"></label><label>首页短介绍<input name="promo" maxlength="300" value="${escapeHtml(item?.promo)}"></label><label>剧情与作品介绍<textarea name="synopsis" rows="8">${escapeHtml(item?.synopsis)}</textarea></label>${coverSelect}${resourceImport}<label>封面比例<select name="cover_ratio"><option value="landscape"${item?.cover_ratio !== "portrait" ? " selected" : ""}>横版</option><option value="portrait"${item?.cover_ratio === "portrait" ? " selected" : ""}>竖版</option></select></label><label>作品卡片布局<select name="feature_layout"><option value="split"${item?.feature_layout !== "overlay" ? " selected" : ""}>图文并列</option><option value="overlay"${item?.feature_layout === "overlay" ? " selected" : ""}>文字叠加</option></select><span class="hint">同时用于作品档案列表和首页精选区。图文并列保持现有排版；文字叠加使用剧照卡片，悬停展开简介和操作，手机直接显示。需要先选择展示图。</span></label><button>保存作品</button></form>${item ? `<aside class="danger-zone"><p class="eyebrow">DANGER ZONE</p><h2>删除作品</h2><p>演职员和待审核加入申请会一并移除；已上传资料不会删除，而会转入“其他资料”。</p><form method="post" action="/admin/productions/${item.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>输入作品名“${escapeHtml(item.title)}”确认<input name="confirm_title" autocomplete="off" required></label><button class="danger">删除这部作品</button></form></aside>` : ""}</section>`,
    true,
    true,
  );
}

export function productionRequestsPage(rows: ProductionJoinRequestRow[], csrf: string): string {
  const requests = rows.length
    ? rows
        .map(
          (row) =>
            `<article class="card"><p class="eyebrow">${escapeHtml(row.production_title)}</p><h2>${escapeHtml(row.member_name)}申请${row.kind === "crew" ? "后台与创作" : "演员"}</h2><p>角色或分工：${escapeHtml(row.role_name)}</p>${row.existing_names ? `<p class="notice">相同角色或分工已有：${escapeHtml(row.existing_names)}。通过后会共同列入，不会覆盖原记录。</p>` : '<p class="muted">这是当前名单中的新角色或分工。</p>'}<p class="muted">账号：${escapeHtml(row.username)} · ${escapeHtml(row.created_at.slice(0, 16))}</p><form method="post" action="/admin/production-requests/${row.id}/review"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>审核说明<input name="admin_note" maxlength="1000" placeholder="驳回时必填"></label><button name="decision" value="approve">通过并加入名单</button> <button class="secondary" name="decision" value="reject">驳回</button></form></article>`,
        )
        .join("")
    : '<p class="card">当前没有待审核的作品加入申请。</p>';
  return layout(
    "作品加入审核",
    `<section class="page-heading"><p class="eyebrow">PRODUCTION REQUESTS</p><h1>作品加入审核</h1></section><section class="review-grid">${requests}</section>`,
    true,
    true,
  );
}
