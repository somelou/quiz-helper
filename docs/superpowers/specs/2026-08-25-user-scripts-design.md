# 用户脚本（User Scripts）功能设计

- 日期：2026-08-25
- 版本：3.1.2 → 3.2.0（预期）
- 状态：已确认，待实现

## 1. 背景与目标

为 Quiz Helper 插件增加类似 Tampermonkey 的"用户脚本"能力：用户可以在设置页编写自己的页面注入脚本，脚本运行在页面真实上下文（可访问页面自身的 `window` / `jQuery` 等全局变量，即 Tampermonkey 的 `unsafeWindow`），并按 URL 匹配自动注入到对应页面。

明确约束：

- 内置一个默认脚本「解除页面限制（默认）」（拦截 blur/focus 监听、移除右键/复制/剪切/粘贴限制），仅在**首次初始化**（`user_scripts` 从未写入）时种子化，用户可编辑或删除，删除后不重复添加。除此之外的示例脚本**不写死在代码里**，一律由用户自行添加。
- 不提供 GM_* 辅助 API，仅提供 `unsafeWindow`（= 页面真实 `window`）。
- URL 匹配使用 Chrome match patterns（与 Tampermonkey `@match` 一致）。
- 运行时机支持 `document_start` / `document_end` / `document_idle` 三档。
- 用户脚本纳入"备份与恢复"模块。
- **Chrome < 120 时仅此功能不可用，插件其余功能不受影响。**

## 2. 技术方案

采用 Chrome 官方 `chrome.userScripts` API（Chrome 120+，MV3），以 `world: "MAIN"` 注册脚本，使脚本运行在页面主世界，可直接访问页面全局对象。

### 2.1 为什么选 `chrome.userScripts`

- 官方为该场景（运行用户提供的任意代码）量身定制的 API。
- 脚本本体由浏览器编译注入，不受页面 CSP（`unsafe-eval`）拦截，能在强 CSP 站点运行。
- `matches` / `runAt` / `world` 原生支持，无需自建导航追踪与匹配逻辑。
- 与自建 `chrome.scripting.executeScript({ world: 'MAIN' })` + `new Function` 相比，后者在 MAIN world 内的动态代码会受到页面 CSP `unsafe-eval` 限制，鲁棒性差。

### 2.2 unsafeWindow

注册时代码前缀拼一行 `const unsafeWindow = window;`。`world: "MAIN"` 下 `window` 即页面真实 window，因此：

- 脚本里可用 `unsafeWindow`（兼容 Tampermonkey 写法）。
- 脚本可直接操作页面 `jQuery`、`document`、页面挂载的全局变量。

## 3. 权限与兼容性策略（重点）

### 3.1 manifest 改动

```jsonc
{
  "permissions": [ /* 保持现有不变 */ ],
  "optional_permissions": ["userScripts"]
}
```

- **不设** `minimum_chrome_version`。
- **不把** `userScripts` 放入 required `permissions`（未知权限会导致旧 Chrome 整个插件无法加载/安装）。
- `userScripts` 放 `optional_permissions`，运行时按需请求（Tampermonkey 同款做法）。

### 3.2 运行时启用流程（设置页"用户脚本"分区）

设置页加载该分区时运行状态检测，进入以下状态机：

| 状态 | 判定 | 界面表现 |
| --- | --- | --- |
| `unsupported` | Chrome < 120（权限请求抛"权限未知"错误 / API 不存在） | 显示"当前 Chrome 版本过低（需 120+），用户脚本功能不可用，其余功能不受影响" |
| `permission-needed` | ≥120 但 `chrome.permissions.contains({permissions:['userScripts']})` 为 false | 显示"启用"按钮，点击调 `chrome.permissions.request(...)`，弹出系统授权框 |
| `toggle-needed` | 已授权但 `chrome.userScripts` 不可用（undefined 或 `getScripts()` 抛错） | 显示引导：≥138 → 扩展详情页开 **Allow User Scripts**；<138 → `chrome://extensions` 开 **开发者模式** |
| `ready` | `chrome.userScripts` 可用 | 开放完整增删改查与列表渲染 |

关键细节：

- 权限授权成功后：options 页向后台发 `syncUserScripts` 消息触发重注册；后台同时监听 `chrome.permissions.onAdded`。
- Chrome 138+ 的"Allow User Scripts"开关关闭时，`chrome.userScripts` 可能为 undefined，且该状态只在扩展脚本上下文重载后重置；后台同步函数幂等，SW 重启后自然恢复。
- 版本判定：`navigator.userAgent` 匹配 `(Chrome|Chromium)\/(\d+)` 取主版本号，>=138 走新指引，否则走开发者模式指引。

## 4. 数据模型

### 4.1 存储

`src/shared/constants.js` 的 `STORAGE_KEYS` 新增：

```js
USER_SCRIPTS: 'user_scripts'
```

值为数组，元素结构：

```js
{
  id: 'us-1720000000000',              // 唯一 id，同时用作 userScripts 注册 id
  name: '解除复制粘贴限制',             // 显示名称
  matches: ['https://example.com/*'], // Chrome match patterns 数组
  runAt: 'document_start',             // document_start | document_end | document_idle
  enabled: true,
  code: '(function(){ ... })()',       // 用户 JS 代码
  timestamp: 1720000000000             // 创建/更新时间
}
```

### 4.2 常量

- `RUN_AT_OPTIONS`：`[{ value: 'document_start' }, { value: 'document_end' }, { value: 'document_idle' }]`（标签文案走 i18n）。

## 5. 后台模块：`src/background/user-scripts.js`

新建文件，由 `src/background/index.js` 引入。

### 5.1 `syncUserScripts()`

幂等全量同步：

1. 探测 `chrome.userScripts` 可用性：`typeof chrome.userScripts === 'undefined'` 或 `chrome.userScripts.getScripts()` 抛错 → 视为不可用，返回 `{ available: false }`，静默降级，不抛错。
2. 读取 `user_scripts`，取 `enabled === true` 的脚本。
3. 先 `chrome.userScripts.unregister()` 清空本扩展已注册脚本（或按 id 计算增删，实现取最简：全部注销后重新注册）。
4. 逐个 `chrome.userScripts.register([{ id, matches, runAt, world: 'MAIN', js: [{ code: PRELUDE + script.code }] }])`，每个脚本 try/catch：
   - 单个脚本 matches 非法等导致注册失败 → 收集 `{ id, name, error }`，不阻断其它脚本。
5. 返回 `{ available: true, failed: [...] }`。

PRELUDE 常量：

```js
const PRELUDE = 'const unsafeWindow = window;\n';
```

### 5.2 触发时机

| 时机 | 事件 |
| --- | --- |
| 模块加载（SW 启动） | 顶层调用 `syncUserScripts()`（先 `seedDefaultUserScript()` 种子化默认脚本，幂等） |
| 安装/更新 | `chrome.runtime.onInstalled`（扩展更新会清空已注册脚本，需重注册；`reason === 'install' | 'update'` 都执行，且首次写入默认脚本） |
| 存储变化 | `chrome.storage.onChanged` 中 `user_scripts` 变化 |
| 权限授予 | `chrome.permissions.onAdded`（含 `userScripts`） |
| 设置页手动 | 接收 `syncUserScripts` 消息（onMessage） |

`syncUserScripts` 内部做去抖（如 200ms），避免连续触发。

### 5.3 错误处理

- API 不可用：静默返回，不影响其它后台逻辑。
- 单脚本注册失败：收集并上报（设置页展示）。
- 存储读写：沿用 `shared/storage-utils.js` 的 `safeSet`。

## 6. 设置页 UI：用户脚本分区

### 6.1 入口

- `src/options/options.html`：侧边导航新增"用户脚本"项，新增卡片 `#section-userscripts`。
- `src/options/options.css`：复用现有样式，新增少量列表/表单样式。
- 新模块文件 `src/options/userscript-section.js`，在 `src/options/index.js` 装配（`initUserScripts(...)`）。
- `src/options/options.html` 底部 script 引入该模块（跟随现有模块引入方式）。

### 6.2 样式一致性要求（硬性约束）

新增前端样式必须与现有设置页风格完全一致，**不引入独立的设计体系**：

- 复用 Design Token：颜色/圆角/间距/字体等一律取 `src/shared/variables.css` 与 `src/themes/*.css`（classic / apple 主题）定义的变量，禁止写死新色值或新字体。
- 深浅主题跟随 `theme_mode`，通过 options 页现有的 `body.dark` 机制自动适配，不新增主题切换逻辑。
- 组件复用现有约定：
  - 分段控件用 `.segmented-control`（含滑动指示器，需在 `index.js` 的 `setSegValue` 体系内初始化）。
  - 开关用 `.switch`（`shared/toggle.css`）。
  - 卡片/列表/空态/按钮/状态提示沿用 `options.css` 现有类名与层级习惯。
  - 编辑器放现有抽屉（`#drawerBody`），表单结构参考 `rule-section.js` / `model-section.js` 的抽屉表单写法。
- 新增样式写入 `src/options/options.css`（在对应分区注释块下追加），不新建独立的 css 文件。
- 图标沿用 `data-icon` + `icons.js` 替换机制，复用现有 `icons/*.svg`，优先不新增图标资源。

### 6.3 页面结构

1. 状态横幅区：`#userscriptStatus`（含 `unsupported` / `permission-needed` / `toggle-needed` 三种提示 + "启用"按钮 + "重新检测"按钮）。
2. 提示区：安全提示一行（"用户脚本以页面权限运行，请仅添加可信代码"）。
3. 列表容器：`#userScriptList`。
   - 每项：名称、matches 摘要、runAt 标签、启用开关、编辑/删除按钮。
4. 添加按钮：`#addUserScriptBtn`。
5. 抽屉（复用现有 `openDrawer`，type = `userscript`）：
   - 名称 input
   - matches textarea（每行一个 match pattern）
   - runAt 分段控件（`document_start` / `document_end` / `document_idle`）
   - 启用开关
   - 代码 textarea（等宽字体、monospace）
   - 保存/取消
   - `#drawerSaveBtn` 分发 `save-userscript` 动作

### 6.4 逻辑

- 加载：读取 `user_scripts` → 渲染列表；运行状态检测 → 渲染状态横幅。
- 新增/编辑：打开抽屉填写 → 保存写入 storage（`safeSet`）→ 后台 `storage.onChanged` 自动同步。
- 删除：确认后从 storage 移除。
- 启用开关：直接写 storage。
- 保存校验：name 非空、matches 至少一条非空、code 非空；matches 格式简单校验（以 `*://` / `http://` / `https://` 等开头或含 `://`）。

### 6.5 状态检测函数（放 `userscript-section.js`）

```js
async function checkUserScriptsStatus() {
  // 返回 { state: 'ready' | 'permission-needed' | 'toggle-needed' | 'unsupported', chromeVersion }
}
```

## 7. 备份与恢复

- `src/options/backup-section.js` 模块清单新增 `user_scripts`（label："用户脚本"）。
- 导出/导入逻辑按现有模块化机制自动覆盖（读取/写入 `user_scripts` key）。

## 8. i18n 文案

`_locales/zh_CN/messages.json` 与 `_locales/en/messages.json` 新增（前缀 `userscript`）：

- 侧边导航标题、卡片标题
- 状态：unsupported / permission-needed / toggle-needed / ready
- 引导按钮：启用、重新检测
- 启用开关说明、安全提示
- 表单字段：名称、匹配页面、运行时机、代码、启用
- runAt 三档标签
- 空列表、删除确认、保存校验错误
- 注册失败提示（含脚本名）

## 9. 边界与不在范围内

- 脚本改动在"下次页面加载"生效（与 Tampermonkey @run-at 行为一致），不对已打开页面回溯注入。
- 不提供 GM_* API、脚本市场、popup 入口。
- 不对用户脚本做沙箱（与 Tampermonkey 相同，以页面权限运行）。
- iframe 默认不注入（`allFrames` 默认 false），如需后续可加开关。
- 同一脚本同一页面由 `userScripts` 注册机制保证单次执行。

## 10. 验证方式

1. Chrome ≥ 120 加载插件，设置页"用户脚本"分区新增脚本（用"解除复制粘贴限制"示例逻辑，但由用户手动输入），打开匹配页面确认脚本生效、`unsafeWindow` 可访问页面全局。
2. 关闭扩展详情的 Allow User Scripts / 开发者模式 → 分区显示 toggle-needed 引导。
3. 模拟 Chrome < 120（如可用时）：确认仅该分区提示不可用，其余功能（分析题目、设置、题库）正常。
4. 备份导出 → 清空 → 导入 → 确认用户脚本被恢复。
5. 扩展更新（重新加载插件）后脚本仍能注入（onInstalled 重注册兜底）。
