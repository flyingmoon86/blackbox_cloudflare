# 黑匣子 Cloudflare 迁移工程

原 Flask 源码保留在项目根目录，作为功能对照和回退参考。新的 Cloudflare 实现从 src/worker.py 开始，迁移期间不连接正式 MySQL，也不复制 .env 和用户上传文件。

## 当前进度

阶段 0 最小验证已建立。Flask/Jinja、Cookie/CSRF、D1 读写和 Static Assets 已通过；Python Worker 缺少 Werkzeug scrypt 所需的 hashlib.scrypt，TypeScript 的 node:crypto 探针可以验证现有密码。路线选择尚待确认。

当前配置只允许本地测试；D1 的占位 ID 和本地密钥不能用于部署。

## 本地验证

1. 安装 Node 依赖：npm install；安装项目内 uv 后执行 .tools/bin/uv sync
2. 初始化本地 D1：npm run cf:db:init
3. 复制 .dev.vars.example 为 .dev.vars 并换成本地随机密钥
4. 启动：npm run cf:dev
5. 打开首页、/health 和 /poc/password
6. 另开终端执行 npm run cf:auth-poc -- --port 8789，访问 http://127.0.0.1:8789/poc/password 验证旧密码格式

进入云端测试前，需要先创建独立的测试 D1/R2，再把 wrangler.jsonc 中的占位 ID 替换为实际测试资源 ID。
