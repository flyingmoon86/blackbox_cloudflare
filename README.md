# 黑匣子网站

面向话剧队内部使用的资料与档案网站，正在从 Flask 迁移到 Cloudflare。新版本采用 TypeScript + Hono 单 Worker，D1 保存数据，R2 将保存照片、剧本和大视频。

## 文件从哪里看起

```text
src/             正式 TypeScript 网站代码
public/          CSS、图片等静态文件
migrations/      D1 数据库结构
scripts/data/    旧 MySQL 与文件迁移工具
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

本地功能迁移已经覆盖账号、队员、作品、公告、页面文案、资料审核、R2 分片与断点续传、受控下载、头像、作品封面、首页背景和分级帮助。旧 MySQL 导出、D1 转换和 R2 文件迁移工具也已通过虚拟数据验证。下一步需要连接真实 Cloudflare 测试环境并导入真实旧数据。邮箱发送按用户选择暂缓；当前没有上线，也没有连接正式 Cloudflare 数据库、域名、邮件或真实文件。

- [迁移计划](docs/迁移计划.md)
- [产品与权限规则](docs/产品与权限规则.md)
- [架构与部署](docs/架构与部署.md)
- [验证记录](docs/验证记录.md)
- [本地验收指南](docs/本地验收指南.md)
