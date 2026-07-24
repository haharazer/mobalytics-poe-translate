# Mobalytics PoE 中文化

[![Validate extension](https://github.com/haharazer/mobalytics-poe-translate/actions/workflows/validate.yml/badge.svg)](https://github.com/haharazer/mobalytics-poe-translate/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个面向 Chrome / Edge 的 Manifest V3 浏览器扩展。首版聚焦
Mobalytics 的 Path of Exile 1 攻略页，将技能石名称切换为简体中文、
繁体中文或中英双语。

当前发布版本：`0.1.0`

项目主页：<https://github.com/haharazer/mobalytics-poe-translate>

## 当前功能

- 覆盖 `https://mobalytics.gg/poe/builds/*`
- 以 812 条 PoE 1 三语词条为数据源（552 主动 + 260 辅助）
- 支持简体、繁体、双语和恢复英文
- 攻略页右下角提供可展开、可隐藏的快捷语言按钮
- 自动处理 Mobalytics 省略 `Support` 的辅助宝石名称
- 监听页面动态更新，切换 Build Variant 后自动翻译新内容
- 翻译文本节点以及 `title`、`aria-label` 中的精确技能石名称
- 不依赖 Mobalytics 的随机 CSS 类名

## 本地安装

可先从
[GitHub Releases](https://github.com/haharazer/mobalytics-poe-translate/releases)
下载最新发布包并解压，然后：

1. 打开 Chrome 的 `chrome://extensions`，或 Edge 的
   `edge://extensions`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本项目根目录。
5. 打开或刷新一个 Mobalytics PoE 1 攻略页。
6. 点击攻略页右下角的「译」按钮，选择简体、繁体、英文或双语显示；再次
   点击按钮、点击关闭按钮或按 `Esc` 可隐藏设置窗口。

修改扩展源码后，在扩展管理页点击本扩展的「重新加载」，再刷新攻略页。

## 词表更新

构建阶段以以下工作簿中的 552 条主动技能为校验基准：

`C:\Users\hanpe\Desktop\poe-trans-data\data\poe1\output\poe1_skill_gem_names_trilingual.xlsx`

辅助技能由同目录的 `gems_index.json` 补齐。生成器会校验 Excel 与完整索引中
主动技能的简体、英文、繁体名称完全一致，然后再输出全部 812 条词条。

在提供 `@oai/artifact-tool` 的 Codex 工作区运行：

```powershell
npm run build:data
```

生成结果为 `data/poe1-skill-gems.js`。扩展运行时不读取 Excel，也不需要
任何第三方依赖。

## 测试

```powershell
npm test
```

测试覆盖精确翻译、空白保留、繁体、双语、`Support` 缩写和英文恢复。

## 打包发布

在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

脚本只会把扩展运行时文件写入发布 ZIP，不会包含测试、构建脚本或源 Excel。
输出位于 `release/`，并同时生成 SHA-256 校验文件。

## 隐私

扩展只在 Mobalytics PoE 攻略页运行。语言设置通过浏览器同步存储保存；
扩展不会收集、上传或发送网页内容。

## 开源许可与贡献

本项目采用 [MIT License](LICENSE) 开源。贡献流程见
[CONTRIBUTING.md](CONTRIBUTING.md)。
