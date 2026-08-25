import './webrequest-interceptor.js';
import { registerBackgroundRouter } from './router.js';
import { executeWebSearch } from './search-proxy.js';
import { checkMonthlySearchLimit, incrementMonthlySearchCount } from './search-usage.js';
import { syncUserScripts, scheduleUserScriptsSync, seedDefaultUserScript } from './user-scripts.js';

const { getMessage } = globalThis.QuizHelperI18n;

// 独立注册 webSearch 监听器（早于 router，确保无拦截）
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'webSearch') {
    const providerId = request.provider?.id || '';
    // 检查每月限制
    checkMonthlySearchLimit(providerId).then(ok => {
      if (!ok) {
        sendResponse({ success: false, error: getMessage('bgMonthlySearchLimitReached') });
        return;
      }
      executeWebSearch(request.provider, request.settings, request.query)
        .then(data => {
          incrementMonthlySearchCount(providerId);
          sendResponse({ success: true, data });
        })
        .catch(err => {
          console.error('[webSearch] 搜索失败:', err);
          sendResponse({
            success: false,
            error: (err && err.message) ? err.message : String(err),
            stack: (err && err.stack) ? err.stack : ''
          });
        });
    });
    return true;
  }
  return false;
});

// 设置页手动触发用户脚本重同步（如刚授予 userScripts 权限后）
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'syncUserScripts') {
    syncUserScripts()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: (err && err.message) ? err.message : String(err) }));
    return true;
  }
  return false;
});

// 用户脚本初始化流程：首次使用种子化默认脚本，随后全量同步注册
async function bootstrapUserScripts() {
  try {
    await seedDefaultUserScript();
  } catch (err) {
    console.warn('[user-scripts] 默认脚本种子化失败:', err);
  }
  await syncUserScripts();
}

// 扩展安装/更新后：首次写入默认脚本并重注册（扩展更新会清空已注册的用户脚本）
chrome.runtime.onInstalled.addListener(() => {
  bootstrapUserScripts().catch(err => console.warn('[user-scripts] onInstalled 同步失败:', err));
});

// 用户脚本增删改 / 备份导入后自动同步（去抖）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.user_scripts) {
    scheduleUserScriptsSync();
  }
});

// 运行时授予 userScripts 可选权限后立即同步
if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(permissions => {
    if (permissions.permissions && permissions.permissions.includes('userScripts')) {
      syncUserScripts().catch(err => console.warn('[user-scripts] 权限授予后同步失败:', err));
    }
  });
}

registerBackgroundRouter();

// SW 每次启动兜底同步（幂等，含首次默认脚本种子化）
bootstrapUserScripts().catch(err => console.warn('[user-scripts] 启动同步失败:', err));
