# Quiz Helper

## 项目概览

- 当前仓库是独立的 `quiz-helper` 浏览器插件项目，不再是多项目 playground。
- 插件类型：Manifest V3
- 主要技术：JavaScript、HTML、CSS
- 默认语言：`zh_CN`

## 主要入口

- `manifest.json`：插件清单与运行时入口
- `popup/popup.html` + `popup/popup.js`：浏览器工具栏弹窗
- `options/options.html` + `options/index.js`：设置页
- `background.js` + `background/*.js`：后台 Service Worker 与业务模块
- `content/index.js` + `content/*.js` + `content/panel.css`：页面注入面板

## 目录结构

- `background/`：后台消息路由、AI 请求、题库检索、联网搜索等逻辑
- `content/`：页面题目解析、面板 UI、分析流程
- `options/`：设置页各分区逻辑
- `shared/`：共享常量、存储、主题、文本与快捷键工具
- `data/`：默认解析规则、提示词模板等静态数据
- `popup/`：弹窗页面
- `docs/`：项目说明文档
- `icons/`：图标资源
- `lib/`：第三方库

## 运行结构

- `background.js` 是 MV3 要求的薄入口，实际逻辑位于 `background/index.js` 及其模块中。
- `content_scripts` 由 `manifest.json` 统一配置，并按顺序注入共享脚本与内容脚本。
- 页面通用注入样式位于 `content-styles.css`。

## 关键文件

- `docs/structure.md`：当前页面结构、模块职责与维护说明
- `data/default-parse-rule.json`：默认解析规则
- `data/prompt-templates.json`：AI 提示词模板
- `icons.js`：SVG 图标替换逻辑
- `shared/storage-utils.js`：存储读写工具

## 当前权限

定义于 `manifest.json`：

- `storage`
- `activeTab`
- `scripting`
- `declarativeNetRequest`
- `host_permissions: <all_urls>`

## Content Script 注入顺序

当前 `manifest.json` 中的 `content_scripts[0].js` 顺序为：

1. `icons.js`
2. `shared/constants.js`
3. `shared/shortcut-utils.js`
4. `shared/theme-utils.js`
5. `shared/storage-utils.js`
6. `shared/text-utils.js`
7. `content/state.js`
8. `content/dom-parser.js`
9. `content/panel-ui.js`
10. `content/analyzer.js`
11. `content/index.js`

如果调整共享工具或内容脚本初始化逻辑，需要同步检查这里的依赖顺序。

## 主要界面

- Popup：
  - 分析当前页面题目
  - 打开设置页
  - 显示快捷键提示
  - 切换主题
- Options：
  - 基本设置
  - 大模型管理
  - 联网搜索设置
  - 解析规则管理
  - 题库管理
  - 历史记录管理
- Content 面板：
  - 从页面 DOM 解析题目
  - 展示题目卡片与答题结果
  - AI 选区解析
  - 题库匹配与校验

## 后台消息动作

当前主要由 `background/router.js` 路由：

- `fetchAnswer`
- `verifyBankAnswer`
- `extractQuestions`
- `parseQuestionBank`
- `searchQuestionBank`

新增 AI 能力时，需要同时更新路由、提示词构建和对应数据流。

## 维护建议

- `options/index.js` 和 `content/index.js` 仍然是主要维护入口。
- 页面样式主要集中在：
  - `options/options.css`
  - `content/panel.css`
  - `popup/popup.css`
- 可复用逻辑优先放入 `shared/`。
- 固定配置与模板数据优先放入 `data/`。

## 语言

- 代码注释与界面文案以中文为主。
