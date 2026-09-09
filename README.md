# 黑匣子网站

面向话剧队内部使用的资料与档案网站，正在从 Flask 迁移到 Cloudflare。新版本采用 TypeScript + Hono 单 Worker，D1 保存数据，R2 将保存照片、剧本和大视频。

## 文件从哪里看起

```text
src/             正式 TypeScript 网站代码
public/          CSS、图片等静态文件
migrations/      D1 数据库结构
docs/            当前有效的需求、计划和验收说明
legacy-python/   原 Flask 网站参考副本，不参与新站运行
test-fixtures/   仅限本地的虚拟测试数据
wrangler.jsonc   Cloudflare 配置入口
package.json     本地开发命令
```

日常开发主要看 `src/`。Cloudflare 只运行 `src/index.ts` 并读取 `public/`，不会运行 `legacy-python/`。

## 本地启动

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:init
npm run dev
```

看到 `Ready on http://127.0.0.1:8787` 后，在浏览器打开该地址。详细点击检查见 [本地验收指南](docs/本地验收指南.md)。

## 当前状态

已完成账号基础、注册与改密码、队员名录与认证申请、管理员审核、作品与演职员、公告、精选大戏、主要首页文案、资料记录与审核、队员档案维护和分级帮助页。邮箱发送按用户选择暂缓，R2 大文件与图片上传、数据导入和云端部署仍待完成。当前没有上线，也没有连接正式 Cloudflare 数据库、域名、邮件或真实文件。

- [迁移计划](docs/迁移计划.md)
- [产品与权限规则](docs/产品与权限规则.md)
- [架构与部署](docs/架构与部署.md)
- [验证记录](docs/验证记录.md)
- [本地验收指南](docs/本地验收指南.md)
