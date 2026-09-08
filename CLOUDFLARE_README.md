# 黑匣子 Cloudflare 迁移工程

原 Flask 源码保留在项目根目录，作为功能、页面和数据迁移对照。新的实现位于 `src/`，采用 TypeScript + Hono 的单 Worker 架构；原 Python 文件不再修改。

## 当前进度

阶段 0 的运行能力验证和阶段 1 的账号基础均已通过本地测试：正式 D1 表结构、静态资源、登录、退出、CSRF、签名 Cookie 会话、旧 Werkzeug scrypt 密码兼容和 `auth_version` 会话失效。

当前配置只用于本地测试。`wrangler.jsonc` 仍是占位数据库 ID，尚未连接 Cloudflare 账户、域名、邮件、真实数据库或用户文件，不能直接部署。

## 本地运行

1. 安装依赖：`npm install`
2. 初始化本地 D1：`npm run db:init`
3. 按 `.dev.vars.example` 创建 `.dev.vars`，填入仅供本机使用的随机会话密钥
4. 启动 Worker：`npm run dev`
5. 访问首页和 `/health`

用于自动检查的固定虚拟账号在 `test-fixtures/local-user.sql` 中。它只应导入本地 D1，不得导入线上数据库。

## 上线前必须完成

- 迁移剩余账号、队员、作品、资源、公告和后台功能。
- 创建独立测试 D1/R2，并替换 Wrangler 的占位绑定。
- 通过 Cloudflare Secret 保存正式会话密钥。
- 导入脱敏测试数据，完成权限、大文件上传和数据一致性验证。
- 全部验收后再配置域名并切换流量。
