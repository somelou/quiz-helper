// 联网搜索设置模块

// 将 Tavily 搜索深度档位映射为提示文案的 locale key 后缀
function tavilyDepthKey(depth) {
  const map = { basic: 'Basic', advanced: 'Advanced', fast: 'Fast', 'ultra-fast': 'UltraFast' };
  return (depth && map[depth]) || 'Basic';
}

// 内联常量（不再依赖 shared/search-params.js，防止选项页有任何直接 fetch 路径）
const DEFAULT_WEB_SEARCH_PROVIDERS = [
  {
    id: 'brave-search',
    name: 'Brave Search',
    desc: 'Brave LLM Context API，西文Agent场景友好',
    endpoint: 'https://api.search.brave.com/res/v1/llm/context',
    apiKey: '',
    authHeader: 'X-Subscription-Token',
    paramMapping: { count: 'count', timeRange: 'freshness', language: 'search_lang' },
    defaultParams: { safesearch: 'strict' },
    monthlyLimit: 1000,
    language: ''
  },
  {
    id: 'volcengine-search',
    name: '豆包搜索',
    desc: '火山引擎豆包搜索 Custom 版，中文Agent场景友好',
    endpoint: 'https://open.feedcoopapi.com/search_api/web_search',
    apiKey: '',
    authHeader: 'Authorization',
    paramMapping: { q: 'Query', count: 'Count', timeRange: 'TimeRange', authInfoLevel: 'Filter.AuthInfoLevel', blockHosts: 'Filter.BlockHosts' },
    defaultParams: { SearchType: 'web' },
    monthlyLimit: 500,
    authInfoLevel: '0',
    blockHosts: ''
  },
  {
    id: 'tavily-search',
    name: 'Tavily Search',
    desc: 'Tavily 实时搜索 API，注册即可免费使用',
    endpoint: 'https://api.tavily.com/search',
    apiKey: '',
    authHeader: 'Authorization',
    paramMapping: { q: 'query', count: 'max_results', timeRange: 'time_range' },
    defaultParams: { search_depth: 'basic', topic: 'general', include_answer: false, chunks_per_source: 3 },
    monthlyLimit: 1000,
    searchDepth: 'basic',
    includeAnswer: false
  }
];

const DEFAULT_WEB_SEARCH_SETTINGS = { count: 10, timeRange: '' };

// 分段滑块辅助（使用 index.js 中的全局 setSegValue/getSegValue）

function initSearch({
  searchListEl,
  searchEnabledInput,
  countInput, timeRangeEl,
  drawerBodyEl, drawerTitleEl, drawerMetaEl, drawerSaveBtn, drawerOverlay,
  onCloseDrawer
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;

  let currentEditingProvider = null;

  // 默认服务商名称/描述本地化（用户自定义服务商直接使用其原始值）
  function getProviderDisplayName(provider) {
    if (provider.id === 'volcengine-search') return getMessage('optionsSearchProviderNameVolc');
    return provider.name;
  }

  function getProviderDisplayDesc(provider) {
    const descKeys = {
      'brave-search': 'optionsSearchProviderDescBrave',
      'volcengine-search': 'optionsSearchProviderDescVolc',
      'tavily-search': 'optionsSearchProviderDescTavily'
    };
    const key = descKeys[provider.id];
    return key ? getMessage(key) : provider.desc;
  }

  function showStatus(msg, isError) {
    globalThis.QuizHelperMessage[isError ? 'error' : 'info'](msg);
  }

  // ===== 加载 =====

  /**
   * 将已存储的服务商配置与默认定义对齐（迁移 + 规范化）
   * @param {Array} providers 已存储的服务商列表
   * @param {Array} defaults  默认服务商定义
   * @returns {boolean} 是否有变更需要保存
   */
  function normalizeProviders(providers, defaults) {
    let changed = false;

    // 1. 补全缺失的默认服务商
    for (const def of defaults) {
      if (!providers.find(p => p.id === def.id)) {
        providers.push(JSON.parse(JSON.stringify(def)));
        changed = true;
      }
    }

    // 2. 逐个规范化（以默认定义为 schema，合并已存储的值）
    const CORE_KEYS = ['id', 'name', 'desc', 'endpoint', 'apiKey', 'authHeader', 'paramMapping', 'defaultParams', 'monthlyLimit'];
    const OBSOLETE_PARAMS = ['NeedSummary', 'IncludeRandomSummary', 'summary', 'NeedContentDetail'];

    for (const p of providers) {
      const def = defaults.find(d => d.id === p.id);
      if (!def) continue; // 用户自定义服务商跳过

      // 基础字段同步（endpoint 用户可编辑，不同步）
      for (const key of ['name', 'desc', 'authHeader']) {
        if (p[key] !== def[key]) { p[key] = def[key]; changed = true; }
      }

      // paramMapping 合并（def 打底，已有配置优先但又以 def 最新为准）
      const fixedMapping = {};
      for (const k of Object.keys(def.paramMapping || {})) {
        fixedMapping[k] = def.paramMapping[k];
      }
      // 保留用户自定义的映射项（def 中不存在的）
      for (const k of Object.keys(p.paramMapping || {})) {
        if (!(k in (def.paramMapping || {}))) {
          fixedMapping[k] = p.paramMapping[k];
        }
      }
      if (JSON.stringify(fixedMapping) !== JSON.stringify(p.paramMapping)) {
        p.paramMapping = fixedMapping;
        changed = true;
      }

      // defaultParams 合并（def 打底，用户值覆盖，清理废弃字段）
      const mergedParams = { ...def.defaultParams, ...p.defaultParams };
      for (const key of OBSOLETE_PARAMS) {
        if (key in mergedParams) { delete mergedParams[key]; }
      }
      if (JSON.stringify(mergedParams) !== JSON.stringify(p.defaultParams)) {
        p.defaultParams = mergedParams;
        changed = true;
      }

      // 独立参数（非核心字段）补全 / 清理
      for (const key of Object.keys(def)) {
        if (CORE_KEYS.includes(key)) continue;
        if (p[key] === undefined) { p[key] = def[key]; changed = true; }
      }
      for (const key of Object.keys(p)) {
        if (CORE_KEYS.includes(key) || key === 'apiKey') continue;
        if (!(key in def)) { delete p[key]; changed = true; }
      }

      // monthlyLimit 补全
      if (p.monthlyLimit === undefined) { p.monthlyLimit = def.monthlyLimit ?? 0; changed = true; }
    }

    return changed;
  }

  async function loadSearchProviders() {
    const result = await chrome.storage.local.get([
      'web_search_providers', 'active_search_provider_id',
      'web_search_settings', 'web_search_enabled',
      'web_search_usage'
    ]);

    let providers = result.web_search_providers || [];

    // 首次加载：写入种子数据
    if (!providers.length) {
      providers = JSON.parse(JSON.stringify(DEFAULT_WEB_SEARCH_PROVIDERS));
      await safeSet({ web_search_providers: providers });
    } else {
      // 规范化已有配置
      if (normalizeProviders(providers, DEFAULT_WEB_SEARCH_PROVIDERS)) {
        await safeSet({ web_search_providers: providers });
      }
    }

    const activeId = result.active_search_provider_id || '';
    const settings = result.web_search_settings || DEFAULT_WEB_SEARCH_SETTINGS;
    const enabled = result.web_search_enabled !== undefined ? result.web_search_enabled : false;

    // 回填总开关
    searchEnabledInput.checked = enabled;

    // 回填通用搜索设置
    countInput.value = settings.count || 10;
    setSegValue(timeRangeEl, settings.timeRange || '');

    // 渲染服务商列表
    renderSearchProviders(providers, activeId, result.web_search_usage);
  }

  // ===== 渲染 =====

  function renderSearchProviders(providers, activeId, usageData = {}) {
    searchListEl.innerHTML = '';
    const currentMonth = new Date().toISOString().slice(0, 7);

    providers.forEach(provider => {
      const isActive = provider.id === activeId;
      const item = document.createElement('div');
      item.className = 'list-item' + (isActive ? ' search-item-active' : '');

      // 每月用量
      const limit = parseInt(provider.monthlyLimit, 10) || 0;
      const pu = usageData[provider.id] || { month: '', count: 0 };
      const usageCount = pu.month === currentMonth ? pu.count : 0;
      let usageHtml = '';
      if (limit > 0) {
        const remaining = Math.max(0, limit - usageCount);
        const usageColor = usageCount >= limit ? 'var(--color-error-text)' : 'var(--color-text-muted)';
        usageHtml = `<span class="search-usage-badge" style="color:${usageColor};font-size:11px;">${getMessage('optionsSearchUsageFormat', [usageCount, limit])}</span>`;
      }

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">
              ${escapeHtml(getProviderDisplayName(provider))}
              ${isActive
                ? '<span class="search-provider-badge search-badge-active">' + getMessage('optionsSearchActiveBadge') + '</span>'
                : '<span class="search-provider-badge search-badge-inactive">' + getMessage('optionsSearchInactiveBadge') + '</span>'}
            </div>
            <div class="list-item-meta">${usageHtml}${escapeHtml(getProviderDisplayDesc(provider))}</div>
          </div>
          <div class="list-item-actions">
            <label class="switch">
              <input type="checkbox" data-action="toggle-search" data-id="${provider.id}" ${isActive ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
            <button class="action-btn action-edit" data-id="${provider.id}">${getMessage('optionsSearchConfigure')}</button>
          </div>
        </div>
      `;

      // 激活/取消（直接操作 DOM，保留 switch 动画）
      item.querySelector('[data-action="toggle-search"]').addEventListener('change', async (event) => {
        event.stopPropagation();
        const checked = event.target.checked;
        if (checked) {
          // 取消上一个激活项的选中状态
          const prevActive = searchListEl.querySelector('.search-item-active');
          if (prevActive && prevActive !== item) {
            const prevCheckbox = prevActive.querySelector('[data-action="toggle-search"]');
            if (prevCheckbox) prevCheckbox.checked = false;
            const prevBadge = prevActive.querySelector('.search-provider-badge');
            if (prevBadge) {
              prevBadge.textContent = getMessage('optionsSearchInactiveBadge');
              prevBadge.className = 'search-provider-badge search-badge-inactive';
            }
            prevActive.classList.remove('search-item-active');
          }
          // 更新当前项
          item.classList.add('search-item-active');
          const badge = item.querySelector('.search-provider-badge');
          if (badge) {
            badge.textContent = getMessage('optionsSearchActiveBadge');
            badge.className = 'search-provider-badge search-badge-active';
          }
          await safeSet({ active_search_provider_id: provider.id });
          showStatus(getMessage('optionsSearchActivatedFormat', [getProviderDisplayName(provider)]));
        } else {
          // 取消激活
          item.classList.remove('search-item-active');
          const badge = item.querySelector('.search-provider-badge');
          if (badge) {
            badge.textContent = getMessage('optionsSearchInactiveBadge');
            badge.className = 'search-provider-badge search-badge-inactive';
          }
          await safeSet({ active_search_provider_id: '' });
          showStatus(getMessage('optionsSearchDeactivated'));
        }
      });

      // 打开配置抽屉
      item.querySelector('.action-edit').addEventListener('click', () => {
        openSearchDrawer(provider);
      });

      searchListEl.appendChild(item);
    });
  }

  // ===== 通用搜索设置保存 =====

  async function saveSearchSettings() {
    const count = Math.max(1, Math.min(50, parseInt(countInput.value, 10) || 10));
    countInput.value = count;

    const settings = {
      count,
      timeRange: getSegValue(timeRangeEl)
    };

    const enabled = searchEnabledInput.checked;

    await safeSet({
      web_search_settings: settings,
      web_search_enabled: enabled
    });

    showStatus(getMessage('optionsSettingsSaved'));
  }

  // 监听通用搜索设置变更自动保存
  const publicEls = [countInput, searchEnabledInput];
  publicEls.forEach(el => {
    if (el) el.addEventListener('change', () => saveSearchSettings());
  });
  // 分段滑块用 click 事件
  [timeRangeEl].forEach(el => {
    if (!el) return;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      setSegValue(el, btn.dataset.value);
      saveSearchSettings();
    });
  });

  // ===== 抽屉 =====

  function openSearchDrawer(provider) {
    currentEditingProvider = provider;
    drawerTitleEl.textContent = getMessage('optionsSearchDrawerTitleFormat', [getProviderDisplayName(provider)]);
    drawerMetaEl.textContent = getProviderDisplayDesc(provider);
    renderSearchDrawerForm(provider);
    drawerSaveBtn.style.display = '';
    drawerSaveBtn.dataset.action = 'save-search';
    drawerSaveBtn.dataset.providerId = provider.id;
    drawerOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // 初始化分段滑块指示器（同步执行，确保首次绘制前 CSS 变量已就位）
    initDrawerSegControls(drawerBodyEl);
  }

  function renderSearchDrawerForm(provider) {
    const isBrave = provider.id === 'brave-search';
    const isVolc = provider.id === 'volcengine-search';
    const isTavily = provider.id === 'tavily-search';

    let extraFields = '';

    if (isBrave) {
      const langVal = provider.language || '';
      extraFields = `
        <div class="rule-form-section">${getMessage('optionsSearchBraveSection')}</div>
        <div class="rule-form-group">
          <label>${getMessage('optionsSearchLangLabel')}</label>
          <div class="segmented-control" id="drawer-brave-lang">
            <button data-value=""${langVal === '' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchNoLimit')}</button>
            <button data-value="zh"${langVal === 'zh' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchLangZh')}</button>
            <button data-value="en"${langVal === 'en' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchLangEn')}</button>
            <button data-value="ja"${langVal === 'ja' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchLangJa')}</button>
            <button data-value="ko"${langVal === 'ko' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchLangKo')}</button>
            <button data-value="fr"${langVal === 'fr' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchLangFr')}</button>
            <button data-value="de"${langVal === 'de' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchLangDe')}</button>
          </div>
          <div class="hint">${getMessage('optionsSearchBraveLangHint')}</div>
        </div>`;
    } else if (isVolc) {
      const aVal = provider.authInfoLevel || '0';
      const bhVal = provider.blockHosts || '';
      extraFields = `
        <div class="rule-form-section">${getMessage('optionsSearchVolcSection')}</div>
        <div class="rule-form-group">
          <label>${getMessage('optionsSearchAuthLevelLabel')}</label>
          <div class="segmented-control" id="drawer-volc-auth">
            <button data-value="0"${aVal === '0' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchNoLimit')}</button>
            <button data-value="1"${aVal === '1' ? ' class="seg-active"' : ''}>${getMessage('optionsSearchAuthHigh')}</button>
          </div>
          <div class="hint">${getMessage('optionsSearchVolcAuthHint')}</div>
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsSearchBlockHostsLabel')}</label>
          <input type="text" id="drawer-volc-blockHosts" value="${escapeHtml(bhVal)}" placeholder="${getMessage('optionsSearchBlockHostsPlaceholder')}">
          <div class="hint">${getMessage('optionsSearchBlockHostsHint')}</div>
        </div>`;
    } else if (isTavily) {
      const depthVal = provider.searchDepth || 'basic';
      const answerVal = provider.includeAnswer === true;
      extraFields = `
        <div class="rule-form-section">${getMessage('optionsSearchTavilySection')}</div>
        <div class="rule-form-group">
          <label>${getMessage('optionsSearchDepthLabel')}</label>
          <div class="segmented-control" id="drawer-tavily-depth">
            <button data-value="basic"${depthVal === 'basic' ? ' class="seg-active"' : ''}>Basic</button>
            <button data-value="advanced"${depthVal === 'advanced' ? ' class="seg-active"' : ''}>Advanced</button>
            <button data-value="fast"${depthVal === 'fast' ? ' class="seg-active"' : ''}>Fast</button>
            <button data-value="ultra-fast"${depthVal === 'ultra-fast' ? ' class="seg-active"' : ''}>Ultra-Fast</button>
          </div>
          <div class="hint" id="drawer-tavily-depthHint">${getMessage('optionsSearchTavilyDepthHint' + tavilyDepthKey(depthVal))}</div>
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsSearchAnswerLabel')}</label>
          <label class="switch">
            <input type="checkbox" id="drawer-tavily-answer" ${answerVal ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </label>
          <div class="hint">${getMessage('optionsSearchAnswerHint')}</div>
        </div>`;
    }

    drawerBodyEl.innerHTML = `
      <div class="rule-form-section">${getMessage('optionsSearchProviderSection')}</div>
      <div class="rule-form-group">
        <label>${getMessage('optionsSearchProviderNameLabel')}</label>
        <input type="text" disabled value="${escapeHtml(getProviderDisplayName(provider))}">
      </div>

      <div class="rule-form-section">${getMessage('optionsApiSection')}</div>

      <div class="rule-form-group">
        <label>${getMessage('optionsSearchUrlLabel')}<span style="color:var(--color-error-text);">*</span></label>
        <input type="text" id="search-endpoint" value="${escapeHtml(provider.endpoint || '')}" placeholder="${getMessage('optionsSearchUrlPlaceholder')}">
      </div>

      <div class="rule-form-group">
        <label>API Key <span style="color:var(--color-error-text);">*</span></label>
        <div class="input-wrapper">
          <input type="password" id="search-apiKey" value="${escapeHtml(provider.apiKey || '')}" placeholder="${getMessage('optionsSearchApiKeyPlaceholder')}">
          <button type="button" class="toggle-visible" id="search-toggleKey"><span data-icon="eye"></span>${getMessage('optionsShow')}</button>
        </div>
        <div class="hint">${getMessage('optionsModelFormApiKeyHint')}</div>
      </div>

      <div class="rule-form-group">
        <label for="search-monthlyLimit">${getMessage('optionsSearchMonthlyLimitLabel')}</label>
        <input type="number" id="search-monthlyLimit" min="0" max="9999" value="${provider.monthlyLimit || 0}">
        <div class="hint">${getMessage('optionsSearchMonthlyLimitHint')}</div>
      </div>

      ${extraFields}

      <div class="rule-form-section">${getMessage('optionsSearchTest')}</div>
      <div class="rule-form-group">
        <textarea id="search-testQuery" placeholder="${getMessage('optionsSearchTestQueryPlaceholder')}" rows="2" style="width:100%;box-sizing:border-box;resize:vertical;">${getMessage('optionsSearchTestQueryValue')}</textarea>
        <button type="button" class="btn-primary" id="search-testBtn" style="width:100%;margin-top:8px;"><span data-icon="search"></span>${getMessage('optionsSearchTest')}</button>
        <div class="hint" id="search-testResult" style="margin-top:8px;white-space:pre-wrap;word-break:break-all;"></div>
      </div>
    `;

    // 渲染后统一替换 data-icon（列表编辑入口不经过 index.js openDrawer，需在此兜底）
    window.QuizHelperIcons?.replaceIcons(drawerBodyEl);

    // 切换 key 可见性
    const toggleKeyBtn = drawerBodyEl.querySelector('#search-toggleKey');
    const apiKeyInput = drawerBodyEl.querySelector('#search-apiKey');
    toggleKeyBtn.addEventListener('click', () => {
      const reveal = apiKeyInput.type === 'password';
      apiKeyInput.type = reveal ? 'text' : 'password';
      toggleKeyBtn.innerHTML = `<span data-icon="${reveal ? 'eye-off' : 'eye'}"></span>${reveal ? getMessage('optionsHide') : getMessage('optionsShow')}`;
      window.QuizHelperIcons?.replaceIcons(toggleKeyBtn);
    });

    // 测试搜索
    const testBtn = drawerBodyEl.querySelector('#search-testBtn');
    testBtn.addEventListener('click', testSearchConnection);

    // Tavily：根据所选搜索深度更新提示文案
    const tavilyDepthEl = drawerBodyEl.querySelector('#drawer-tavily-depth');
    const tavilyDepthHint = drawerBodyEl.querySelector('#drawer-tavily-depthHint');
    if (tavilyDepthEl && tavilyDepthHint) {
      tavilyDepthEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (btn) tavilyDepthHint.textContent = getMessage('optionsSearchTavilyDepthHint' + tavilyDepthKey(btn.dataset.value));
      });
    }
  }

  async function testSearchConnection() {
    const resultEl = drawerBodyEl.querySelector('#search-testResult');
    const endpoint = drawerBodyEl.querySelector('#search-endpoint').value.trim();
    const apiKey = drawerBodyEl.querySelector('#search-apiKey').value.trim();
    const testQuery = drawerBodyEl.querySelector('#search-testQuery').value.trim();

    if (!endpoint) {
      resultEl.textContent = getMessage('optionsSearchApiUrlRequired');
      resultEl.style.color = 'var(--color-error-text)';
      return;
    }
    if (!apiKey) {
      resultEl.textContent = getMessage('optionsSearchApiKeyRequired');
      resultEl.style.color = 'var(--color-error-text)';
      return;
    }
    if (!testQuery) {
      resultEl.textContent = getMessage('optionsSearchTestQueryRequired');
      resultEl.style.color = 'var(--color-error-text)';
      return;
    }

    resultEl.textContent = getMessage('optionsSearchSearching');
    resultEl.style.color = 'var(--color-text-muted)';

    // 读取当前通用搜索设置
    const count = Math.max(1, Math.min(50, parseInt(countInput.value, 10) || 10));
    const settings = {
      count,
      timeRange: getSegValue(timeRangeEl)
    };

    // 测试计时（同步状态缓存用）
    const testStartTs = performance.now();
    const providerId = currentEditingProvider.id;
    const syncStatus = (status, extra) => {
      globalThis.QuizHelperStatusUtils?.updateSearchProviderStatus(providerId, { status, ...extra });
    };

    // 先保存 API Key 到 storage，确保 DNR 规则同步后再发请求
    const result = await chrome.storage.local.get(['web_search_providers']);
    const providers = result.web_search_providers || [];
    const idx = providers.findIndex(p => p.id === currentEditingProvider.id);
    if (idx >= 0) {
      providers[idx] = { ...providers[idx], endpoint, apiKey };
      await safeSet({ web_search_providers: providers });
    }

    // 等待 DNR 规则同步（storage change → SW listener → updateDynamicRules）
    await new Promise(r => setTimeout(r, 150));

    // 通过 background service worker 代理（认证头由 DNR 在网络层注入）
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'webSearch',
        provider: { ...currentEditingProvider, endpoint, apiKey },
        settings,
        query: testQuery
      });

      if (!response) {
        const lastError = chrome.runtime.lastError;
        const errMsg = lastError?.message || getMessage('optionsSearchSwNoResponse');
        resultEl.innerHTML = getMessage('optionsSearchTestErrorNoResponse', [escapeHtml(errMsg)]);
        syncStatus('err', { error: errMsg });
        return;
      }

      if (!response.success) {
        const errorMsg = response.error || getMessage('commonUnknownError');
        const stack = response.stack || '';
        const details = response.details ? JSON.stringify(response.details, null, 2) : '';
        resultEl.innerHTML = `<span style="color:var(--color-error-text);font-weight:600;">${getMessage('optionsSearchFailFormat', [escapeHtml(errorMsg)])}</span>
${stack ? `<div style="margin-top:4px;font-size:11px;color:var(--color-text-muted);white-space:pre-wrap;">${escapeHtml(stack.slice(0, 500))}</div>` : ''}
${details ? `<div style="margin-top:4px;font-size:11px;color:var(--color-text-muted);white-space:pre-wrap;">${getMessage('optionsSearchDetailFormat', [escapeHtml(details.slice(0, 300))])}</div>` : ''}`;
        resultEl.style.color = 'var(--color-error-text)';
        syncStatus('err', { error: errorMsg });
        return;
      }

      const data = response.data;

      // 测试成功：同步状态缓存
      syncStatus('ok', { latencyMs: Math.round(performance.now() - testStartTs) });

      // 提取搜索结果摘要
      let summaryHtml = `<span style="color:var(--color-success)">${getMessage('optionsSearchSuccess')}</span>\n`;
      try {
        const results = globalThis.QuizHelperSearchUtils.extractSearchResults(data, currentEditingProvider.id);
        if (results.length === 0) {
          summaryHtml += `<span style="color:var(--color-text-muted)">${getMessage('optionsSearchNoResults')}</span>`;
        } else {
          summaryHtml += `<span style="color:var(--color-text-muted)">${getMessage('optionsSearchResultsCountFormat', [results.length])}</span>\n`;
          results.slice(0, 5).forEach((r, i) => {
            summaryHtml += `\n<span style="color:var(--color-primary);font-weight:600;">${i + 1}. ${escapeHtml(r.title || getMessage('optionsSearchNoTitle'))}</span>`;
            summaryHtml += `\n<span style="color:var(--color-text-secondary);">   ${escapeHtml((r.snippet || '').slice(0, 150))}</span>`;
          });
          if (results.length > 5) {
            summaryHtml += `\n<span style="color:var(--color-text-muted);">${getMessage('optionsSearchMoreFormat', [results.length - 5])}</span>`;
          }
        }
      } catch {
        summaryHtml += `<span style="color:var(--color-text-secondary);">${escapeHtml(JSON.stringify(data).slice(0, 500))}</span>`;
      }

      resultEl.innerHTML = summaryHtml;
    } catch (err) {
      resultEl.textContent = getMessage('optionsSearchFailFormat', [err.message]);
      resultEl.style.color = 'var(--color-error-text)';
      syncStatus('err', { error: err.message || String(err) });
    }

    // 刷新服务商列表以更新用量显示
    const refreshResult = await chrome.storage.local.get(['web_search_providers', 'active_search_provider_id', 'web_search_usage']);
    renderSearchProviders(refreshResult.web_search_providers || [], refreshResult.active_search_provider_id || '', refreshResult.web_search_usage);
  }

  // ===== 抽屉保存 =====

  function getSearchFormData() {
    const endpoint = drawerBodyEl.querySelector('#search-endpoint')?.value?.trim() || '';
    const apiKey = drawerBodyEl.querySelector('#search-apiKey')?.value?.trim() || '';
    const monthlyLimit = Math.max(0, parseInt(drawerBodyEl.querySelector('#search-monthlyLimit')?.value, 10) || 0);

    if (!endpoint) { showStatus(getMessage('optionsSearchUrlRequired'), true); return null; }

    const extra = {};

    // Brave：语言
    const braveLangEl = drawerBodyEl.querySelector('#drawer-brave-lang');
    if (braveLangEl) {
      extra.language = getSegValue(braveLangEl);
    }

    // 豆包：权威度 + 屏蔽站点
    const volcAuthEl = drawerBodyEl.querySelector('#drawer-volc-auth');
    if (volcAuthEl) {
      extra.authInfoLevel = getSegValue(volcAuthEl);
    }
    const blockHostsEl = drawerBodyEl.querySelector('#drawer-volc-blockHosts');
    if (blockHostsEl) {
      extra.blockHosts = blockHostsEl.value.trim();
    }

    // Tavily：搜索深度 + 答案摘要
    const tavilyDepthEl = drawerBodyEl.querySelector('#drawer-tavily-depth');
    if (tavilyDepthEl) {
      extra.searchDepth = getSegValue(tavilyDepthEl);
    }
    const tavilyAnswerEl = drawerBodyEl.querySelector('#drawer-tavily-answer');
    if (tavilyAnswerEl) {
      extra.includeAnswer = tavilyAnswerEl.checked;
    }

    return { endpoint, apiKey, monthlyLimit, ...extra };
  }

  async function saveSearchFromDrawer() {
    const providerId = drawerSaveBtn.dataset.providerId;
    if (!providerId) return;

    const formData = getSearchFormData();
    if (!formData) return;

    const result = await chrome.storage.local.get(['web_search_providers']);
    const providers = result.web_search_providers || [];
    const idx = providers.findIndex(p => p.id === providerId);
    if (idx < 0) return;

    providers[idx] = {
      ...providers[idx],
      endpoint: formData.endpoint,
      apiKey: formData.apiKey,
      monthlyLimit: formData.monthlyLimit
    };

    // 合并独立参数
    if (formData.language !== undefined) providers[idx].language = formData.language;
    if (formData.authInfoLevel !== undefined) providers[idx].authInfoLevel = formData.authInfoLevel;
    if (formData.blockHosts !== undefined) providers[idx].blockHosts = formData.blockHosts;
    if (formData.searchDepth !== undefined) providers[idx].searchDepth = formData.searchDepth;
    if (formData.includeAnswer !== undefined) providers[idx].includeAnswer = formData.includeAnswer;

    await safeSet({ web_search_providers: providers });

    showStatus(getMessage('optionsSearchSavedFormat', [getProviderDisplayName(providers[idx])]));
    onCloseDrawer();

    // 刷新列表
    const refreshResult = await chrome.storage.local.get(['active_search_provider_id', 'web_search_usage']);
    renderSearchProviders(providers, refreshResult.active_search_provider_id || '', refreshResult.web_search_usage);
  }

  return { loadSearchProviders, openSearchDrawer, saveSearchFromDrawer };
}
