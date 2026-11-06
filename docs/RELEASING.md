# 发布 0.3.2

## 已准备的材料

- 版本：`manifest.json` 与 `package.json` 均为 `0.3.2`。
- 发布说明：`docs/releases/v0.3.2.md`，汇总自已发布的 0.1.0 以来的用户可见变化。
- 商店文案与权限用途：`STORE_LISTING.md`。
- 隐私说明：`PRIVACY.md`。
- 商店图标与界面示意图：`store-assets/`。
- 安装包与校验文件：`release/mobalytics-poe-translate-v0.3.2.zip` 及对应 `.sha256`。

原始客户端提取文件、临时网页源码和测试浏览器配置位于忽略目录，不提交或打包。
新生成的 ZIP 作为 GitHub Release 附件管理，不再新增到 Git 历史；已有 0.1.0 历史文件保留。

## 发布顺序

1. 运行 `npm test`、`npm run test:browser`、JavaScript 语法检查与 `git diff --check`。
2. 运行 `npm run package`，检查 ZIP 中的版本、运行时文件与 SHA-256。
3. 推送发布分支并创建 PR，等待 GitHub Actions 通过。
4. 创建 `v0.3.2` Release 草稿，附上安装包、校验文件和发布说明。
5. 审阅并合并 PR。正式发布前，将 Release 的目标提交确认到已合并的发布提交；使用 squash merge 时尤其需要更新目标 SHA。
6. 确认后发布 GitHub Release。如需更新扩展商店，将同一安装包上传到现有商店条目，复核描述、截图和隐私声明后提交审核。

GitHub Release 草稿不等于已公开发布，也不代表 Chrome/Edge 商店已提交或已通过审核。
本次准备工作不自动合并 PR、公开 Release 或提交商店审核。
