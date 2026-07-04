import './webrequest-interceptor.js';
import { registerBackgroundRouter } from './router.js';
import { executeWebSearch } from './search-proxy.js';

/**
 * 检查每月搜索次数限制（按服务商）
 */
async function checkMonthlySearchLimit(providerId) {
  const result = await chrome.storage.local.get(['web_search_providers', 'web_search_usage']);
  const providers = result.web_search_providers || [];
  const provider = providers.find(p => p.id === providerId);
  const limit = parseInt(provider?.monthlyLimit, 10) || 0;
  if (limit <= 0) return true;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = result.web_search_usage || {};
  const pu = usage[providerId] || { month: '', count: 0 };
  if (pu.month !== currentMonth) {
    pu.month = currentMonth;
    pu.count = 0;
  }
  return pu.count < limit;
}

async function incrementMonthlySearchCount(providerId) {
  const result = await chrome.storage.local.get(['web_search_usage']);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = result.web_search_usage || {};
  const pu = usage[providerId] || { month: '', count: 0 };
  if (pu.month !== currentMonth) {
    pu.month = currentMonth;
    pu.count = 0;
  }
  pu.count += 1;
  usage[providerId] = pu;
  await chrome.storage.local.set({ web_search_usage: usage });
}

// 独立注册 webSearch 监听器（早于 router，确保无拦截）
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'webSearch') {
    const providerId = request.provider?.id || '';
    // 检查每月限制
    checkMonthlySearchLimit(providerId).then(ok => {
      if (!ok) {
        sendResponse({ success: false, error: '本月搜索次数已达上限' });
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
