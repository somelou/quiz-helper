// 每月搜索次数限制检查与递增（按服务商）
// 由 background/index.js（webSearch 独立监听）与 background/router.js（fetchAnswerWithSearch）共用

// 跨月用量重置逻辑在共享工具中实现，供两个函数复用
import '../shared/search-utils.js';

const { getOrResetProviderUsage } = globalThis.QuizHelperSearchUtils;

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

  const usage = result.web_search_usage || {};
  const record = getOrResetProviderUsage(usage, providerId);
  return record.count < limit;
}

/**
 * 递增每月搜索次数（按服务商）
 * @param {string} providerId
 */
export async function incrementMonthlySearchCount(providerId) {
  const result = await chrome.storage.local.get(['web_search_usage']);
  const usage = result.web_search_usage || {};
  const record = getOrResetProviderUsage(usage, providerId);
  record.count += 1;
  usage[providerId] = record;
  await chrome.storage.local.set({ web_search_usage: usage });
}
