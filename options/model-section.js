// 大模型管理模块

function initModels({
  modelListEl, modelStatusEl,
  drawerBodyEl, drawerTitleEl, drawerMetaEl,
  drawerSaveBtn, drawerOverlay,
  onCloseDrawer
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const paginationState = { model: 1 };
  let currentModelEditingBase = null;

  function showModelStatus(msg) {
    modelStatusEl.textContent = msg;
    if (msg) {
      setTimeout(() => {
        if (modelStatusEl.textContent === msg) modelStatusEl.textContent = '';
      }, 3000);
    }
  }

  async function loadModels() {
    const result = await chrome.storage.local.get(['llm_models', 'active_model_id']);
    const models = result.llm_models || [];
    renderModels(models, result.active_model_id || '');
  }

  function renderModels(models, activeModelId) {
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
      const isPreferred = model.id === activeModelId;
      const item = document.createElement('div');
      item.className = 'list-item' + (isPreferred ? ' active' : (model.isActive ? '' : ' model-inactive'));

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">
              ${escapeHtml(model.name || '未命名')}
              ${isPreferred ? '<span class="model-badge model-preferred">首选</span>' : ''}
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
        ${!isPreferred && model.isActive ? `
        <div class="list-item-footer">
          <button class="action-link" data-idx="${idx}" data-action="preferred">设为首选</button>
        </div>
        ` : ''}
      `;

      item.querySelector('[data-action="toggle"]').addEventListener('change', event => {
        toggleModelActive(idx, event.target.checked);
      });
      item.querySelector('.action-edit').addEventListener('click', () => openModelDrawer(model));
      item.querySelector('.action-delete').addEventListener('click', () => deleteModel(idx));

      const preferredBtn = item.querySelector('[data-action="preferred"]');
      if (preferredBtn) {
        preferredBtn.addEventListener('click', () => setPreferredModel(idx));
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

  async function deleteModel(idx) {
    if (!confirm('确定要删除这个大模型配置吗？')) return;
    const result = await chrome.storage.local.get(['llm_models', 'active_model_id']);
    const models = result.llm_models || [];
    const deletedModel = models[idx];
    models.splice(idx, 1);

    const updates = { llm_models: models };
    if (result.active_model_id === deletedModel.id) {
      const firstActive = models.find(m => m.isActive);
      updates.active_model_id = firstActive ? firstActive.id : '';
    }

    await safeSet(updates);
    showModelStatus('模型已删除');
    await loadModels();
  }

  async function toggleModelActive(idx, checked) {
    const result = await chrome.storage.local.get(['llm_models', 'active_model_id']);
    const models = result.llm_models || [];
    models[idx].isActive = checked;

    const updates = { llm_models: models };
    let preferredChanged = false;
    if (!checked && result.active_model_id === models[idx].id) {
      const firstActive = models.find(m => m.isActive);
      updates.active_model_id = firstActive ? firstActive.id : '';
      preferredChanged = true;
    } else if (checked && !result.active_model_id) {
      updates.active_model_id = models[idx].id;
      preferredChanged = true;
    }

    await safeSet(updates);
    showModelStatus(checked ? '模型已激活' : '模型已停用');
    const activeModelId = updates.active_model_id !== undefined ? updates.active_model_id : result.active_model_id;
    if (preferredChanged) {
      // 首选变化了，需要更新整个列表
      await loadModels();
    } else {
      // 只更新当前 item，保留 switch 动画
      updateModelItemDom(idx, models[idx], activeModelId);
    }
  }

  function updateModelItemDom(idx, model, activeModelId) {
    const checkbox = modelListEl.querySelector(`input[data-idx="${idx}"][data-action="toggle"]`);
    if (!checkbox) return;
    const item = checkbox.closest('.list-item');
    if (!item) return;
    const isPreferred = model.id === activeModelId;
    item.classList.toggle('model-inactive', !model.isActive);
    item.classList.toggle('active', isPreferred);
    // 更新 badge
    const titleEl = item.querySelector('.list-item-title');
    if (titleEl) {
      const nameText = escapeHtml(model.name || '未命名');
      titleEl.innerHTML = nameText + (isPreferred ? '<span class="model-badge model-preferred">首选</span>' : '');
    }
    // 更新 footer（设为首选链接）
    const existingFooter = item.querySelector('.list-item-footer');
    if (!isPreferred && model.isActive) {
      if (!existingFooter) {
        const footer = document.createElement('div');
        footer.className = 'list-item-footer';
        footer.innerHTML = `<button class="action-link" data-idx="${idx}" data-action="preferred">设为首选</button>`;
        item.appendChild(footer);
      }
    } else if (existingFooter) {
      existingFooter.remove();
    }
  }

  async function setPreferredModel(idx) {
    const result = await chrome.storage.local.get(['llm_models']);
    const models = result.llm_models || [];
    if (!models[idx].isActive) {
      showModelStatus('请先激活该模型');
      return;
    }
    await safeSet({ active_model_id: models[idx].id });
    showModelStatus('已设为首选模型');
    await loadModels();
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
        <div class="segmented-control" id="model-apiFormat" data-active="${!model.apiFormat || model.apiFormat === 'openai' ? 'openai' : 'anthropic'}">
          <button type="button" class="${!model.apiFormat || model.apiFormat === 'openai' ? 'seg-active' : ''}" data-value="openai">OpenAI</button>
          <button type="button" class="${model.apiFormat === 'anthropic' ? 'seg-active' : ''}" data-value="anthropic">Anthropic</button>
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

      <div class="rule-form-section">测试连接</div>
      <div class="rule-form-group">
        <textarea id="model-testText" placeholder="输入测试文本" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;">请回复 OK</textarea>
        <button type="button" class="btn-secondary" id="model-testBtn" style="width:100%;margin-top:8px;">测试连接</button>
        <div class="hint" id="model-testResult" style="margin-top:8px;white-space:pre-wrap;word-break:break-all;"></div>
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

    const testBtn = drawerBodyEl.querySelector('#model-testBtn');
    testBtn.addEventListener('click', testModelConnection);
  }

  async function testModelConnection() {
    const resultEl = drawerBodyEl.querySelector('#model-testResult');
    const name = drawerBodyEl.querySelector('#model-name').value.trim();
    const apiUrl = drawerBodyEl.querySelector('#model-apiUrl').value.trim().replace(/\/+$/, '');
    const apiKey = drawerBodyEl.querySelector('#model-apiKey').value.trim();
    const modelId = drawerBodyEl.querySelector('#model-modelId').value.trim();
    const testText = drawerBodyEl.querySelector('#model-testText').value.trim();
    const apiFormat = drawerBodyEl.querySelector('#model-apiFormat')?.dataset?.active || 'openai';

    if (!apiUrl || !apiKey || !modelId) {
      resultEl.textContent = '请先填写 API URL、API Key 和模型 ID';
      resultEl.style.color = 'var(--color-error-text)';
      return;
    }

    resultEl.textContent = '测试中...';
    resultEl.style.color = 'var(--color-text-muted)';

    const userContent = testText || '请回复 OK';

    try {
      let response, data;

      if (apiFormat === 'anthropic') {
        response = await fetch(`${apiUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: userContent }],
            max_tokens: 256,
            temperature: 0
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
        }
        data = await response.json();
        const text = data.content?.[0]?.text || '';
        resultEl.innerHTML = `<span style="color:var(--color-success)">连接成功！</span><br><span style="color:var(--color-text-muted)">模型回复：</span><span style="color:var(--color-text-primary)">${escapeHtml(text)}</span>`;
      } else {
        response = await fetch(`${apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: userContent }],
            temperature: 0
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
        }

        data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        resultEl.innerHTML = `<span style="color:var(--color-success)">连接成功！</span><br><span style="color:var(--color-text-muted)">模型回复：</span><span style="color:var(--color-text-primary)">${escapeHtml(content)}</span>`;
      }
    } catch (err) {
      resultEl.textContent = `连接失败: ${err.message}`;
      resultEl.style.color = 'var(--color-error-text)';
    }
  }

  function getModelFromForm() {
    const name = drawerBodyEl.querySelector('#model-name')?.value?.trim() || '';
    const apiUrl = drawerBodyEl.querySelector('#model-apiUrl')?.value?.trim().replace(/\/+$/, '') || '';
    const apiKey = drawerBodyEl.querySelector('#model-apiKey')?.value?.trim() || '';
    const modelId = drawerBodyEl.querySelector('#model-modelId')?.value?.trim() || '';
    const apiFormat = drawerBodyEl.querySelector('#model-apiFormat')?.dataset?.active || 'openai';

    if (!name) { showModelStatus('模型展示名称不能为空'); return null; }
    if (!apiUrl) { showModelStatus('API URL 不能为空'); return null; }
    if (!apiKey) { showModelStatus('API Key 不能为空'); return null; }
    if (!modelId) { showModelStatus('模型 ID 不能为空'); return null; }

    return { name, apiUrl, apiKey, modelId, apiFormat };
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
