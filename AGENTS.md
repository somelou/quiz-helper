# Quiz Helper

## 项目概览

- 当前仓库是独立的 `quiz-helper` 浏览器插件项目，不再是多项目 playground。
- 插件类型：Manifest V3
- 主要技术：JavaScript、HTML、CSS
- 默认语言：`zh_CN`
- 插件完整运行目录位于 `src/`

## 主要入口

- `src/manifest.json`：插件清单与运行时入口
- `src/popup/popup.html` + `src/popup/popup.js`：浏览器工具栏弹窗
- `src/options/options.html` + `src/options/index.js`：设置页
- `src/background.js` + `src/background/*.js`：后台 Service Worker 与业务模块
- `src/content/index.js` + `src/content/*.js` + `src/content/panel.css`：页面注入面板

## 目录结构

- `src/background/`：后台消息路由、AI 请求、题库检索、联网搜索等逻辑
- `src/content/`：页面题目解析、面板 UI、分析流程
- `src/options/`：设置页各分区逻辑
- `src/shared/`：共享常量、存储、主题、文本与快捷键工具
- `src/data/`：默认解析规则、提示词模板等静态数据
- `src/popup/`：弹窗页面
- `docs/`：项目说明文档
- `src/icons/`：图标资源
- `src/lib/`：第三方库

## 运行结构

- `src/background.js` 是 MV3 要求的薄入口，实际逻辑位于 `src/background/index.js` 及其模块中。
- `content_scripts` 由 `src/manifest.json` 统一配置，并按顺序注入共享脚本与内容脚本。
- 页面通用注入样式位于 `src/content-styles.css`。

## 关键文件

- `docs/structure.md`：当前页面结构、模块职责与维护说明
- `src/data/default-parse-rule.json`：默认解析规则
- `src/data/prompt-templates.json`：AI 提示词模板
- `src/icons.js`：SVG 图标替换逻辑
- `src/shared/storage-utils.js`：存储读写工具

## 当前权限

定义于 `src/manifest.json`：

- `storage`
- `activeTab`
- `scripting`
- `declarativeNetRequest`
- `host_permissions: <all_urls>`

## Content Script 注入顺序

当前 `src/manifest.json` 中的 `content_scripts[0].js` 顺序为：

1. `src/icons.js`
2. `src/shared/i18n-utils.js`
3. `src/shared/constants.js`
4. `src/shared/shortcut-utils.js`
5. `src/shared/theme-utils.js`
6. `src/shared/storage-utils.js`
7. `src/shared/text-utils.js`
8. `src/content/state.js`
9. `src/content/dom-parser.js`
10. `src/content/panel-ui.js`
11. `src/content/analyzer.js`
12. `src/content/index.js`

如果调整共享工具或内容脚本初始化逻辑，需要同步检查这里的依赖顺序。

## 主要界面

- Popup：
  - 分析当前页面题目
  - 打开设置页
  - 显示快捷键提示
  - 切换主题
  - 快捷切换答题模型
- Options：
  - 基本设置
  - 大模型管理
  - 联网搜索设置
  - 解析规则管理
  - 题库管理
  - 历史记录管理
  - 备份与恢复
  - 关于
- Content 面板：
  - 从页面 DOM 解析题目
  - 展示题目卡片与答题结果（支持流式输出与深度思考展示）
  - AI 选区解析
  - 题库匹配与校验

## 后台消息动作

`src/background/router.js` 注册 `chrome.runtime.onMessage` 分发以下动作：

- `fetchAnswer`
- `fetchAnswerWithSearch`（搜索感知流程：首次作答 → 判断是否需搜索 → 二次作答，含自动降级）
- `verifyBankAnswer`
- `extractQuestions`
- `parseQuestionBank`
- `searchQuestionBank`

`src/background/index.js` 额外独立注册 `webSearch` 动作（含每月搜索次数限额检查）。

`src/background/router.js` 同时注册 `chrome.runtime.onConnect` port 通道：

- `parseQuestionBank`：题库分批解析，进度通过 port 上报
- `streamAnswer`：流式答题，逐块回传思考 / 答案 / 参考链接

新增 AI 能力时，需要同时更新路由、提示词构建和对应数据流。

## 维护建议

- `src/options/index.js` 和 `src/content/index.js` 仍然是主要维护入口。
- 页面样式主要集中在：
  - `src/options/options.css`
  - `src/content/panel.css`
  - `src/popup/popup.css`
- 可复用逻辑优先放入 `src/shared/`。
- 固定配置与模板数据优先放入 `src/data/`。

## 发布流程

如需发布离线安装包，可使用仓库内置发版脚本：

```bash
bash scripts/release-tag.sh --push
```

发版脚本会执行以下操作：

- 读取 `src/manifest.json` 中的版本号
- 自动同步 `README.md` 中的“插件版本”
- 如有需要，自动创建 `chore(release): 发布 x.y.z` 提交
- 创建对应的 Git tag，例如 `v2.4.2`
- 可选自动推送当前分支和 tag

GitHub 在收到 `v*` tag 后，会自动创建 Release，并上传基于 `src/` 目录打包的插件 zip 包。

如果只想先检查结果、不真正创建 tag，可先执行：

```bash
bash scripts/release-tag.sh --dry-run
```

## 语言

- 代码注释与界面文案以中文为主。
