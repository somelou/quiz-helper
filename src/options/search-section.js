// 联网搜索设置模块

// 内联常量（不再依赖 shared/search-params.js，防止选项页有任何直接 fetch 路径）
const DEFAULT_WEB_SEARCH_PROVIDERS = [
  {
    id: 'brave-search',
    name: 'Brave Search',
    desc: 'Brave LLM Context API，返回提纯后的网页内容',
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
    desc: '火山引擎豆包搜索 Custom 版，专为Agent场景开发',
    endpoint: 'https://open.feedcoopapi.com/search_api/web_search',
    apiKey: '',
    authHeader: 'Authorization',
    paramMapping: { q: 'Query', count: 'Count', timeRange: 'TimeRange', authInfoLevel: 'Filter.AuthInfoLevel', blockHosts: 'Filter.BlockHosts' },
    defaultParams: { SearchType: 'web' },
    monthlyLimit: 500,
    authInfoLevel: '0',
    blockHosts: ''
  }
];

const DEFAULT_WEB_SEARCH_SETTINGS = { count: 10, timeRange: '' };

// 分段滑块辅助（使用 index.js 中的全局 setSegValue/getSegValue）

function initSearch({
  searchListEl, searchStatusEl,
  searchEnabledInput,
  countInput, timeRangeEl,
  drawerBodyEl, drawerTitleEl, drawerMetaEl, drawerSaveBtn, drawerOverlay,
  onCloseDrawer
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;

  let currentEditingProvider = null;

  function showStatus(msg, isError) {
    searchStatusEl.textContent = msg;
    searchStatusEl.style.color = isError ? 'var(--color-error-text)' : '#666';
    if (msg) {
      setTimeout(() => {
        if (searchStatusEl.textContent === msg) {
          searchStatusEl.textContent = '';
          searchStatusEl.style.color = '#666';
        }
      }, 3000);
    }
  }

  // ===== 加载 =====

  async function loadSearchProviders() {
    const result = await chrome.storage.local.get([
      'web_search_providers', 'active_search_provider_id',
      'web_search_settings', 'web_search_enabled',
      'web_search_usage'
    ]);

    let providers = result.web_search_providers || [];
    let needSave = false;

    // 首次加载：写入种子数据
    if (!providers.length) {
      providers = JSON.parse(JSON.stringify(DEFAULT_WEB_SEARCH_PROVIDERS));
      needSave = true;
    }

    // 迁移旧端点和旧名称
    for (const p of providers) {
      if (p.id === 'volcengine-search') {
        if (p.endpoint && p.endpoint.includes('torchlight.byteintlapi.com')) {
          p.endpoint = DEFAULT_WEB_SEARCH_PROVIDERS[1].endpoint;
          needSave = true;
        }
        if (p.name === '火山/豆包搜索' || p.name === '豆包搜索/火山Agent Plan') {
          p.name = DEFAULT_WEB_SEARCH_PROVIDERS[1].name;
          needSave = true;
        }
        if (p.desc !== DEFAULT_WEB_SEARCH_PROVIDERS[1].desc) {
          p.desc = DEFAULT_WEB_SEARCH_PROVIDERS[1].desc;
          needSave = true;
        }
        // 补全缺失的 paramMapping 和 defaultParams
        if (!p.paramMapping?.q || !p.defaultParams) {
          p.paramMapping = { ...DEFAULT_WEB_SEARCH_PROVIDERS[1].paramMapping, ...p.paramMapping };
          p.defaultParams = { ...DEFAULT_WEB_SEARCH_PROVIDERS[1].defaultParams, ...p.defaultParams };
          needSave = true;
        }
        // 迁移：去掉过时的 NeedSummary
        if (p.defaultParams?.NeedSummary !== undefined) {
          delete p.defaultParams.NeedSummary;
          needSave = true;
        }
        // 补全独立参数
        if (p.authInfoLevel === undefined) {
          p.authInfoLevel = '0';
          needSave = true;
        }
        if (p.blockHosts === undefined) {
          p.blockHosts = '';
          needSave = true;
        }
      }
      if (p.id === 'brave-search') {
        // 补全 safesearch 默认值
        if (!p.defaultParams?.safesearch) {
          p.defaultParams = { ...p.defaultParams, safesearch: 'strict' };
          needSave = true;
        }
        // 迁移：language 从旧公共参数移到 provider 字段
        if (p.language === undefined) {
          p.language = '';
          needSave = true;
        }
      }
    }

    // 补全缺失的 monthlyLimit
    for (const p of providers) {
      if (p.monthlyLimit === undefined) {
        const def = DEFAULT_WEB_SEARCH_PROVIDERS.find(d => d.id === p.id);
        p.monthlyLimit = def ? def.monthlyLimit : 0;
        needSave = true;
      }
    }

    if (needSave) {
      await safeSet({ web_search_providers: providers });
    }

    const activeId = result.active_search_provider_id || '';
    const settings = result.web_search_settings || DEFAULT_WEB_SEARCH_SETTINGS;
    const enabled = result.web_search_enabled !== undefined ? result.web_search_enabled : false;

    // 回填总开关
    searchEnabledInput.checked = enabled;

    // 回填公共参数
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
        usageHtml = `<span class="search-usage-badge" style="color:${usageColor};font-size:11px;">本月 ${usageCount}/${limit} · </span>`;
      }

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">
              ${escapeHtml(provider.name)}
              ${isActive
                ? '<span class="search-provider-badge search-badge-active">当前使用</span>'
                : '<span class="search-provider-badge search-badge-inactive">未激活</span>'}
            </div>
            <div class="list-item-meta">${usageHtml}${escapeHtml(provider.desc)}</div>
          </div>
          <div class="list-item-actions">
            <label class="switch">
              <input type="checkbox" data-action="toggle-search" data-id="${provider.id}" ${isActive ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
            <button class="action-btn action-edit" data-id="${provider.id}">配置</button>
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
              prevBadge.textContent = '未激活';
              prevBadge.className = 'search-provider-badge search-badge-inactive';
            }
            prevActive.classList.remove('search-item-active');
          }
          // 更新当前项
          item.classList.add('search-item-active');
          const badge = item.querySelector('.search-provider-badge');
          if (badge) {
            badge.textContent = '当前使用';
            badge.className = 'search-provider-badge search-badge-active';
          }
          await safeSet({ active_search_provider_id: provider.id });
          showStatus(`已激活「${provider.name}」`);
        } else {
          // 取消激活
          item.classList.remove('search-item-active');
          const badge = item.querySelector('.search-provider-badge');
          if (badge) {
            badge.textContent = '未激活';
            badge.className = 'search-provider-badge search-badge-inactive';
          }
          await safeSet({ active_search_provider_id: '' });
          showStatus('已取消激活');
        }
      });

      // 打开配置抽屉
      item.querySelector('.action-edit').addEventListener('click', () => {
        openSearchDrawer(provider);
      });

      searchListEl.appendChild(item);
    });
  }

  // ===== 公共参数保存 =====

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

    showStatus('设置已保存');
  }

  // 监听公共参数变更自动保存
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
    drawerTitleEl.textContent = `配置 - ${provider.name}`;
    drawerMetaEl.textContent = provider.desc;
    renderSearchDrawerForm(provider);
    drawerSaveBtn.style.display = '';
    drawerSaveBtn.dataset.action = 'save-search';
    drawerSaveBtn.dataset.providerId = provider.id;
    drawerOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // 初始化分段滑块指示器（同步执行，确保首次绘制前 CSS 变量已就位）
    drawerBodyEl.getBoundingClientRect();
    drawerBodyEl.querySelectorAll('.segmented-control').forEach(seg => {
      const active = seg.querySelector('.seg-active');
      if (active) setSegValue(seg, active.dataset.value);
    });
  }

  function renderSearchDrawerForm(provider) {
    const isBrave = provider.id === 'brave-search';
    const isVolc = provider.id === 'volcengine-search';

    let extraFields = '';

    if (isBrave) {
      const langVal = provider.language || '';
      extraFields = `
        <div class="rule-form-section">Brave 搜索参数</div>
        <div class="rule-form-group">
          <label>搜索语言</label>
          <div class="segmented-control" id="drawer-brave-lang">
            <button data-value=""${langVal === '' ? ' class="seg-active"' : ''}>不限制</button>
            <button data-value="zh"${langVal === 'zh' ? ' class="seg-active"' : ''}>中文</button>
            <button data-value="en"${langVal === 'en' ? ' class="seg-active"' : ''}>英文</button>
            <button data-value="ja"${langVal === 'ja' ? ' class="seg-active"' : ''}>日文</button>
            <button data-value="ko"${langVal === 'ko' ? ' class="seg-active"' : ''}>韩文</button>
            <button data-value="fr"${langVal === 'fr' ? ' class="seg-active"' : ''}>法文</button>
            <button data-value="de"${langVal === 'de' ? ' class="seg-active"' : ''}>德文</button>
          </div>
          <div class="hint">仅对 Brave 生效，选择「不限制」由 Brave 自行判断</div>
        </div>`;
    } else if (isVolc) {
      const aVal = provider.authInfoLevel || '0';
      const bhVal = provider.blockHosts || '';
      extraFields = `
        <div class="rule-form-section">豆包搜索参数</div>
        <div class="rule-form-group">
          <label>权威度限制</label>
          <div class="segmented-control" id="drawer-volc-auth">
            <button data-value="0"${aVal === '0' ? ' class="seg-active"' : ''}>不限制</button>
            <button data-value="1"${aVal === '1' ? ' class="seg-active"' : ''}>非常权威</button>
          </div>
          <div class="hint">可指定仅在非常权威内容范围内搜索（详情请参考：<a href="https://docs.volcengine.com/docs/87772/2518319?lang=zh" target="_blank" rel="noreferrer">豆包权威度说明</a>）</div>
        </div>
        <div class="rule-form-group">
          <label>屏蔽站点</label>
          <input type="text" id="drawer-volc-blockHosts" value="${escapeHtml(bhVal)}" placeholder="多个域名用 | 分隔，如 example.com|spam.net">
          <div class="hint">指定要屏蔽的搜索域名，最多 5 个</div>
        </div>`;
    }

    drawerBodyEl.innerHTML = `
      <div class="rule-form-section">服务商信息</div>
      <div class="rule-form-group">
        <label>服务商名称</label>
        <input type="text" disabled value="${escapeHtml(provider.name)}">
      </div>

      <div class="rule-form-section">API 配置</div>

      <div class="rule-form-group">
        <label>搜索 API URL<span style="color:var(--color-error-text);">*</span></label>
        <input type="text" id="search-endpoint" value="${escapeHtml(provider.endpoint || '')}" placeholder="搜索 API 的请求地址">
      </div>

      <div class="rule-form-group">
        <label>API Key <span style="color:var(--color-error-text);">*</span></label>
        <div class="input-wrapper">
          <input type="password" id="search-apiKey" value="${escapeHtml(provider.apiKey || '')}" placeholder="请输入 API Key">
          <button type="button" class="toggle-visible" id="search-toggleKey">显示</button>
        </div>
        <div class="hint">您的 API 密钥仅存储在本地浏览器中</div>
      </div>

      <div class="rule-form-group">
        <label for="search-monthlyLimit">每月可执行次数</label>
        <input type="number" id="search-monthlyLimit" min="0" max="9999" value="${provider.monthlyLimit || 0}">
        <div class="hint">达到上限后使用将不再进行搜索服务。设为 0 表示不限制</div>
      </div>

      ${extraFields}

      <div class="rule-form-section">测试搜索</div>
      <div class="rule-form-group">
        <textarea id="search-testQuery" placeholder="输入测试搜索词" rows="2" style="width:100%;box-sizing:border-box;resize:vertical;">人工智能最新进展</textarea>
        <button type="button" class="btn-primary" id="search-testBtn" style="width:100%;margin-top:8px;">测试搜索</button>
        <div class="hint" id="search-testResult" style="margin-top:8px;white-space:pre-wrap;word-break:break-all;"></div>
      </div>
    `;

    // 切换 key 可见性
    const toggleKeyBtn = drawerBodyEl.querySelector('#search-toggleKey');
    const apiKeyInput = drawerBodyEl.querySelector('#search-apiKey');
    toggleKeyBtn.addEventListener('click', () => {
      if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleKeyBtn.textContent = '隐藏';
      } else {
        apiKeyInput.type = 'password';
        toggleKeyBtn.textContent = '显示';
      }
    });

    // 测试搜索
    const testBtn = drawerBodyEl.querySelector('#search-testBtn');
    testBtn.addEventListener('click', testSearchConnection);
  }

  async function testSearchConnection() {
    const resultEl = drawerBodyEl.querySelector('#search-testResult');
    const endpoint = drawerBodyEl.querySelector('#search-endpoint').value.trim();
    const apiKey = drawerBodyEl.querySelector('#search-apiKey').value.trim();
    const testQuery = drawerBodyEl.querySelector('#search-testQuery').value.trim();

    if (!endpoint) {
      resultEl.textContent = '请先填写搜索 API URL';
      resultEl.style.color = 'var(--color-error-text)';
      return;
    }
    if (!apiKey) {
      resultEl.textContent = '请先填写 API Key';
      resultEl.style.color = 'var(--color-error-text)';
      return;
    }
    if (!testQuery) {
      resultEl.textContent = '请输入测试搜索词';
      resultEl.style.color = 'var(--color-error-text)';
      return;
    }

    resultEl.textContent = '搜索中...';
    resultEl.style.color = 'var(--color-text-muted)';

    // 读取当前公共参数
    const count = Math.max(1, Math.min(50, parseInt(countInput.value, 10) || 10));
    const settings = {
      count,
      timeRange: getSegValue(timeRangeEl)
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
        const errMsg = lastError?.message || '后台服务未响应';
        resultEl.innerHTML = `<span style="color:var(--color-error-text);font-weight:600;">错误：${escapeHtml(errMsg)}</span>
<div style="margin-top:6px;font-size:11px;color:var(--color-text-muted);">
  可能原因：扩展未重新加载，或 Service Worker 已崩溃。<br>
  请前往 chrome://extensions 点击扩展的刷新按钮后重试。
</div>`;
        return;
      }

      if (!response.success) {
        const errorMsg = response.error || '未知错误';
        const stack = response.stack || '';
        const details = response.details ? JSON.stringify(response.details, null, 2) : '';
        resultEl.innerHTML = `<span style="color:var(--color-error-text);font-weight:600;">搜索失败：${escapeHtml(errorMsg)}</span>
${stack ? `<div style="margin-top:4px;font-size:11px;color:var(--color-text-muted);white-space:pre-wrap;">${escapeHtml(stack.slice(0, 500))}</div>` : ''}
${details ? `<div style="margin-top:4px;font-size:11px;color:var(--color-text-muted);white-space:pre-wrap;">细节：${escapeHtml(details.slice(0, 300))}</div>` : ''}`;
        resultEl.style.color = 'var(--color-error-text)';
        return;
      }

      const data = response.data;

      // 提取搜索结果摘要
      let summaryHtml = `<span style="color:var(--color-success)">搜索成功！</span>\n`;
      try {
        const results = extractSearchResults(data, currentEditingProvider.id);
        if (results.length === 0) {
          summaryHtml += `<span style="color:var(--color-text-muted)">未找到相关结果</span>`;
        } else {
          summaryHtml += `<span style="color:var(--color-text-muted)">共 ${results.length} 条结果：</span>\n`;
          results.slice(0, 5).forEach((r, i) => {
            summaryHtml += `\n<span style="color:var(--color-primary);font-weight:600;">${i + 1}. ${escapeHtml(r.title || '无标题')}</span>`;
            summaryHtml += `\n<span style="color:var(--color-text-secondary);">   ${escapeHtml((r.snippet || '').slice(0, 150))}</span>`;
          });
          if (results.length > 5) {
            summaryHtml += `\n<span style="color:var(--color-text-muted);">... 还有 ${results.length - 5} 条</span>`;
          }
        }
      } catch {
        summaryHtml += `<span style="color:var(--color-text-secondary);">${escapeHtml(JSON.stringify(data).slice(0, 500))}</span>`;
      }

      resultEl.innerHTML = summaryHtml;
    } catch (err) {
      resultEl.textContent = `搜索失败: ${err.message}`;
      resultEl.style.color = 'var(--color-error-text)';
    }

    // 刷新服务商列表以更新用量显示
    const refreshResult = await chrome.storage.local.get(['web_search_providers', 'active_search_provider_id', 'web_search_usage']);
    renderSearchProviders(refreshResult.web_search_providers || [], refreshResult.active_search_provider_id || '', refreshResult.web_search_usage);
  }

  /**
   * 从各 API 返回数据中提取统一格式的搜索结果
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

    // volcengine-search / 默认 WebResults
    const webResults = data?.Result?.WebResults || data?.WebResults || [];
    return webResults.map(item => ({
      title: item.Title || '',
      url: item.Url || '',
      snippet: item.Snippet || item.Summary || ''
    }));
  }

  // ===== 抽屉保存 =====

  function getSearchFormData() {
    const endpoint = drawerBodyEl.querySelector('#search-endpoint')?.value?.trim() || '';
    const apiKey = drawerBodyEl.querySelector('#search-apiKey')?.value?.trim() || '';
    const monthlyLimit = Math.max(0, parseInt(drawerBodyEl.querySelector('#search-monthlyLimit')?.value, 10) || 0);

    if (!endpoint) { showStatus('搜索 API URL不能为空', true); return null; }

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

    await safeSet({ web_search_providers: providers });

    showStatus(`「${providers[idx].name}」配置已保存`);
    onCloseDrawer();

    // 刷新列表
    const refreshResult = await chrome.storage.local.get(['active_search_provider_id', 'web_search_usage']);
    renderSearchProviders(providers, refreshResult.active_search_provider_id || '', refreshResult.web_search_usage);
  }

  return { loadSearchProviders, openSearchDrawer, saveSearchFromDrawer };
}
