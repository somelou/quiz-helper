// 联网搜索共享工具（IIFE + globalThis，供 options 普通脚本与 background ES module 复用）
(() => {
  'use strict';

  /**
   * 从各 API 返回数据中提取统一格式的搜索结果
   * @param {Object} data - 原始 API 响应
   * @param {string} providerId - 服务商标识
   * @returns {Array<{title: string, url: string, snippet: string}>}
   */
  function extractSearchResults(data, providerId) {
    if (providerId === 'brave-search') {
      const generic = data?.grounding?.generic || [];
      return generic.map(item => ({
        title: item.title || '',
        url: item.url || '',
        snippet: (item.snippets || []).join(' ')
      }));
    }

    // tavily-search
    if (providerId === 'tavily-search') {
      const results = data?.results || [];
      return results.map(item => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.content || ''
      }));
    }

    // volcengine-search / 默认 WebResults
    const webResults = data?.Result?.WebResults || data?.WebResults || [];
    return webResults.map(item => ({
      title: item.Title || '',
      url: item.Url || '',
      snippet: item.Snippet || item.Summary || ''
    }));
  }

  /**
   * 获取某搜索服务商的月度用量记录，若记录月份与当前月不同则重置计数
   * （供后台按服务商统计/限额检查使用，原地更新 usage 对象）
   * @param {Object} usage - web_search_usage 存储对象
   * @param {string} providerId - 服务商标识
   * @returns {{month: string, count: number}} 当前月的用量记录
   */
  function getOrResetProviderUsage(usage, providerId) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const record = usage[providerId] || { month: '', count: 0 };
    if (record.month !== currentMonth) {
      record.month = currentMonth;
      record.count = 0;
    }
    return record;
  }

  globalThis.QuizHelperSearchUtils = { extractSearchResults, getOrResetProviderUsage };
})();
