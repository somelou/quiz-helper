# Quiz Helper 当前页面结构清单与主要内容

本文档用于帮助后续 AI 或开发者快速理解 `quiz-helper` 当前的页面入口、页面结构、主要交互、关键脚本与维护落点。

> 说明：本文档描述的是**当前代码实际状态**（对应 `src/manifest.json` 版本 `3.1.0`），不是理想目标状态。

## 1. 项目界面入口总览

当前插件的可见界面主要有 3 类：

1. `popup` 弹窗页
   - 文件：`src/popup/popup.html` + `src/popup/popup.js` + `src/popup/popup.css`
   - 作用：从浏览器工具栏打开，负责触发当前页面分析、打开设置页、显示快捷键信息、切换主题、快捷切换答题模型

2. `options` 设置页
   - 文件：`src/options/options.html` + `src/options/index.js` + `src/options/options.css`
   - 作用：负责大模型管理、联网搜索设置、快捷键、域名白名单、解析规则管理、题库管理、历史记录管理、备份与恢复、关于
   - 采用侧边导航 + 滚动内容布局，含 8 张卡片与 1 个通用详情抽屉

3. `content` 注入面板
   - 文件：`src/content/index.js` + `src/content/state.js` + `src/content/dom-parser.js` + `src/content/panel-ui.js` + `src/content/analyzer.js` + `src/content/panel.css`
   - 作用：注入到目标网页中，负责提取题目、展示题目卡片、调用后台分析答案、AI 选区解析、题库匹配展示

此外还有 1 个不可见的后台服务：

1. `background` 后台服务
   - 文件：`src/background.js` + `src/background/*.js`
   - 作用：作为消息中转和 AI 能力服务层，负责答题请求、题库解析、题库检索、AI 选区抽题、联网搜索代理、DNR 网络层拦截

## 2. 目录结构速览

当前仓库中，插件运行目录位于 `src/`，核心结构如下：

```text
quiz-helper/
├── src/
│   ├── background/                # 后台逻辑模块
│   │   ├── index.js               # 后台入口（webSearch 独立监听 + 路由注册）
│   │   ├── router.js              # 消息路由（onMessage + onConnect port 通道）
│   │   ├── api-client.js          # LLM API 调用（三格式统一分发 + 流式/非流式，复用 llm-utils）
│   │   ├── prompt-builder.js      # 提示词构建
│   │   ├── json-parser.js         # JSON 响应解析与题型归一化
│   │   ├── question-bank.js       # 题库解析（含分批）与相似题检索
│   │   ├── search-proxy.js        # 联网搜索代理（Brave/豆包/Tavily）
│   │   ├── search-usage.js        # 每月搜索次数限额检查与递增（共用）
│   │   └── webrequest-interceptor.js  # DNR 拦截器（注入认证头/规避 CORS 预检）
│   ├── content/                   # 内容脚本主逻辑与面板样式
│   │   ├── index.js               # 编排入口
│   │   ├── state.js               # 共享可变状态与 content 专用常量
│   │   ├── dom-parser.js          # DOM 题目提取
│   │   ├── panel-ui.js            # 面板生命周期 + 拖拽 + 卡片渲染（含流式/思考区）
│   │   ├── analyzer.js            # 分析控制 + AI 选区解析 + AI 作答流程
│   │   └── panel.css              # 面板样式
│   ├── data/                      # 静态 JSON 数据（默认解析规则、提示词模板）
│   ├── icons/                     # PNG/SVG 图标资源
│   ├── lib/                       # 第三方库（xlsx、mammoth、marked、katex）
│   ├── options/                   # 设置页主逻辑与样式
│   │   ├── options.html           # 设置页 HTML
│   │   ├── options.css            # 样式
│   │   ├── index.js               # 协调层（主题 + 导航 + 滑块 + 抽屉 + 迁移 + 装配）
│   │   ├── utils.js               # 共享工具（分页、文本清洗、文件读取）
│   │   ├── shortcut-section.js    # 快捷键管理
│   │   ├── config-section.js      # 基本配置管理（提示词分题型 tab）
│   │   ├── model-section.js       # 大模型管理（含测试连接、工具标签、Responses）
│   │   ├── search-section.js      # 联网搜索设置（服务商 CRUD、参数配置、测试）
│   │   ├── history-section.js     # 历史记录
│   │   ├── bank-section.js        # 题库导入（port 进度）、管理、渲染
│   │   ├── rule-section.js        # 解析规则（表单/JSON 双视图编辑器）
│   │   └── backup-section.js      # 备份与恢复（模块化导入/导出）
│   ├── popup/                     # 弹窗页
│   │   ├── popup.html             # 弹窗 HTML
│   │   ├── popup.js               # 弹窗逻辑
│   │   └── popup.css              # 弹窗样式
│   ├── shared/                    # 共享常量与工具
│   │   ├── constants.js           # 常量定义（STORAGE_KEYS/标签/默认快捷键）
│   │   ├── shortcut-utils.js      # 快捷键工具（格式化/匹配/录制辅助）
│   │   ├── theme-utils.js         # 主题工具
│   │   ├── storage-utils.js       # 存储工具（safeSet 等）
│   │   ├── search-utils.js        # 联网搜索共用工具（结果提取、月度用量重置，IIFE）
│   │   ├── llm-utils.js           # 大模型共用工具（SSE 流解析/请求体构造/system 消息分离）
│   │   ├── text-utils.js          # 文本工具（转义/规范化/题型归一化）
│   │   ├── text-splitter.js       # 题库文本按题目边界拆分（background 专用，ES module）
│   │   ├── variables.css          # Design Token 变量
│   │   └── toggle.css             # 开关组件样式
│   ├── background.js              # Background 薄入口（ES module import）
│   ├── content-styles.css         # 页面注入通用样式
│   ├── icons.js                   # SVG 图标加载与替换
│   └── manifest.json              # 扩展入口配置
├── docs/                          # 项目说明文档
├── scripts/                       # 仓库辅助脚本（发版）
├── .github/workflows/             # CI 发布工作流
├── README.md                      # 项目说明
└── AGENTS.md                      # 维护说明
```

## 3. manifest 入口关系

入口配置来自 `src/manifest.json`：

- `action.default_popup = popup/popup.html`
- `options_page = options/options.html`
- `background.service_worker = background.js`（`type: "module"`）
- `content_scripts.js` 当前按顺序注入：
  - `src/icons.js`
  - `src/shared/constants.js`
  - `src/shared/shortcut-utils.js`
  - `src/shared/theme-utils.js`
  - `src/shared/storage-utils.js`
  - `src/shared/text-utils.js`
  - `src/content/state.js`
  - `src/content/dom-parser.js`
  - `src/content/panel-ui.js`
  - `src/content/analyzer.js`
  - `src/content/index.js`
- `web_accessible_resources` 放行：`icons/*`、`lib/*`、`data/*.json`、`content/*.css`、`shared/*.css`

说明：

- `src/background.js` 作为 ES module 薄入口，通过 `import './background/index.js'` 加载主逻辑。这是唯一需要薄入口的场景（MV3 service worker 只能指定一个文件且使用 `type: "module"`）。
- `content_scripts` 采用 IIFE + `globalThis` 模式按顺序注入。共享工具（`src/shared/`）先于 content 模块加载，content 模块之间通过 `globalThis.QuizHelperContentState` 共享状态，通过 `globalThis.QuizHelperXxx` 调用彼此 API。
- `src/popup/popup.js` 中 `chrome.scripting.executeScript` 的兜底注入清单与 manifest 的 content_scripts 清单保持一致（11 个文件）。

## 4. Popup 页面

### 4.1 文件

- 页面结构：`src/popup/popup.html`
- 交互逻辑：`src/popup/popup.js`
- 样式：`src/popup/popup.css`
- 图标依赖：`src/icons.js`
- 公共依赖：
  - `src/shared/constants.js`
  - `src/shared/shortcut-utils.js`
  - `src/shared/theme-utils.js`

### 4.2 页面结构

`src/popup/popup.html` 的结构比较简单，主要分成 4 块：

1. 头部
   - 标题：`题目助手`
   - 主题切换器：`#themeToggle`
   - 三个主题按钮：`data-theme="light"` / `data-theme="dark"` / `data-theme="system"`

2. 主操作区
   - `#analyzeBtn`：分析当前页面题目
   - `#optionsBtn`：打开设置

3. 模型快捷切换
   - `#modelDropdown`：模型下拉（`#modelDropdownBtn` + `#modelDropdownLabel` + `#modelDropdownMenu`）
   - 仅展示 `isActive` 的模型，点击 `mousedown` 直接写 `active_model_id`

4. 提示区
   - `#popupHint`
   - 当前主要用于显示唤起助手快捷键

### 4.3 主要逻辑

`src/popup/popup.js` 当前负责：

- 替换 `data-icon` 对应的 SVG 图标
- 读取和保存 `theme_mode`
- 根据系统主题切换深浅模式
- 读取 `panel_shortcut` 并格式化展示
- 加载并展示可用模型下拉，支持快捷切换 `active_model_id`
- 点击“分析当前页面题目”时：
  - 先尝试给当前标签页发送 `analyze` 消息
  - 如果 content script 未加载，则按 `chrome.runtime.getManifest().content_scripts[0].js` 动态注入（单一数据源，与 manifest 自动保持一致）
  - 注入后再发送 `analyze` 消息
- 点击“打开设置”时打开 `options.html`

### 4.4 维护重点

- Popup 体量较小，适合作为"入口控制页"继续保持轻量。
- 样式已独立到 `src/popup/popup.css`。
- 动态注入兜底路径的文件清单直接取自 manifest 的 content_scripts，无需手工同步。

## 5. Options 设置页

### 5.1 文件

- 页面结构：`src/options/options.html`
- 样式：`src/options/options.css`
- 主逻辑：`src/options/index.js`
- 第三方依赖：
  - `src/lib/xlsx.full.min.js`（题库 Excel 读取）
  - `src/lib/mammoth.browser.min.js`（题库 Word 读取）
  - `src/lib/marked.min.js`（模型测试连接 Markdown 渲染）
  - `src/lib/katex.min.js` + `katex.min.css`（LaTeX 渲染）
- 共享样式依赖：
  - `src/shared/variables.css`
  - `src/shared/toggle.css`
- 共享脚本依赖：`icons.js`、`constants.js`、`shortcut-utils.js`、`theme-utils.js`、`storage-utils.js`

### 5.2 页面结构总览

`src/options/options.html` 采用侧边导航 + 滚动内容布局，由侧边栏 `#sidebar` + 8 张卡片 + 1 个通用抽屉层组成：

**侧边导航**（`#sidebar`）：

- IntersectionObserver 实现滚动高亮（激活带 rootMargin `-5% 0px -85% 0px`），点击平滑滚动
- 导航项对应：基本设置 / 大模型管理 / 联网搜索设置 / 解析规则管理 / 题库管理 / 历史记录 / 备份与恢复 / 关于

**卡片区域**：

1. 基本设置卡片（`#section-settings`）
   - 主题切换器：`#themeToggle`（三个 `data-theme` 按钮）
   - 系统提示词：按题型分 tab（单选/多选/判断/填空/其他），各对应一个 `textarea`
     - `#systemPrompt-single` / `#systemPrompt-multiple` / `#systemPrompt-judge` / `#systemPrompt-fill` / `#systemPrompt-unknown`
     - 占位符展示默认提示词（来自 `data/prompt-templates.json` 的 `answerSystemPrompts`）
   - 补充提示词：`#extraContextPrompt`
   - 面板快捷键显示：`#shortcutDisplay` + 按钮 `#recordShortcutBtn` / `#clearShortcutBtn` / `#resetShortcutBtn` + 提示 `#shortcutHint`
   - 域名白名单：`#allowedDomains`（每行一个域名，留空对所有站点生效）
   - 操作按钮：`#saveBtn` / `#resetBtn`
   - 状态提示：`#status`

2. 大模型管理卡片（`#section-models`）
   - 添加按钮：`#addModelBtn`
   - 列表容器：`#modelList`
   - 状态提示：`#modelStatus`
   - 流式输出开关：`#streamOutputEnabled`（全局公用，控制大模型测试与答题是否流式返回，默认开启，存储 key `stream_output`）
   - 支持多模型配置，可激活/停用，为答题/题库/抽题指定专用模型（`active_model_id` / `model_bank_id` / `model_extract_id`）
   - 模型字段：名称、API 格式（OpenAI/Anthropic/Responses）、API URL、API Key、模型 ID、内置工具（Responses）、思考模式与强度、测试连接

3. 联网搜索设置卡片（`#section-search`）
   - 启用开关：`#webSearchEnabled`
   - 公共参数：
     - 结果数量：`#searchCount`
     - 时间范围：`#searchTimeRange`（分段滑块）
   - 搜索服务商列表容器：`#searchList`
   - 状态提示：`#searchStatus`
   - 内置 Brave Search、豆包搜索（火山引擎）、Tavily Search 三个服务商种子，支持配置 API Key、endpoint、每月限额及各服务商独立参数，支持测试搜索

4. 解析规则管理卡片（`#section-rules`）
   - 列表容器：`#parseRuleList`
   - 状态提示：`#ruleStatus`
   - 编辑器支持表单 / JSON 双视图切换（`#ruleViewForm` / `#ruleViewJson`），JSON 视图带语法高亮与复制

5. 题库管理卡片（`#section-bank`）
   - 启用开关：`#questionBankEnabled`
   - 导入解析模式：`#importMode`（节能 eco / 平衡 balanced / 精细 precise，分段滑块）+ 提示 `#importModeHint`
   - 文件导入：`#questionBankFile`（accept `.xlsx,.xls,.docx`）
   - 数量提示：`#bankCountHint`
   - 列表容器：`#questionBankList`
   - 解析进度：`#bankProgress`（含进度条 `#bankProgressFill` + 文本 `#bankProgressText` + 取消按钮 `#bankProgressCancel`）
   - 状态提示：`#bankStatus`

6. 历史记录卡片（`#section-history`）
   - 导出按钮：`#exportAllHistory`
   - 清空按钮：`#clearHistory`
   - 列表容器：`#historyList`（每条可查看/导出/删除）

7. 备份与恢复卡片（`#section-backup`）
   - 模块勾选网格：`#backupModuleList`（settings/models/search/rules/banks/history 六模块）
   - 导出：`#exportBackupBtn` + 状态 `#backupExportStatus`
   - 导入：`#backupFileInput` + 文件名 `#backupFileName` + `#importBackupBtn` + 状态 `#backupImportStatus`

8. 关于卡片（`#section-about`）
   - 版本、仓库、隐私链接（由 `initAboutSection` 动态填充版本号）

**通用详情抽屉**：

- 覆盖层：`#drawerOverlay`（mousedown 判定 + click 关闭，Esc 关闭，滚动锁定）
- 标题：`#drawerTitle`
- 元信息：`#drawerMeta`
- 内容区：`#drawerBody`
- 保存按钮：`#drawerSaveBtn`（根据 `dataset.action` 分发到对应模块：`save-rule` / `save-model` / `save-search`）
- 关闭按钮：`#drawerCloseBtn`

### 5.3 `src/options/index.js` 的逻辑分块

`src/options/index.js` 是设置页的协调层，负责主题管理、侧边导航、分段滑块全局工具、抽屉分发、数据迁移和模块装配。内部主要包含以下功能块：

1. 主题管理
   - 初始化主题（提前执行避免闪烁）
   - 监听系统主题变化
   - 监听 `chrome.storage` 中的 `theme_mode`

2. 侧边导航
   - 点击导航项平滑滚动
   - IntersectionObserver 实现滚动高亮

3. 分段滑块全局工具
   - `setSegValue` / `getSegValue` 滑动指示器控制
   - 全局委托处理所有 `.segmented-control` 按钮点击（更新 `--seg-width` / `--seg-left`）

4. 抽屉分发
   - `openDrawer(type, data)` 根据类型分发（bank/history/rule/model/search）
   - `closeDrawer()` 关闭并清理抽屉状态
   - `#drawerSaveBtn` 点击按 `dataset.action` 分发
   - 抽屉内复制题目按钮委托处理（`data-copy-question`）

5. 数据迁移与种子
   - 默认解析规则种子写入（`ensureDefaultParseRuleSeeded`，按 `default_parse_rule_seeded_v1` 标记）
   - 旧单模型 → 新多模型结构（`ensureModelMigration`）
   - 旧 `system_prompt` → 新 `custom_system_prompts`（`ensurePromptMigration`）

6. 模块装配
   - `DOMContentLoaded` 后依次初始化：快捷键 → 配置 → 模型 → 搜索 → 规则 → 历史 → 题库 → 备份
   - 各模块返回对象，协调层负责串联调用

### 5.4 维护重点

- 设置页是当前"信息密度最高"的页面。
- 逻辑已拆分为模块：
  - `src/options/utils.js` — 共享常量和工具函数（分页 `renderPagination`、文本清洗、Excel/Word 文件读取、`normalizeBankQuestionType`）
  - `src/options/shortcut-section.js` — 快捷键录制与显示（复用 `shared/shortcut-utils.js`）
  - `src/options/config-section.js` — 基本配置读取/保存/重置（系统提示词按题型分 tab）
  - `src/options/model-section.js` — 大模型管理（多模型 CRUD、激活/停用、任务专用模型指定、流式/非流式测试连接、流式输出开关）
  - `src/options/search-section.js` — 联网搜索设置（服务商 CRUD、参数配置、测试搜索、结果提取）
  - `src/options/history-section.js` — 历史记录 CRUD
  - `src/options/bank-section.js` — 题库导入（port 通道分批进度）、管理、渲染
  - `src/options/rule-section.js` — 解析规则管理与表单/JSON 编辑器
  - `src/options/backup-section.js` — 模块化备份导出/导入
  - `src/options/index.js` — 协调层：主题管理 + 侧边导航 + 分段滑块工具 + 抽屉分发 + 数据迁移 + 模块装配
- 如果后续 AI 要修改设置页，优先先判断是改：
  - DOM 结构：`src/options/options.html`
  - 样式：`src/options/options.css`
  - 行为：对应模块文件（见上）

## 6. Content 注入面板

### 6.1 文件

`src/content/` 目录已拆分为 5 个 JS 模块 + 1 个 CSS：

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/content/state.js` | ~60 | 共享可变状态（`shadowRoot`/`questionsData`/`isAnalyzing` 等）+ content 专用常量（`DEFAULT_SELECTORS`/`DEFAULT_TYPE_KEYWORDS`） |
| `src/content/dom-parser.js` | ~466 | DOM 题目提取：题型识别、选项提取、文本清洗、结构化/降级题目提取 |
| `src/content/panel-ui.js` | ~888 | 面板生命周期（创建/销毁/最小化/恢复）、元素拖拽、卡片渲染、流式答案/思考区渲染 |
| `src/content/analyzer.js` | ~821 | 分析控制（题库→AI 流程/暂停/继续/重作）+ AI 选区解析 + AI 全页解析 |
| `src/content/index.js` | ~262 | 编排入口：主题管理、快捷键监听、解析规则 CRUD、域名白名单、`startAnalysis` 总编排、`analyze` 消息监听 |
| `src/content/panel.css` | — | Shadow DOM 内部面板样式 |

各模块通过 `globalThis.QuizHelperContentState` 共享状态，通过 `globalThis.QuizHelperDomParser` / `QuizHelperPanelUI` / `QuizHelperAnalyzer` / `QuizHelperApp` 调用彼此 API。

依赖注入顺序：`src/content/state.js → src/content/dom-parser.js → src/content/panel-ui.js → src/content/analyzer.js → src/content/index.js`（`src/shared/` 工具先于所有 content 模块）。

### 6.2 生命周期

`src/content/index.js` 在页面中注入后，主要负责编排：

1. 防止重复注入
   - 使用 `window.__quizHelperInjected` + `data-quiz-helper-injected` 属性双重守卫

2. 初始化运行状态
   - `shadowRoot` / `panelElement` / `questionsData` / `isAnalyzing` / `isStarting` / `isPaused` / `analysisRunId` / `pickerState` / `panelShortcut` / `themeMode` / `isDarkMode` / `currentRule`

3. 加载本地配置
   - 读取面板快捷键、主题模式、确保默认解析规则存在

4. 注册监听
   - `chrome.storage.onChanged`
   - `document.addEventListener('keydown', ..., true)`（全局快捷键，可编辑目标与选择器激活时跳过）
   - `chrome.runtime.onMessage.addListener(...)`（`analyze` 指令）

5. 域名白名单
   - `checkDomainAllowed()`：`allowed_domains` 为空放行所有站点，否则精确匹配或子域名后缀匹配

### 6.3 面板结构

内容面板通过 Shadow DOM 渲染，核心结构如下：

1. 宿主节点
   - 在页面中创建宿主 `div#quiz-helper-host`（`removeAllPanelHosts` 兜底去重）
   - 调用 `attachShadow({ mode: 'open' })`，先注入 `variables.css`（fetch 文本内联）再挂 `panel.css` 外链

2. 主面板 `panelElement`
   - 头部 `.qh-header`
     - 标题 `.qh-title`
     - 进度 `.qh-progress`
     - 头部按钮：`#qh-minimize` / `#qh-close`
   - 主体 `.qh-body`
     - 容器：`#qh-body`
     - 内部按题目渲染多个 `.qh-card`
   - 底部 `.qh-footer`
     - 模型名 `#qh-model-name`
     - 分段按钮组 `.qh-seg`：`#qh-ai-parse`（AI 选区）/ `#qh-reparse`（规则解析）
     - `#qh-pause`（暂停/继续）
     - `#qh-retry`（重新作答）

3. 迷你悬浮条 `miniBar`
   - 最小化后显示插件图标（`#qh-mini-bar`）
   - 用于重新展开面板（恢复时自动计算就近展开位置）

### 6.4 卡片结构

每道题会渲染一个题目卡片，常见结构如下：

1. 卡片头部 `.qh-card-header`
   - 题号 `.qh-card-num`
   - 题型标签 `.qh-card-type`（`qh-type-single` / `qh-type-multiple` / `qh-type-judge` / `qh-type-fill` / `qh-type-unknown`）
   - 题目摘要 `.qh-card-summary`
   - 答案预览 `.qh-card-answer`
   - 状态标签 `.qh-card-status`（`qh-status-pending` / `qh-status-loading` / `qh-status-done` / `qh-status-error`）

2. 卡片主体 `.qh-card-body`
   - 题目原文区 `.qh-question-section`（含复制按钮）
   - 思考区 `.qh-thinking-section`（流式思考，默认折叠，可点击展开）
   - 参考答案区 `.qh-answer-section`
   - 联网搜索参考区 `.qh-search-ref`（`webSearchRefs`，含来源链接）
   - 题库参考区 `.qh-bank-refs`（每个参考项为 `.qh-bank-ref`）

### 6.5 各模块主要职责

content 目录 5 个模块的职责划分如下：

1. 主题与快捷键（→ `src/content/index.js`）
   - 主题模式同步（system 跟随 `prefers-color-scheme`）
   - 全局快捷键监听（`Alt+Q` 默认），白名单校验后切换面板

2. 解析规则与默认规则（→ `src/content/index.js`）
   - 默认规则种子写入（`ensureDefaultRules`）
   - 当前站点规则读取/保存/使用次数统计（`getDomainRule`/`saveParseRule`/`incrementRuleUseCount`）

3. DOM 题目提取（→ `src/content/dom-parser.js`）
   - 题型识别（class 指示器 / data-current / input 类型 / 文本关键词）
   - 文本清洗（`getCleanText` 克隆后剔除无关节点）
   - 选项提取（`collectOptionLines` 多策略）
   - 结构化提取 → 文本提取降级（`parseExamQuestions`）

4. 面板渲染（→ `src/content/panel-ui.js`）
   - `createPanel(totalQuestions)` / `ensurePanel` / `destroyPanel` / `minimizePanel` / `restorePanel` / `removePanel`
   - `renderCards()` / `updateCardBody(index, content, isError)` / `updateAnswerStream`（流式思考+答案）/ `updateProgress` / `updateControls`
   - `makeDraggable` 拖拽（头部/底部/迷你条）
   - `refreshModelNameDisplay`（展示当前答题模型名）

5. AI 分析流程（→ `src/content/analyzer.js`）
   - `analyzeSingleQuestion(index)` / `analyzeAllQuestions({ resume })`
   - 每道题先 `searchQuestionBank` 查题库 → 命中则 `verifyBankAnswer` 校验选项顺序 → 未命中走 `streamQuestion`（port 通道流式答题）
   - `togglePauseAnalysis` / `restartAnalysis` / `reparseAndAnalyze`
   - 分析完成后 `saveHistory`（`exam_history` 最多 50 条）

6. AI 选区解析（→ `src/content/analyzer.js`）
   - `startElementPicker` / `stopElementPicker` / `toggleAiPicker`
   - `aiParseQuestionsFromElement`：局部 DOM + 文本发给 background `extractQuestions`，成功后可合并/新建解析规则（`mergeSelectors` / `buildNewRuleFromAI`）
   - `aiParseFullPageAndAnalyze`：自动查找主内容区做全页解析

7. 消息入口（→ `src/content/index.js`）
   - 接收 popup 或其它来源发来的 `analyze` 指令

### 6.6 维护重点

- `src/content/index.js`（~262 行）已从原 ~2050 行巨型文件拆分为 5 个模块，各模块职责单一。
- 各模块文件对应职责：
  - **改主题/快捷键/解析规则/编排** → `src/content/index.js`
  - **改 DOM 题目提取** → `src/content/dom-parser.js`
  - **改面板生命周期或渲染** → `src/content/panel-ui.js`
  - **改分析流程或 AI 解析** → `src/content/analyzer.js`
  - **改共享状态或 content 专用常量** → `src/content/state.js`
- 跨模块调用通过 `globalThis.QuizHelperXxx` 在函数体内引用（非 IIFE 顶层），确保加载顺序无关。
- 页面结构改动时，要特别注意：
  - Shadow DOM 内部结构是否与 `src/content/panel.css` 对齐
  - `data-icon` 图标替换是否在 ShadowRoot 内生效（`window.QuizHelperIcons.replaceIcons`）
  - 消息监听和快捷键是否重复注册

## 7. Background 后台服务

### 7.1 文件结构

后台服务已模块化，当前职责边界比较清晰：

- `src/background.js`
  - 仅为模块入口，导入 `src/background/index.js`

- `src/background/index.js`
  - 启动后台逻辑，注册路由
  - 独立注册 `webSearch` 消息监听器（早于 router，确保无拦截）
  - 包含每月搜索次数限制检查和递增逻辑

- `src/background/router.js`
  - 统一注册 `chrome.runtime.onMessage`
  - 按 `request.action` 分发请求
  - 同时注册 `chrome.runtime.onConnect` 支持 port 通道：`parseQuestionBank`（分批题库解析进度上报）、`streamAnswer`（流式答题）
  - 包含 `fetchAnswerWithSearch` 的"搜索感知 → 搜索 → 二次作答"流程与引用链接过滤
  - 答题按流式输出开关（`stream_output`）决定流式/非流式调用，关闭时经流式通道一次性回传完整结果
  - 提取 `callLLM` 统一流式/非流式分发，降级分叉合并复用

- `src/background/api-client.js`
  - 读取 API 配置（支持按任务类型读取专用模型：答题/题库/抽题）
  - 支持三种 API 格式：OpenAI Chat Completions、Anthropic Messages、OpenAI Responses
  - 支持流式（SSE 解析）与非流式，思考模式（thinking/reasoning_effort）、内置工具（responses 的 web_search）
  - 带超时的 fetch 封装（`fetchWithTimeout`，支持外部 AbortSignal）

- `src/background/prompt-builder.js`
  - 读取 `src/data/prompt-templates.json`（模块级缓存 Promise）
  - 拼装答题、题库校验、AI 选区抽题、题库解析的提示词
  - 拼装搜索感知提示词和搜索结果提示词

- `src/background/json-parser.js`
  - 去 markdown fence、JSON 解析（公共 `extractJsonResult`，统一数组/对象探测顺序）
  - AI 返回结构归一化（`normalizeParsedQuestions`，题型归一化复用 `shared/text-utils.js`）

- `src/background/question-bank.js`
  - 题库导入解析（支持分批 `handleParseQuestionBankBatched`，并发 + AbortController 取消）
  - 题库 fallback 规则解析（`parseQuestionBankByRules`）
  - 题库相似题搜索（`handleSearchQuestionBank`，字符集 Jaccard 相似度）
  - 题目去重（`deduplicateQuestions`）

- `src/background/search-proxy.js`
  - 联网搜索代理（后台 Service Worker 执行）
  - 支持多服务商：Brave Search、豆包搜索（火山引擎）、Tavily Search
  - 统一参数 → 具体服务商 API 参数映射（`buildSearchRequest` + 嵌套参数 `setNestedParam`）
  - 搜索结果提取、格式化、参考链接提取

- `src/background/webrequest-interceptor.js`
  - DNR（declarativeNetRequest）拦截器
  - 动态注入认证头 + Content-Type + X-Traffic-Tag，规避 CORS 预检
  - 监听 `web_search_providers` 变化自动同步 DNR 规则

### 7.2 当前消息动作清单

`src/background/router.js` 当前支持以下动作：

1. `fetchAnswer`
   - 输入：题目文本、题型
   - 输出：AI 参考答案
   - 支持流式（port `streamAnswer`）与非流式两种调用

2. `fetchAnswerWithSearch`
   - 输入：题目文本、题型、是否强制搜索（`forceSearch`）
   - 输出：带联网搜索结果的 AI 参考答案 + 参考链接列表
   - 流程：第一次 LLM 调用（搜索感知）→ 判断是否需要搜索（`[NEED_SEARCH: ...]` 标记）→ 执行搜索 → 第二次 LLM 调用（带搜索结果）→ 按引用过滤参考链接
   - 搜索不可用、达上限或搜索失败时自动降级为普通 `fetchAnswer`

3. `verifyBankAnswer`
   - 输入：当前题目、题型、题库匹配结果
   - 输出：根据题目当前选项顺序重新校验后的答案

4. `extractQuestions`
   - 输入：局部 HTML、局部文本、选中文本、元素提示
   - 输出：题目列表 + selectors

5. `parseQuestionBank`
   - 输入：题库原始文本、文件名
   - 输出：解析后的题目数组
   - 同时支持 port 通道分批解析（`handleParseQuestionBankBatched`），进度通过 port 上报

6. `searchQuestionBank`
   - 输入：当前题目文本
   - 输出：题库相似题匹配结果（最多 3 条，按相似度排序）

此外，`src/background/index.js` 独立注册了 `webSearch` 动作监听器（早于 router）：

1. `webSearch`
   - 输入：搜索服务商配置、搜索设置、搜索词
   - 输出：原始搜索结果数据
   - 含每月搜索次数限制检查

**port 通道**（`chrome.runtime.onConnect`）：

1. `parseQuestionBank`
   - 消息：`{ text, fileName }`
   - 回传：`progress`（current/total/totalQuestions/message）→ `result`
   - 支持取消（port 断开 → AbortController.abort）

2. `streamAnswer`
   - 消息：`{ data: questionText, questionType, forceSearch }`
   - 回传：`connected` → `thinking` / `text` / `searchStatus` / `referenceLinks` → `done` / `error`

### 7.3 维护重点

- 后台是当前最适合继续扩展 AI 能力的区域。
- 如果后续 AI 需要改提示词，优先查：
  - `src/data/prompt-templates.json`
  - `src/background/prompt-builder.js`
- 如果后续 AI 需要改题库解析结果格式，优先查：
  - `src/background/json-parser.js`
  - `src/background/question-bank.js`
- 如果后续 AI 需要新增消息动作，优先查：
  - `src/background/router.js`（普通 onMessage 动作 + port 通道）
  - `src/background/index.js`（需要独立监听器的动作）
- 如果后续 AI 需要改 API 调用或新增模型格式，优先查：
  - `src/background/api-client.js`（三种格式 + 流式解析）
- 如果后续 AI 需要改联网搜索，优先查：
  - `src/background/search-proxy.js`（搜索执行与结果提取）
  - `src/background/webrequest-interceptor.js`（认证头注入）
  - `src/options/search-section.js`（服务商配置 UI）

## 8. 共享层与静态数据

### 8.1 shared 目录

用于放页面/脚本共用的常量和工具：

- `src/shared/constants.js`
  - `STORAGE_KEYS`（全部 storage key 集中定义）
  - `DEFAULT_SHORTCUT`
  - `TYPE_LABELS`
  - `STATUS_LABELS`
  - `IMPORT_MODES`（题库导入模式配置：eco/balanced/precise，后台与设置页共用）

- `src/shared/shortcut-utils.js`
  - 快捷键格式化（mac/win 差异显示）
  - 快捷键匹配、归一化、默认值
  - 修饰键判断、键符号映射

- `src/shared/theme-utils.js`
  - 主题模式保存与加载
  - 浅色/深色解析
  - 页面主题应用、主题切换器 UI 更新

- `src/shared/storage-utils.js`
  - `safeSet` — 统一写入封装（捕获配额超限并提示）

- `src/shared/search-utils.js`
  - `extractSearchResults` — 从各搜索服务商 API 数据中提取统一格式的搜索结果（IIFE，options 页与 background 共用）
  - `getOrResetProviderUsage` — 搜索服务商月度用量记录获取/跨月重置（background 限额检查与计数共用）

- `src/shared/llm-utils.js`
  - 大模型共用工具（IIFE + `globalThis.QuizHelperLLMUtils`，background 与 options 模型测试共用）
  - `parseOpenAISSE` / `parseAnthropicSSE` / `parseResponsesSSE` — 三格式 SSE 流解析，输出 `{type: 'thinking'|'text'|'searchStatus'|'referenceLinks'}` 事件并返回完整文本（注意：Responses 返回 `{text, annotations}` 对象）
  - `splitSystemMessages` / `convertToResponsesFormat` — system 消息分离与 Responses input 转换
  - `buildOpenAIBody` / `buildAnthropicBody` / `buildResponsesBody` — 三格式请求体构造（thinking/temperature 互斥）

- `src/shared/text-utils.js`
  - `normalizeWhitespace` — 空白字符规范化
  - `escapeRegex` — 正则特殊字符转义
  - `escapeHtml` — HTML 实体转义
  - `normalizeQuestionType` — 题型归一化（AI/Excel 题型描述 → 内部题型，content/options/background 三端共用）

- `src/shared/text-splitter.js`
  - `splitTextByQuestions` — 按题目边界拆分题库文本为多个批次（ES module，供 background 使用）
  - 无法识别题号时退化为按段落 + 字符数拆分（`splitByChars` / `splitLongText`）

- `src/shared/variables.css`
  - Design Token 变量定义，content 面板通过 `fetch` 文本内联注入 Shadow DOM；popup/options 通过 `<link>` 引用

- `src/shared/toggle.css`
  - 开关组件（`.switch`）样式，供设置页使用

### 8.2 data 目录

当前静态数据有两份：

- `src/data/default-parse-rule.json`
  - 默认解析规则种子（`example.com`）
  - 包含 `selectors` 与 `typeKeywords`

- `src/data/prompt-templates.json`
  - AI 答题提示词（按题型）
  - 搜索感知答题提示词
  - 搜索结果作答提示词
  - 题库校验提示词
  - AI 选区抽题提示词
  - 题库导入解析提示词

## 9. 当前页面维护建议

如果后续 AI 需要更新页面，建议按下面的判断顺序定位：

1. 要改页面布局或新增 DOM 节点
   - 先看 `src/popup/popup.html` / `src/options/options.html`
   - content 面板则看 `src/content/panel-ui.js` 的 `createPanel` 与卡片渲染代码

2. 要改样式
   - popup：`src/popup/popup.html` + `src/popup/popup.css`
   - options：`src/options/options.css`
   - content 面板：`src/content/panel.css`
   - 页面级辅助样式：`src/content-styles.css`

3. 要改存储字段
   - 先看 `src/shared/constants.js` 的 `STORAGE_KEYS`
   - 再全局搜对应 key

4. 要改 AI 相关能力
   - 先看 `src/background/router.js`
   - 再看 `src/background/prompt-builder.js`
   - 最后看 `src/background/question-bank.js` / `src/background/json-parser.js` / `src/background/api-client.js`

5. 要改题目提取或面板交互
   - DOM 解析：`src/content/dom-parser.js`
   - 面板渲染：`src/content/panel-ui.js`
   - 分析流程：`src/content/analyzer.js`
   - 编排入口：`src/content/index.js`

6. 要改设置页功能
   - 重点看 `src/options/index.js` 及对应模块文件（见 5.4）

## 10. 已知现状说明

这份文档描述的是**当前代码实际状态**，不是理想目标状态。需要特别注意：

- `src/options/options.css` 和 `src/content/panel.css` 已完成样式独立
- `src/popup/popup.html` + `src/popup/popup.css` 已完成样式独立
- `src/popup/popup.js` 体量较小，动态注入兜底清单与 manifest 保持一致
- `src/background/` 已完成较明确的模块化（8 个模块 + 薄入口，含 `search-usage.js`）
- `src/content/index.js` 已拆分为 5 个模块，单文件最大 ~888 行（`panel-ui.js`）
- `src/options/index.js` 仍可继续细拆（已拆分 10 个模块文件）
- 重复的常量和快捷键函数已被消除，改为统一引用 `src/shared/`
- 跨文件重复代码已收敛：月度限额函数（`background/search-usage.js` 复用 `shared/search-utils.js`）、搜索结果提取（`shared/search-utils.js`）、题型归一化（`shared/text-utils.js`）、大模型 SSE 解析与请求体构造（`shared/llm-utils.js`）均单点维护

## 11. 建议后续 AI 接手顺序

如果后续要继续维护或重构，建议 AI 按这个顺序理解代码：

1. 先读 `src/manifest.json`
2. 再读本文件
3. 再看 `src/background/router.js`
4. 再看 `src/popup/popup.html` + `src/popup/popup.js`
5. 再看 `src/options/options.html` + `src/options/index.js`
6. 最后看 content 模块，按注入顺序：`src/content/state.js` → `src/content/dom-parser.js` → `src/content/panel-ui.js` → `src/content/analyzer.js` → `src/content/index.js`

这样能先建立入口和消息流，再进入最复杂的注入逻辑。
