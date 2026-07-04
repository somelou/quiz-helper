// 解析规则管理模块

function highlightJson(json) {
  if (typeof json !== 'string') {
    try { json = JSON.stringify(json, null, 2); } catch (e) { return ''; }
  }
  let escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\],:])/g,
    (match) => {
      let cls = 'json-punctuation';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      } else if (/^-?\d/.test(match)) {
        cls = 'json-number';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function initRules({
  ruleListEl, ruleStatusEl, drawerBodyEl, drawerTitleEl, drawerMetaEl,
  drawerSaveBtn, drawerOverlay, onCloseDrawer
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const paginationState = { rule: 1 };
  let ruleEditorView = 'form';
  let currentRuleEditingBase = null;

  function showRuleStatus(msg) {
    ruleStatusEl.textContent = msg;
    if (msg) {
      setTimeout(() => {
        if (ruleStatusEl.textContent === msg) ruleStatusEl.textContent = '';
      }, 3000);
    }
  }

  async function loadParseRules() {
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    renderParseRules(rules);
  }

  function renderParseRules(rules) {
    if (!rules || rules.length === 0) {
      ruleListEl.innerHTML = '<div class="list-empty">暂无解析规则。访问新站点时 AI 会自动生成规则。</div>';
      return;
    }

    const totalPages = Math.ceil(rules.length / PAGE_SIZE);
    if (paginationState.rule > totalPages) paginationState.rule = totalPages;
    const page = paginationState.rule;
    const startIdx = (page - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, rules.length);

    ruleListEl.innerHTML = '';
    for (let idx = startIdx; idx < endIdx; idx++) {
      const rule = rules[idx];
      const item = document.createElement('div');
      item.className = 'list-item';

      const lastUsed = rule.lastUsed ? new Date(rule.lastUsed).toLocaleString('zh-CN') : '未使用';
      const created = rule.timestamp ? new Date(rule.timestamp).toLocaleString('zh-CN') : '';
      const useCount = rule.useCount || 0;

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">${escapeHtml(rule.domain || '未命名')}</div>
            <div class="list-item-meta">创建: ${created} · 最后使用: ${lastUsed} · 使用次数: ${useCount}</div>
          </div>
          <div class="list-item-actions">
            <button class="action-btn action-edit" data-idx="${idx}">编辑</button>
            <button class="action-btn action-delete" data-idx="${idx}">删除</button>
          </div>
        </div>
      `;

      item.querySelector('.action-edit').addEventListener('click', () => openRuleDrawer(rule));
      item.querySelector('.action-delete').addEventListener('click', () => deleteParseRule(idx));

      ruleListEl.appendChild(item);
    }

    const pager = document.createElement('div');
    pager.className = 'pagination';
    ruleListEl.appendChild(pager);
    renderPagination(pager, rules.length, page, (p) => {
      paginationState.rule = p;
      renderParseRules(rules);
    });
  }

  async function deleteParseRule(idx) {
    if (!confirm('确定要删除这条解析规则吗？删除后该站点将回退到 AI 解析模式。')) return;
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    rules.splice(idx, 1);
    await chrome.storage.local.set({ parse_rules: rules });
    showRuleStatus('解析规则已删除');
    await loadParseRules();
  }

  // ---- 规则编辑器 ----

  function openRuleDrawer(rule) {
    drawerTitleEl.textContent = '编辑解析规则';
    drawerMetaEl.textContent = rule.domain || '';
    currentRuleEditingBase = JSON.parse(JSON.stringify(rule || {}));
    ruleEditorView = 'form';
    renderRuleForm(rule);
    drawerSaveBtn.style.display = '';
    drawerSaveBtn.dataset.action = 'save-rule';
    drawerSaveBtn.dataset.ruleId = rule.id || '';
    drawerSaveBtn.dataset.ruleDomain = rule.domain || '';
    drawerOverlay.classList.add('open');
  }

  function renderRuleForm(rule) {
    const selectors = rule.selectors || {};
    const typeKeywords = rule.typeKeywords || {};
    const typeIndicators = selectors.typeIndicators || {};

    const rootSelectors = (selectors.rootSelectors || []).join('\n');
    const questionTextSelectors = (selectors.questionTextSelectors || []).join('\n');
    const optionContainerSelectors = (selectors.optionContainerSelectors || []).join('\n');
    const fallbackTextSelectors = (selectors.fallbackTextSelectors || []).join('\n');
    const singleIndicators = (typeIndicators.single || []).join(', ');
    const multipleIndicators = (typeIndicators.multiple || []).join(', ');
    const judgeIndicators = (typeIndicators.judge || []).join(', ');
    const multipleKw = (typeKeywords.multiple || []).join(', ');
    const judgeKw = (typeKeywords.judge || []).join(', ');
    const fillKw = (typeKeywords.fill || []).join(', ');

    drawerBodyEl.innerHTML = `
      <div class="rule-view-header">
        <div class="rule-view-toggle">
          <button type="button" class="rule-view-btn active" data-view="form">表单</button>
          <button type="button" class="rule-view-btn" data-view="json">JSON</button>
        </div>
        <button type="button" class="rule-copy-btn" id="ruleCopyJsonBtn" style="display:none;">复制</button>
      </div>

      <div id="ruleViewForm">
        <div class="rule-form-group">
          <label>生效域名</label>
          <input type="text" id="rule-domain" value="${escapeHtml(rule.domain || '')}" placeholder="example.com">
        </div>

        <div class="rule-form-section">CSS 选择器配置</div>

        <div class="rule-form-group">
          <label>根容器选择器（每行一个，按优先级排序）</label>
          <textarea id="rule-rootSelectors" rows="3">${escapeHtml(rootSelectors)}</textarea>
        </div>
        <div class="rule-form-group">
          <label>题目项选择器</label>
          <input type="text" id="rule-questionItemSelector" value="${escapeHtml(selectors.questionItemSelector || '')}" placeholder=".question-type-item">
        </div>
        <div class="rule-form-group">
          <label>题型标题选择器（可选）</label>
          <input type="text" id="rule-typeHeadingSelector" value="${escapeHtml(selectors.typeHeadingSelector || '')}" placeholder=".h3.m-bottom">
        </div>
        <div class="rule-form-group">
          <label>题干选择器（每行一个，按优先级排序）</label>
          <textarea id="rule-questionTextSelectors" rows="2">${escapeHtml(questionTextSelectors)}</textarea>
        </div>
        <div class="rule-form-group">
          <label>选项容器选择器（每行一个，按优先级排序）</label>
          <textarea id="rule-optionContainerSelectors" rows="2">${escapeHtml(optionContainerSelectors)}</textarea>
        </div>
        <div class="rule-form-group">
          <label>选项元素选择器</label>
          <input type="text" id="rule-optionItemSelector" value="${escapeHtml(selectors.optionItemSelector || '')}" placeholder="dd">
        </div>
        <div class="rule-form-group">
          <label>选项编号选择器（可选）</label>
          <input type="text" id="rule-optionNumberSelector" value="${escapeHtml(selectors.optionNumberSelector || '')}" placeholder=".option-num">
        </div>

        <div class="rule-form-section">题型指示器（class 名关键词，逗号分隔）</div>
        <div class="hint" style="margin-bottom: 8px; font-size: 12px;">题目元素或其父元素的 class 包含这些关键词时，优先据此判断题型（适用于用 checkbox 模拟单选等场景）</div>
        <div class="rule-form-group">
          <label>单选指示器</label>
          <input type="text" id="rule-singleIndicators" value="${escapeHtml(singleIndicators)}" placeholder="singleContainer, singleChoice">
        </div>
        <div class="rule-form-group">
          <label>多选指示器</label>
          <input type="text" id="rule-multipleIndicators" value="${escapeHtml(multipleIndicators)}" placeholder="multipleContainer, multipleChoice">
        </div>
        <div class="rule-form-group">
          <label>判断指示器</label>
          <input type="text" id="rule-judgeIndicators" value="${escapeHtml(judgeIndicators)}" placeholder="judgeContainer, true-false">
        </div>

        <div class="rule-form-section">文本降级选择器</div>
        <div class="rule-form-group">
          <label>降级文本选择器（每行一个）</label>
          <textarea id="rule-fallbackTextSelectors" rows="4">${escapeHtml(fallbackTextSelectors)}</textarea>
        </div>

        <div class="rule-form-section">题型检测关键词</div>
        <div class="rule-form-group">
          <label>多选题关键词（逗号分隔）</label>
          <input type="text" id="rule-kwMultiple" value="${escapeHtml(multipleKw)}" placeholder="多选, 以下哪些, 至少选">
        </div>
        <div class="rule-form-group">
          <label>判断题关键词（逗号分隔）</label>
          <input type="text" id="rule-kwJudge" value="${escapeHtml(judgeKw)}" placeholder="正确, 错误, 对, 错">
        </div>
        <div class="rule-form-group">
          <label>填空题关键词（逗号分隔）</label>
          <input type="text" id="rule-kwFill" value="${escapeHtml(fillKw)}" placeholder="___, 【, 填空">
        </div>
      </div>

      <div id="ruleViewJson" class="rule-json" style="display:none;">
        <div class="rule-form-group">
          <label>规则 JSON</label>
          <div class="rule-json-editor">
            <pre id="rule-json-highlight"><code></code></pre>
            <textarea id="rule-json" spellcheck="false"></textarea>
          </div>
          <div class="hint" style="margin-top: 6px;">可直接编辑 JSON；切回表单或保存时会校验格式。</div>
        </div>
      </div>
    `;

    drawerBodyEl.dataset.ruleView = 'form';
    ruleEditorView = 'form';

    drawerBodyEl.querySelectorAll('.rule-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        setRuleEditorView(targetView);
      });
    });

    const toggleEl = drawerBodyEl.querySelector('.rule-view-toggle');
    if (toggleEl) toggleEl.dataset.active = 'form';

    const jsonTextarea = drawerBodyEl.querySelector('#rule-json');
    if (jsonTextarea) {
      jsonTextarea.addEventListener('input', updateJsonHighlight);
      jsonTextarea.addEventListener('scroll', syncJsonScroll);
      // 阻止鼠标滚轮穿透到主页面
      jsonTextarea.addEventListener('wheel', (e) => {
        const { scrollTop, scrollHeight, clientHeight } = jsonTextarea;
        const atTop = scrollTop <= 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
        const scrollingUp = e.deltaY < 0;
        const scrollingDown = e.deltaY > 0;
        // 未到边界时阻止事件传播
        if (!((scrollingUp && atTop) || (scrollingDown && atBottom))) {
          e.stopPropagation();
        }
      });
    }

    const copyBtn = drawerBodyEl.querySelector('#ruleCopyJsonBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const textarea = drawerBodyEl.querySelector('#rule-json');
        if (!textarea) return;
        try {
          await navigator.clipboard.writeText(textarea.value);
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '已复制';
          setTimeout(() => { copyBtn.textContent = originalText; }, 1500);
        } catch (e) {
          textarea.select();
          document.execCommand('copy');
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '已复制';
          setTimeout(() => { copyBtn.textContent = originalText; }, 1500);
        }
      });
    }
  }

  function getRuleUpdatedFieldsFromForm() {
    const domain = drawerBodyEl.querySelector('#rule-domain')?.value?.trim() || '';
    if (!domain) return null;

    return {
      domain,
      name: domain,
      selectors: {
        rootSelectors: parseLines(drawerBodyEl.querySelector('#rule-rootSelectors').value),
        questionItemSelector: drawerBodyEl.querySelector('#rule-questionItemSelector').value.trim(),
        typeHeadingSelector: drawerBodyEl.querySelector('#rule-typeHeadingSelector').value.trim(),
        questionTextSelectors: parseLines(drawerBodyEl.querySelector('#rule-questionTextSelectors').value),
        optionContainerSelectors: parseLines(drawerBodyEl.querySelector('#rule-optionContainerSelectors').value),
        optionItemSelector: drawerBodyEl.querySelector('#rule-optionItemSelector').value.trim(),
        optionNumberSelector: drawerBodyEl.querySelector('#rule-optionNumberSelector').value.trim(),
        typeIndicators: {
          single: parseKeywords(drawerBodyEl.querySelector('#rule-singleIndicators').value),
          multiple: parseKeywords(drawerBodyEl.querySelector('#rule-multipleIndicators').value),
          judge: parseKeywords(drawerBodyEl.querySelector('#rule-judgeIndicators').value)
        },
        fallbackTextSelectors: parseLines(drawerBodyEl.querySelector('#rule-fallbackTextSelectors').value)
      },
      typeKeywords: {
        multiple: parseKeywords(drawerBodyEl.querySelector('#rule-kwMultiple').value),
        judge: parseKeywords(drawerBodyEl.querySelector('#rule-kwJudge').value),
        fill: parseKeywords(drawerBodyEl.querySelector('#rule-kwFill').value)
      }
    };
  }

  function populateRuleFormFromRule(rule) {
    const selectors = rule.selectors || {};
    const typeKeywords = rule.typeKeywords || {};
    const typeIndicators = selectors.typeIndicators || {};

    const setValue = (id, value) => {
      const el = drawerBodyEl.querySelector(id);
      if (!el) return;
      el.value = value == null ? '' : String(value);
    };

    setValue('#rule-domain', rule.domain || '');
    setValue('#rule-rootSelectors', (selectors.rootSelectors || []).join('\n'));
    setValue('#rule-questionItemSelector', selectors.questionItemSelector || '');
    setValue('#rule-typeHeadingSelector', selectors.typeHeadingSelector || '');
    setValue('#rule-questionTextSelectors', (selectors.questionTextSelectors || []).join('\n'));
    setValue('#rule-optionContainerSelectors', (selectors.optionContainerSelectors || []).join('\n'));
    setValue('#rule-optionItemSelector', selectors.optionItemSelector || '');
    setValue('#rule-optionNumberSelector', selectors.optionNumberSelector || '');
    setValue('#rule-singleIndicators', (typeIndicators.single || []).join(', '));
    setValue('#rule-multipleIndicators', (typeIndicators.multiple || []).join(', '));
    setValue('#rule-judgeIndicators', (typeIndicators.judge || []).join(', '));
    setValue('#rule-fallbackTextSelectors', (selectors.fallbackTextSelectors || []).join('\n'));
    setValue('#rule-kwMultiple', (typeKeywords.multiple || []).join(', '));
    setValue('#rule-kwJudge', (typeKeywords.judge || []).join(', '));
    setValue('#rule-kwFill', (typeKeywords.fill || []).join(', '));
  }

  function normalizeRuleUpdatedFieldsFromJson(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '').trim();
    const domain = String(raw.domain || '').trim();
    if (!domain) return null;

    const selectors = raw.selectors || {};
    const typeIndicators = selectors.typeIndicators || {};
    const typeKeywords = raw.typeKeywords || {};

    return {
      id,
      domain,
      name: String(raw.name || domain),
      selectors: {
        rootSelectors: normalizeArrayField(selectors.rootSelectors, 'lines'),
        questionItemSelector: String(selectors.questionItemSelector || '').trim(),
        typeHeadingSelector: String(selectors.typeHeadingSelector || '').trim(),
        questionTextSelectors: normalizeArrayField(selectors.questionTextSelectors, 'lines'),
        optionContainerSelectors: normalizeArrayField(selectors.optionContainerSelectors, 'lines'),
        optionItemSelector: String(selectors.optionItemSelector || '').trim(),
        optionNumberSelector: String(selectors.optionNumberSelector || '').trim(),
        typeIndicators: {
          single: normalizeArrayField(typeIndicators.single, 'keywords'),
          multiple: normalizeArrayField(typeIndicators.multiple, 'keywords'),
          judge: normalizeArrayField(typeIndicators.judge, 'keywords')
        },
        fallbackTextSelectors: normalizeArrayField(selectors.fallbackTextSelectors, 'lines')
      },
      typeKeywords: {
        multiple: normalizeArrayField(typeKeywords.multiple, 'keywords'),
        judge: normalizeArrayField(typeKeywords.judge, 'keywords'),
        fill: normalizeArrayField(typeKeywords.fill, 'keywords')
      }
    };
  }

  function buildRuleObjectForJson(baseRule, updatedFields) {
    const base = baseRule ? JSON.parse(JSON.stringify(baseRule)) : {};
    return { ...base, ...updatedFields, selectors: updatedFields.selectors || {}, typeKeywords: updatedFields.typeKeywords || {} };
  }

  function updateJsonHighlight() {
    const jsonTextarea = drawerBodyEl.querySelector('#rule-json');
    const jsonHighlight = drawerBodyEl.querySelector('#rule-json-highlight code');
    if (!jsonTextarea || !jsonHighlight) return;
    jsonHighlight.innerHTML = highlightJson(jsonTextarea.value);
  }

  function syncJsonScroll() {
    const jsonTextarea = drawerBodyEl.querySelector('#rule-json');
    const jsonHighlight = drawerBodyEl.querySelector('#rule-json-highlight');
    if (!jsonTextarea || !jsonHighlight) return;
    // 用百分比同步，避免 font render 差异导致内容滚动不到位
    const taMaxScroll = jsonTextarea.scrollHeight - jsonTextarea.clientHeight;
    const preMaxScroll = jsonHighlight.scrollHeight - jsonHighlight.clientHeight;
    if (taMaxScroll > 0) {
      const pct = jsonTextarea.scrollTop / taMaxScroll;
      jsonHighlight.scrollTop = pct * preMaxScroll;
    } else {
      jsonHighlight.scrollTop = 0;
    }
    jsonHighlight.scrollLeft = jsonTextarea.scrollLeft;
  }

  function setRuleEditorView(view) {
    const targetView = view === 'json' ? 'json' : 'form';
    if (targetView === ruleEditorView) return;

    const formPanel = drawerBodyEl.querySelector('#ruleViewForm');
    const jsonPanel = drawerBodyEl.querySelector('#ruleViewJson');
    const jsonTextarea = drawerBodyEl.querySelector('#rule-json');
    const copyBtn = drawerBodyEl.querySelector('#ruleCopyJsonBtn');
    if (!formPanel || !jsonPanel || !jsonTextarea) return;

    if (targetView === 'json') {
      const updatedFields = getRuleUpdatedFieldsFromForm();
      if (!updatedFields) {
        showRuleStatus('域名不能为空');
        return;
      }
      const fullRule = buildRuleObjectForJson(currentRuleEditingBase, updatedFields);
      jsonTextarea.value = JSON.stringify(fullRule, null, 2);
      updateJsonHighlight();
      formPanel.style.display = 'none';
      jsonPanel.style.display = 'flex';
      // 显示后同步滚动和滚动条位置
      requestAnimationFrame(() => syncJsonScroll());
      if (copyBtn) copyBtn.style.display = '';
    } else {
      let parsed;
      try {
        parsed = JSON.parse(jsonTextarea.value || '');
      } catch (e) {
        showRuleStatus('JSON 格式错误，无法切回表单');
        return;
      }
      const updatedFields = normalizeRuleUpdatedFieldsFromJson(parsed);
      if (!updatedFields) {
        showRuleStatus('JSON 缺少 domain 或结构不正确');
        return;
      }
      const fullRule = buildRuleObjectForJson(currentRuleEditingBase, updatedFields);
      populateRuleFormFromRule(fullRule);
      jsonPanel.style.display = 'none';
      formPanel.style.display = '';
      if (copyBtn) copyBtn.style.display = 'none';
    }

    ruleEditorView = targetView;
    drawerBodyEl.dataset.ruleView = targetView;
    const toggleEl = drawerBodyEl.querySelector('.rule-view-toggle');
    if (toggleEl) toggleEl.dataset.active = targetView;
    drawerBodyEl.querySelectorAll('.rule-view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === targetView);
    });
  }

  async function saveRuleFromDrawer() {
    const originalId = drawerSaveBtn.dataset.ruleId || '';
    const originalDomain = drawerSaveBtn.dataset.ruleDomain || '';

    const view = drawerBodyEl.dataset.ruleView || 'form';
    let updatedFields = null;
    if (view === 'json') {
      const jsonText = drawerBodyEl.querySelector('#rule-json')?.value || '';
      let parsed;
      try { parsed = JSON.parse(jsonText); } catch (e) {
        showRuleStatus('JSON 格式错误，无法保存');
        return;
      }
      updatedFields = normalizeRuleUpdatedFieldsFromJson(parsed);
      if (!updatedFields) {
        showRuleStatus('JSON 缺少 domain 或结构不正确');
        return;
      }
    } else {
      updatedFields = getRuleUpdatedFieldsFromForm();
      if (!updatedFields) {
        showRuleStatus('域名不能为空');
        return;
      }
    }

    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];

    if (updatedFields.domain !== originalDomain) {
      const conflict = rules.find(r => r.domain === updatedFields.domain);
      if (conflict) {
        showRuleStatus(`域名 ${updatedFields.domain} 已存在规则，无法重复`);
        return;
      }
    }

    const idx = rules.findIndex(r => r.id === originalId);
    const desiredId = view === 'json'
      ? (updatedFields.id || originalId || `manual-${Date.now()}`)
      : (originalId || `manual-${Date.now()}`);
    const finalId = makeUniqueRuleId(desiredId, rules, idx >= 0 ? idx : -1);
    const now = Date.now();
    if (idx >= 0) {
      rules[idx] = { ...rules[idx], ...updatedFields, id: finalId, lastUsed: now };
    } else {
      rules.push({ ...updatedFields, id: finalId, timestamp: now, lastUsed: now });
    }

    await safeSet({ parse_rules: rules });
    showRuleStatus('规则已保存');
    onCloseDrawer();
    await loadParseRules();
  }

  return { loadParseRules, openRuleDrawer, saveRuleFromDrawer };
}
