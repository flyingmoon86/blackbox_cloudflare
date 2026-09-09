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

export function productionListPage(items: ProductionRow[], admin: boolean): string {
  const cards = items.length
    ? items
        .map(
          (item) =>
            `<article class="card production-card">${item.cover_id ? `<img class="production-cover" src="/resources/${item.cover_id}/preview" alt="${escapeHtml(item.title)}封面">` : ""}<p class="eyebrow">${escapeHtml(item.year || "作品档案")}</p><h2><a href="/productions/${item.id}">${escapeHtml(item.title)}</a></h2><p>${escapeHtml(item.promo || item.synopsis || "暂无介绍")}</p></article>`,
        )
        .join("")
    : '<p class="card">还没有作品档案。</p>';
  return layout(
    "作品",
    `<section class="page-heading"><p class="eyebrow">PRODUCTIONS</p><h1>作品与资料</h1><p><a href="/resources">浏览资料库</a> · <a href="/my-resources">查看我的提交</a> · <a href="/resources/submit">提交资料</a></p>${admin ? '<a class="button" href="/admin/productions/new">创建作品</a>' : ""}</section><section class="card-grid">${cards}</section>`,
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
  myRequest: { status: string; kind: string; role_name: string; admin_note: string } | null,
  alreadyJoined: boolean,
  csrf: string,
): string {
  const admin = user.role === "admin";
  const group = (kind: "cast" | "crew") =>
    credits
      .filter((credit) => credit.kind === kind)
      .map(
        (credit) =>
          `<li><a href="/members/${credit.member_id}">${escapeHtml(credit.member_name)}</a> · ${escapeHtml(credit.role_name)}${admin ? `<form class="inline" method="post" action="/admin/productions/${item.id}/credits/${credit.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="link-button">删除</button></form>` : ""}</li>`,
      )
      .join("") || "<li>暂无记录</li>";
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
            `<article class="card"><p class="eyebrow">${escapeHtml(resourceLabels[resource.res_type] || resource.res_type)}</p><h3><a href="/resources/${resource.id}">${escapeHtml(resource.title)}</a></h3><p>${escapeHtml(resource.description || resource.original_name)}</p></article>`,
        )
        .join("")
    : "";
  const archiveContent =
    gallery || archive ? `${gallery}${archive}` : '<p class="muted">这部作品还没有已入库资料。</p>';
  let join = "";
  if (alreadyJoined) join = '<p class="notice">你已经在这部作品的演职员名单中。</p>';
  else if (user.role === "member") {
    if (myRequest?.status === "pending")
      join = `<p class="notice">你的“${myRequest.kind === "crew" ? "后台与创作" : "演员"} · ${escapeHtml(myRequest.role_name)}”申请正在等待管理员审核。</p>`;
    else
      join = `${myRequest?.status === "rejected" ? `<p class="alert">上次申请未通过：${escapeHtml(myRequest.admin_note || "请联系管理员了解原因。")}</p>` : ""}<form class="credit-form" method="post" action="/productions/${item.id}/join"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>我想加入<select name="kind"><option value="cast">演员</option><option value="crew">后台与创作</option></select></label><label>角色或分工<input name="role_name" maxlength="80" required placeholder="如：哈姆雷特、灯光、舞台监督"></label><button>提交加入申请</button></form>`;
  }
  return layout(
    item.title,
    `<article class="card production-detail">${item.cover_id ? `<img class="production-cover" src="/resources/${item.cover_id}/preview" alt="${escapeHtml(item.title)}封面">` : ""}<p class="eyebrow">${escapeHtml(item.year || "PRODUCTION")}</p><h1>${escapeHtml(item.title)}</h1><p class="lead">${escapeHtml(item.promo)}</p><p>${escapeHtml(item.synopsis || "暂无剧情介绍")}</p>
    <div class="two-column"><section><h2>演员</h2><ul>${group("cast")}</ul></section><section><h2>后台与创作</h2><ul>${group("crew")}</ul></section></div>
    <section class="production-archive"><h2>相关资料</h2><p class="muted">已由管理员审核入库的剧本、剧照、视频和其他档案。</p><div class="card-grid">${archiveContent}</div></section>
    ${join}
    ${admin ? `<p><a href="/admin/productions/${item.id}/edit">编辑作品资料</a></p><form class="credit-form" method="post" action="/admin/productions/${item.id}/credits"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>选择队员<select name="member_id" required><option value="">请选择</option>${members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}${member.cohort ? `（${escapeHtml(member.cohort)}）` : ""}</option>`).join("")}</select></label><label>类别<select name="kind"><option value="cast">演员</option><option value="crew">后台与创作</option></select></label><label>角色或分工<input name="role_name" maxlength="80" required></label><button>添加演职员</button></form>` : ""}</article>`,
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
    `<section class="card auth wide"><p class="eyebrow">PRODUCTION EDITOR</p><h1>${item ? "编辑作品" : "创建作品"}</h1><form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>作品名称<input name="title" maxlength="100" value="${escapeHtml(item?.title)}" required></label><label>年份<input name="year" type="number" min="1" max="9999" value="${escapeHtml(item?.year)}"></label><label>首页短介绍<input name="promo" maxlength="300" value="${escapeHtml(item?.promo)}"></label><label>剧情与作品介绍<textarea name="synopsis" rows="8">${escapeHtml(item?.synopsis)}</textarea></label>${coverSelect}${resourceImport}<label>封面比例<select name="cover_ratio"><option value="landscape"${item?.cover_ratio !== "portrait" ? " selected" : ""}>横版</option><option value="portrait"${item?.cover_ratio === "portrait" ? " selected" : ""}>竖版</option></select></label><label>首页布局<select name="feature_layout"><option value="split"${item?.feature_layout !== "overlay" ? " selected" : ""}>图文并列</option><option value="overlay"${item?.feature_layout === "overlay" ? " selected" : ""}>文字叠加</option></select></label><button>保存作品</button></form></section>`,
    true,
    true,
  );
}

export function productionRequestsPage(rows: ProductionJoinRequestRow[], csrf: string): string {
  const requests = rows.length
    ? rows
        .map(
          (row) =>
            `<article class="card"><p class="eyebrow">${escapeHtml(row.production_title)}</p><h2>${escapeHtml(row.member_name)}申请${row.kind === "crew" ? "后台与创作" : "演员"}</h2><p>角色或分工：${escapeHtml(row.role_name)}</p><p class="muted">账号：${escapeHtml(row.username)} · ${escapeHtml(row.created_at.slice(0, 16))}</p><form method="post" action="/admin/production-requests/${row.id}/review"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>审核说明<input name="admin_note" maxlength="1000" placeholder="驳回时必填"></label><button name="decision" value="approve">通过并加入名单</button> <button class="secondary" name="decision" value="reject">驳回</button></form></article>`,
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
