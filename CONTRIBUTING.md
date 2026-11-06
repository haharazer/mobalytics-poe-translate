# 参与贡献

感谢你帮助改进 Mobalytics PoE 中文化。

## 开发流程

1. Fork 仓库并从 `main` 创建功能分支。
2. 修改代码后运行：

   ```powershell
   npm test
   npm run test:browser
   node --check src/content.js
   node --check src/translation-core.js
   node --check popup/popup.js
   ```

3. 在 Chrome 或 Edge 中以「加载已解压的扩展程序」方式验证实际攻略页。
4. 提交 Pull Request，并说明变更目的、验证页面和测试结果。

## 词表更新

运行时词典位于 `data/poe1-skill-gems.js`、`data/poe1-core.js` 和 `data/poe1-extended.js`，请不要直接手改。
运行 `npm run build:data` 从本地 poe-client-data 生成，具体输入与当前临时说明适配器
的边界见 README。来源与诊断输出至 `data/poe1-core.report.json` 和 `data/poe1-extended.report.json`。
站点改写句式在 `data/mobalytics-stat-aliases.json` 显式维护，必须指向客户端 Stat 身份，
附实测页面及回归测试；不允许用任意数字正则批量替换未知属性语义。

提交词表变更时，请在 Pull Request 中说明：

- 数据来源与更新时间；
- 新增、修改或删除的词条数量；
- 至少一个实际 Mobalytics 攻略页验证结果。

## 问题反馈

反馈翻译遗漏时，请提供：

- Mobalytics 攻略页链接；
- 页面上的英文名称；
- 期望的简体或繁体译名；
- 出现位置，例如 Skills、正文、悬浮提示或特定 Build Variant。

请勿在 Issue 中提交账号、Cookie 或其他敏感信息。
