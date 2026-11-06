# PoE 攻略中文化 · Mobalytics 与 Maxroll

[![Validate extension](https://github.com/haharazer/mobalytics-poe-translate/actions/workflows/validate.yml/badge.svg)](https://github.com/haharazer/mobalytics-poe-translate/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Chrome / Edge Manifest V3 扩展，为 Mobalytics 和 Maxroll 的 PoE 1 构筑攻略提供简体、繁体和中英双语翻译。
开发版本：`0.6.3`。

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

- 支持 `https://mobalytics.gg/poe/builds/*` 和 `https://maxroll.gg/poe/build-guides/*`，含两站的 `www` 子域。
- 右下角「译」面板与工具栏弹窗同步语言、双语及六类独立开关。
- 支持动态提示、Build Variant 切换、React 复用节点与属性更新。
- 完整名称/句子匹配；属性匹配由客户端模板、条件和数值变换驱动，保留数值与范围。
- 支持拆分到多个相邻文本节点或内联 span 的说明与属性句子，保留原有节点并可无损恢复英文。
- 默认使用离线词库。可单独开启 LLM 翻译作者撰写的攻略正文。

### Maxroll 的正文和配装工具

Maxroll 将外层文章放在 `#main-article` 中，再按需挂载 Build Progression Tool。工具里的 Overview、Build Info、Leveling、Progression、FAQ 和作者自定义标签会切换或重建内容。点击一次「翻译本页正文」后，新显示的作者段落、优缺点、升级建议和里程碑说明会沿用本次翻译及缓存。两站共用语言、分类开关、API 配置和提示词。[示例攻略](https://maxroll.gg/poe/build-guides/poison-ranged-animate-weapons-league-starter)

技能、物品、天赋的内联链接和悬浮卡按本地规则匹配。工具按钮、配装评分、作者资料、更新日志、评论和相关推荐跳过 LLM。复制用的独立引号搜索表达式保留原样。天赋树图形和视频不做图像翻译。

## 启用攻略正文翻译

1. 点击扩展工具栏图标，打开「配置正文翻译」。
2. 填写兼容 Chat Completions 的 API 基址（如 `https://api.example.com/v1`）或完整端点、模型 ID 和 API Key。支持 HTTPS 和本机 HTTP 服务，本机免鉴权服务可留空密钥。
3. 点击「保存设置」，按提示授予 API 主机权限。打开攻略，选择简体或繁体，在页面右下角「译」面板或工具栏弹窗点击「翻译本页正文」。此后切换 Build Variants 或展开本页正文时会继续翻译，切回已读段落会复用缓存。刷新页面或打开另一篇攻略后需重新点击。需要跨攻略自动翻译时，勾选「自动翻译作者正文」并保存。
4. 如需调整风格，编辑同一设置页里的 PoE 1 翻译提示词并保存。「恢复默认提示词」可以找回内置版本。

正文先按段落查缓存，再将同一页的待译段落合并，每次请求共用一份提示词。每批最多 16 段，多段合计最多 6,000 个原文字符和 120 个排版片段，较长的段落单独处理。API 日志显示实际发送的段数，展开可查看服务商返回的输入和输出 token 用量（如有）。批量回复中格式正确的段落会分别缓存，重试时可直接复用。

译文保留链接和内联格式。手动和自动 LLM 翻译均跳过 Comments 评论区及其回复。已识别的整条游戏文本由本地词库处理，正文内匹配到的专名在本地回填。选择英文或关闭正文翻译会恢复原文。

在正文翻译设置中打开「缓存管理」可查看已用条数和上限，按时间分页浏览译文。新记录可展开查看待译片段、译文、目标语言、模型和写入时间。默认保留 2,000 条，可调整为 1 至 100,000 条。降低上限会立即移除超出的最早记录。

相同的待译内容、语言、端点、模型和提示词可跨刷新、跨攻略复用，多个标签同时请求相同内容时会合并请求。只切换双语显示或更换密钥可以沿用已有译文。

翻译失败时点击「查看 API 日志」，展开最近一次失败请求，查看 HTTP 状态、Content-Type、服务商请求 ID（如有）和失败响应预览。例如，HTTP 200 搭配 `text/html` 时，可查看返回的是登录页还是代理错误页。若失败阶段为「校验译文格式」，可检查返回的片段数量和术语占位符。日志仅记录实际发出的请求，保留最近 100 条。

## 安装、重载与版本

1. 在 Chrome 打开 `chrome://extensions/`，或 Edge 打开 `edge://extensions/`。
2. 打开开发者模式，点击「加载已解压的扩展程序」。
3. 本机开发请选择 **`C:\Users\hanpe\Desktop\mobalytics-translate-plugin`** 根目录。
4. 确认卡片版本为 `0.6.3`，刷新攻略页。

若先前从 ZIP 安装，要保留缓存与设置，请将新版文件覆盖到浏览器已加载的同一目录，点击原扩展卡片的「重新加载」，然后刷新攻略页。

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
语言、双语和类别开关通过浏览器同步存储保存。API 设置、密钥与正文缓存仅保存在当前浏览器。
见 [隐私说明](PRIVACY.md)、[贡献说明](CONTRIBUTING.md) 与 [MIT License](LICENSE)。
