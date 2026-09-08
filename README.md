# 黑匣子网站（Cloudflare 迁移版）

这是正在开发的新网站，使用 **TypeScript + Hono + Cloudflare Worker**。前端页面和后端功能放在同一个 Worker 中，部署时只有一个网站项目，适合目前约 30 人使用的剧团队伍维护。

## 先看懂整体结构

```text
浏览器
  └─ Cloudflare Worker（TypeScript）
       ├─ 返回 HTML 页面和 CSS
       ├─ 处理登录、权限和业务操作
       ├─ D1：保存账号、作品、公告等数据
       └─ R2：保存照片、剧本和大视频（后续接入）
```

项目根目录只保留以下几类内容：

```text
blackbox_cloudflare/
├─ src/                 新网站的 TypeScript 源码，日常开发主要看这里
│  ├─ index.ts          网站入口和当前路由
│  ├─ views.ts          当前 HTML 页面
│  └─ auth/             密码与登录会话
├─ public/              浏览器直接使用的 CSS、图片等静态文件
├─ migrations/          D1 数据库建表和升级脚本
├─ test-fixtures/       只供本地测试的虚拟数据
├─ docs/                迁移计划、使用指南和验证记录
├─ legacy-python/       原 Flask 网站的只读参考副本，不参与新站运行
├─ poc/                 阶段零技术实验，不参与新站运行
├─ wrangler.jsonc       Cloudflare Worker、D1、R2 的配置入口
├─ package.json         开发命令和 JavaScript 依赖
└─ tsconfig.json        TypeScript 类型检查规则
```

旧 Python 文件仍然保留，因为作品、资源、公告、后台等功能尚未全部迁移。每迁移一项，都要与 `legacy-python/` 中的旧实现核对，防止漏掉权限或字段。Cloudflare 配置只指向 `src/index.ts` 和 `public/`，因此旧站文件不会进入新网站的运行流程。

## 第一次本地运行

在项目目录打开终端，依次执行：

```powershell
npm install
npm run db:init
npm run dev
```

然后打开终端显示的本地网址。常用命令：

- `npm run dev`：启动本地网站。
- `npm run typecheck`：检查 TypeScript 是否写错。
- `npm run build`：模拟 Cloudflare 打包，但不发布。
- `npm run db:init`：把尚未执行的数据库迁移应用到本地 D1。
- `npm run deploy`：正式发布；迁移完成并验收前不要执行。

本地会话密钥放在 `.dev.vars`，该文件不会提交到 GitHub。可公开的格式示例放在 `.dev.vars.example`。

## 当前进度

阶段 0 的 Cloudflare 能力验证和阶段 1 的账号基础已完成：正式 D1 表结构、静态资源、登录、退出、CSRF、签名 Cookie 会话、旧 Werkzeug scrypt 密码兼容和改密码后旧会话失效均已通过本地测试。

注册、个人中心、修改密码、队员名录、档案详情、献花、队员认证申请、管理员审核、账号状态管理、作品档案和演职员分工已经完成。尚未完成邮箱验证与找回密码、资源审核、R2 大文件上传和完整的网站内容管理。目前没有连接正式 Cloudflare 数据库、域名、邮件或真实用户文件，也没有上线。

想亲自检查成果，请按 [本地验收指南](docs/本地验收指南.md) 操作。详细步骤见 [迁移计划](docs/迁移计划.md)，自动测试结果见 [阶段验证记录](docs/阶段0验证记录.md)。
