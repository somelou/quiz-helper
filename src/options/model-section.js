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

  // 流式输出全局开关（作用于大模型测试与答题，默认开启）
  const streamOutputToggle = document.getElementById('streamOutputEnabled');
  if (streamOutputToggle) {
    chrome.storage.local.get(['stream_output']).then(result => {
      streamOutputToggle.checked = result.stream_output !== false;
    });
    streamOutputToggle.addEventListener('change', () => {
      safeSet({ stream_output: streamOutputToggle.checked });
    });
  }

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
      modelListEl.innerHTML = '<div class="list-empty">' + getMessage('optionsModelsEmpty') + '</div>';
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
      if (isAnswerModel) badges.push('<span class="model-badge model-preferred">' + getMessage('optionsModelBadgeAnswer') + '</span>');
      if (isExtract) badges.push('<span class="model-badge model-task-extract">' + getMessage('optionsModelBadgeExtract') + '</span>');
      if (isBank) badges.push('<span class="model-badge model-task-bank">' + getMessage('optionsModelBadgeBank') + '</span>');

      const badgeHtml = badges.join('');

      const item = document.createElement('div');
      item.className = 'list-item' + (isAnswerModel ? ' active' : (model.isActive ? '' : ' model-inactive'));

      // 构建用途切换 chips（demo2 .task-toggles，位于 list-info 内，供苹果主题使用）
      const taskTogglesHtml = `
        <div class="task-toggles" role="group" aria-label="${getMessage('optionsModelUseForAnswer')}">
          <button type="button" class="task-toggle${isAnswerModel ? ' active' : ''}" data-idx="${idx}" data-action="set-answer" ${model.isActive ? '' : 'disabled'}>${getMessage('optionsModelUseForAnswer')}</button>
          <button type="button" class="task-toggle${isExtract ? ' active' : ''}" data-idx="${idx}" data-action="set-extract" ${model.isActive ? '' : 'disabled'}>${getMessage('optionsModelUseForExtract')}</button>
          <button type="button" class="task-toggle${isBank ? ' active' : ''}" data-idx="${idx}" data-action="set-bank" ${model.isActive ? '' : 'disabled'}>${getMessage('optionsModelUseForBank')}</button>
        </div>`;

      // 经典主题页脚操作链接（仅显示未指派的任务，供经典主题使用）
      const footerButtons = [];
      if (!isAnswerModel && model.isActive) footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-answer">' + getMessage('optionsModelUseForAnswer') + '</button>');
      if (!isExtract && model.isActive) footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-extract">' + getMessage('optionsModelUseForExtract') + '</button>');
      if (!isBank && model.isActive) footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-bank">' + getMessage('optionsModelUseForBank') + '</button>');
      const footerHtml = footerButtons.length ? '<div class="list-item-footer">' + footerButtons.join('') + '</div>' : '';

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">
              ${escapeHtml(model.name || getMessage('optionsUnnamed'))}
              ${badgeHtml}
            </div>
            <div class="list-item-meta">${getMessage('optionsModelMetaFormat', [escapeHtml(model.modelId || ''), escapeHtml(model.apiUrl || '')])}</div>
            ${taskTogglesHtml}
          </div>
          <div class="list-item-actions">
            <label class="switch">
              <input type="checkbox" data-action="toggle" data-idx="${idx}" ${model.isActive ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
            <button class="action-btn action-edit" data-idx="${idx}"><span data-icon="pencil"></span>${getMessage('optionsEdit')}</button>
            <button class="action-btn action-delete" data-idx="${idx}"><span data-icon="trash"></span>${getMessage('commonDelete')}</button>
          </div>
        </div>
        ${footerHtml}
      `;

      item.querySelector('[data-action="toggle"]').addEventListener('change', event => {
        toggleModelActive(idx, event.target.checked);
      });
      item.querySelector('.action-edit').addEventListener('click', () => openModelDrawer(model));
      item.querySelector('.action-delete').addEventListener('click', () => deleteModel(idx));

      item.querySelectorAll('[data-action="set-answer"]').forEach(btn => {
        btn.addEventListener('click', () => setAnswerModel(idx));
      });
      item.querySelectorAll('[data-action="set-extract"]').forEach(btn => {
        btn.addEventListener('click', () => setTaskModel(idx, 'model_extract_id', getMessage('optionsModelBadgeExtract')));
      });
      item.querySelectorAll('[data-action="set-bank"]').forEach(btn => {
        btn.addEventListener('click', () => setTaskModel(idx, 'model_bank_id', getMessage('optionsModelBadgeBank')));
      });

      modelListEl.appendChild(item);
    }

    window.QuizHelperIcons?.replaceIcons(modelListEl);

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
      showModelStatus(getMessage('optionsModelActivateFirst'));
      return;
    }
    await safeSet({ [storageKey]: models[idx].id });
    showModelStatus(getMessage('optionsModelSetAsFormat', [label]));
    await loadModels();
  }

  async function deleteModel(idx) {
    if (!confirm(getMessage('optionsModelDeleteConfirm'))) return;
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
    showModelStatus(getMessage('optionsModelDeleted'));
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
    showModelStatus(checked ? getMessage('optionsModelActivated') : getMessage('optionsModelDeactivated'));
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
      const nameText = escapeHtml(model.name || getMessage('optionsUnnamed'));
      let badgeHtml = '';
      if (isAnswerModel) badgeHtml += '<span class="model-badge model-preferred">' + getMessage('optionsModelBadgeAnswer') + '</span>';
      if (isExtract) badgeHtml += '<span class="model-badge model-task-extract">' + getMessage('optionsModelBadgeExtract') + '</span>';
      if (isBank) badgeHtml += '<span class="model-badge model-task-bank">' + getMessage('optionsModelBadgeBank') + '</span>';
      titleEl.innerHTML = nameText + badgeHtml;
    }
    // 更新用途切换 chips 状态
    const toggles = item.querySelectorAll('.task-toggle');
    const stateMap = {
      'set-answer': isAnswerModel,
      'set-extract': isExtract,
      'set-bank': isBank
    };
    toggles.forEach(btn => {
      const active = !!stateMap[btn.dataset.action];
      btn.classList.toggle('active', active);
      btn.disabled = !model.isActive;
    });
    // 更新经典主题页脚操作链接（仅显示未指派任务）
    const footer = item.querySelector('.list-item-footer');
    if (footer) {
      const footerButtons = [];
      if (!isAnswerModel && model.isActive) footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-answer">' + getMessage('optionsModelUseForAnswer') + '</button>');
      if (!isExtract && model.isActive) footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-extract">' + getMessage('optionsModelUseForExtract') + '</button>');
      if (!isBank && model.isActive) footerButtons.push('<button class="action-link" data-idx="' + idx + '" data-action="set-bank">' + getMessage('optionsModelUseForBank') + '</button>');
      if (footerButtons.length) {
        footer.innerHTML = footerButtons.join('');
        footer.querySelectorAll('[data-action="set-answer"]').forEach(b => b.addEventListener('click', () => setAnswerModel(idx)));
        footer.querySelectorAll('[data-action="set-extract"]').forEach(b => b.addEventListener('click', () => setTaskModel(idx, 'model_extract_id', getMessage('optionsModelBadgeExtract'))));
        footer.querySelectorAll('[data-action="set-bank"]').forEach(b => b.addEventListener('click', () => setTaskModel(idx, 'model_bank_id', getMessage('optionsModelBadgeBank'))));
      } else {
        footer.remove();
      }
    }
  }

  async function setAnswerModel(idx) {
    const result = await chrome.storage.local.get(['llm_models']);
    const models = result.llm_models || [];
    if (!models[idx].isActive) {
      showModelStatus(getMessage('optionsModelActivateFirst'));
      return;
    }
    await safeSet({ active_model_id: models[idx].id });
    showModelStatus(getMessage('optionsModelSetAsAnswer'));
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
    drawerTitleEl.textContent = isEdit ? getMessage('optionsDrawerTitleEditModel') : getMessage('optionsDrawerTitleAddModel');
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
    initDrawerSegControls(drawerBodyEl);
  }

  function renderModelForm(model) {
    const isNew = !model.id;
    let nameManuallyEdited = !!model.name;

    drawerBodyEl.innerHTML = `
      <div class="rule-form-group">
        <label>${getMessage('optionsModelFormNameLabel')} <span style="color:var(--color-error-text);">*</span></label>
        <input type="text" id="model-name" value="${escapeHtml(model.name || '')}" placeholder="${getMessage('optionsModelFormNamePlaceholder')}">
        <div class="hint">${getMessage('optionsModelFormNameHint')}</div>
      </div>

      <div class="rule-form-section">${getMessage('optionsApiSection')}</div>

      <div class="rule-form-group">
        <label>${getMessage('optionsModelFormApiFormatLabel')}</label>
        <div class="segmented-control" id="model-apiFormat" data-active="${(!model.apiFormat || model.apiFormat === 'openai') ? 'openai' : (model.apiFormat === 'anthropic' ? 'anthropic' : 'responses')}">
          <button type="button" class="${!model.apiFormat || model.apiFormat === 'openai' ? 'seg-active' : ''}" data-value="openai">OpenAI</button>
          <button type="button" class="${model.apiFormat === 'anthropic' ? 'seg-active' : ''}" data-value="anthropic">Anthropic</button>
          <button type="button" class="${model.apiFormat === 'responses' ? 'seg-active' : ''}" data-value="responses">Responses</button>
        </div>
        <div class="hint">${getMessage('optionsModelFormApiFormatHint')}</div>
      </div>

      <div class="rule-form-group">
        <label>${getMessage('optionsModelFormApiUrlLabel')} <span style="color:var(--color-error-text);">*</span></label>
        <input type="text" id="model-apiUrl" value="${escapeHtml(model.apiUrl || 'https://api.deepseek.com/v1')}" placeholder="https://api.deepseek.com/v1">
        <div class="hint">${getMessage('optionsModelFormApiUrlHint')}</div>
      </div>

      <div class="rule-form-group">
        <label>API Key <span style="color:var(--color-error-text);">*</span></label>
        <div class="input-wrapper">
          <input type="password" id="model-apiKey" value="${escapeHtml(model.apiKey || '')}" placeholder="sk-...">
          <button type="button" class="toggle-visible" id="model-toggleKey"><span data-icon="eye"></span>${getMessage('optionsShow')}</button>
        </div>
        <div class="hint">${getMessage('optionsModelFormApiKeyHint')}</div>
      </div>

      <div class="rule-form-group">
        <label>${getMessage('optionsModelFormModelIdLabel')} <span style="color:var(--color-error-text);">*</span></label>
        <input type="text" id="model-modelId" value="${escapeHtml(model.modelId || '')}" placeholder="deepseek-v4-pro">
        <div class="hint">${getMessage('optionsModelFormModelIdHint')}</div>
      </div>

      <div class="rule-form-group" id="model-toolsGroup" style="display:${model.apiFormat === 'responses' ? '' : 'none'}">
        <label>${getMessage('optionsModelFormToolsLabel')}</label>
        <div class="tools-select" id="model-toolsSelect">
          <div class="tools-select-inner" id="model-toolsSelectInner">
            ${renderToolsTags(model.tools || [])}
            <input type="text" class="tools-select-input" id="model-toolsField"
                   placeholder="${(model.tools || []).length === 0 ? getMessage('optionsModelFormToolsPlaceholder') : ''}"
                   autocomplete="off">
          </div>
        </div>
        <div class="hint">${getMessage('optionsModelFormToolsHint')}</div>
      </div>

      <div class="rule-form-section">${getMessage('optionsModelFormThinking')}</div>
      <div class="rule-form-group">
        <label>${getMessage('optionsModelFormThinking')}</label>
        <label class="switch">
          <input type="checkbox" id="model-enableThinking" ${model.enableThinking ? 'checked' : ''}>
          <span class="switch-slider"></span>
        </label>
        <div class="hint">${getMessage('optionsModelFormThinkingHint')}</div>
      </div>
      <div class="rule-form-group" id="model-thinkingEffortGroup" style="display:${model.enableThinking ? '' : 'none'}">
        <label>${getMessage('optionsModelFormEffortLabel')}</label>
        <div class="segmented-control" id="model-thinkingEffort" data-active="${model.thinkingEffort || 'high'}">
          <button type="button" class="${model.thinkingEffort === 'low' ? 'seg-active' : ''}" data-value="low">Low</button>
          <button type="button" class="${model.thinkingEffort === 'medium' ? 'seg-active' : ''}" data-value="medium">Medium</button>
          <button type="button" class="${(!model.thinkingEffort || model.thinkingEffort === 'high') ? 'seg-active' : ''}" data-value="high">High</button>
          <button type="button" class="${model.thinkingEffort === 'xhigh' ? 'seg-active' : ''}" data-value="xhigh">X-High</button>
          <button type="button" class="${model.thinkingEffort === 'max' ? 'seg-active' : ''}" data-value="max">Max</button>
        </div>
        <div class="hint">${getMessage('optionsModelFormEffortHint')}</div>
      </div>

      <div class="rule-form-section">${getMessage('optionsModelTestConnection')}</div>
      <div class="rule-form-group">
        <textarea id="model-testText" placeholder="${getMessage('optionsModelFormTestTextPlaceholder')}" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;">${getMessage('optionsModelFormTestTextValue')}</textarea>
        <button type="button" class="btn-primary" id="model-testBtn" style="width:100%;margin-top:8px;"><span data-icon="plug"></span>${getMessage('optionsModelTestConnection')}</button>
        <div id="model-testResult" style="display:none;">
          <div class="test-status" id="model-testStatus"></div>
          <div class="test-thinking" id="model-testThinking" style="display:none;">
            <div class="test-thinking-header" id="model-testThinkingHeader">
              <span class="test-thinking-dot"></span>
              <span>${getMessage('optionsModelFormDeepThinking')}</span>
              <svg class="test-thinking-chevron" width="12" height="12" viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
            </div>
            <div class="test-thinking-body" id="model-testThinkingBody"></div>
          </div>
          <div class="test-response" id="model-testResponse"></div>
        </div>
      </div>
    `;

    // 渲染后统一替换 data-icon（列表编辑入口不经过 index.js openDrawer，需在此兜底）
    window.QuizHelperIcons?.replaceIcons(drawerBodyEl);

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
      const reveal = apiKeyInput.type === 'password';
      apiKeyInput.type = reveal ? 'text' : 'password';
      toggleKeyBtn.innerHTML = `<span data-icon="${reveal ? 'eye-off' : 'eye'}"></span>${reveal ? getMessage('optionsHide') : getMessage('optionsShow')}`;
      window.QuizHelperIcons?.replaceIcons(toggleKeyBtn);
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
        field.placeholder = getMessage('optionsModelFormToolsPlaceholder');
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
      statusEl.innerHTML = '<span class="test-status-error">' + getMessage('optionsModelFormTestErrorNoApi') + '</span>';
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
    statusEl.innerHTML = '<span class="test-status-loading"><span class="test-spinner"></span>' + getMessage('optionsModelFormTestRequesting') + '</span>';

    const userContent = testText || getMessage('optionsModelFormTestTextValue');

    // 收集当前表单中的 tools 用于测试
    const testTools = collectTools();

    // 流式输出开关：关闭时走非流式测试（一次性返回完整结果）
    const { stream_output } = await chrome.storage.local.get(['stream_output']);
    const streamEnabled = stream_output !== false;

    try {
      if (apiFormat === 'anthropic') {
        await streamAnthropicTest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, {
          statusEl, thinkingEl, thinkingBodyEl, thinkingHeaderEl, responseEl
        }, streamEnabled);
      } else if (apiFormat === 'responses') {
        await streamResponsesTest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, testTools, {
          statusEl, thinkingEl, thinkingBodyEl, thinkingHeaderEl, responseEl
        }, streamEnabled);
      } else {
        await streamOpenAITest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, {
          statusEl, thinkingEl, thinkingBodyEl, thinkingHeaderEl, responseEl
        }, streamEnabled);
      }
    } catch (err) {
      statusEl.innerHTML = `<span class="test-status-error">${getMessage('optionsModelFormTestConnFail', [escapeHtml(err.message)])}</span>`;
      thinkingEl.style.display = 'none';
    }
  }

  /**
   * 非流式测试收尾：一次性渲染完整结果并标记成功
   * @param {string} text - 模型返回文本
   * @param {Object} els - 测试结果相关 DOM 元素
   */
  function renderNonStreamResult(text, els) {
    if (text) {
      els.responseEl.innerHTML = marked.parse(preprocessLatex(text), { breaks: true, gfm: true });
    }
    els.statusEl.innerHTML = '<span class="test-status-success">' + getMessage('optionsModelFormTestConnSuccess') + '</span>';
  }

  async function streamOpenAITest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, els, stream = true) {
    // 请求体构造统一复用 shared/llm-utils.js
    const body = globalThis.QuizHelperLLMUtils.buildOpenAIBody({
      model: modelId,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0,
      enableThinking,
      thinkingEffort,
      stream
    });

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (!stream) {
      const data = await response.json();
      renderNonStreamResult(data.choices?.[0]?.message?.content || '', els);
      return;
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
    let hasThinking = false;
    // 流式解析统一复用 shared/llm-utils.js，此处只做 UI 更新
    const fullText = await globalThis.QuizHelperLLMUtils.parseOpenAISSE(reader, (event) => {
      if (event.type === 'thinking') {
        if (!hasThinking) {
          hasThinking = true;
          els.thinkingEl.style.display = '';
          els.statusEl.innerHTML = '<span class="test-status-thinking"><span class="test-spinner"></span>' + getMessage('optionsModelFormTestThinking') + '</span>';
        }
        els.thinkingBodyEl.textContent += event.content;
        els.thinkingBodyEl.scrollTop = els.thinkingBodyEl.scrollHeight;
      } else if (event.type === 'text') {
        if (hasThinking && els.thinkingBodyEl.style.display !== 'none') {
          els.statusEl.innerHTML = '';
        }
        els.responseEl.textContent += event.content;
        els.responseEl.scrollTop = els.responseEl.scrollHeight;
      }
    });

    // 流式结束后用 marked 渲染 Markdown
    if (fullText) {
      els.responseEl.innerHTML = marked.parse(preprocessLatex(fullText), { breaks: true, gfm: true });
    }
    els.statusEl.innerHTML = '<span class="test-status-success">' + getMessage('optionsModelFormTestConnSuccess') + '</span>';
    if (hasThinking) {
      els.thinkingHeaderEl.classList.add('test-thinking-collapsed');
      els.thinkingBodyEl.style.display = 'none';
    }
  }

  async function streamAnthropicTest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, els, stream = true) {
    // 请求体构造统一复用 shared/llm-utils.js
    const body = globalThis.QuizHelperLLMUtils.buildAnthropicBody({
      model: modelId,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 4096,
      temperature: 0,
      enableThinking,
      thinkingEffort,
      stream
    });

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

    if (!stream) {
      const data = await response.json();
      renderNonStreamResult(data.content?.[0]?.text || '', els);
      return;
    }

    await parseAnthropicSSE(response.body.getReader(), els);
  }

  async function parseAnthropicSSE(reader, els) {
    let hasThinking = false;
    // 流式解析统一复用 shared/llm-utils.js，此处只做 UI 更新
    const fullText = await globalThis.QuizHelperLLMUtils.parseAnthropicSSE(reader, (event) => {
      if (event.type === 'thinking') {
        if (!hasThinking) {
          hasThinking = true;
          els.thinkingEl.style.display = '';
          els.statusEl.innerHTML = '<span class="test-status-thinking"><span class="test-spinner"></span>' + getMessage('optionsModelFormTestThinking') + '</span>';
        }
        els.thinkingBodyEl.textContent += event.content;
        els.thinkingBodyEl.scrollTop = els.thinkingBodyEl.scrollHeight;
      } else if (event.type === 'text') {
        if (hasThinking && els.thinkingBodyEl.style.display !== 'none') {
          els.statusEl.innerHTML = '';
        }
        els.responseEl.textContent += event.content;
        els.responseEl.scrollTop = els.responseEl.scrollHeight;
      }
    });

    // 流式结束后用 marked 渲染 Markdown
    if (fullText) {
      els.responseEl.innerHTML = marked.parse(preprocessLatex(fullText), { breaks: true, gfm: true });
    }
    els.statusEl.innerHTML = '<span class="test-status-success">' + getMessage('optionsModelFormTestConnSuccess') + '</span>';
    if (hasThinking) {
      els.thinkingHeaderEl.classList.add('test-thinking-collapsed');
      els.thinkingBodyEl.style.display = 'none';
    }
  }

  async function streamResponsesTest(apiUrl, apiKey, modelId, userContent, enableThinking, thinkingEffort, tools, els, stream = true) {
    // 请求体构造统一复用 shared/llm-utils.js
    const body = globalThis.QuizHelperLLMUtils.buildResponsesBody({
      model: modelId,
      input: [{ role: 'user', content: userContent }],
      tools,
      temperature: 0,
      enableThinking,
      thinkingEffort,
      stream
    });

    const response = await fetch(`${apiUrl}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (!stream) {
      const data = await response.json();
      const output = data.output?.find(o => o.type === 'message');
      const textContent = output?.content?.find(c => c.type === 'output_text');
      renderNonStreamResult(textContent?.text || '', els);
      return;
    }

    await parseResponsesSSE(response.body.getReader(), els);
  }

  async function parseResponsesSSE(reader, els) {
    let hasThinking = false;
    // 流式解析统一复用 shared/llm-utils.js，此处只做 UI 更新（联网搜索状态/引用标注事件在此忽略）
    // 注意：Responses 解析返回 {text, annotations}，需取 .text
    const result = await globalThis.QuizHelperLLMUtils.parseResponsesSSE(reader, (event) => {
      if (event.type === 'thinking') {
        if (!hasThinking) {
          hasThinking = true;
          els.thinkingEl.style.display = '';
          els.statusEl.innerHTML = '<span class="test-status-thinking"><span class="test-spinner"></span>' + getMessage('optionsModelFormTestThinking') + '</span>';
        }
        els.thinkingBodyEl.textContent += event.content;
        els.thinkingBodyEl.scrollTop = els.thinkingBodyEl.scrollHeight;
      } else if (event.type === 'text') {
        if (hasThinking && els.thinkingBodyEl.style.display !== 'none') {
          els.statusEl.innerHTML = '';
        }
        els.responseEl.textContent += event.content;
        els.responseEl.scrollTop = els.responseEl.scrollHeight;
      }
    });
    const fullText = result.text;

    if (fullText) {
      els.responseEl.innerHTML = marked.parse(preprocessLatex(fullText), { breaks: true, gfm: true });
    }
    els.statusEl.innerHTML = '<span class="test-status-success">' + getMessage('optionsModelFormTestConnSuccess') + '</span>';
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

    if (!name) { showModelStatus(getMessage('optionsModelFormNameRequired')); return null; }
    if (!apiUrl) { showModelStatus(getMessage('optionsModelFormApiUrlRequired')); return null; }
    if (!apiKey) { showModelStatus(getMessage('optionsModelFormApiKeyRequired')); return null; }
    if (!modelId) { showModelStatus(getMessage('optionsModelFormModelIdRequired')); return null; }

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
      showModelStatus(getMessage('optionsModelFormNameConflict', [updated.name]));
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
    showModelStatus(getMessage('optionsModelSaved'));
    onCloseDrawer();
    await loadModels();
  }

  return { loadModels, openModelDrawer, saveModelFromDrawer };
}
