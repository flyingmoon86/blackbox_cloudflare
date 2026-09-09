import { escapeHtml, layout } from "../views";

export const MEMBER_GUIDE_DEFAULT =
  "先在个人中心完成队员认证，再从作品档案申请自己的角色或分工、补充对应资料。上传内容会先由管理员审核；在“我的提交”可查看进度和驳回原因。";
export const ADMIN_GUIDE_DEFAULT =
  "日常先查看管理员工作台的待审核事项，再维护作品、演职员、资料和公告。通过演职员申请前请核对作品、人员及角色；相同角色可保留多人，作为 AB 角或轮换演员。";

const paragraph = (value: string): string => `<p class="preline">${escapeHtml(value)}</p>`;

export function helpPage(texts: Record<string, string>, admin: boolean): string {
  const memberGuide = texts.member_guide || MEMBER_GUIDE_DEFAULT;
  const adminGuide = texts.admin_guide || ADMIN_GUIDE_DEFAULT;
  const adminNav = admin ? '<a href="#captain-guide">队长与管理员</a>' : "";
  return layout(
    "使用指南",
    `<section class="page-heading"><p class="eyebrow">HELP</p><h1>网站使用指南</h1><p>从下面选择要完成的事情；每一步都提供直接入口。</p></section>
    <nav class="guide-jumps" aria-label="指南目录"><a href="#member-guide">队员须知</a><a href="#find-production">寻找作品</a><a href="#join-production-guide">登记演职员</a><a href="#upload-guide">上传资料</a><a href="#profile-guide">个人档案</a>${adminNav}</nav>
    <article id="member-guide" class="card guide-section"><div class="guide-title"><div><p class="eyebrow">MEMBER GUIDE</p><h2>队员须知</h2></div>${admin ? '<a class="edit-link" href="/admin/site#member_guide">编辑队员须知正文</a>' : ""}</div>${paragraph(memberGuide)}<p class="hint">下面的操作步骤由网站维护，会随功能更新；队长可在页面管理中补充本队约定。</p></article>
    <section class="guide-grid">
      <article id="find-production" class="card guide-section"><span class="guide-step">01</span><h2>先找到作品</h2><p>打开作品档案，找到你参与的戏。缺少档案时，直接点击页面上方“申请创建作品”，填写作品名、年份和说明。</p><p><a class="button" href="/productions">打开作品档案</a></p></article>
      <article id="join-production-guide" class="card guide-section"><span class="guide-step">02</span><h2>登记角色或分工</h2><p>从作品卡片点击“我是主创！”。已有同名角色时仍可提交，审核通过后会显示为多人饰演或 AB 角；同一个人也能继续申请其他角色。</p><p><a href="/productions">选择作品并申请</a></p></article>
      <article id="upload-guide" class="card guide-section"><span class="guide-step">03</span><h2>补充资料</h2><p>从作品卡片进入上传，作品会自动选中。图片可批量选择；1–5GB 视频支持分片和断点续传。上传后到“我的提交”查看审核结果。</p><p><a href="/resources/submit">上传资料</a> · <a href="/my-resources">查看我的提交</a></p></article>
      <article id="profile-guide" class="card guide-section"><span class="guide-step">04</span><h2>维护个人档案与账号</h2><p>在个人中心修改头像、简介和代表作，也可以修改密码。姓名、届别等公共档案信息由管理员维护。</p><p><a href="/profile">进入个人中心</a></p></article>
    </section>
    ${
      admin
        ? `<article id="captain-guide" class="card guide-section admin-guide"><div class="guide-title"><div><p class="eyebrow">CAPTAIN GUIDE</p><h2>队长与管理员指南</h2></div><a class="edit-link" href="/admin/site#admin_guide">编辑管理员须知正文</a></div>${paragraph(adminGuide)}
        <nav class="admin-guide-links" aria-label="管理员常用入口"><a href="/admin/production-requests">审核演职员</a><a href="/admin/resources/reviews">审核资料</a><a href="/admin/suggestions">处理建档申请</a><a href="/admin/productions/new">创建作品</a><a href="/admin/announcements/new">发布公告</a><a href="/admin/site">页面管理</a></nav>
        <ol class="guide-checklist"><li><strong>先处理建档申请：</strong>确认作品尚不存在，再创建档案并补全名称、年份和介绍。</li><li><strong>再审核演职员：</strong>同角色已有人员时，页面会明确提示；通过后共同保留，不会覆盖原队员。</li><li><strong>审核资料：</strong>检查作品归属、内容和文件名；驳回时写清修改原因。剧照可逐张审核。</li><li><strong>维护展示：</strong>为作品选择已入库剧照作封面，再按需设为首页精选；公告和页面文案从工作台管理。</li><li><strong>定期检查：</strong>测试账号权限、下载与大文件上传，重要修改后按本地验收指南复核再上线。</li></ol></article>`
        : ""
    }`,
    true,
    admin,
  );
}
