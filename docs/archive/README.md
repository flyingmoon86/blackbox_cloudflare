# 历史设计归档

[design-proposal/index.html](design-proposal/index.html) 是合入正式网站前的静态设计演示，使用固定的公开页面数据快照，不是当前业务数据，也不是正式页面入口。

原 `design-proposal/` 的 7 个 HTML、共享脚本、样式和 10 张图片完整保留在这里。照片与头像可能具有复用价值，因此没有删除。内部页面与图片相对路径保持不变；样式中的字体路径改为引用仓库 [assets/fonts](../../assets/fonts/README.md) 的唯一源文件。应在完整仓库中查看演示，不要单独拷贝此文件夹后假定字体仍可用。

归档不参与 Worker 构建或 Static Assets 发布。当前实现以 `src/`、`public/` 和现行维护文档为准。
