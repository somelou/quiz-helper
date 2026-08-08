// Background 入口：主逻辑已迁移到 `background/index.js`。
// 副作用导入 i18n 工具，保证 Service Worker 中可用 globalThis.QuizHelperI18n
import './shared/i18n-utils.js';
import './background/index.js';
