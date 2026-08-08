// 每月搜索次数限制检查与递增（按服务商）
// 由 background/index.js（webSearch 独立监听）与 background/router.js（fetchAnswerWithSearch）共用

/**
 * 检查每月搜索次数限制（按服务商）
 * @param {string} providerId
 * @returns {Promise<boolean>} true 表示可用，false 表示达到上限
 */
export async function checkMonthlySearchLimit(providerId) {
  const result = await chrome.storage.local.get(['web_search_providers', 'web_search_usage']);
  const providers = result.web_search_providers || [];
  const provider = providers.find(p => p.id === providerId);
  const limit = parseInt(provider?.monthlyLimit, 10) || 0;
  if (limit <= 0) return true; // 0 表示不限制

  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = result.web_search_usage || {};
  const pu = usage[providerId] || { month: '', count: 0 };
  if (pu.month !== currentMonth) {
    pu.month = currentMonth;
    pu.count = 0;
  }
  return pu.count < limit;
}

/**
 * 递增每月搜索次数（按服务商）
 * @param {string} providerId
 */
export async function incrementMonthlySearchCount(providerId) {
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
