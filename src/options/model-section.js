// 大模型管理模块

function initModels({
  modelListEl,
  drawerBodyEl, drawerTitleEl, drawerMetaEl,
  drawerSaveBtn, drawerOverlay,
  onCloseDrawer
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const paginationState = { model: 1 };
  let currentModelEditingBase = null;

  function showModelStatus(msg) {
    globalThis.QuizHelperMessage.info(msg);
  }

  async function loadModels() {
    const result = await chrome.storage.local.get([
      'llm_models', 'active_model_id',
      'model_bank_id', 'model_extract_id'
    ]);
    const models = result.llm_models || [];
    renderModels(models, result.active_model_id || '', result.model_bank_id || '', result.model_extract_id || '');
  }

  function renderModels(models, activeModelId, bankModelId, extractModelId) {
    if (!models || models.length === 0) {
      modelListEl.innerHTML = '<div class="list-empty">暂无大模型配置，点击右上角「添加」创建。</div>';
      return;
    }

    const totalPages = Math.ceil(models.length / PAGE_SIZE);
    if (paginationState.model > totalPages) paginationState.model = totalPages;
    const page = paginationState.model;
    const startIdx = (page - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, models.length);

    modelListEl.innerHTML = '';
    for (let idx = startIdx; idx < endIdx; idx++) {
      const model = models[idx];
      const isAnswerModel = model.id === activeModelId;
      const isBank = model.id === bankModelId && model.isActive;
      const isExtract = model.id === extractModelId && model.isActive;

      // 构建 badge 列表
      const badges = [];
      if (isAnswerModel) badges.push('<span class="model-badge model-preferred">答题</span>');
      if (isExtract) badges.push('<span class="model-badge model-task-extract">页面解析</span>');
      if (isBank) badges.push('<span class="model-badge model-task-bank">题库解析</span>');

      const badgeHtml = badges.join('');

      const item = document.createElement('div');
      item.className = 'list-item' + (isAnswerModel ? ' active' : (model.isActive ? '' : ' model-inactive'));

      // 构建 footer 按钮
      const footerButtons = [];
      if (!isAnswerModel && model.isActive) {
        footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-answer">用于答题</button>');
      }
      if (!isExtract && model.isActive) {
        footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-extract">用于页面解析</button>');
      }
      if (!isBank && model.isActive) {
        footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-bank">用于题库解析</button>');
      }

      const footerHtml = footerButtons.length > 0
        ? '<div class="list-item-footer">' + footerButtons.join('') + '</div>'
        : '';

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">
              ${escapeHtml(model.name || '未命名')}
              ${badgeHtml}
            </div>
            <div class="list-item-meta">模型 ID: ${escapeHtml(model.modelId || '')} · ${escapeHtml(model.apiUrl || '')}</div>
          </div>
          <div class="list-item-actions">
            <label class="switch">
              <input type="checkbox" data-action="toggle" data-idx="${idx}" ${model.isActive ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
            <button class="action-btn action-edit" data-idx="${idx}">编辑</button>
            <button class="action-btn action-delete" data-idx="${idx}">删除</button>
          </div>
        </div>
        ${footerHtml}
      `;

      item.querySelector('[data-action="toggle"]').addEventListener('change', event => {
        toggleModelActive(idx, event.target.checked);
      });
      item.querySelector('.action-edit').addEventListener('click', () => openModelDrawer(model));
      item.querySelector('.action-delete').addEventListener('click', () => deleteModel(idx));

      const answerBtn = item.querySelector('[data-action="set-answer"]');
      if (answerBtn) {
        answerBtn.addEventListener('click', () => setAnswerModel(idx));
      }
      const extractBtn = item.querySelector('[data-action="set-extract"]');
      if (extractBtn) {
        extractBtn.addEventListener('click', () => setTaskModel(idx, 'model_extract_id', '页面解析'));
      }
      const bankBtn = item.querySelector('[data-action="set-bank"]');
      if (bankBtn) {
        bankBtn.addEventListener('click', () => setTaskModel(idx, 'model_bank_id', '题库解析'));
      }

      modelListEl.appendChild(item);
    }

    const pager = document.createElement('div');
    pager.className = 'pagination';
    modelListEl.appendChild(pager);
    renderPagination(pager, models.length, page, (p) => {
      paginationState.model = p;
      loadModels();
    });
  }

  async function setTaskModel(idx, storageKey, label) {
    const result = await chrome.storage.local.get(['llm_models']);
    const models = result.llm_models || [];
    if (!models[idx] || !models[idx].isActive) {
      showModelStatus('请先激活该模型');
      return;
    }
    await safeSet({ [storageKey]: models[idx].id });
    showModelStatus(`已设为${label}模型`);
    await loadModels();
  }

  async function deleteModel(idx) {
    if (!confirm('确定要删除这个大模型配置吗？')) return;
    const result = await chrome.storage.local.get([
      'llm_models', 'active_model_id',
      'model_bank_id', 'model_extract_id'
    ]);
    const models = result.llm_models || [];
    const deletedModel = models[idx];
    models.splice(idx, 1);

    const updates = { llm_models: models };
    if (result.active_model_id === deletedModel.id) {
      const firstActive = models.find(m => m.isActive);
      updates.active_model_id = firstActive ? firstActive.id : '';
    }
    if (result.model_bank_id === deletedModel.id) {
      updates.model_bank_id = '';
    }
    if (result.model_extract_id === deletedModel.id) {
      updates.model_extract_id = '';
    }

    await safeSet(updates);
    showModelStatus('模型已删除');
    await loadModels();
  }

  async function toggleModelActive(idx, checked) {
    const result = await chrome.storage.local.get([
      'llm_models', 'active_model_id',
      'model_bank_id', 'model_extract_id'
    ]);
    const models = result.llm_models || [];
    const model = models[idx];
    models[idx].isActive = checked;

    const updates = { llm_models: models };
    let answerChanged = false;
    if (!checked && result.active_model_id === model.id) {
      const firstActive = models.find(m => m.isActive);
      updates.active_model_id = firstActive ? firstActive.id : '';
      answerChanged = true;
    } else if (checked && !result.active_model_id) {
      updates.active_model_id = model.id;
      answerChanged = true;
    }

    // 停用时清理任务映射
    if (!checked) {
      if (result.model_bank_id === model.id) {
        updates.model_bank_id = '';
        answerChanged = true;
      }
      if (result.model_extract_id === model.id) {
        updates.model_extract_id = '';
        answerChanged = true;
      }
    }

    await safeSet(updates);
    showModelStatus(checked ? '模型已激活' : '模型已停用');
    const activeModelId = updates.active_model_id !== undefined ? updates.active_model_id : result.active_model_id;
    if (answerChanged) {
      // 答题模型变化了，需要更新整个列表
      await loadModels();
    } else {
      // 只更新当前 item，保留 switch 动画
      updateModelItemDom(idx, models[idx], activeModelId, result.model_bank_id, result.model_extract_id);
    }
  }

  function updateModelItemDom(idx, model, activeModelId, bankModelId, extractModelId) {
    const checkbox = modelListEl.querySelector(`input[data-idx="${idx}"][data-action="toggle"]`);
    if (!checkbox) return;
    const item = checkbox.closest('.list-item');
    if (!item) return;
    const isAnswerModel = model.id === activeModelId;
    const isBank = model.id === bankModelId;
    const isExtract = model.id === extractModelId;
    item.classList.toggle('model-inactive', !model.isActive);
    item.classList.toggle('active', isAnswerModel);
    // 更新 badge
    const titleEl = item.querySelector('.list-item-title');
    if (titleEl) {
      const nameText = escapeHtml(model.name || '未命名');
      let badgeHtml = '';
      if (isAnswerModel) badgeHtml += '<span class="model-badge model-preferred">答题</span>';
      if (isExtract) badgeHtml += '<span class="model-badge model-task-extract">页面解析</span>';
      if (isBank) badgeHtml += '<span class="model-badge model-task-bank">题库解析</span>';
      titleEl.innerHTML = nameText + badgeHtml;
    }
    // 重建 footer（包含全部三个操作链接）
    const existingFooter = item.querySelector('.list-item-footer');
    const footerButtons = [];
    if (!isAnswerModel && model.isActive) {
      footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-answer">用于答题</button>');
    }
    if (!isExtract && model.isActive) {
      footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-extract">用于页面解析</button>');
    }
    if (!isBank && model.isActive) {
      footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-bank">用于题库解析</button>');
    }
    if (existingFooter && footerButtons.length > 0) {
      existingFooter.innerHTML = footerButtons.join('');
    } else if (!existingFooter && footerButtons.length > 0) {
      const footer = document.createElement('div');
      footer.className = 'list-item-footer';
      footer.innerHTML = footerButtons.join('');
      item.appendChild(footer);
    } else if (existingFooter) {
      existingFooter.remove();
    }
    // 重新绑定 footer 按钮事件
    const answerBtn = item.querySelector('[data-action="set-answer"]');
    if (answerBtn) {
      answerBtn.addEventListener('click', () => setAnswerModel(idx));
    }
    const extractBtn = item.querySelector('[data-action="set-extract"]');
    if (extractBtn) {
      extractBtn.addEventListener('click', () => setTaskModel(idx, 'model_extract_id', '页面解析'));
    }
    const bankBtn = item.querySelector('[data-action="set-bank"]');
    if (bankBtn) {
      bankBtn.addEventListener('click', () => setTaskModel(idx, 'model_bank_id', '题库解析'));
    }
  }

  async function setAnswerModel(idx) {
    const result = await chrome.storage.local.get(['llm_models']);
    const models = result.llm_models || [];
    if (!models[idx].isActive) {
      showModelStatus('请先激活该模型');
      return;
    }
    await safeSet({ active_model_id: models[idx].id });
    showModelStatus('已设为答题模型');
    await loadModels();
  }

  /**
   * 渲染工具标签列表
   */
  function renderToolsTags(tools) {
    if (!tools || tools.length === 0) return '';
    return tools.map((t, i) => `
      <span class="tools-tag" data-tool-idx="${i}" data-tool-name="${escapeHtml(t.type || '')}">
        ${escapeHtml(t.type || '')}
        <button type="button" class="tools-tag-close">&times;</button>
      </span>
    `).join('');
  }

  function generateModelName(apiUrl, modelId) {
    if (!apiUrl || !modelId) return '';
    try {
      const url = new URL(apiUrl);
      let hostname = url.hostname;
      hostname = hostname.replace(/^(api|openai|chat)\./, '');
      const domain = hostname.split('.')[0];
      return `${domain}/${modelId}`;
    } catch {
      return '';
    }
  }

  function openModelDrawer(model) {
    const isEdit = !!model;
    drawerTitleEl.textContent = isEdit ? '编辑大模型' : '添加大模型';
    drawerMetaEl.textContent = '';
    currentModelEditingBase = model ? JSON.parse(JSON.stringify(model)) : null;
    renderModelForm(model || {});
    drawerSaveBtn.style.display = '';
    drawerSaveBtn.dataset.action = 'save-model';
    drawerSaveBtn.dataset.modelId = model?.id || '';
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

  function renderModelForm(model) {
    const isNew = !model.id;
    let nameManuallyEdited = !!model.name;

    drawerBodyEl.innerHTML = `
      <div class="rule-form-group">
        <label>模型展示名称 <span style="color:var(--color-error-text);">*</span></label>
        <input type="text" id="model-name" value="${escapeHtml(model.name || '')}" placeholder="自动生成：主站名/模型ID">
        <div class="hint">用于区分不同模型配置，需全局唯一</div>
      </div>

      <div class="rule-form-section">API 配置</div>

      <div class="rule-form-group">
        <label>API 格式</label>
        <div class="segmented-control" id="model-apiFormat" data-active="${(!model.apiFormat || model.apiFormat === 'openai') ? 'openai' : (model.apiFormat === 'anthropic' ? 'anthropic' : 'responses')}">
          <button type="button" class="${!model.apiFormat || model.apiFormat === 'openai' ? 'seg-active' : ''}" data-value="openai">OpenAI</button>
          <button type="button" class="${model.apiFormat === 'anthropic' ? 'seg-active' : ''}" data-value="anthropic">Anthropic</button>
          <button type="button" class="${model.apiFormat === 'responses' ? 'seg-active' : ''}" data-value="responses">Responses</button>
        </div>
        <div class="hint">根据 API 服务商提供的请求格式设置</div>
      </div>

      <div class="rule-form-group">
        <label>API 基础 URL <span style="color:var(--color-error-text);">*</span></label>
        <input type="text" id="model-apiUrl" value="${escapeHtml(model.apiUrl || 'https://api.deepseek.com/v1')}" placeholder="https://api.deepseek.com/v1">
        <div class="hint">例如：https://api.deepseek.com/v1、https://api.openai.com/v1</div>
      </div>

      <div class="rule-form-group">
        <label>API Key <span style="color:var(--color-error-text);">*</span></label>
        <div class="input-wrapper">
          <input type="password" id="model-apiKey" value="${escapeHtml(model.apiKey || '')}" placeholder="sk-...">
          <button type="button" class="toggle-visible" id="model-toggleKey">显示</button>
        </div>
        <div class="hint">您的 API 密钥仅存储在本地浏览器中</div>
      </div>

      <div class="rule-form-group">
        <label>模型 ID <span style="color:var(--color-error-text);">*</span></label>
        <input type="text" id="model-modelId" value="${escapeHtml(model.modelId || '')}" placeholder="deepseek-v4-pro">
        <div class="hint">例如：gpt-5、deepseek-v4-pro、deepseek-v4-flash</div>
      </div>

      <div class="rule-form-group" id="model-toolsGroup" style="display:${model.apiFormat === 'responses' ? '' : 'none'}">
        <label>内置工具</label>
        <div class="tools-select" id="model-toolsSelect">
          <div class="tools-select-inner" id="model-toolsSelectInner">
            ${renderToolsTags(model.tools || [])}
            <input type="text" class="tools-select-input" id="model-toolsField"
                   placeholder="${(model.tools || []).length === 0 ? '输入内置工具名称后按回车添加' : ''}"
                   autocomplete="off">
          </div>
        </div>
        <div class="hint">例如 web_search；输入后按回车添加，点击 × 移除</div>
      </div>

      <div class="rule-form-section">思考模式</div>
      <div class="rule-form-group">
        <label>思考模式</label>
        <label class="switch">
          <input type="checkbox" id="model-enableThinking" ${model.enableThinking ? 'checked' : ''}>
          <span class="switch-slider"></span>
        </label>
        <div class="hint">启用后强制开启思考模式，未启用则由模型自己判断</div>
      </div>
      <div class="rule-form-group" id="model-thinkingEffortGroup" style="display:${model.enableThinking ? '' : 'none'}">
        <label>思考强度</label>
        <div class="segmented-control" id="model-thinkingEffort" data-active="${model.thinkingEffort || 'high'}">
          <button type="button" class="${(!model.thinkingEffort || model.thinkingEffort === 'high') ? 'seg-active' : ''}" data-value="high">High</button>
          <button type="button" class="${model.thinkingEffort === 'max' ? 'seg-active' : ''}" data-value="max">Max</button>
        </div>
        <div class="hint">High 适合多数场景；Max 适合复杂推理任务</div>
      </div>

      <div class="rule-form-section">测试连接</div>
      <div class="rule-form-group">
        <textarea id="model-testText" placeholder="输入测试文本" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;">请回复 OK</textarea>
        <button type="button" class="btn-primary" id="model-testBtn" style="width:100%;margin-top:8px;">测试连接</button>
        <div id="model-testResult" style="display:none;">
          <div class="test-status" id="model-testStatus"></div>
          <div class="test-thinking" id="model-testThinking" style="display:none;">
            <div class="test-thinking-header" id="model-testThinkingHeader">
              <span class="test-thinking-dot"></span>
              <span>深度思考</span>
              <svg class="test-thinking-chevron" width="12" height="12" viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
            </div>
            <div class="test-thinking-body" id="model-testThinkingBody"></div>
          </div>
          <div class="test-response" id="model-testResponse"></div>
        </div>
      </div>
    `;

    // 自动生成名称
    const nameInput = drawerBodyEl.querySelector('#model-name');
    const apiUrlInput = drawerBodyEl.querySelector('#model-apiUrl');
    const modelIdInput = drawerBodyEl.querySelector('#model-modelId');
    const formatToggle = drawerBodyEl.querySelector('#model-apiFormat');

    function tryAutoGenerateName() {
      if (nameManuallyEdited) return;
      const autoName = generateModelName(apiUrlInput.value.trim(), modelIdInput.value.trim());
      if (autoName) {
        nameInput.value = autoName;
      }
    }

    nameInput.addEventListener('input', () => {
      nameManuallyEdited = true;
    });

    apiUrlInput.addEventListener('input', tryAutoGenerateName);
    modelIdInput.addEventListener('input', tryAutoGenerateName);

    // 新增时初始触发一次自动生成
    if (isNew) {
      tryAutoGenerateName();
    }

    const toggleKeyBtn = drawerBodyEl.querySelector('#model-toggleKey');
    const apiKeyInput = drawerBodyEl.querySelector('#model-apiKey');
    toggleKeyBtn.addEventListener('click', () => {
      if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleKeyBtn.textContent = '隐藏';
      } else {
        apiKeyInput.type = 'password';
        toggleKeyBtn.textContent = '显示';
      }
    });

    // 思考模式开关 - 控制思考强度是否显示
    const thinkingToggle = drawerBodyEl.querySelector('#model-enableThinking');
    const thinkingEffortGroup = drawerBodyEl.querySelector('#model-thinkingEffortGroup');
    thinkingToggle.addEventListener('change', () => {
      thinkingEffortGroup.style.display = thinkingToggle.checked ? '' : 'none';
    });

    // 初始化思考强度分段控件
    const thinkingEffortSeg = drawerBodyEl.querySelector('#model-thinkingEffort');
    if (thinkingEffortSeg) {
      const activeBtn = thinkingEffortSeg.querySelector('.seg-active');
      if (activeBtn) setSegValue(thinkingEffortSeg, activeBtn.dataset.value);
    }

    // 思考过程折叠/展开
    const thinkingHeader = drawerBodyEl.querySelector('#model-testThinkingHeader');
    const thinkingBody = drawerBodyEl.querySelector('#model-testThinkingBody');
    thinkingHeader.addEventListener('click', () => {
      const expanded = thinkingBody.style.display !== 'none';
      thinkingBody.style.display = expanded ? 'none' : '';
      thinkingHeader.classList.toggle('test-thinking-collapsed', expanded);
    });

    const testBtn = drawerBodyEl.querySelector('#model-testBtn');
    testBtn.addEventListener('click', testModelConnection);

    // 工具选择器（antdv Select 多选风格）
    initToolsSelect(drawerBodyEl);

    // API 格式切换时显示/隐藏工具区域
    const apiFormatSeg = drawerBodyEl.querySelector('#model-apiFormat');
    const toolsGroup = drawerBodyEl.querySelector('#model-toolsGroup');
    if (apiFormatSeg && toolsGroup) {
      const observer = new MutationObserver(() => {
        toolsGroup.style.display = apiFormatSeg.dataset.active === 'responses' ? '' : 'none';
      });
      observer.observe(apiFormatSeg, { attributes: true, attributeFilter: ['data-active'] });
    }
  }

  /**
   * 从 DOM 中收集当前表单的所有工具标签
   */
  function collectTools() {
    const container = document.querySelector('#model-toolsSelectInner');
    if (!container) return [];
    return [...container.querySelectorAll('.tools-tag')]
      .map(tag => tag.dataset.toolName)
      .filter(Boolean)
      .map(name => ({ type: name }));
  }

  function initToolsSelect(drawerBodyEl) {
    const field = drawerBodyEl.querySelector('#model-toolsField');
    const inner = drawerBodyEl.querySelector('#model-toolsSelectInner');
    const select = drawerBodyEl.querySelector('#model-toolsSelect');
    if (!field || !inner) return;

    function getToolNames() {
      return [...inner.querySelectorAll('.tools-tag')].map(t => t.dataset.toolName);
    }

    function commitTool(name) {
      if (!name) return;
      const existing = getToolNames();
      if (existing.includes(name)) return;
      const tag = document.createElement('span');
      tag.className = 'tools-tag';
      tag.dataset.toolName = name;
      tag.innerHTML = `${escapeHtml(name)} <button type="button" class="tools-tag-close">&times;</button>`;
      inner.insertBefore(tag, field);
      field.value = '';
      field.placeholder = '';
    }

    function removeTag(idx) {
      const tags = [...inner.querySelectorAll('.tools-tag')];
      if (tags[idx]) tags[idx].remove();
      if (getToolNames().length === 0) {
        field.placeholder = '输入内置工具名称后按回车添加';
      }
    }

    // 点击容器聚焦输入框
    select.addEventListener('click', (e) => {
      if (e.target === select || e.target === inner || e.target === field) {
        field.focus();
      }
    });

    // 标签关闭按钮
    inner.addEventListener('click', (e) => {
      if (e.target.classList.contains('tools-tag-close')) {
        e.stopPropagation();
        const tag = e.target.closest('.tools-tag');
        const tags = [...inner.querySelectorAll('.tools-tag')];
        removeTag(tags.indexOf(tag));
      }
    });

    // 输入框键盘事件
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTool(field.value.trim());
      } else if (e.key === 'Backspace' && field.value === '' && field.selectionStart === 0) {
        const tags = [...inner.querySelectorAll('.tools-tag')];
        if (tags.length > 0) removeTag(tags.length - 1);
      }
    });
  }

  async function testModelConnection() {
    const resultEl = drawerBodyEl.querySelector('#model-testResult');
    const statusEl = drawerBodyEl.querySelector('#model-testStatus');
    const thinkingEl = drawerBodyEl.querySelector('#model-testThinking');
    const thinkingBodyEl = drawerBodyEl.querySelector('#model-testThinkingBody');
    const thinkingHeaderEl = drawerBodyEl.querySelector('#model-testThinkingHeader');
    const responseEl = drawerBodyEl.querySelector('#model-testResponse');

    const apiUrl = drawerBodyEl.querySelector('#model-apiUrl').value.trim().replace(/\/+$/, '');
    const apiKey = drawerBodyEl.querySelector('#model-apiKey').value.trim();
    const modelId = drawerBodyEl.querySelector('#model-modelId').value.trim();
    const testText = drawerBodyEl.querySelector('#model-testText').value.trim();
    const apiFormat = drawerBodyEl.querySelector('#model-apiFormat')?.dataset?.active || 'openai';
    const enableThinking = drawerBodyEl.querySelector('#model-enableThinking')?.checked || false;
    const thinkingEffort = drawerBodyEl.querySelector('#model-thinkingEffort')?.dataset?.active || 'high';

    if (!apiUrl || !apiKey || !modelId) {
      statusEl.innerHTML = '<span class="test-status-error">请先填写 API URL、API Key 和模型 ID</span>';
      resultEl.style.display = '';
      thinkingEl.style.display = 'none';
      responseEl.innerHTML = '';
      return;
    }

    // 重置界面
    resultEl.style.display = '';
    thinkingEl.style.display = 'none';
    thinkingBodyEl.textContent = '';
    thinkingHeaderEl.classList.remove('test-thinking-collapsed');
    thinkingBodyEl.style.display = '';
    responseEl.textContent = '';
    statusEl.innerHTML = '<span class="test-status-loading"><span class="test-spinner"></span>请求中...</span>';

    const userContent = testText || '请回复 OK';

    // 收集当前表单中的 tools 用于测试
    const testTools = collectTools();

    try {
      if (apiFormat === 'anthropic') {
        await streamAnthropicTest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, {
          statusEl, thinkingEl, thinkingBodyEl, thinkingHeaderEl, responseEl
        });
      } else if (apiFormat === 'responses') {
        await streamResponsesTest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, testTools, {
          statusEl, thinkingEl, thinkingBodyEl, thinkingHeaderEl, responseEl
        });
      } else {
        await streamOpenAITest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, {
          statusEl, thinkingEl, thinkingBodyEl, thinkingHeaderEl, responseEl
        });
      }
    } catch (err) {
      statusEl.innerHTML = `<span class="test-status-error">连接失败: ${escapeHtml(err.message)}</span>`;
      thinkingEl.style.display = 'none';
    }
  }

  async function streamOpenAITest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, els) {
    const body = { model: modelId, messages: [{ role: 'user', content: userContent }], stream: true };
    if (enableThinking) {
      body.thinking = { type: 'enabled' };
      body.reasoning_effort = thinkingEffort;
    } else {
      body.temperature = 0;
    }

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    await parseOpenAISSE(response.body.getReader(), els);
  }

  /**
   * KaTeX 渲染 LaTeX 数学公式
   */
  function preprocessLatex(text) {
    // 块级公式 \[ ... \]
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
      try {
        return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
      } catch (_) {
        return `<code>${math.trim()}</code>`;
      }
    });
    // 行内公式 \( ... \)
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
      try {
        return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
      } catch (_) {
        return `<code>${math.trim()}</code>`;
      }
    });
    return text;
  }

  async function parseOpenAISSE(reader, els) {
    const decoder = new TextDecoder();
    let buffer = '';
    let hasThinking = false;
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.reasoning_content) {
            if (!hasThinking) {
              hasThinking = true;
              els.thinkingEl.style.display = '';
              els.statusEl.innerHTML = '<span class="test-status-thinking"><span class="test-spinner"></span>深度思考中...</span>';
            }
            els.thinkingBodyEl.textContent += delta.reasoning_content;
            els.thinkingBodyEl.scrollTop = els.thinkingBodyEl.scrollHeight;
          }

          if (delta.content) {
            if (hasThinking && els.thinkingBodyEl.style.display !== 'none') {
              els.statusEl.innerHTML = '';
            }
            fullText += delta.content;
            els.responseEl.textContent = fullText;
            els.responseEl.scrollTop = els.responseEl.scrollHeight;
          }
        } catch (_) { /* 忽略解析错误 */ }
      }
    }

    // 流式结束后用 marked 渲染 Markdown
    if (fullText) {
      els.responseEl.innerHTML = marked.parse(preprocessLatex(fullText), { breaks: true, gfm: true });
    }
    els.statusEl.innerHTML = '<span class="test-status-success">连接成功</span>';
    if (hasThinking) {
      els.thinkingHeaderEl.classList.add('test-thinking-collapsed');
      els.thinkingBodyEl.style.display = 'none';
    }
  }

  async function streamAnthropicTest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, els) {
    const body = { model: modelId, messages: [{ role: 'user', content: userContent }], max_tokens: 4096, stream: true };
    if (enableThinking) {
      body.thinking = { type: 'enabled' };
      body.output_config = { effort: thinkingEffort };
    } else {
      body.temperature = 0;
    }

    const response = await fetch(`${apiUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    await parseAnthropicSSE(response.body.getReader(), els);
  }

  async function parseAnthropicSSE(reader, els) {
    const decoder = new TextDecoder();
    let buffer = '';
    let hasThinking = false;
    let currentEvent = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();

        try {
          const json = JSON.parse(data);

          if (currentEvent === 'content_block_start' || currentEvent === 'content_block_delta') {
            const text = json.delta?.text || json.content_block?.text || '';
            const thinking = json.delta?.thinking || json.content_block?.thinking || '';

            if (thinking) {
              if (!hasThinking) {
                hasThinking = true;
                els.thinkingEl.style.display = '';
                els.statusEl.innerHTML = '<span class="test-status-thinking"><span class="test-spinner"></span>深度思考中...</span>';
              }
              els.thinkingBodyEl.textContent += thinking;
              els.thinkingBodyEl.scrollTop = els.thinkingBodyEl.scrollHeight;
            }

            if (text) {
              if (hasThinking && els.thinkingBodyEl.style.display !== 'none') {
                els.statusEl.innerHTML = '';
              }
              fullText += text;
              els.responseEl.textContent = fullText;
              els.responseEl.scrollTop = els.responseEl.scrollHeight;
            }
          }
        } catch (_) { /* 忽略解析错误 */ }
      }
    }

    // 流式结束后用 marked 渲染 Markdown
    if (fullText) {
      els.responseEl.innerHTML = marked.parse(preprocessLatex(fullText), { breaks: true, gfm: true });
    }
    els.statusEl.innerHTML = '<span class="test-status-success">连接成功</span>';
    if (hasThinking) {
      els.thinkingHeaderEl.classList.add('test-thinking-collapsed');
      els.thinkingBodyEl.style.display = 'none';
    }
  }

  async function streamResponsesTest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, tools, els) {
    const body = { model: modelId, input: [{ role: 'user', content: userContent }], stream: true };
    if (tools && tools.length > 0) body.tools = tools;
    if (enableThinking) {
      body.reasoning = { effort: thinkingEffort };
    } else {
      body.temperature = 0;
    }

    const response = await fetch(`${apiUrl}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    await parseResponsesSSE(response.body.getReader(), els);
  }

  async function parseResponsesSSE(reader, els) {
    const decoder = new TextDecoder();
    let buffer = '';
    let hasThinking = false;
    let currentEvent = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);

          if (currentEvent === 'response.reasoning_text.delta') {
            if (!hasThinking) {
              hasThinking = true;
              els.thinkingEl.style.display = '';
              els.statusEl.innerHTML = '<span class="test-status-thinking"><span class="test-spinner"></span>深度思考中...</span>';
            }
            els.thinkingBodyEl.textContent += (json.delta || '');
            els.thinkingBodyEl.scrollTop = els.thinkingBodyEl.scrollHeight;
          }

          if (currentEvent === 'response.output_text.delta') {
            if (hasThinking && els.thinkingBodyEl.style.display !== 'none') {
              els.statusEl.innerHTML = '';
            }
            fullText += (json.delta || '');
            els.responseEl.textContent = fullText;
            els.responseEl.scrollTop = els.responseEl.scrollHeight;
          }
        } catch (_) { /* 忽略解析错误 */ }
      }
    }

    if (fullText) {
      els.responseEl.innerHTML = marked.parse(preprocessLatex(fullText), { breaks: true, gfm: true });
    }
    els.statusEl.innerHTML = '<span class="test-status-success">连接成功</span>';
    if (hasThinking) {
      els.thinkingHeaderEl.classList.add('test-thinking-collapsed');
      els.thinkingBodyEl.style.display = 'none';
    }
  }

  function getModelFromForm() {
    const name = drawerBodyEl.querySelector('#model-name')?.value?.trim() || '';
    const apiUrl = drawerBodyEl.querySelector('#model-apiUrl')?.value?.trim().replace(/\/+$/, '') || '';
    const apiKey = drawerBodyEl.querySelector('#model-apiKey')?.value?.trim() || '';
    const modelId = drawerBodyEl.querySelector('#model-modelId')?.value?.trim() || '';
    const apiFormat = drawerBodyEl.querySelector('#model-apiFormat')?.dataset?.active || 'openai';
    const enableThinking = drawerBodyEl.querySelector('#model-enableThinking')?.checked || false;
    const thinkingEffort = drawerBodyEl.querySelector('#model-thinkingEffort')?.dataset?.active || 'high';

    // 收集工具标签
    const tools = collectTools();

    if (!name) { showModelStatus('模型展示名称不能为空'); return null; }
    if (!apiUrl) { showModelStatus('API URL 不能为空'); return null; }
    if (!apiKey) { showModelStatus('API Key 不能为空'); return null; }
    if (!modelId) { showModelStatus('模型 ID 不能为空'); return null; }

    return { name, apiUrl, apiKey, modelId, apiFormat, enableThinking, thinkingEffort, tools };
  }

  async function saveModelFromDrawer() {
    const originalId = drawerSaveBtn.dataset.modelId || '';
    const updated = getModelFromForm();
    if (!updated) return;

    const result = await chrome.storage.local.get(['llm_models', 'active_model_id']);
    const models = result.llm_models || [];

    const nameConflict = models.find((m, i) => {
      if (originalId && m.id === originalId) return false;
      return m.name === updated.name;
    });
    if (nameConflict) {
      showModelStatus(`模型展示名称「${updated.name}」已存在，请使用其他名称`);
      return;
    }

    const now = Date.now();
    let newActiveId = result.active_model_id;

    if (originalId) {
      const idx = models.findIndex(m => m.id === originalId);
      if (idx >= 0) {
        models[idx] = { ...models[idx], ...updated };
      }
    } else {
      const newModel = {
        id: `model-${now}`,
        ...updated,
        isActive: models.length === 0,
        timestamp: now
      };
      models.push(newModel);
      if (models.length === 1) {
        newActiveId = newModel.id;
      }
    }

    await safeSet({ llm_models: models, active_model_id: newActiveId });
    showModelStatus('模型已保存');
    onCloseDrawer();
    await loadModels();
  }

  return { loadModels, openModelDrawer, saveModelFromDrawer };
}
