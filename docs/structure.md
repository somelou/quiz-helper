# Quiz Helper 当前页面结构清单与主要内容

本文档用于帮助后续 AI 或开发者快速理解 `quiz-helper` 当前的页面入口、页面结构、主要交互、关键脚本与维护落点。

## 1. 项目界面入口总览

当前插件的可见界面主要有 3 类：

1. `popup` 弹窗页
   - 文件：`popup/popup.html` + `popup/popup.js` + `popup/popup.css`
   - 作用：从浏览器工具栏打开，负责触发当前页面分析、打开设置页、显示快捷键信息、切换主题

2. `options` 设置页
   - 文件：`options/options.html` + `options/index.js` + `options/options.css`
   - 作用：负责大模型管理、联网搜索设置、快捷键、域名白名单、解析规则管理、题库管理、历史记录管理

3. `content` 注入面板
   - 文件：`content/index.js` + `content/state.js` + `content/dom-parser.js` + `content/panel-ui.js` + `content/analyzer.js` + `content/panel.css`
   - 作用：注入到目标网页中，负责提取题目、展示题目卡片、调用后台分析答案、AI 选区解析、题库匹配展示

此外还有 1 个不可见的后台服务：

4. `background` 后台服务
   - 文件：`background.js` + `background/*.js`
   - 作用：作为消息中转和 AI 能力服务层，负责答题请求、题库解析、题库检索、AI 选区抽题

## 2. 目录结构速览

当前 `quiz-helper` 目录的核心结构如下：

```text
quiz-helper/
├── background/                # 后台逻辑模块
│   ├── index.js               # 后台入口（webSearch 监听 + 路由注册）
│   ├── router.js              # 消息路由
│   ├── api-client.js          # LLM API 调用
│   ├── prompt-builder.js      # 提示词构建
│   ├── json-parser.js         # JSON 响应解析与归一化
│   ├── question-bank.js       # 题库解析与检索
│   ├── search-proxy.js        # 联网搜索代理（多服务商）
│   └── webrequest-interceptor.js  # DNR 拦截器（注入认证头/规避 CORS 预检）
├── content/                   # 内容脚本主逻辑与面板样式
│   ├── index.js               # 编排入口
│   ├── state.js               # 共享可变状态与 content 专用常量
│   ├── dom-parser.js          # DOM 题目提取
│   ├── panel-ui.js            # 面板生命周期 + 拖拽 + 卡片渲染
│   ├── analyzer.js            # 分析控制 + AI 选区解析 + AI 作答流程
│   └── panel.css              # 面板样式
├── data/                      # 静态 JSON 数据（默认解析规则、提示词模板）
├── docs/                      # 项目说明文档
├── icons/                     # PNG/SVG 图标资源
├── lib/                       # 第三方库（xlsx、mammoth）
├── options/                   # 设置页主逻辑与样式
│   ├── options.html           # 设置页 HTML
│   ├── options.css            # 样式
│   ├── index.js               # 协调层
│   ├── utils.js               # 共享工具
│   ├── shortcut-section.js    # 快捷键管理
│   ├── config-section.js      # 基本配置管理
│   ├── model-section.js       # 大模型管理
│   ├── search-section.js      # 联网搜索设置
│   ├── history-section.js     # 历史记录
│   ├── bank-section.js        # 题库管理
│   └── rule-section.js        # 解析规则
├── shared/                    # 共享常量与工具
│   ├── constants.js           # 常量定义
│   ├── shortcut-utils.js      # 快捷键工具
│   ├── theme-utils.js         # 主题工具
│   ├── storage-utils.js       # 存储工具
│   ├── text-utils.js          # 文本工具（转义/规范化/正则）
│   ├── text-splitter.js       # 题库文本按题目边界拆分
│   ├── variables.css          # Design Token 变量
│   └── toggle.css             # 开关组件样式
├── background.js              # Background 薄入口（ES module import）
├── content-styles.css         # 页面注入通用样式
├── icons.js                   # SVG 图标加载与替换
├── manifest.json              # 扩展入口配置
├── popup/                     # 弹窗页
│   ├── popup.html             # 弹窗 HTML
│   ├── popup.js               # 弹窗逻辑
│   └── popup.css               # 弹窗样式
```

## 3. manifest 入口关系

入口配置来自 `manifest.json`：

- `action.default_popup = popup/popup.html`
- `options_page = options/options.html`
- `background.service_worker = background.js`
- `content_scripts.js` 当前按顺序注入：
  - `icons.js`
  - `shared/constants.js`
  - `shared/shortcut-utils.js`
  - `shared/theme-utils.js`
  - `shared/storage-utils.js`
  - `shared/text-utils.js`
  - `content/state.js`
  - `content/dom-parser.js`
  - `content/panel-ui.js`
  - `content/analyzer.js`
  - `content/index.js`

说明：

- `background.js` 作为 ES module 薄入口，通过 `import './background/index.js'` 加载主逻辑。这是唯一需要薄入口的场景（MV3 service worker 只能指定一个文件且使用 `type: "module"`）。
- `content_scripts` 采用 IIFE + `globalThis` 模式按顺序注入。共享工具（`shared/`）先于 content 模块加载，content 模块之间通过 `globalThis.QuizHelperContentState` 共享状态，通过 `globalThis.QuizHelperXxx` 调用彼此 API。

## 4. Popup 页面

### 4.1 文件

- 页面结构：`popup/popup.html`
- 交互逻辑：`popup/popup.js`
- 样式：`popup/popup.css`
- 图标依赖：`icons.js`
- 公共依赖：
  - `shared/constants.js`
  - `shared/shortcut-utils.js`
  - `shared/theme-utils.js`

### 4.2 页面结构

`popup/popup.html` 的结构比较简单，主要分成 3 块：

1. 头部
   - 标题：`题目助手`
   - 主题切换器：`#themeToggle`
   - 三个主题按钮：
     - `data-theme="light"`
     - `data-theme="dark"`
     - `data-theme="system"`

2. 主操作区
   - `#analyzeBtn`：分析当前页面题目
   - `#optionsBtn`：打开设置
   - `#modelDropdown`：模型快捷切换下拉（`#modelDropdownBtn` + `#modelDropdownMenu`）

3. 提示区
   - `#popupHint`
   - 当前主要用于显示唤起助手快捷键

### 4.3 主要逻辑

`popup/popup.js` 当前负责：

- 替换 `data-icon` 对应的 SVG 图标
- 读取和保存 `theme_mode`
- 根据系统主题切换深浅模式
- 读取 `panel_shortcut` 并格式化展示
- 点击“分析当前页面题目”时：
  - 先尝试给当前标签页发送 `analyze` 消息
  - 如果 content script 未加载，则动态注入共享脚本 + `content/` 模块文件
  - 注入后再发送 `analyze` 消息
- 点击“打开设置”时打开 `options.html`

### 4.4 维护重点

- Popup 体量较小，适合作为"入口控制页"继续保持轻量。
- 样式已独立到 `popup/popup.css`。

## 5. Options 设置页

### 5.1 文件

- 页面结构：`options/options.html`
- 样式：`options/options.css`
- 主逻辑：`options/index.js`
- 第三方依赖：
  - `lib/xlsx.full.min.js`
  - `lib/mammoth.browser.min.js`
- 共享样式依赖：
  - `shared/variables.css`
  - `shared/toggle.css`

### 5.2 页面结构总览

`options/options.html` 采用侧边导航 + 滚动内容布局，由侧边栏 `#sidebar` + 6 张卡片 + 1 个通用抽屉层组成：

**侧边导航**（`#sidebar`）：

- IntersectionObserver 实现滚动高亮，点击平滑滚动
- 导航项对应：基本设置 / 大模型管理 / 联网搜索设置 / 解析规则管理 / 题库管理 / 历史记录

**卡片区域**：

1. 基本设置卡片（`#section-settings`）
   - 系统提示词：按题型分 tab（单选/多选/判断/填空/其他），各对应一个 `textarea`
     - `#systemPrompt-single` / `#systemPrompt-multiple` / `#systemPrompt-judge` / `#systemPrompt-fill` / `#systemPrompt-unknown`
   - 补充提示词：`#extraContextPrompt`
   - 面板快捷键显示：`#shortcutDisplay`
   - 快捷键按钮：
     - `#recordShortcutBtn`
     - `#clearShortcutBtn`
     - `#resetShortcutBtn`
   - 域名白名单：`#allowedDomains`
   - 操作按钮：
     - `#saveBtn`
     - `#resetBtn`
   - 状态提示：`#status`

2. 大模型管理卡片（`#section-models`）
   - 添加按钮：`#addModelBtn`
   - 列表容器：`#modelList`
   - 状态提示：`#modelStatus`
   - 支持多模型配置，可激活/停用，为答题/题库/抽题指定专用模型

3. 联网搜索设置卡片（`#section-search`）
   - 启用开关：`#webSearchEnabled`
   - 公共参数：
     - 结果数量：`#searchCount`
     - 时间范围：`#searchTimeRange`（分段滑块）
     - 搜索语言：`#searchLang`（分段滑块）
   - 搜索服务商列表容器：`#searchList`
   - 状态提示：`#searchStatus`
   - 内置 Brave Search 和豆包搜索/火山引擎两个服务商种子

4. 解析规则管理卡片（`#section-rules`）
   - 列表容器：`#parseRuleList`
   - 状态提示：`#ruleStatus`

5. 题库管理卡片（`#section-bank`）
   - 启用开关：`#questionBankEnabled`
   - 导入解析模式：`#importMode`（节能/平衡/精细，分段滑块）
   - 文件导入：`#questionBankFile`
   - 数量提示：`#bankCountHint`
   - 列表容器：`#questionBankList`
   - 解析进度：`#bankProgress`（含进度条 `#bankProgressFill` + 文本 `#bankProgressText` + 取消按钮 `#bankProgressCancel`）
   - 状态提示：`#bankStatus`

6. 历史记录卡片（`#section-history`）
   - 导出按钮：`#exportAllHistory`
   - 清空按钮：`#clearHistory`
   - 列表容器：`#historyList`

**通用详情抽屉**：

- 覆盖层：`#drawerOverlay`
- 标题：`#drawerTitle`
- 元信息：`#drawerMeta`
- 内容区：`#drawerBody`
- 保存按钮：`#drawerSaveBtn`（根据 `dataset.action` 分发到对应模块：`save-rule` / `save-model` / `save-search`）
- 关闭按钮：`#drawerCloseBtn`

### 5.3 `options/index.js` 的逻辑分块

`options/index.js` 是设置页的协调层，负责主题管理、侧边导航、分段滑块全局工具、抽屉分发和模块装配。内部主要包含以下功能块：

1. 主题管理
   - 初始化主题
   - 监听系统主题变化
   - 监听 `chrome.storage` 中的 `theme_mode`
   - 更新 `#themeToggle`

2. 侧边导航
   - 点击导航项平滑滚动
   - IntersectionObserver 实现滚动高亮

3. 分段滑块全局工具
   - `setSegValue` / `getSegValue` 滑动指示器控制
   - 全局委托处理所有 `.segmented-control` 按钮点击

4. 抽屉分发
   - `openDrawer(type, data)` 根据类型分发到各模块
   - `closeDrawer()` 关闭并清理抽屉状态
   - `#drawerSaveBtn` 点击按 `dataset.action` 分发

5. 数据迁移
   - 旧单模型 → 新多模型结构（`ensureModelMigration`）
   - 旧 `system_prompt` → 新 `custom_system_prompts`（`ensurePromptMigration`）
   - 默认解析规则种子写入（`ensureDefaultParseRuleSeeded`）

6. 模块装配
   - `DOMContentLoaded` 后依次初始化：快捷键 → 配置 → 模型 → 搜索 → 规则 → 历史 → 题库
   - 各模块返回对象，协调层负责串联调用

### 5.4 维护重点

- 设置页是当前"信息密度最高"的页面。
- 逻辑已拆分为模块：
  - `options/utils.js` — 共享常量和工具函数（分页、文本清洗、文件读取等）
  - `options/shortcut-section.js` — 快捷键录制与显示
  - `options/config-section.js` — 基本配置读取/保存/重置（系统提示词按题型分 tab）
  - `options/model-section.js` — 大模型管理（多模型 CRUD、激活/停用、任务专用模型指定）
  - `options/search-section.js` — 联网搜索设置（服务商 CRUD、公共参数配置）
  - `options/history-section.js` — 历史记录 CRUD
  - `options/bank-section.js` — 题库导入、管理、渲染（支持分批解析进度上报）
  - `options/rule-section.js` — 解析规则管理与编辑器
  - `options/index.js` — 协调层：主题管理 + 侧边导航 + 分段滑块工具 + 抽屉分发 + 模块装配
- 如果后续 AI 要修改设置页，优先先判断是改：
  - DOM 结构：`options/options.html`
  - 样式：`options/options.css`
  - 行为：对应模块文件（见上）

## 6. Content 注入面板

### 6.1 文件

content/ 目录已拆分为 5 个 JS 模块 + 1 个 CSS：

| 文件 | 行数 | 职责 |
|------|------|------|
| `content/state.js` | ~60 | 共享可变状态（`shadowRoot`/`questionsData`/`isAnalyzing` 等）+ content 专用常量（`DEFAULT_SELECTORS`/`DEFAULT_TYPE_KEYWORDS`） |
| `content/dom-parser.js` | ~450 | DOM 题目提取：题型识别、选项提取、文本清洗、结构化/降级题目提取 |
| `content/panel-ui.js` | ~630 | 面板生命周期（创建/销毁/最小化/恢复）、元素拖拽、卡片渲染、答案格式化 |
| `content/analyzer.js` | ~620 | 分析控制（题库→AI 流程/暂停/继续/重作）+ AI 选区解析 + AI 全页解析 |
| `content/index.js` | ~260 | 编排入口：主题管理、快捷键监听、解析规则 CRUD、域名白名单、`startAnalysis` 总编排、`analyze` 消息监听 |
| `content/panel.css` | — | Shadow DOM 内部面板样式 |

各模块通过 `globalThis.QuizHelperContentState` 共享状态，通过 `globalThis.QuizHelperDomParser` / `QuizHelperPanelUI` / `QuizHelperAnalyzer` / `QuizHelperApp` 调用彼此 API。

依赖注入顺序：`state.js → dom-parser.js → panel-ui.js → analyzer.js → index.js`（shared/ 工具先于所有 content 模块）。

### 6.2 生命周期

`content/index.js` 在页面中注入后，主要负责编排：

1. 防止重复注入
   - 使用 `window.__quizHelperInjected`

2. 初始化运行状态
   - `shadowRoot`
   - `panelElement`
   - `questionsData`
   - `isAnalyzing`
   - `isPaused`
   - `analysisRunId`
   - `pickerState`
   - `panelShortcut`
   - `themeMode`
   - `isDarkMode`
   - `currentRule`

3. 加载本地配置
   - 读取面板快捷键
   - 读取主题模式
   - 确保默认解析规则存在

4. 注册监听
   - `chrome.storage.onChanged`
   - `document.addEventListener('keydown', ...)`
   - `chrome.runtime.onMessage.addListener(...)`

### 6.3 面板结构

内容面板通过 Shadow DOM 渲染，核心结构如下：

1. 宿主节点
   - 在页面中创建宿主 `div`
   - 调用 `attachShadow({ mode: 'open' })`

2. 主面板 `panelElement`
   - 头部 `.qh-header`
     - 标题 `.qh-title`
     - 进度 `.qh-progress`
     - 头部按钮：
       - `#qh-minimize`
       - `#qh-close`
   - 主体 `.qh-body`
     - 容器：`#qh-body`
     - 内部按题目渲染多个 `.qh-card`
   - 底部 `.qh-footer`
     - `#qh-ai-parse`：AI 选区解析
     - `#qh-reparse`：规则重解析
     - `#qh-pause`：暂停
     - `#qh-retry`：重新作答

3. 迷你悬浮条 `miniBar`
   - 最小化后显示插件图标
   - 用于重新展开面板

### 6.4 卡片结构

每道题会渲染一个题目卡片，常见结构如下：

1. 卡片头部 `.qh-card-header`
   - 题号 `.qh-card-num`
   - 题型标签 `.qh-card-type`
   - 题目摘要 `.qh-card-summary`
   - 答案预览 `.qh-card-answer`
   - 状态标签 `.qh-card-status`

2. 卡片主体 `.qh-card-body`
   - 题目原文区 `.qh-question-section`
   - 参考答案区 `.qh-answer-section`
   - 可包含题库参考区 `.qh-bank-refs`
   - 每个题库参考项为 `.qh-bank-ref`

### 6.5 各模块主要职责

content 目录 5 个模块的职责划分如下：

当前主要包含以下几类逻辑：

1. 主题与快捷键（→ `content/index.js`）
   - 主题模式同步
   - 全局快捷键监听
   - 面板显示/隐藏控制

2. 解析规则与默认规则（→ `content/index.js`）
   - 默认规则种子写入
   - 当前站点规则选择
   - 规则解析与 AI 解析配合

3. DOM 题目提取（→ `content/dom-parser.js`）
   - 题型识别
   - 文本清洗
   - 选项提取
   - 题目列表构造

4. 面板渲染（→ `content/panel-ui.js`）
   - `createPanel(totalQuestions)`
   - `renderCards()`
   - `updateCardBody(index, content, isError)`

5. AI 分析流程（→ `content/analyzer.js`）
   - `analyzeSingleQuestion(index)`
   - `analyzeAllQuestions({ resume })`
   - 先查题库，再校验，再走 AI 答题

6. AI 选区解析（→ `content/analyzer.js`）
   - 在页面中高亮并选择区域
   - 将局部 DOM 与文本发给 background 的 `extractQuestions`

7. 消息入口（→ `content/index.js`）
   - 接收 popup 或其它来源发来的 `analyze` 指令

### 6.6 维护重点

- `content/index.js`（~260 行）已从原 ~2050 行巨型文件拆分为 5 个模块，各模块职责单一。
- 各模块文件对应职责：
  - **改主题/快捷键/解析规则/编排** → `content/index.js`
  - **改 DOM 题目提取** → `content/dom-parser.js`
  - **改面板生命周期或渲染** → `content/panel-ui.js`
  - **改分析流程或 AI 解析** → `content/analyzer.js`
  - **改共享状态或 content 专用常量** → `content/state.js`
- 跨模块调用通过 `globalThis.QuizHelperXxx` 在函数体内引用（非 IIFE 顶层），确保加载顺序无关。
- 页面结构改动时，要特别注意：
  - Shadow DOM 内部结构是否与 `content/panel.css` 对齐
  - `data-icon` 图标替换是否在 ShadowRoot 内生效
  - 消息监听和快捷键是否重复注册

## 7. Background 后台服务

### 7.1 文件结构

后台服务已模块化，当前职责边界比较清晰：

- `background.js`
  - 仅为模块入口，导入 `background/index.js`

- `background/index.js`
  - 启动后台逻辑，注册路由
  - 独立注册 `webSearch` 消息监听器（早于 router，确保无拦截）
  - 包含每月搜索次数限制检查和递增逻辑

- `background/router.js`
  - 统一注册 `chrome.runtime.onMessage`
  - 按 `request.action` 分发请求
  - 同时注册 `chrome.runtime.onConnect` 支持 port 通道（分批题库解析进度上报）

- `background/api-client.js`
  - 读取 API 配置（支持按任务类型读取专用模型：答题/抽题）
  - 调用 `/chat/completions`

- `background/prompt-builder.js`
  - 读取 `data/prompt-templates.json`
  - 拼装答题、题库校验、AI 选区抽题、题库解析的提示词
  - 拼装搜索感知提示词和搜索结果提示词

- `background/json-parser.js`
  - 去 markdown fence
  - JSON 解析
  - AI 返回结构归一化

- `background/question-bank.js`
  - 题库导入解析（支持分批 `handleParseQuestionBankBatched`）
  - 题库 fallback 规则解析
  - 题库相似题搜索

- `background/search-proxy.js`
  - 联网搜索代理（后台 Service Worker 执行）
  - 支持多服务商（Brave Search、豆包搜索/火山引擎）
  - 统一参数 → 具体服务商 API 参数映射
  - 搜索结果提取、格式化、参考链接提取

- `background/webrequest-interceptor.js`
  - DNR（declarativeNetRequest）拦截器
  - 动态注入认证头 + Content-Type，规避 CORS 预检
  - 根据服务商配置动态构建 DNR 规则

### 7.2 当前消息动作清单

`background/router.js` 当前支持以下动作：

1. `fetchAnswer`
   - 输入：题目文本、题型
   - 输出：AI 参考答案

2. `fetchAnswerWithSearch`
   - 输入：题目文本、题型、是否强制搜索（`forceSearch`）
   - 输出：带联网搜索结果的 AI 参考答案 + 参考链接列表
   - 流程：第一次 LLM 调用（搜索感知）→ 判断是否需要搜索 → 执行搜索 → 第二次 LLM 调用（带搜索结果）
   - 搜索不可用或达上限时自动降级为普通 `fetchAnswer`

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
   - 输出：题库相似题匹配结果

此外，`background/index.js` 独立注册了 `webSearch` 动作监听器（早于 router）：

7. `webSearch`
   - 输入：搜索服务商配置、搜索设置、搜索词
   - 输出：原始搜索结果数据
   - 含每月搜索次数限制检查

### 7.3 维护重点

- 后台是当前最适合继续扩展 AI 能力的区域。
- 如果后续 AI 需要改提示词，优先查：
  - `data/prompt-templates.json`
  - `background/prompt-builder.js`
- 如果后续 AI 需要改题库解析结果格式，优先查：
  - `background/json-parser.js`
  - `background/question-bank.js`
- 如果后续 AI 需要新增消息动作，优先查：
  - `background/router.js`（普通 onMessage 动作）
  - `background/index.js`（需要独立监听器的动作）
- 如果后续 AI 需要改联网搜索，优先查：
  - `background/search-proxy.js`（搜索执行与结果提取）
  - `background/webrequest-interceptor.js`（认证头注入）
  - `options/search-section.js`（服务商配置 UI）

## 8. 共享层与静态数据

### 8.1 shared 目录

用于放页面/脚本共用的常量和工具：

- `shared/constants.js`
  - `STORAGE_KEYS`
  - `DEFAULT_SHORTCUT`
  - `TYPE_LABELS`
  - `STATUS_LABELS`

- `shared/shortcut-utils.js`
  - 快捷键格式化
  - 快捷键匹配
  - 默认快捷键
  - 修饰键判断

- `shared/theme-utils.js`
  - 主题模式保存与加载
  - 浅色/深色解析
  - 页面主题应用

- `shared/storage-utils.js`
  - 常见 storage 读取工具

- `shared/text-utils.js`
  - `normalizeWhitespace` — 空白字符规范化
  - `escapeRegex` — 正则特殊字符转义
  - `escapeHtml` — HTML 实体转义

- `shared/text-splitter.js`
  - `splitTextByQuestions` — 按题目边界拆分题库文本为多个批次
  - 无法识别题号时退化为按段落 + 字符数拆分

- `shared/variables.css`
  - Design Token 变量定义，运行时通过 `fetch` 注入 Shadow DOM

- `shared/toggle.css`
  - 开关组件（`.switch`）样式，供设置页使用

### 8.2 data 目录

当前静态数据有两份：

- `data/default-parse-rule.json`
  - 默认解析规则种子
  - 包含 `selectors` 与 `typeKeywords`

- `data/prompt-templates.json`
  - AI 答题提示词
  - 题库校验提示词
  - AI 选区抽题提示词
  - 题库导入解析提示词

## 9. 当前页面维护建议

如果后续 AI 需要更新页面，建议按下面的判断顺序定位：

1. 要改页面布局或新增 DOM 节点
   - 先看 `popup/popup.html` / `options/options.html`
   - content 面板则看 `content/panel-ui.js` 的 `createPanel` 与卡片渲染代码

2. 要改样式
   - popup：`popup/popup.html` + `popup/popup.css`
   - options：`options/options.css`
   - content 面板：`content/panel.css`
   - 页面级辅助样式：`content-styles.css`

3. 要改存储字段
   - 先看 `shared/constants.js`
   - 再全局搜对应 key

4. 要改 AI 相关能力
   - 先看 `background/router.js`
   - 再看 `background/prompt-builder.js`
   - 最后看 `background/question-bank.js` / `background/json-parser.js`

5. 要改题目提取或面板交互
   - DOM 解析：`content/dom-parser.js`
   - 面板渲染：`content/panel-ui.js`
   - 分析流程：`content/analyzer.js`
   - 编排入口：`content/index.js`

6. 要改设置页功能
   - 重点看 `options/index.js` 及对应模块文件（见 5.4）

## 10. 已知现状说明

这份文档描述的是**当前代码实际状态**，不是理想目标状态。需要特别注意：

- `options/options.css` 和 `content/panel.css` 已完成样式独立
- `popup/popup.html` + `popup/popup.css` 已完成样式独立
- `popup/popup.js` 体量较小
- `background` 已完成较明确的模块化
- `content/index.js` 已拆分为 5 个模块（`state.js` / `dom-parser.js` / `panel-ui.js` / `analyzer.js` / `index.js`），单文件最大 ~630 行
- `options/index.js` 仍可继续细拆
- 重复的常量和快捷键函数已被消除，改为统一引用 `shared/`

## 11. 建议后续 AI 接手顺序

如果后续要继续维护或重构，建议 AI 按这个顺序理解代码：

1. 先读 `manifest.json`
2. 再读本文件
3. 再看 `background/router.js`
4. 再看 `popup/popup.html` + `popup/popup.js`
5. 再看 `options/options.html` + `options/index.js`
6. 最后看 content 模块，按注入顺序：`content/state.js` → `content/dom-parser.js` → `content/panel-ui.js` → `content/analyzer.js` → `content/index.js`

这样能先建立入口和消息流，再进入最复杂的注入逻辑。
