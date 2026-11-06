# Mobalytics PoE 中文化

[![Validate extension](https://github.com/haharazer/mobalytics-poe-translate/actions/workflows/validate.yml/badge.svg)](https://github.com/haharazer/mobalytics-poe-translate/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Chrome / Edge Manifest V3 扩展，为 Mobalytics 的 PoE 1 攻略详情页提供简体、繁体和中英双语翻译。
开发版本：`0.3.2`。

## 当前覆盖

| 内容 | 构建候选数 | 数据与边界 |
| --- | ---: | --- |
| 技能名称 | 812 | 保留既有词表、历史 overlay 与 Support 省略别名 |
| 主动技能描述 | 900 | ActiveSkills.Description 完整文本 |
| 辅助技能说明 | 180 | GemEffects.SupportText 与辅助宝石通用说明，包含共享说明的合并 |
| 装备/物品基底 | 3,635 | BaseItemTypes 名称 |
| 传奇物品名称 | 1,383 | UniqueStashLayout 引用 Words，按 Wordlist + HASH32 对齐 |
| 天赋名称 | 3,122 | 天赋、升华、专精类别等名称 |
| 词缀前后缀名称 | 3,658 | 装备相关 Mods.Name，与属性句子独立 |
| 属性显示规则 | 19,856 | 装备数值词缀、技能数值、天赋效果与专精选项；支持的 AST 子集 |

这些数字是词条/规则候选数，**不等于所有页面文字均可翻译**。同名异译、缺失语言、
不支持的指令和无法恢复原始 Stat 参数的句子保留英文。报告记录来源、冲突及跳过原因。

- 支持 `https://mobalytics.gg/poe/builds/*` 及 `www` 子域。
- 右下角「译」面板与工具栏弹窗同步语言、双语及六类独立开关。
- 支持动态提示、Build Variant 切换、React 复用节点与属性更新。
- 完整名称/句子匹配；属性匹配由客户端模板、条件和数值变换驱动，保留数值与范围。
- 支持拆分到多个相邻文本节点或内联 span 的说明与属性句子，保留原有节点并可无损恢复英文。
- 不使用随机 CSS 类名，不联网发送网页内容。

## 安装、重载与版本

1. 在 Chrome 打开 `chrome://extensions/`，或 Edge 打开 `edge://extensions/`。
2. 打开开发者模式，点击「加载已解压的扩展程序」。
3. 本机开发请选择 **`C:\Users\hanpe\Desktop\mobalytics-translate-plugin`** 根目录。
4. 确认卡片版本为 `0.3.2`，刷新攻略页。

若先前从 ZIP 安装，请将新 ZIP 解压到独立目录后加载，并关闭旧版本，避免两个扩展
同时替换文字。点击「重新加载」仍显示旧版本，说明浏览器加载的是另一份目录；
源码目录和 release 目录不是同一个安装目录。源码修改后需要重载扩展并刷新攻略页。

## 数据构建

已有名称领域包来自本机 `C:\Users\hanpe\Desktop\poe-client-data`：

- `dist/current/domains/localized-names/localized-names.v1.manifest.json`：基底、天赋与通用说明。
- `dist/demo/domains/affixes/affixes.v1.manifest.json`：固定的已发布词缀包，不自动选择其他版本。
- 名称 manifest 声明并通过大小与 SHA-256 校验的三语 `activeskills.csv`：临时主动说明适配器。

上游尚未发布 GemEffects、传奇名称与 stat-display-rules 的正式领域包。新增适配器使用
该项目已验证的 LibGGPK3/LibBundle3、冻结的 PoE1 schema，只读提取客户端资源至本项目
`.local/client-translation`，不修改客户端或上游项目。**这是隔离的临时消费者适配器，
不能当作上游稳定领域契约；正式领域包发布后应替换。**

先在独立进程中依次提取两个 channel，避免同时保留两份百万级索引：

```powershell
$poeRuntime = 'C:/Users/hanpe/Desktop/poe-client-data/work/pwsh-7.4.17/pwsh.exe'
& $poeRuntime -NoProfile -File scripts/extract_client_translation.ps1 -Channel International
& $poeRuntime -NoProfile -File scripts/extract_client_translation.ps1 -Channel Cn
npm run build:data
```

LibDat2 使用该项目验证的 PowerShell 7.4/.NET 8 运行时。提取脚本可指定
`-ClientDataRoot`、`-InternationalClient`、`-CnClient`、`-OutputDirectory`。GGPK、索引和
国服 bundle 使用只读流；自定义 bundle factory 拒绝创建或删除资源。原始提取文件不进入 Git
或安装包。每个 channel 的 manifest 保存 schema、资源原始哈希、导出哈希与容器快照信息。

生成器：

- `scripts/generate_skill_dictionary.mjs` → 原有 `data/poe1-skill-gems.js`。
- `scripts/generate_core_dictionary.mjs` → `data/poe1-core.js` 与来源/冲突报告。
- `scripts/generate_extended_dictionary.mjs` → `data/poe1-extended.js` 与规则诊断报告。

可分别运行 `npm run build:core`、`npm run build:extended`。
新生成器的输入根目录也可通过位置参数传入：

```powershell
node scripts/generate_extended_dictionary.mjs D:/snapshots/client-translation
```

旧技能投影仍使用 `data/poe1-skill-gem-keys.json` 与 `data/poe1-skill-gems.overlay.json`。
基底/天赋/主动描述沿用已有三语快照，国际服与国服版本存在差异；新增规则要求 Stat 元组、
命名规则标识和英文分支语义相符，才接入国服中文分支。不会用繁简转换填补缺失文本。

当前本机客户端存在自定义显示文本。例如传奇名称末尾带价格注记。生成器仅移除已识别的
末尾 `[数字c/d等字母]` 显示注记，报告保留原始输入哈希和处理数量；这批客户端文本不宣称为
未经修改的官方基线。属性规则读取国服 Simplified Chinese 块，不读取被替换的 French 块。

## 属性规则与页面适配

属性解析保留命名/非命名 description、Stat ID 元组顺序、语言、条件、占位符和变换。
运行时从英文显示值反推原始 Stat 数值，检查条件，再按目标语言的顺序和变换渲染。
支持 `#`、整数、闭合/开放区间与非零等排除条件；支持数值正负号、括号范围、重复参数
一致性、参数重排及明确的线性变换（negate、double、除十/百、毫秒到秒、每分到每秒）。
不支持的距离换算、枚举、复杂伤害变换、格式精度指令和客户端富文本会记录跳过原因。

品质范围允许触及零端点（如 `(0-10)% increased Cold Damage`），但不放过跨越正负分支的
范围。`data/mobalytics-stat-aliases.json` 显式记录实测的站点改写句式，并指向客户端 Stat ID
和原始模板；别名复用客户端翻译与条件，不单独手写中文属性句子。

上下文取自语义 section/header h2（真实页面使用 UUID），或明确的
`data-poe-category` / `data-poe-entity-id`。Skills 区域也允许显示装备基底名称。
同名词条无法消歧时保留英文；前后缀名称仅在明确装备/词缀区域匹配。

在验证页面 [Fubgun Winter Orb](https://mobalytics.gg/poe/builds/fubgun-winter-orb-elementalist) 中，
天赋图由 Canvas 绘制，树下核心天赋和专精选项是 DOM 文本。新规则已在真实页面确认这些
效果及传奇名称可翻译。图形本体不做像素替换；Canvas 悬浮提示若生成 DOM，则由同一动态
扫描处理。关闭的 Shadow DOM、WebGL 纹理或纯 Canvas 绘制的文字不在当前保证范围。

## 验证与打包

```powershell
npm test
npm run test:browser
npm run package
```

测试覆盖 AST 分支/版本对齐、数值逆变换、区间、参数重排、冲突、辅助说明、传奇名称、
实际 Winter Orb 核心天赋与专精选项、内联节点复用、独立开关、双语和无损英文恢复。
专注吟唱截图的消耗、伤害与品质数值效果也按实际格式器的相邻文本节点结构验证，
包含 React 修改单个数值片段、繁体双语及逐节点英文恢复。
浏览器回归使用独立临时配置，可设置 `BROWSER_PATH` 指定 Chrome/Edge/Chromium。

安装包和 SHA-256 位于 `release/`。报告、提取数据、脚本与测试不进入安装包。
语言、双语和类别开关通过浏览器同步存储保存；所有翻译在本地完成。
见 [隐私说明](PRIVACY.md)、[贡献说明](CONTRIBUTING.md) 与 [MIT License](LICENSE)。
