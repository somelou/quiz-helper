// 用户脚本注入模块：基于 chrome.userScripts API（Chrome 120+）
// 将设置页维护的 user_scripts 注册到页面 MAIN world，脚本可访问页面真实 window（unsafeWindow）。
// 权限采用 optional_permissions + 运行时请求；API 不可用时静默降级，不影响其它功能。
import '../shared/constants.js';

const { STORAGE_KEYS, RUN_AT_OPTIONS } = globalThis.QuizHelperConstants;

// MAIN world 下 window 即页面真实 window，与 Tampermonkey 的 unsafeWindow 语义一致
const PRELUDE = 'const unsafeWindow = window;\n';

// 默认用户脚本数据文件（src/data/default-user-script.json），首次初始化时种子化
const DEFAULT_USER_SCRIPT_URL = chrome.runtime.getURL('data/default-user-script.json');

let syncTimer = null;

// 默认用户脚本加载 Promise（与解析规则种子逻辑一致：只 fetch 一次）
let defaultUserScriptPromise = null;

function loadDefaultUserScript() {
  if (!defaultUserScriptPromise) {
    defaultUserScriptPromise = fetch(DEFAULT_USER_SCRIPT_URL).then(async res => {
      if (!res.ok) throw new Error(`加载默认用户脚本失败: ${res.status}`);
      return res.json();
    });
  }
  return defaultUserScriptPromise;
}

/**
 * 首次初始化种子化默认脚本。
 * 仅当 user_scripts 从未写入过（值为 undefined）时写入；用户手动删除后列表为 []，不会重复添加。
 * @returns {Promise<boolean>} 是否执行了种子化
 */
export async function seedDefaultUserScript() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.USER_SCRIPTS]);
  if (result[STORAGE_KEYS.USER_SCRIPTS] !== undefined) return false;
  const defaultScript = await loadDefaultUserScript();
  await chrome.storage.local.set({
    [STORAGE_KEYS.USER_SCRIPTS]: [{ ...defaultScript, timestamp: Date.now() }]
  });
  return true;
}

/**
 * 探测 chrome.userScripts 是否可用（权限已授予 + 用户开关已打开 + Chrome >= 120）
 * 官方推荐写法：调用一个必然成功的方法，抛错即不可用。
 */
export function isUserScriptsAvailable() {
  try {
    if (typeof chrome === 'undefined' || !chrome.userScripts) return false;
    chrome.userScripts.getScripts();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 幂等全量同步：清空已注册脚本后，按 storage 中启用状态逐个重新注册。
 * 单个脚本失败（如 matches 非法）只记录，不阻断其它脚本。
 * @returns {Promise<{available: boolean, failed: Array<{id, name, error}>}>}
 */
export async function syncUserScripts() {
  if (!isUserScriptsAvailable()) {
    console.warn('[user-scripts] chrome.userScripts 不可用（权限未授予、开关未开启或 Chrome 版本过低），已跳过同步');
    return { available: false, failed: [] };
  }

  const result = await chrome.storage.local.get([STORAGE_KEYS.USER_SCRIPTS]);
  const scripts = result[STORAGE_KEYS.USER_SCRIPTS] || [];
  const enabled = scripts.filter(s => s && s.enabled);

  try {
    await chrome.userScripts.unregister();
  } catch (e) {
    // 无已注册脚本时 unregister 也可能抛错，忽略
  }

  const failed = [];
  for (const script of enabled) {
    const matches = Array.isArray(script.matches) ? script.matches.filter(Boolean) : [];
    if (!matches.length || !script.code || !script.id) continue;
    try {
      await chrome.userScripts.register([{
        id: script.id,
        matches,
        runAt: RUN_AT_OPTIONS.includes(script.runAt) ? script.runAt : 'document_idle',
        world: 'MAIN',
        js: [{ code: PRELUDE + script.code }]
      }]);
    } catch (err) {
      failed.push({
        id: script.id,
        name: script.name || script.id,
        error: (err && err.message) ? err.message : String(err)
      });
      console.warn('[user-scripts] 脚本注册失败:', script.name || script.id, err);
    }
  }

  if (failed.length) {
    console.warn('[user-scripts] 部分脚本注册失败:', failed);
  }
  return { available: true, failed };
}

/** 去抖触发同步，避免连续 storage 变更重复注册 */
export function scheduleUserScriptsSync(delay = 300) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncUserScripts().catch(err => console.warn('[user-scripts] 同步失败:', err));
  }, delay);
}
