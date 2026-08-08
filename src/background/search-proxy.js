// 联网搜索代理（后台 Service Worker 执行）
// 认证头及 Content-Type 由 webrequest-interceptor.js 在网络层注入，规避 CORS 预检

// 共享的搜索结果提取工具（IIFE，挂 globalThis.QuizHelperSearchUtils）
import '../shared/search-utils.js';

const { getMessage } = globalThis.QuizHelperI18n;

/**
 * 设置嵌套对象属性，支持 'Filter.TimeRange' 点路径
 */
function setNestedParam(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * 将统一参数转为具体 API 的请求参数
 */
export function buildSearchRequest(provider, settings, query) {
  const mapping = provider.paramMapping || {};
  const params = {};

  // 合并服务商默认参数
  if (provider.defaultParams) {
    Object.assign(params, provider.defaultParams);
  }

  if (mapping.q !== undefined) {
    if (mapping.q !== null) {
      setNestedParam(params, mapping.q, query);
    }
  } else {
    params.q = query;
  }

  if (mapping.count) {
    setNestedParam(params, mapping.count, settings.count);
  }

  if (mapping.timeRange && settings.timeRange) {
    const value = convertTimeRange(settings.timeRange, provider.id);
    setNestedParam(params, mapping.timeRange, value);
  }

  if (mapping.language && provider.language) {
    setNestedParam(params, mapping.language, provider.language);
  }

  // 服务商独立参数：authInfoLevel（豆包 Filter.AuthInfoLevel）
  if (mapping.authInfoLevel && provider.authInfoLevel !== undefined && provider.authInfoLevel !== '') {
    setNestedParam(params, mapping.authInfoLevel, Number(provider.authInfoLevel));
  }

  // 服务商独立参数：blockHosts（豆包 Filter.BlockHosts）
  if (mapping.blockHosts && provider.blockHosts) {
    setNestedParam(params, mapping.blockHosts, provider.blockHosts);
  }

  // Tavily 独立参数：depth / include_answer 覆盖 defaultParams
  if (provider.id === 'tavily-search') {
    if (provider.searchDepth) params.search_depth = provider.searchDepth;
    if (provider.includeAnswer !== undefined) params.include_answer = provider.includeAnswer;
  }

  return params;
}

/**
 * 统一时间范围 → 各 API 实际值转换
 */
function convertTimeRange(unifiedValue, providerId) {
  if (providerId === 'brave-search') {
    const map = { OneDay: 'pd', OneWeek: 'pw', OneMonth: 'pm', OneYear: 'py' };
    return map[unifiedValue] || unifiedValue;
  }
  if (providerId === 'tavily-search') {
    const map = { OneDay: 'day', OneWeek: 'week', OneMonth: 'month', OneYear: 'year' };
    return map[unifiedValue] || unifiedValue;
  }
  return unifiedValue;
}

/**
 * 执行搜索请求（fetch 不带自定义头，认证头由 DNR 注入）
 */
export async function executeWebSearch(provider, settings, query) {
  const params = buildSearchRequest(provider, settings, query);
  console.log('[search-proxy] 搜索请求:', { provider: provider.id, endpoint: provider.endpoint, query, params });

  const isGet = provider.id === 'brave-search';
  const url = isGet
    ? `${provider.endpoint}?${new URLSearchParams(params).toString()}`
    : provider.endpoint;

  // 只设简单头（Accept 不会触发预检），Content-Type 由 DNR 注入
  const fetchOptions = {
    method: isGet ? 'GET' : 'POST',
    headers: { 'Accept': 'application/json' }
  };

  if (!isGet) {
    fetchOptions.body = JSON.stringify(params);
  }

  console.log('[search-proxy] fetch', fetchOptions.method, url);

  const response = await fetch(url, fetchOptions);

  console.log('[search-proxy] 响应状态:', response.status, response.statusText);

  if (!response.ok) {
    const body = await response.text();
    console.error('[search-proxy] 响应错误:', { status: response.status, body: body.slice(0, 500) });
    const err = new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    err.details = { status: response.status, body: body.slice(0, 1000), url: provider.endpoint };
    throw err;
  }

  const data = await response.json();
  console.log('[search-proxy] 搜索成功，数据大小:', JSON.stringify(data).length, 'bytes');
  return data;
}

/**
 * 将搜索结果格式化为 LLM 可读的编号文本块
 * @param {Array} results - extractSearchResults 的输出
 * @returns {string}
 */
export function formatSearchResultsForLLM(results) {
  if (!results || results.length === 0) return getMessage('bgNoSearchResults');

  return results.map((r, i) => {
    const title = r.title || getMessage('bgNoTitle');
    const snippet = r.snippet || '';
    return getMessage('bgSearchResultBlock', [i + 1, title, snippet, r.url || getMessage('bgNoUrl')]);
  }).join('\n\n');
}

/**
 * 从原始 API 数据中提取统一格式的搜索结果（同时供 LLM 阅读与 UI 参考链接展示）
 * 统一实现见 src/shared/search-utils.js（globalThis.QuizHelperSearchUtils.extractSearchResults）
 * @param {Object} data - 原始 API 响应
 * @param {string} providerId - 服务商标识
 * @returns {Array<{title: string, url: string, snippet: string}>}
 */
export function extractSearchResults(data, providerId) {
  return globalThis.QuizHelperSearchUtils.extractSearchResults(data, providerId);
}
