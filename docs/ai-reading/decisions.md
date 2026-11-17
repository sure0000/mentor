# AI 伴读：决策记录

需求见仓库根目录 `AI伴读-需求.md`。本文记录每阶段的设计取舍与对上游文件的修改，便于 `git merge upstream`。

## P1 Claude Code 后端（2026-11-15）

### 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | 流式用 `--include-partial-messages` 的 `stream_event / content_block_delta / text_delta`，不用 `assistant` 整条消息 | 实测 `assistant` 事件只在整段生成后出现，达不到「逐字出现」（FR-AI-02）。两者同时解析会重复，故只取 delta |
| D2 | 提示词经 **stdin** 传入，系统提示经 `--system-prompt` | 章节全文可能很长，命令行有长度上限；同时避免全文出现在 `ps` 里 |
| D3 | 子进程 `detached` 启动，取消时 `process.kill(-pid)` 结束整个进程组 | FR-AI-05 要求含子进程一起结束；实测取消后无残留 `claude -p` |
| D4 | 多轮对话由渲染进程拼成单个提示（按字数从近往远保留，默认 12000 字） | `--no-session-persistence` 下没有会话可续；顺带去掉了「只留 5 条」的限制（FR-QA-05 的简化版，完整版留到 P5） |
| D5 | 沿用现有 `aiAssistancePrompt` 模板（`{text}` = 选中文字或当前章节） | 与「自定义 AI」行为一致，P3/P5 再替换为全书上下文 |
| D6 | 后端以插件形式出现（key `claude-code-assistant-plugin`），只在 Electron 下注册 | 复用 popupAssist 已有的服务下拉框，切回其他服务行为不变（FR-AI-01） |
| D7 | 默认 5 分钟超时；单次花费上限 `--max-budget-usd` 预留参数，P1 未在 UI 暴露 | P4 全书分析时再接入预估与确认（FR-AI-06 后半） |

### 对上游文件的修改

| 文件 | 修改 |
| --- | --- |
| `main.js` | 引入 `claude-code-util`；新增 3 个 `ipcMain.handle`（`claude-code-check/chat/cancel`），位于 `dict-lookup` 之后的「AI 伴读」分区；`before-quit` 里 `cancelAll()` |
| `preload.js` | INVOKE 白名单 +3，EVENT 白名单 +1（`claude-code-delta`） |
| `src/store/useAppStore.ts` | `handleFetchPlugins` 中注册 Claude Code 插件（约 15 行） |
| `src/components/popups/popupAssist/component.tsx` | `handleDoAnswer` 分支到 `handleClaudeCodeAnswer`；停止按钮；耗时/花费显示；卸载时取消 |
| `src/components/popups/popupAssist/popupAssist.css` | `.popup-assist-usage` |
| `src/containers/settings/aiSetting/component.tsx` | 插入 `<ClaudeCodeSetting />`（1 行 + import） |
| `src/assets/locales/en.json`、`zh-CN.json` | 追加文案 |

### 新增文件

- `src/utils/main/claude-code-util.js`（主进程：定位、调用、解析、取消）+ 单测
- `src/utils/aiReading/claudeCode.ts`（渲染进程封装、错误文案、对话拼装）+ 单测
- `src/components/aiReading/claudeCodeSetting/`（设置项：路径、模型、检测）

### 已知事项

- `src/utils/main/dict-reader.test.ts` 有 1 个用例在基线 `28809dd5` 上即失败，与本改动无关。
- 本机 Node 26 下 Electron 安装需手动解压（见 README 外的会话记录），不影响代码。

## P2 全书文本提取与索引（2026-11-15）

### 方案验证

测试书：自建中文 EPUB（24 章，6.7 万字）、自建嵌套目录 EPUB（10 个文档，含封面/版权页/注释等非目录项）、Project Gutenberg《Alice》TXT（7 万字）、arXiv《Attention Is All You Need》PDF（15 页）、自建大 TXT（120 章，54 万字）。

| 方案 | 结论 | 依据 |
| --- | --- | --- |
| 1a 主页面里再建一个离屏 rendition | ❌ 不可行 | `renderTo` 永不返回（无报错）。容器 id 改成 `page-area` 才能渲染，说明引擎按 id 查找文档里的 `#page-area`，与阅读器的实例冲突，会干扰阅读 |
| 1b 放进 shadow root | ❌ | 同样卡住 |
| **1c 独立同源 iframe（`extractor.html`），在其中重新加载引擎** | ✅ **采用** | 独立 document 无冲突；EPUB / TXT / PDF 全部章节可取；对阅读器位置零影响（提取前后 `getPosition()` 完全一致）；localStorage 无写入 |
| 2 按格式自行解析 | 未实施 | 1c 已覆盖引擎支持的全部可文本化格式，不必另写解析器 |

### 实测数据（方案 1c）

| 书 | 文档数 / 目录项 | 字数 | 耗时 | 备注 |
| --- | --- | --- | --- | --- |
| 中文 EPUB | 24 / 24 | 67,583 | 0.18 s | 段落换行保留 |
| 嵌套目录 EPUB | 10 / 7 | 1,501 | 0.07 s | 封面、版权页、注释被识别为非目录项 |
| Alice TXT | 7 / 6 | 71,341 | 0.18 s | 与原文 71,037 字吻合（差值为换行规范化） |
| Attention PDF | 15 / 9（目录 22 项） | 39,334 | 0.96 s | PDF 以页为单位，无段落换行 |
| 大 TXT | 120 / 120 | 543,375 | 0.22 s | FR-IDX-05 的规模 |
| 第二次打开（缓存） | — | — | ≤ 5 ms | FR-IDX-03 |

### 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D8 | 用方案 1c：`extractor.html` + `src/utils/aiReading/extractor/entry.ts`，主页面通过 postMessage 传书籍字节（transfer，不复制） | 见上 |
| D9 | 按 `getChapterDoc()` 文档（而非 `flatChapter` 目录项）切分；跳转用 `goToPosition({chapterDocIndex})` | 实测 `goToChapterIndex(i)` 在 TXT/PDF 下是 1 基且末尾越界报错，EPUB 下 0 基；`goToPosition` 按文档下标在三种格式下一致。目录项是文档的子集（PDF 的目录项可能落在同一页） |
| D10 | 文本优先取渲染后 iframe 的 `innerText`，不足时退回 `chapterText()` | 引擎 `chapterText()` 在 EPUB 下丢失段落换行，后续检索/引文核对需要段落；PDF 下 DOM 为空，退回引擎文本 |
| D11 | 非目录文档的标题取正文首行（≤40 字）；`getPosition().chapterTitle` 只作兜底 | 引擎会让「注释」继承前一章的标题 |
| D12 | 缓存为 JSON：`<数据目录>/ai-reading/<bookKey>/index.json`，按 `bookKey + md5 + size + 版本号` 失效（FR-DATA-01 选 JSON 文件） | 易检查、易删除；不需要新增数据库表和 IPC |
| D13 | 打开「本书导读」时若无缓存则自动在后台提取 | 提取不调用 AI、不花钱，且普通书 < 1 秒 |
| D14 | 漫画（CBR/CBZ/CBT/CB7）、DJVU、扫描版 PDF 不提取，界面说明 | 无文本层 |
| D15 | 位置信息只到章节（文档）级；段落级定位留到 P3/P5 引文核对时用「章节 + 原文短引」实现 | 需求允许「至少到章节」 |

### 对上游文件的修改（P2 新增）

| 文件 | 修改 |
| --- | --- |
| `vite.config.mts` | `rollupOptions.input` 增加 `extractor.html` |
| `src/components/popups/popupAssist/component.tsx` | 第三个页签「本书导读」（仅 Electron）；三个页签在停靠模式下改为 `flex: 1` |
| `src/components/dialogs/deleteDialog/component.tsx` | 彻底删除书籍时调用 `clearBookAiCache`（FR-DATA-02） |
| `src/assets/locales/en.json`、`zh-CN.json` | 追加文案 |

### 新增文件（P2）

- `extractor.html`、`src/utils/aiReading/extractor/{entry,protocol}.ts`
- `src/utils/aiReading/indexText.ts`（纯逻辑 + 单测）、`bookIndex.ts`（构建/缓存/清除）、`readerAdapter.ts`（rendition 适配层）
- `src/components/aiReading/bookGuide/`

### 未覆盖 / 已知限制

- 只用了公开样书和自建书验证，**用户自己的真书尚未测试**。
- MOBI/AZW3/DOCX/FB2 等格式走同一条引擎路径，理论上可用，未逐一实测。
- 提取一次性在内存中完成；54 万字 TXT 仅 0.2 s，未做断点续提（FR-IDX-05 的「可中断」通过「取消」实现）。

## P3 本章要点（2026-11-15）

### 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D16 | Claude Code 走 `--json-schema` 结构化输出（`result.structured_output`）；自定义 OpenAI 兼容服务把 Schema 写进提示词、从回答中提取 JSON | 实测 `--tools ""` 下 `--json-schema` 仍可用；两个后端都能生成要点 |
| D17 | 每条要点 / 概念必须带「原文短引」；程序在**本章**原文中核对，规范化后（去空白与常见标点、NFKC、小写）做子串匹配；短于 4 字视为未定位 | FR-SUM-05：不采信模型自述。规范化避免把引号/空格差异误判为编造 |
| D18 | 未定位的引文以橙色 ⚠ 标注「未在原文中定位到」，并在底部统计条数；不自动删除 | 让用户自己判断，而不是悄悄丢弃 |
| D19 | 单章正文超过 30,000 字时截断并在界面注明 | 控制单次花费（实测 3k–11k 字的章节约 $0.0025） |
| D20 | 缓存：`ai-reading/<bookKey>/points/<docIndex>.json`，含章节文本指纹；文本变了自动失效。「重新生成本章」覆盖缓存 | FR-SUM-06 |
| D21 | 入口放在 P2 的「本书导读」页签：顶部「正在读：xx」一键进入本章要点；列表点章节进入要点，右侧小图标才是跳转 | FR-SUM-01（不新建页面）；FR-SUM-02（只点本章只调用一次） |
| D22 | 当前章节跟随阅读位置，通过 `readerAdapter.onReaderPositionChange`（`page-changed` / `rendered` 事件） | 所有 rendition 调用仍集中在适配层 |

### 实测

| 章节 | 字数 | 模型 | 耗时 | 花费 | 引文核对 |
| --- | --- | --- | --- | --- | --- |
| 测试书 第 7 章（中文） | 2,807 | haiku | 13.6 s | $0.0024 | 10/10 定位 |
| Alice CHAPTER I（英文） | 11,523 | haiku | 17.3 s | $0.0024 | 10/10 定位 |
| 人为构造的假引文 | — | — | — | — | 正确标为未定位；改了空格/标点的真引文仍判为定位 |

- 生成中途取消：返回 `cancelled`，无残留 `claude -p` 进程。
- 在真实阅读器里走了一遍界面：「正在读」随翻页更新 → 生成 → 显示要点/概念/引文/花费 → 返回列表后该章显示「✓ 要点」。

### 对上游文件的修改（P3 新增）

| 文件 | 修改 |
| --- | --- |
| `main.js` | `claude-code-chat` 新增可选 `schema` 参数（校验为对象） |
| `src/assets/locales/en.json`、`zh-CN.json` | 追加文案 |

### 新增文件（P3）

- `src/utils/aiReading/chapterPoints.ts`（提示词、Schema、引文核对，+ 单测）、`chapterPointsService.ts`（生成、缓存、双后端）
- `src/components/aiReading/chapterPoints/`
- `src/utils/main/claude-code-util.js` 增加 `--json-schema` 支持

## P4 全书导读（2026-11-15）

### 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D23 | **先章后书**：逐章复用/生成 P3 的章节要点，再用一次调用把所有章节要点汇总为导读；汇总只看要点，不再发送全文 | FR-SUM-02；汇总调用很便宜（实测 $0.003–0.005） |
| D24 | 断点续跑不另存任务状态：每章要点生成即落盘，「继续」= 重新开始任务并跳过已有缓存的章节 | 暂停、关闭面板、退出应用后都能续上，且不会重复花钱（FR-SUM-07） |
| D25 | 任务状态放在模块级（`bookGuideService`），关闭面板不中断；同一时间只跑一本书 | 后台执行；控制花费 |
| D26 | 开始前用确认框给出：章节数（已完成几章）、调用次数、发送字数、花费区间。区间按「小模型～大模型」粗估 | FR-SUM-07 / FR-AI-06。实测 Alice 7 章：预估 $0.03–0.65，实际 haiku $0.020 |
| D27 | 正文 < 200 字的文档（封面、版权页、空白页）不参与全书分析；没有可分析章节时直接提示，不调用 AI | 避免对空内容花钱（实测空书会产生一次无意义的汇总） |
| D28 | 模型输出的章节 id 只接受索引中存在的；漏掉的章节用该章要点的「问题」补齐；概念的首次出现章节无效时显示「—」 | 不采信模型自述的结构；保证章节地图完整、可跳转 |
| D29 | 「核心 / 可略读」与阅读建议要求给依据，没有依据就留空；`reason` 只在有 `advice` 时保留 | FR-SUM-04「有依据才给」 |
| D30 | 按正文粗判书的语言（汉字占比），在提示词末尾明确作答语言 | 实测只写「用原书语言」时模型会中英混杂 |
| D31 | 任一章节要点被重新生成后，导读标注「部分章节要点已更新」并提供「更新导读」（只需 1 次汇总调用） | 导读与要点保持一致 |
| D32 | 读完一章提示（FR-SUM-08）：只在向后翻到紧邻的下一章时触发；默认关闭，在「设置 > AI」开启；点提示打开该章要点 | 跳转、回翻不打扰 |

### 实测（Alice TXT，7 章，haiku）

- 确认框：7 章 / 8 次调用 / 71k 字 / 预估 $0.03–0.65。
- 第 1 章完成后暂停 → 状态「已暂停 1/7」，无残留 `claude -p` 进程；预估变为「已完成 1 章，7 次调用」。
- 继续 → 逐章 2/7 … 7/7 → 汇总 → 完成，共 $0.020；关闭面板期间任务继续，列表顶部显示「生成中 n/7」。
- 只重新生成导读：复用 7 章缓存，1 次调用，$0.0047。
- 章节地图、概念「首次出现」都可点击跳转（实测跳到 docIndex 2、5）。
- 读完一章提示：关闭时不提示；开启后从第 2 章翻到第 3 章出现「已读完 CHAPTER II. · 看看本章要点？」，点击后打开第 2 章要点。

### 对上游文件的修改（P4 新增）

| 文件 | 修改 |
| --- | --- |
| `src/pages/reader/component.tsx` | 挂载 `<ChapterEndPrompt />`（1 行 + import） |
| `src/components/popups/popupAssist/component.tsx` | 外部请求打开导读时切到导读页签（订阅 `guideNav`） |
| `src/assets/locales/en.json`、`zh-CN.json` | 追加文案 |

### 新增文件（P4）

- `src/utils/aiReading/bookGuide.ts`（预估、提示词、Schema、结果整理，+ 单测）、`bookGuideService.ts`（后台任务、暂停/继续、缓存）、`guideNav.ts`
- `src/components/aiReading/bookOverview/`、`chapterEndPrompt/`
- `chapterPointsService.ts` 抽出 `runStructured`（两个后端的结构化调用）；章节要点与导读都按书的语言作答

## P5 全书问答（2026-11-15）

### 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D33 | 在现有 popupAssist 的「AI 问书」页签上增强，不另起界面；选了 Claude Code 或自定义 AI 时走全书问答，官方 AI 与「AI 助手」页签行为不变 | 需求 §5.4「不另起一套」；对上游改动集中在一个分支函数 `handleBookQaAnswer` |
| D34 | 上下文 = 选中文字 + 当前章（≤12k 字）+ 全书检索片段（≤6k 字、≤8 段、每章 ≤3 段）。实测单次约 $0.002（haiku） | FR-QA-01；需求 §7 单次 ~$0.05 以内 |
| D35 | 检索不引入向量库：章节按段切（约 600 字，PDF 整页按句切）→ 检索词（英文去停用词；中文去疑问/虚词后取 2–4 字滑窗；引号内容为强检索词）→ 稀有度加权打分，多词同时命中加成，章节要点命中再加权 | 需求 §3.2 不做向量库；实测 5 个跨章问题均检索到正确章节 |
| D36 | 回答仍是流式纯文本。约定标记：书外补充包在 `[[补充]]…[[/补充]]`，末尾 `<sources>` 块每行「片段号 \| 原文短引」；流式显示时隐藏出处块 | FR-QA-02/03 且保持逐字出现（FR-AI-02） |
| D37 | 出处由程序核对：先在被引用的片段里找，找不到再在全部上下文里找（模型常把编号写错）；都找不到标「⚠ 未在原文中定位到」，不可点击；没有出处时显示「未给出出处，请谨慎参考」 | 与 FR-SUM-05 一致，不采信模型自述 |
| D38 | 点出处用引擎的全书搜索定位短引所在段落（`jumpToQuote`，取同一章的命中），搜不到退回章节开头并提示 | 实测可跳到段落，可见区域含短引原文；比 P2 的「只到章节」更精确 |
| D39 | 片段编号只对当次提问有效：展示与写入历史前去掉正文里的 `[P1]` 标记，系统提示明确不要据旧编号「更正」旧回答 | 实测模型曾因上一轮的编号与本轮不同而错误「更正」自己 |
| D40 | 作答语言跟随提问语言（中文问中文答），短引保持原文语言 | 实测英文书用中文提问时的用户预期 |
| D41 | 历史按字数截断（最近 8k 字全文），更早的只保留用户问题列表作为摘要 | FR-QA-05 |
| D42 | 防剧透开关放在问书页签输入框上方（`isAiSpoilerSafe`），开启后只检索当前文档之前的章节，并告知模型不要透露后文 | FR-QA-04；实测在第 2 章问第 6 章的柴郡猫，开启时拒绝透露，关闭时引用第 6 章作答 |
| D43 | 没有全书索引时退化为「当前章节」，并在回答下方注明；界面提示「打开一次本书导读即可启用全书问答」 | 提取不花钱，但不在用户没打开导读时偷偷运行 |
| D44 | 出处随消息保存在原有的 `aiAskHistory` 中（`AiChatMessage.sources` 可选字段） | FR-QA-06；旧消息无该字段，按原样渲染 |

### 实测（Alice TXT，haiku，从第 6 章提问）

| 问题 | 结果 | 花费 |
| --- | --- | --- |
| 在哪里喝了会变大小的东西、标签是什么 | 第 1 章「DRINK ME」与第 4 章无标签的瓶子，3 条出处均核对通过；点出处跳到第 1 章，可见区域含该句 | $0.0024 |
| 如何遇见毛毛虫、给了什么 | 书中部分如实说明片段未提及，蘑菇的情节放在「AI 补充」里 | $0.0022 |
| Caucus-race 是什么、谁提议 | 渡渡鸟提议，出处 2/2 通过；规则细节归入「AI 补充」 | $0.0021 |
| 作者在哪几处写到 Dinah（中文问） | 中文作答，列出第 1–4 章 8 处，6 条出处全部通过 | $0.0029 |
| 出版年份、作者职业（书中没有） | 明确说原文未提及，全部内容放在「AI 补充」，无出处并提示谨慎参考 | $0.0019 |

### 对上游文件的修改（P5 新增）

| 文件 | 修改 |
| --- | --- |
| `src/components/popups/popupAssist/component.tsx` | `handleDoAnswer` 分支到 `handleBookQaAnswer`；消息带 `sources` 时用 `QaAnswer` 渲染；流式时隐藏出处块；防剧透开关与索引提示 |
| `src/components/popups/popupAssist/popupAssist.css` | `.popup-assist-qa-options` |
| `src/assets/locales/en.json`、`zh-CN.json` | 追加文案 |

### 新增文件（P5）

- `src/utils/aiReading/retrieval.ts`（切段、检索词、打分）、`bookQa.ts`（提示词、出处解析与核对、正文分段）+ 单测、`bookQaService.ts`
- `src/components/aiReading/qaAnswer/`
- `readerAdapter.ts` 新增 `jumpToQuote`

### 已知限制

- 检索基于字面命中：问题用词与原文差异很大（同义改写、跨语言提问）时可能检索不到，此时回答会说明「给出的片段没有提到」。英文书用中文提问时，主要依赖当前章节和章节要点。
- 自定义 OpenAI 兼容服务拿不到花费，只显示耗时。

## 去除 Pro / Koodo 官方服务（2026-11-16）

用户要求：二开版本不依赖 Koodo 官方服务器，Pro 相关能力按新需求重新实现或删除。用户选择：
AI 类统一走用户选的 AI 后端；云同步只保留 iCloud；官方 TTS 改接自定义接口。

### 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D45 | 新增统一 AI 网关 `aiGateway.ts`：按用途（translate / dict / assistance）解析后端，优先「模型分配」里指定的自定义模型，其次 Claude Code（选为 AI 服务时），再次任意已保存的自定义模型，桌面端最后兜底 Claude Code | 一处决定「用哪个 AI」，替代散落各处的 `isAuthed` 判断 |
| D46 | `request/reader.ts` 保留原函数名与 `{ code, data }` 返回结构，内部改走网关 | 调用方（翻译、词典、整页翻译、多角色朗读、书名识别）几乎不用改，降低回归面 |
| D47 | 原 `official-ai-*` 插件 key 保留，显示名改为「AI 词典 / AI 翻译 / 自定义 TTS」 | 兼容用户已保存的 `dictService` / `transService` / `voiceEngine` 选择 |
| D48 | 官方 AI 助手插件删除 | AI 助手已有 Claude Code 与自定义 AI，两者覆盖其能力 |
| D49 | 元数据检索改用 Open Library 公共接口（免 Key） | 元数据是事实查询，AI 会编造 ISBN / 出版社；Open Library 有封面与评分 |
| D50 | 单词释义（Word definition）从界面移除 | 结果由闭源引擎 `handleWordDefinitionResult` 渲染，数据结构不可见（AGENTS.md 禁止读取引擎），无法可靠重实现 |
| D51 | 自定义 TTS 走 OpenAI 兼容 `/audio/speech`，配置存 `customTtsConfig`；音色列表由用户填写；未配置时不注册该插件 | OpenAI、openai-edge-tts、kokoro-fastapi 等都兼容；不再有官方额度 |
| D52 | 官方云 OCR 删除；旧配置 `official-ai-ocr` 读取时回落到本地默认引擎（扫描版 Paddle，其余系统 OCR） | 本地引擎已覆盖 |
| D53 | 云同步只保留 iCloud。数据源配置以明文 JSON 存 `TokenService`（主进程 safeStorage 加密落盘），不再经服务器加解密 | 其余网盘依赖 Koodo 服务器 OAuth 中转与令牌加密 |
| D54 | iCloud 目录改为 `iCloud Drive/Koodo Reader`（自动创建）；若存在官方 iOS 容器目录则沿用 | 不再依赖官方 iOS App 先创建容器 |
| D55 | 启动时 `removeUnsupportedSyncSources()` 一次性清理已删除的数据源与 Koodo Sync 开关；旧服务器加密的 iCloud 令牌解析失败时返回 410，需重新绑定 | 避免旧配置导致同步报错 |
| D56 | 删除账号体系：登录页、账号设置、Pro 订阅弹窗、更新弹窗、客服聊天窗、通知、问题反馈上报、Koodo Sync | 全部依赖 Koodo 服务器 |
| D57 | 关闭在线更新检查与 Windows 自动下载安装包 | 会把二开版本升级回上游版本 |
| D58 | 字体 / 背景 / 词典 / OCR 模型的下载镜像只按地区选择，不再与登录绑定 | 原逻辑只给登录用户用国内镜像 |
| D59 | 有 iCloud 数据源时启动即自动同步（原先需登录 Pro 才会触发） | |

### 对上游文件的修改

| 范围 | 文件 |
| --- | --- |
| 重写 | `src/utils/request/reader.ts`、`src/utils/request/thirdparty.ts` |
| 删除 | `src/utils/request/user.ts`、`src/pages/login/`、`src/containers/settings/accountSetting/`、`src/components/dialogs/{supportDialog,updateDialog,importDialog}/`、`chat-preload.js` |
| 去掉官方分支 | `popupAssist`、`popupDict`、`popupTrans`、`textToSpeech`、`studyLangDialog`、`convertDialog`、`editDialog`、`metadataDialog`、`importLocal`、`pageWidget`、`viewer`、`pages/reader`、`pages/manager`、`header`、`sidebar`、`settingDialog`、`syncSetting`、`readingSetting`、`aboutSetting`、`router` |
| 同步链路 | `utils/common.ts`（`getICloudDrivePath`、`prepareThirdConfig`、`isTokenExpired`，删除 `resetKoodoSync` / `handleAutoCloudSync`）、`utils/file/{common,configUtil,bookUtil,coverUtil}.ts`、`constants/driveList.tsx`、`constants/settingList.tsx` |
| 状态 | `useAppStore.ts`：删除 `isAuthed`、`userInfo`、`isShowSupport`、`isShowNew`、`loginOptionList` 及对应 action；插件注册改为 AI 词典 / AI 翻译 / 自定义 TTS |
| 主进程 | `main.js` 删除 `new-chat`、`chat-message`、`check-cloud-url`、`update-win-app`、`cancel-download-app`；`preload.js` 白名单同步删除；`package.json` 打包清单去掉 `chat-preload.js` |

### 新增文件

- `src/utils/aiReading/aiGateway.ts`、`customTts.ts` + 单测 `aiGateway.test.ts`、`backendAndSync.test.ts`
- `src/components/aiReading/customTtsSetting/`

### 已知限制

- 单词释义暂不可用（D50）。
- 网页版无云同步（iCloud 只在 macOS 桌面端）。
- 旧版本用 Koodo 服务器加密的 iCloud 绑定需要在设置里删除后重新添加。

## 伴读：阅读分级与重点划线（2026-11-16）

用户需求：点击后生成本书的重点划线，标注哪些内容略读 / 浅读 / 精读；精读部分可再选「知识关联 / 拓展阅读 / 辅助阅读」；支持按章节或全书渲染。

### 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D60 | 章节先切成带编号的段落（按换行，超长段按句切到约 400 字，总量受 `MAX_CHAPTER_CHARS` 限制），模型只回答「段落区间 → 级别」与「重点原句 + 段落号」 | 分级靠编号落到原文，不依赖模型复述原文；输出短、便宜 |
| D61 | 程序整理区间：排序、裁剪越界、去重叠，漏掉的段落补为「浅读」（`auto`）；重点原句沿用 D17 的规范化核对，编号写错时在全章重找，找不到标 ⚠ 且不在书页划线 | 不采信模型自述的结构（同 D28 / D37） |
| D62 | 书页渲染用 CSS Custom Highlight API（`::highlight`）：略读 = 文字变灰，精读 = 浅黄底，重点句 = 红色下划线；浅读不加样式 | 不改书籍 DOM，不影响引擎分页、已有高亮笔记、选区与 TTS；Electron 35 支持 |
| D63 | 段落在页面上的定位：规范化页面文本建立「字符 → 文本节点」映射，按顺序整段匹配，失败时用段首/段尾各 24 字定位 | 页面文本与提取文本有空白/标点差异 |
| D64 | 渲染范围设置 `aiReadingMarksScope`：全书（默认，所有已生成的章节都标）/ 仅本章（面板打开的章节，未打开时为正在读的章）/ 关闭 | 需求「按章节或全书来渲染」 |
| D65 | 全书伴读 = 逐章任务，与全书导读同样的预估确认、暂停/继续、每章落盘；没有汇总调用 | 复用 D24–D26 |
| D66 | 精读的进一步功能复用全书问答：把该精读区间作为「选中文字」交给 `prepareQa`（当前章 + 全书检索），回答带出处核对；结果存在该章 marks 的 `extras`，重新生成分级时保留区间未变的结果 | 知识关联需要跨章检索；出处可跳转；不重复花钱 |
| D67 | 入口：AI 面板新增「伴读」页签；在书页点击精读段落弹出三项功能，点选后打开面板并运行 | 不新建页面；不用另记位置 |
| D68 | 缓存 `ai-reading/<bookKey>/marks/<docIndex>.json`，按章节文本指纹失效；删书 / 「清除本书 AI 缓存」已覆盖该目录 | 同 D20 |

### 对上游文件的修改

| 文件 | 修改 |
| --- | --- |
| `src/components/popups/popupAssist/component.tsx` | 第四个页签「伴读」；`isPanelMode` 让导读与伴读都隐藏问答输入区；订阅书页点击请求切换页签 |
| `src/pages/reader/component.tsx` | 挂载 `<ReadingMarksLayer />`（1 行 + import） |
| `src/utils/aiReading/bookGuide.ts` | `estimateGuideCost` 增加可选参数 `withSummary` |
| `src/assets/locales/en.json`、`zh-CN.json` | 追加文案 |

### 新增文件

- `src/utils/aiReading/readingMarks.ts`（切段、提示词、Schema、区间整理、原句核对、定位）+ 单测 `readingMarks.test.ts`
- `src/utils/aiReading/readingMarksService.ts`（生成、缓存、全书任务、精读功能、渲染范围与面板导航）
- `src/utils/aiReading/marksRenderer.ts`（书页 Highlight 渲染、点击命中）
- `src/components/aiReading/{readingCompanion,chapterCompanion,readingMarksLayer}/`

### 已知限制

- 尚未在真书上实测（界面与渲染需用户在 `yarn dev` 中验证）。
- 原生 PDF 以页为单位渲染，段落切分按句，定位精度低于 EPUB/TXT。
- 若引擎在渲染后替换文本节点（如重新渲染笔记），已画的区间可能失效，翻页或切换范围后会重画。

## 去除官网 Logo 与跳转链接（2026-11-16）

| # | 决策 | 理由 |
| --- | --- | --- |
| D69 | 删除侧边栏 Koodo Logo（点击跳官网）；删除「关于」页的文档、FAQ、支持、快捷键、网页版、官网、反馈邮箱、翻译、GitHub 入口，以及已失效的「更新通道」选择 | 二开版本不再指向上游官网；在线更新已关闭（D57） |
| D70 | 删除设置里指向官网教程的链接：同步「如何填写」「如何跨设备同步」、第三方数据源弹窗「教程」、插件「文档 / 在线版本 / 教程」；插件「如何自定义插件」（GitHub）一并删除 | 同上 |
| D71 | 网页版浏览器扩展提示的「安装扩展」按钮改为「取消」；词典「了解更多」只在词典本身提供链接时可点（不再兜底到官网）；Discord 状态去掉「Get Koodo Reader」按钮；`index.html` 去掉官网 dns-prefetch | 同上 |
| D72 | `common.ts` 删除 `WEBSITE_URL` / `WEB_APP_URL` / `getWebsiteUrl` / `getWebAppUrl` / `getWebsiteLang` | 防止以后再引用 |

### 保留（有功能依赖或需要用户提供素材）

- `storage.koodoreader.com/.cn`：字体、背景图、词典、OCR 模型的下载源。删掉这些功能就不能下载资源，需自备镜像后替换。
- `src/components/footer`：只在网站 `web.koodoreader.cn` 上显示备案信息，桌面版不会渲染。
- 产品名「Koodo Reader」（窗口标题、托盘、`package.json` 的 `productName`、导出文件名 `KoodoReader-*`、`koodo-reader://` 协议）与应用图标（`assets/icons` 等）：改名会改变用户数据目录与协议注册；换图标需要新的图标素材。
- Discord Rich Presence 仍使用上游注册的 Discord App ID（图标 `koodo_reader_logo` 由该 App 提供）。
- 原项目为 AGPL-3.0：分发修改版需保留 LICENSE 与版权声明并提供源码；去掉界面上的 Logo 与链接不违反该许可。

## 品牌更名为 Mentor（2026-11-16）

| # | 决策 | 理由 |
| --- | --- | --- |
| D73 | 产品名 Mentor；`productName`/`appId`/协议/安装器/AppX 全部改名，去掉上游的 GitHub 发布配置 | 全新定位的独立项目 |
| D74 | 图标：一本摊开的书，书页轮廓构成字母 M，上方一颗引路星；深青底 + 米白 + 金色。由 `scripts/gen-brand.py` 生成全部尺寸（png / ico / icns / AppX / 侧边栏标记） | 呼应「导师 / 伴读」；脚本化便于调整配色后重新生成 |
| D75 | 侧边栏顶部为标记 + 文字「Mentor」（文字用 CSS，随主题变色） | 位图文字在深浅主题下都不清晰 |
| D76 | 用户数据目录随 `productName` 变为 `<appData>/Mentor`：主进程启动最早期把旧 `koodo-reader` 目录改名过来；若新目录只是没有书库的空壳则先挪到 `Mentor-empty-*` | 改名会丢书库，必须迁移 |
| D77 | 渲染进程保存了绝对路径 `storageLocation`；`getStorageLocation` 发现它是旧的默认路径时改写为新路径（用户自选目录不动） | 否则数据仍写回旧目录 |
| D78 | 深链接改为 `mentor://`，主进程同时接受旧的 `koodo-reader://`；iCloud 同步目录 `Koodo Reader` 首次使用时改名为 `Mentor` | 兼容已复制出去的链接与已同步的数据 |
| D79 | 文案中的 Koodo / Koodo Reader 统一替换为 Mentor（41 种语言，仅改译文值不改 key）；提到真实目录名 `KoodoReader/` 的文案保留目录名 | 云端数据源目录名由闭源引擎决定，不能改 |
| D80 | README 重写，删除其余语言版本；保留对 Koodo Reader 与 AGPL-3.0 的署名 | 许可证要求 |

### 保留

- 云端数据源里的 `KoodoReader` 目录名、数据库与配置键名：由闭源引擎 `kookit` 决定，改名会读不到已有的云端数据。
- `package.json` 的 `name` 改为 `mentor` 不影响数据目录（由 `app.setName("Mentor")` 与 `setPath("userData")` 决定）。
