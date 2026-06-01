# 站点应用

## 构建命令

```bash
./build.sh docs
./build.sh docs:dev
./build.sh docs:preview
./build.sh all
```

- `docs`：构建 VitePress 文档。
- `docs:dev`：启动本地文档开发服务。
- `docs:preview`：预览已构建文档。
- `all`：构建管理服务和文档站。

## 自动发布

提交到配置分支且文档相关文件发生变化时，GitHub Actions 会构建 `doc/.vitepress/dist` 并发布到 GitHub Pages。
