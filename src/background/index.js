import './webrequest-interceptor.js';
import { registerBackgroundRouter } from './router.js';
import { executeWebSearch } from './search-proxy.js';
import { checkMonthlySearchLimit, incrementMonthlySearchCount } from './search-usage.js';

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

registerBackgroundRouter();
