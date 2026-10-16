import { escapeHtml } from "./html";
import { adminNavigation } from "./admin-navigation";
import { stageArt, stageAssets, stageAttributes, stageSources, type StageScene } from "./stage-art";
import { icon } from "./shared";
import { assetUrl } from "./assets";
import { tryGetContext } from "hono/context-storage";
import { adminPortal } from "../services/admin-portal";
import { publicNavigationRequest } from "../services/navigation-cache";
import { PUBLIC_LANDING_PATHS } from "../shared/navigation";
import type { AppEnv } from "../types";
export function layout(title: string, content: string, signedIn = false, admin = false, themeId?: number): string {
  const context = tryGetContext<AppEnv>();
  const preview = context?.get("user")?.role === "admin" && context.req.query("stage-preview") === "1";
  const portal = context && !preview ? adminPortal(context) : null;
  const workspace = admin && Boolean(portal?.active || context?.req.path.startsWith("/admin"));
  const publicNavigation = Boolean(context && publicNavigationRequest(context));
  const eligibleLanding = Boolean(
    context &&
    PUBLIC_LANDING_PATHS.includes(context.req.path) &&
    !new URL(context.req.url).search &&
    !portal?.active &&
    !workspace &&
    !preview,
  );
  const openingVersion = eligibleLanding
    ? JSON.stringify([
        ...[
          "/navigation-preload.js",
          "/fonts.css",
          "/curtain-boot.js",
          "/curtain.css",
          "/app.js",
          "/app.css",
          "/experience.js",
          "/experience.css",
          "/home-light.js",
          "/home-light.css",
          "/work-browse.js",
          "/work-browse.css",
        ].map(assetUrl),
        ...(["home", "productions", "members", "thanks"] as StageScene[]).flatMap((scene) => [
          ...Object.values(stageSources(scene)),
          ...Object.values(stageSources(scene, undefined, true)),
        ]),
      ])
    : "";
  const bookLayout =
    !portal?.active &&
    (["/", "/thanks"].includes(context?.req.path || "") || /^\/announcements(?:\/\d+)?$/.test(context?.req.path || ""));
  const archiveGallery = !portal?.active && ["/productions", "/resources"].includes(context?.req.path || "");
  const memberGallery = !portal?.active && context?.req.path === "/members";
  const workBrowse =
    !portal?.active && !workspace && !preview && /^\/productions(?:\/\d+)?$/.test(context?.req.path || "");
  const artPage =
    !portal?.active && ["/productions", "/resources", "/members"].includes(context?.req.path || "")
      ? context!.req.path === "/resources"
        ? "productions"
        : (context!.req.path.slice(1) as StageScene)
      : null;
  if (artPage)
    content =
      stageAssets() +
      `<div class="navigation-stage" ${stageAttributes(artPage)}>${stageArt(artPage)}<div class="navigation-stage-content">${content}</div></div>`;
  const link = (href: string, label: string) =>
    '<a href="' +
    href +
    '">' +
    (href === "/"
      ? icon("home")
      : href === "/productions"
        ? icon("productions")
        : href === "/resources"
          ? icon("resources")
          : href === "/members"
            ? icon("members")
            : href === "/help"
              ? icon("help")
              : href === "/thanks"
                ? icon("thanks")
                : href === "/login" || href === "/profile"
                  ? icon("account")
                  : "") +
    label +
    "</a>";
  const menu = (label: string, href: string, id: string, items: string) =>
    '<div class="nav-menu"><a class="nav-menu-link" href="' +
    href +
    '">' +
    (href === "/productions" ? icon("productions") : href === "/members" ? icon("members") : icon("help")) +
    label +
    '</a><button class="nav-menu-toggle" type="button" aria-label="展开' +
    label +
    '子菜单" aria-expanded="false" aria-controls="' +
    id +
    '"></button><div class="nav-panel" id="' +
    id +
    '" hidden>' +
    items +
    "</div></div>";
  const group = (caption: string, href: string, label: string, children: string) =>
    '<section class="nav-group"><p class="nav-caption">' +
    caption +
    "</p><h2>" +
    link(href, label) +
    '</h2><ul class="nav-children">' +
    children +
    "</ul></section>";
  const child = (href: string, label: string) => "<li>" + link(href, label) + "</li>";
  let nav =
    link("/", "首页") +
    menu(
      "作品与资料",
      "/productions",
      "productions-menu",
      group(
        "走进舞台",
        "/productions",
        "作品档案",
        child("/suggestions?type=production&source=productions", "申请创建作品"),
      ) +
        group(
          "留存每一幕",
          "/resources",
          "资料库",
          child("/resources/submit", "我要补充资料") + (signedIn ? child("/my-resources", "我的提交") : ""),
        ),
    ) +
    menu(
      "队员与剧团",
      "/members",
      "members-menu",
      group(
        "台前与幕后",
        "/members",
        "队员名录",
        child("/profile/member", "修改我的信息") + child("/profile/member-application", "申请队员认证"),
      ) + group("认识我们", "/#about", "剧团介绍", child("/#contact", "联系我们")),
    ) +
    menu(
      "鸣谢",
      "/thanks",
      "thanks-menu",
      group("一起完善黑匣子", "/thanks", "网站贡献者", child("/feedback", "提交网站建议")),
    ) +
    (admin ? link("/admin", "管理") : "");
  const account =
    '<a class="account-link" href="' +
    (signedIn ? "/profile" : "/login") +
    '" aria-label="' +
    (signedIn ? "个人中心" : portal?.active ? "后台登录" : "登录或注册") +
    '" title="' +
    (signedIn ? "个人中心" : portal?.active ? "后台登录" : "登录或注册") +
    '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20v-1.5a6.5 6.5 0 0 1 13 0V20"/><circle cx="12" cy="12" r="10"/></svg></a>';
  let mobile =
    '<nav class="mobile-nav" aria-label="手机主导航">' +
    link("/", "首页") +
    link("/productions", "作品档案") +
    link("/members", "队员") +
    link(signedIn ? "/profile" : "/login", signedIn ? "我的" : "登录") +
    "</nav>";
  if (portal?.active) {
    nav =
      (admin
        ? link("/admin", "工作台") +
          link("/productions", "作品") +
          link("/members", "队员") +
          link("/admin/resources", "资料") +
          link("/admin/site", "页面编辑")
        : "") + `<a href="${escapeHtml(portal.publicSite)}" target="_blank" rel="noopener">查看正式网站 ↗</a>`;
    mobile = admin
      ? '<nav class="mobile-nav" aria-label="手机管理导航">' +
        link("/admin", "工作台") +
        link("/productions", "作品") +
        link("/admin/resources/reviews", "资料审核") +
        link("/profile", "账号") +
        "</nav>"
      : "";
  }
  if (workspace) {
    nav = '<span class="workspace-context">管理员后台</span>';
    mobile = "";
  }
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escapeHtml(title) +
    ' · 黑匣子</title><link rel="icon" type="image/webp" href="' +
    assetUrl("/images/elephant-mascot-360-v1.webp") +
    '"><link rel="stylesheet" href="' +
    assetUrl("/curtain.css") +
    '"><script src="' +
    assetUrl("/curtain-boot.js") +
    '"' +
    (!portal?.active && !workspace && !preview ? " data-curtain-page" : "") +
    (openingVersion
      ? ' data-site-opening="' +
        escapeHtml(openingVersion) +
        '" data-curtain-texture="' +
        assetUrl("/images/curtain-velvet-v1.webp") +
        '"'
      : "") +
    '></script><link rel="stylesheet" href="' +
    assetUrl("/app.css") +
    '"><link rel="stylesheet" href="' +
    assetUrl("/experience.css") +
    '"><link id="site-theme" rel="stylesheet" href="/site/theme.css' +
    (themeId ? "?production=" + themeId : "") +
    '"><link rel="stylesheet" href="' +
    assetUrl("/redesign.css") +
    '"><link rel="stylesheet" href="' +
    assetUrl("/archive-design.css") +
    '"><link rel="stylesheet" href="' +
    assetUrl("/fonts.css") +
    '">' +
    (bookLayout ? '<link rel="stylesheet" href="' + assetUrl("/layout-book.css") + '">' : "") +
    (memberGallery ? '<link rel="stylesheet" href="' + assetUrl("/layout-members.css") + '">' : "") +
    (archiveGallery ? '<link rel="stylesheet" href="' + assetUrl("/layout-gallery.css") + '">' : "") +
    (workBrowse || content.includes('class="production-cover work-cover-frame"')
      ? '<link rel="stylesheet" href="' + assetUrl("/work-browse.css") + '">'
      : "") +
    (!portal?.active && !workspace && !preview
      ? '<link rel="stylesheet" href="' + assetUrl("/navigation-light.css") + '">'
      : "") +
    '<script src="' +
    assetUrl("/app.js") +
    '" defer></script><script src="' +
    assetUrl("/member-dossier.js") +
    '" defer></script><script src="' +
    assetUrl("/experience.js") +
    '" defer></script>' +
    (workBrowse ? '<script src="' + assetUrl("/work-browse.js") + '" defer></script>' : "") +
    (!portal?.active && !workspace && !preview
      ? '<script src="' +
        assetUrl("/navigation-preload.js") +
        '" defer></script><script src="' +
        assetUrl("/navigation-light.js") +
        '"></script>'
      : "") +
    (admin ? '<script src="' + assetUrl("/review.js") + '" defer></script>' : "") +
    (content.includes("data-resource-picker")
      ? '<link rel="stylesheet" href="' +
        assetUrl("/resource-picker.css") +
        '"><script src="' +
        assetUrl("/resource-picker.js") +
        '" defer></script>'
      : "") +
    (admin
      ? '<link rel="stylesheet" href="' +
        assetUrl("/image-picker.css") +
        '"><script src="' +
        assetUrl("/image-picker.js") +
        '" defer></script>'
      : "") +
    (workspace
      ? '<link rel="stylesheet" href="' +
        assetUrl("/workbench.css") +
        '"><script src="' +
        assetUrl("/workbench.js") +
        '" defer></script>'
      : "") +
    '</head><body data-navigation-cache="' +
    (publicNavigation ? "public-v1" : "none") +
    '"' +
    (eligibleLanding ? ' data-navigation-preload="public"' : "") +
    ' class="' +
    (signedIn ? "signed-in" : "signed-out") +
    (portal?.active || context?.req.path.startsWith("/admin") ? " design-admin" : " design-public") +
    (portal?.active ? " admin-portal" : "") +
    (workspace ? " admin-workspace" : "") +
    (bookLayout ? " layout-book" : "") +
    (memberGallery ? " layout-members" : "") +
    (archiveGallery ? " layout-gallery" : "") +
    (content.includes('class="section-tabs"') ? " archive-page" : "") +
    '" data-section="' +
    (/^\/(productions|resources|my-resources|suggestions)(?:\/|$)/.test(context?.req.path || "")
      ? "productions"
      : /^\/(members|profile)(?:\/|$)/.test(context?.req.path || "")
        ? "members"
        : /^\/(thanks|feedback)(?:\/|$)/.test(context?.req.path || "")
          ? "thanks"
          : "") +
    '"><a class="skip-link" href="#main-content">跳到内容</a><header class="top"><a href="/" class="brand">黑匣子<span>BLACK BOX THEATRE</span></a><button class="menu-toggle" aria-label="菜单" aria-expanded="false" aria-controls="main-navigation"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><nav id="main-navigation" class="desktop-nav" aria-label="主导航">' +
    nav +
    "</nav>" +
    account +
    (admin ? '<div class="admin-notification-host" data-admin-notifications aria-live="polite"></div>' : "") +
    '</header><div class="nav-scrim" aria-hidden="true"></div>' +
    (workspace ? adminNavigation(context?.req.path || "/admin", portal?.publicSite) : "") +
    '<main id="main-content" tabindex="-1">' +
    content +
    "</main>" +
    mobile +
    "</body></html>"
  );
}
