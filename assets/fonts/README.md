# 展示字体源文件

`NotoSerifSC-900.woff2` 是现行标题字体的完整源文件，从旧设计稿目录提取保留，文件内容未改动。

- 离线生成脚本：[build-display-font.py](../../scripts/build-display-font.py)，需要 Python 与 `fonttools[woff]`，从任意目录执行均可。
- 网站实际加载已生成的 `public/fonts/display-*.woff2`，普通 npm 构建不需要 Python，也不重新生成字体。
- 字体声明：[NOTICE.txt](../../public/fonts/NOTICE.txt)；许可证：[OFL.txt](../../public/fonts/OFL.txt)。
- 历史设计稿也引用此源文件，避免维护两份相同字体。

此目录不在 Cloudflare Static Assets 的发布目录 `public/` 中。
