# 黑匣子

Flask + Jinja 页面、MySQL 数据库的话剧队资料站。

## 本地运行

1. 创建 Python 虚拟环境，运行 `python -m pip install -r requirements.txt`。
2. 复制 `.env.example` 为 `.env`，填写已创建的 MySQL 数据库、账号及随机密钥。
3. 运行 `python migrate.py` 创建或升级结构，不添加演示资料。
4. 运行 `python app.py`，打开 `http://127.0.0.1:5000`。

旧的六个 `migrate_*.py` 已合并为 `migrate.py`。升级真实数据库前备份数据库和上传文件。`seed.py` 仅用于添加演示队员，不是部署命令。

## 验证

`python -m unittest discover -s tests -v` 使用内存数据库和临时文件，不改真实数据。

## 部署准备

`python serve.py` 使用 Waitress，仅监听 `127.0.0.1:8080`。必须先配置 HTTPS 网站地址及至少 32 字符随机密钥，并配合 HTTPS 反向代理。该命令不是完整的一键部署；域名、代理、系统服务、备份和首次管理员设置尚需随选定路线落实。

资源文件目前保存在本地目录；`RESOURCE_FOLDER` 可指向持久化数据盘。大视频的对象存储和断点续传尚未实现，现有上传上限仍为 200MB。

- [技术与功能图](docs/技术与部署方案.md)
- [网站使用指南](docs/网站使用指南.md)
- [项目上下文](docs/项目上下文.md)

开发者维护 Python、模板和功能标签；管理员通过“页面文案”、作品管理及剧团设置维护网站内容。
