import { escapeHtml as e, layout } from "../views";
import type { UserSession } from "../types";
import type { SiteProfileRow, AnnouncementRow } from "../routes/content";
import type { ProductionRow } from "../routes/productions";
export function theatreHome(
  profile: SiteProfileRow,
  featured: ProductionRow | null,
  news: AnnouncementRow[],
  user: UserSession | null,
  backgroundId: number | null,
): string {
  let texts: Record<string, string> = {};
  try {
    texts = JSON.parse(profile.page_texts || "{}");
  } catch {}
  const admin = user?.role === "admin";
  const edit = (field: string, label: string) =>
    admin ? '<a class="edit-link" href="/admin/site#' + field + '">' + label + " ↗</a>" : "";
  const image = backgroundId
    ? '<img class="stage-backdrop" src="/site/hero?v=' + backgroundId + '" alt="" fetchpriority="high">'
    : "";
  const mascot = texts.mascot_photo
    ? "/site/mascot?v=" + encodeURIComponent(texts.mascot_photo)
    : "/images/elephant-mascot-360-v1.webp";
  const feature = featured
    ? '<aside class="stage-feature"><span class="eyebrow">ON STAGE / ' +
      e(featured.year || "精选大戏") +
      '</span><a href="/productions/' +
      featured.id +
      '"><h2>' +
      e(featured.title) +
      "</h2><p>" +
      e(featured.promo || "走进这部作品的幕后故事") +
      "</p><span>进入作品 ↗</span></a></aside>"
    : "";
  const notice = news[0]
    ? '<a href="/announcements/' + news[0].id + '"><span>最新公告</span> ' + e(news[0].title) + " ↗</a>"
    : '<a href="/announcements">剧团公告 ↗</a>';
  const welcome = user ? texts.home_welcome : texts.visitor_welcome;
  const posterId = texts.recruitment_poster || texts.recruitment_poster_mobile;
  const poster = posterId
    ? '<figure class="recruitment-poster"><a href="/resources/' +
      Number(posterId) +
      '/preview" data-poster-open><picture>' +
      (texts.recruitment_poster_mobile
        ? '<source media="(max-width:900px)" srcset="/resources/' +
          Number(texts.recruitment_poster_mobile) +
          '/preview">'
        : "") +
      '<img src="/resources/' +
      Number(posterId) +
      '/preview" alt="' +
      e(texts.recruitment_poster_alt || "剧团招新海报") +
      '" loading="lazy" decoding="async"></picture><figcaption>点击放大海报 ↗</figcaption></a></figure>'
    : "";
  const posterDialog = posterId
    ? '<dialog class="poster-dialog"><button type="button" data-poster-close>关闭 ×</button><div class="poster-zoom"><img alt="' +
      e(texts.recruitment_poster_alt || "剧团招新海报") +
      '"></div><p>点击图片切换放大，放大后可滚动查看。</p></dialog>'
    : "";
  const about =
    '<section class="stage-scene stage-about" id="about" aria-label="剧团介绍"><div class="about-copy"><span class="eyebrow">02 / OUR STORY</span><h2>在黑匣子，<br>一起成为故事。</h2>' +
    edit("about_text", "编辑介绍") +
    '<div class="about-columns"><article><h3>关于我们</h3><p class="preline">' +
    e(texts.about_text || profile.introduction || "记录每一次排练、演出与相遇。") +
    '</p></article><article><h3>加入舞台</h3><p class="preline">' +
    e(profile.recruitment || "欢迎喜欢舞台的你加入我们。") +
    "</p><p>" +
    e(profile.requirements) +
    "</p>" +
    poster +
    edit("recruitment_poster", "编辑招新海报") +
    '</article></div><footer class="stage-contact" id="contact"><span>联系剧团</span><a href="mailto:' +
    e(profile.contact_email || "moonflying56@gmail.com") +
    '">' +
    e(profile.contact_email || "moonflying56@gmail.com") +
    "</a>" +
    (profile.qq_group ? "<span>QQ群 " + e(profile.qq_group) + "</span>" : "") +
    edit("contact_intro", "编辑联系") +
    "</footer></div></section>";
  const testNotice = texts.test_notice || "网站正在测试。欢迎浏览与提交建议，测试阶段暂不支持视频上传。";
  let version = 2166136261;
  for (const ch of testNotice) version = Math.imul(version ^ ch.charCodeAt(0), 16777619);
  const dialog =
    '<dialog class="test-notice" data-test-notice="' +
    (version >>> 0) +
    '"><form method="dialog"><h2>测试须知</h2><p class="preline">' +
    e(testNotice) +
    "</p><button value=understood>我已明白</button></form></dialog>";
  return layout(
    "首页",
    dialog +
      posterDialog +
      '<div class="theatre-stage">' +
      image +
      '<div class="stage-shade"></div><section class="stage-scene" id="welcome" aria-label="黑匣子首页"><div class="welcome-copy"><p class="eyebrow">01 / BLACK BOX THEATRE</p><h1>黑匣子<br><span>永远是你家</span></h1><p class="stage-welcome">' +
      e(welcome || "让每一次相遇，都有回响。") +
      "</p>" +
      edit("home_welcome", "编辑欢迎语") +
      '</div><img class="stage-mascot" src="' +
      e(mascot) +
      '" alt="黑匣子毛绒小象" width="360" height="360" decoding="async">' +
      feature +
      '<div class="stage-news">' +
      notice +
      '</div><a class="stage-explore" href="#about">探索剧团 <span>↓</span></a></section>' +
      about +
      '<nav class="scene-nav" aria-label="首页场景"><a href="#welcome" aria-label="第一幕：首页">01 首页</a><span></span><a href="#about" aria-label="第二幕：剧团">02 剧团</a></nav></div>',
    Boolean(user),
    admin,
  );
}
