# 题目助手（Quiz Helper）产品需求文档（PRD）

> 版本：3.1.1 ｜ 文档日期：2026-08-08
> 说明：本文档基于当前代码实际实现（`src/manifest.json` 版本 3.1.1）整理，作为产品功能、交互与约束的完整参考。

---

## 1. 产品概述

### 1.1 产品定位

「题目助手」是一款面向**网页题目场景**的浏览器插件（Manifest V3），帮助用户在网页上快速提取题目，并借助**用户自配的大模型接口**生成参考答案，同时支持题库匹配、AI 选区解析与联网搜索增强。

### 1.2 目标用户

- 需要处理大量网页题目的在线练习者
- 需要辅助分析网页题目的内容工作者
- 需要结合本地题库做答案校验的用户

### 1.3 核心价值

1. **免复制粘贴**：一键从当前页面提取题目与选项，逐题生成参考答案
2. **隐私优先**：配置、题库、历史记录全部保存在本地浏览器，请求直接发往用户自配的模型服务，不经过开发者服务器
3. **可扩展**：支持 OpenAI / Anthropic / Responses 三种 API 格式、自定义解析规则、AI 选区解析与联网搜索

---

## 2. 用户场景

| 场景 | 描述 |
|------|------|
| 整页快速答题 | 打开题目页面 → 点击插件 → 自动解析题目 → 逐题流式生成答案 |
| 复杂页面局部解析 | 页面结构复杂或规则不命中时，手动框选题目区域，由 AI 解析并自动沉淀规则 |
| 题库优先匹配 | 导入本地题库后，答题优先命中题库答案并校验选项顺序，减少 API 调用 |
| 联网搜索增强 | 模型不确定时触发联网搜索，结合搜索结果二次作答并附参考链接 |
| 离线稳定使用 | 关闭流式输出后，答案一次性返回，降低对网络稳定性的依赖 |

---

## 3. 功能需求

### 3.1 Popup 弹窗（`src/popup/`）

| 功能 | 说明 |
|------|------|
| 分析当前页面 | 向当前标签页发送 `analyze` 指令；content script 未加载时，按 manifest 的 content_scripts 清单动态注入后再发送 |
| 打开设置页 | 跳转 `options.html` |
| 主题切换 | 浅色 / 深色 / 跟随系统，持久化到 `theme_mode` |
| 快捷键提示 | 展示唤起面板的快捷键（未设置时显示默认 Alt+Q，显式清空则显示"未设置"） |
| 快捷切换答题模型 | 下拉展示启用中的模型，选中即写入 `active_model_id`（按模型展示名称判断选中态，名称在保存时强制唯一） |

### 3.2 设置页 Options（`src/options/`）

设置页采用**侧边导航 + 滚动内容布局**，包含 8 张卡片与 1 个通用详情抽屉。

#### 3.2.1 基本设置（`#section-settings`）

- **主题**：浅色 / 深色 / 跟随系统
- **系统提示词**：按题型（单选/多选/判断/填空/其他）分 tab 配置，占位符展示默认提示词
- **补充提示词**：附加背景信息
- **面板快捷键**：录制 / 清空 / 恢复默认
- **域名白名单**：每行一个域名，留空对所有站点生效

#### 3.2.2 大模型管理（`#section-models`）

- **多模型 CRUD**：新增 / 编辑 / 删除模型配置，可激活 / 停用
- **模型字段**：展示名称（保存时校验全局唯一）、API 格式（OpenAI / Anthropic / Responses）、API URL、API Key、模型 ID、内置工具（Responses 格式）、思考模式与强度
- **任务专用模型**：可为答题 / 题库解析 / AI 抽题分别指定模型（`active_model_id` / `model_bank_id` / `model_extract_id`）
- **测试连接**：按当前表单配置发起测试请求，支持流式（逐字展示思考与答案）与非流式（一次性返回，Markdown/LaTeX 渲染）
- **流式输出开关（`stream_output`，默认开启）**：全局公用设置，同时作用于**模型测试**与**实际答题**；关闭后两者均一次性返回完整结果

#### 3.2.3 联网搜索设置（`#section-search`）

- **总开关**：`web_search_enabled`
- **公共参数**：结果数量、时间范围（分段滑块）
- **服务商管理**：内置 Brave Search / 豆包搜索（火山引擎）/ Tavily Search 三个种子，支持 API Key、endpoint、每月限额及各服务商独立参数，支持测试搜索
- **每月限额**：按服务商统计月度搜索次数，达上限自动降级为普通答题

#### 3.2.4 解析规则管理（`#section-rules`）

- 按域名维护解析规则，支持**表单 / JSON 双视图**编辑器（JSON 带语法高亮与复制）
- 规则内容：根容器 / 单题容器 / 题型标题 / 题干 / 选项等选择器，题型指示器与文本关键词

#### 3.2.5 题库管理（`#section-bank`）

- **启用开关**：`question_bank_enabled`
- **导入解析模式**：节能 eco / 平衡 balanced / 精细 precise（分段滑块），对应并发数与每批题数
- **文件导入**：支持 `.xlsx` / `.xls` / `.docx`，后台经 port 通道分批解析并上报进度，支持取消
- **列表管理**：查看题目明细（含题型、答案、解析）、复制题目、删除题库

#### 3.2.6 历史记录（`#section-history`）

- 保存最近 50 条分析记录（时间、URL、标题、题目与答案）
- 支持单条查看 / 导出 / 删除，以及全量导出 / 清空

#### 3.2.7 备份与恢复（`#section-backup`）

- 按模块勾选（settings / models / search / rules / banks / history）导出为 JSON 文件
- 支持导入备份文件并按模块合并/覆盖

#### 3.2.8 关于（`#section-about`）

- 版本、仓库、隐私政策链接

### 3.3 内容面板 Content（`src/content/`）

注入到目标网页（Shadow DOM 隔离样式），包含：

- **题目卡片**：题号、题型标签、题目摘要、答案预览、状态标签（待分析/作答中/已完成/出错）
- **卡片详情**：题目原文（可复制）、深度思考区（可折叠）、参考答案、联网搜索参考链接、题库匹配参考
- **控制条**：暂停 / 继续、重新作答、规则重新解析、AI 选区解析
- **AI 选区解析**：鼠标悬停高亮可选区域，点击后 AI 解析该区域题目，可自动生成/合并解析规则
- **面板操作**：拖动、最小化为悬浮条、关闭
- **快捷键唤起**：默认 `Alt+Q`，可编辑目标（输入框等）与白名单校验后触发

### 3.4 后台服务 Background（`src/background/`）

#### 3.4.1 消息动作

| 动作 | 说明 |
|------|------|
| `fetchAnswer` | 普通答题（流式 / 非流式），按 `stream_output` 开关决定 |
| `fetchAnswerWithSearch` | 搜索感知答题：首次作答 → 判断 `[NEED_SEARCH:...]` → 联网搜索 → 二次作答，附参考链接；不可用时自动降级 |
| `verifyBankAnswer` | 题库命中后，按当前选项顺序校验答案 |
| `extractQuestions` | AI 选区抽题（返回题目 + selectors） |
| `parseQuestionBank` | 题库文本解析（onMessage 单批 + onConnect 分批带进度、可取消） |
| `searchQuestionBank` | 题库相似题检索（字符集 Jaccard 相似度，内存索引缓存） |
| `webSearch` | 独立注册的联网搜索动作（含每月限额检查） |

#### 3.4.2 API 能力

- 三种 API 格式统一封装：OpenAI Chat Completions、Anthropic Messages、OpenAI Responses
- 流式（SSE 解析：thinking / text / searchStatus / referenceLinks）与非流式
- 思考模式（thinking / reasoning_effort / output_config）与内置工具（Responses `web_search`）
- 带超时的 fetch 封装，支持外部 AbortSignal 取消

#### 3.4.3 联网搜索代理

- 支持 Brave / 豆包 / Tavily 三服务商，统一参数映射到各自 API 格式
- 通过 DNR（declarativeNetRequest）动态注入认证头规避 CORS 预检

---

## 4. 非功能需求

### 4.1 性能

- 内容面板批量渲染采用静默更新（`updateCardBody` 的 `silent` 参数），避免 O(n²) 重复刷新
- 题库检索使用内存索引缓存（超过 3000 条不缓存，防止拖垮 Service Worker）
- 后台 API 请求默认 120 秒超时，支持外部信号取消

### 4.2 安全与隐私

- 本地存储：配置、题库、历史记录均保存在 `chrome.storage.local`
- 模型请求直接发往用户配置的服务地址，不经过第三方服务器
- 无埋点、无广告、无第三方追踪
- 仅 `storage` / `activeTab` / `scripting` / `declarativeNetRequest` 权限 + `<all_urls>` 主机权限

### 4.3 兼容性

- Chrome / Edge（Manifest V3）
- 深 / 浅色主题（Design Token + CSS 变量）
- 多语言基础框架（`_locales/zh_CN`，默认中文）

---

## 5. 数据存储

| Key | 用途 |
|-----|------|
| `llm_models` / `active_model_id` / `model_bank_id` / `model_extract_id` | 多模型配置与任务专用模型 |
| `stream_output` | 流式输出开关（默认开启） |
| `custom_system_prompts` / `extra_context_prompt` | 分题型系统提示词与补充提示词 |
| `parse_rules` / `default_parse_rule_seeded_v1` | 解析规则与默认规则种子标记 |
| `allowed_domains` | 域名白名单 |
| `panel_shortcut` / `theme_mode` | 快捷键与主题 |
| `web_search_enabled` / `active_search_provider_id` / `web_search_providers` / `web_search_settings` / `web_search_usage` | 联网搜索配置与月度用量 |
| `question_bank_enabled` / `question_banks` / `active_bank_id(s)` / `import_mode` | 题库相关 |
| `exam_history` | 历史记录（上限 50 条） |

---

## 6. 边界与限制

- 页面 DOM 结构差异较大，个别站点需结合解析规则或 AI 选区解析使用
- 题库匹配基于文本相似度，答案仅供参考，不保证绝对正确
- Responses 格式的联网搜索为模型内置能力，需在模型「内置工具」中添加 `web_search`
- 关闭流式输出后，深度思考过程不会逐字展示，仅一次性返回最终答案

---

## 7. 未来规划

- 更多搜索服务商接入
- 多语言界面完善
- 解析规则模板市场 / 导入导出增强
- 题库支持更多文件格式与去重增强
- 答题历史导出格式扩展（CSV / Markdown）

---

## 8. 相关文档

- [README](../README.md) — 快速上手与常见问题
- [页面结构说明](./structure.md) — 代码结构、模块职责与维护落点
- [维护说明](../AGENTS.md) — 项目维护约定
- [隐私政策](../PRIVACY.md)
