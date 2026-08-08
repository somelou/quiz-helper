// DNR (declarativeNetRequest) 拦截器：注入认证头 + CORS 响应头
// MV3 中只有 DNR 能在不触发预检的情况下修改请求/响应头

// 动态规则 ID 起始值（确保不冲突）
const RULE_ID_BASE = 1000;

function buildDynamicRules(providers) {
  const rules = [];
  let ruleId = RULE_ID_BASE;

  for (const p of providers) {
    if (!p.apiKey || !p.endpoint) continue;

    let urlFilter;
    try {
      urlFilter = `*://${new URL(p.endpoint).host}/*`;
    } catch {
      continue;
    }

    const authValue = p.authHeader === 'Authorization'
      ? `Bearer ${p.apiKey}`
      : p.apiKey;

    const requestHeaders = [
      { header: p.authHeader, operation: 'set', value: authValue }
    ];

    // POST 型 API 额外注入 Content-Type（避免 fetch 中设置触发预检）
    if (p.id !== 'brave-search') {
      requestHeaders.push({ header: 'Content-Type', operation: 'set', value: 'application/json' });
      // 火山引擎需要 X-Traffic-Tag 头（官方 SDK 第 51 行），仅对该服务商注入
      if (p.id === 'volcengine-search') {
        requestHeaders.push({ header: 'X-Traffic-Tag', operation: 'set', value: 'skill_web_search_common' });
      }
    }

    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders,
        // 响应头注入 CORS 许可（部分 API 不返回 Access-Control-Allow-Origin）
        responseHeaders: [
          { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' }
        ]
      },
      condition: {
        urlFilter
      }
    });
  }

  return rules;
}

async function syncRules() {
  try {
    const result = await chrome.storage.local.get(['web_search_providers']);
    const providers = result.web_search_providers || [];

    const rules = buildDynamicRules(providers);

    // 移除所有旧规则
    const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = oldRules.map(r => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldIds,
      addRules: rules
    });

    console.log('[dnr-interceptor] 规则已同步:', rules.length, '条，移除旧规则:', oldIds.length);
  } catch (e) {
    console.error('[dnr-interceptor] 同步规则失败:', e);
  }
}

// 监听 storage 变化，自动同步规则
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.web_search_providers) {
    console.log('[dnr-interceptor] 检测到服务商变更，重新同步规则...');
    syncRules();
  }
});

// 初始化
syncRules();

console.log('[dnr-interceptor] DNR 拦截器已初始化');
