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
  ruleListEl, drawerBodyEl, drawerTitleEl, drawerMetaEl,
  drawerSaveBtn, drawerOverlay, onCloseDrawer
}) {
  const { safeSet } = globalThis.QuizHelperStorageUtils;
  const paginationState = { rule: 1 };
  let ruleEditorView = 'form';
  let currentRuleEditingBase = null;

  function showRuleStatus(msg) {
    globalThis.QuizHelperMessage.info(msg);
  }

  async function loadParseRules() {
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    renderParseRules(rules);
  }

  function renderParseRules(rules) {
    if (!rules || rules.length === 0) {
      ruleListEl.innerHTML = '<div class="list-empty">' + getMessage('optionsRuleEmpty') + '</div>';
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

      const lastUsed = rule.lastUsed ? new Date(rule.lastUsed).toLocaleString() : getMessage('optionsRuleNeverUsed');
      const created = rule.timestamp ? new Date(rule.timestamp).toLocaleString() : '';
      const useCount = rule.useCount || 0;

      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">${escapeHtml(rule.domain || getMessage('optionsUnnamed'))}</div>
            <div class="list-item-meta">${getMessage('optionsRuleMetaFormat', [created, lastUsed, useCount])}</div>
          </div>
          <div class="list-item-actions">
            <button class="action-btn action-edit" data-idx="${idx}">${getMessage('optionsEdit')}</button>
            <button class="action-btn action-delete" data-idx="${idx}">${getMessage('commonDelete')}</button>
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
    if (!confirm(getMessage('optionsRuleDeleteConfirm'))) return;
    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];
    rules.splice(idx, 1);
    await chrome.storage.local.set({ parse_rules: rules });
    showRuleStatus(getMessage('optionsRuleDeleted'));
    await loadParseRules();
  }

  // ---- 规则编辑器 ----

  function openRuleDrawer(rule) {
    drawerTitleEl.textContent = getMessage('optionsRuleEditTitle');
    drawerMetaEl.textContent = rule.domain || '';
    currentRuleEditingBase = JSON.parse(JSON.stringify(rule || {}));
    ruleEditorView = 'form';
    renderRuleForm(rule);
    drawerSaveBtn.style.display = '';
    drawerSaveBtn.dataset.action = 'save-rule';
    drawerSaveBtn.dataset.ruleId = rule.id || '';
    drawerSaveBtn.dataset.ruleDomain = rule.domain || '';
    drawerOverlay.classList.add('open');

    // 初始化分段滑块指示器（同步执行，确保首次绘制前 CSS 变量已就位）
    initDrawerSegControls(drawerBodyEl);
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
    const singleKw = (typeKeywords.single || []).join(', ');
    const multipleKw = (typeKeywords.multiple || []).join(', ');
    const judgeKw = (typeKeywords.judge || []).join(', ');
    const fillKw = (typeKeywords.fill || []).join(', ');

    drawerBodyEl.innerHTML = `
      <div class="rule-view-header">
        <div class="segmented-control rule-view-seg" data-active="form">
          <button type="button" class="seg-active" data-value="form">${getMessage('optionsRuleFormView')}</button>
          <button type="button" data-value="json">JSON</button>
        </div>
        <button type="button" class="rule-copy-btn" id="ruleCopyJsonBtn" style="display:none;">${getMessage('optionsRuleCopy')}</button>
      </div>

      <div id="ruleViewForm">
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleDomainLabel')}</label>
          <input type="text" id="rule-domain" value="${escapeHtml(rule.domain || '')}" placeholder="example.com">
        </div>

        <div class="rule-form-section">${getMessage('optionsRuleCssSection')}</div>

        <div class="rule-form-group">
          <label>${getMessage('optionsRuleRootSelectorsLabel')}</label>
          <textarea id="rule-rootSelectors" rows="3">${escapeHtml(rootSelectors)}</textarea>
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleQuestionItemLabel')}</label>
          <input type="text" id="rule-questionItemSelector" value="${escapeHtml(selectors.questionItemSelector || '')}" placeholder=".question-type-item">
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleTypeHeadingLabel')}</label>
          <input type="text" id="rule-typeHeadingSelector" value="${escapeHtml(selectors.typeHeadingSelector || '')}" placeholder=".h3.m-bottom">
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleQuestionTextLabel')}</label>
          <textarea id="rule-questionTextSelectors" rows="2">${escapeHtml(questionTextSelectors)}</textarea>
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleOptionContainerLabel')}</label>
          <textarea id="rule-optionContainerSelectors" rows="2">${escapeHtml(optionContainerSelectors)}</textarea>
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleOptionItemLabel')}</label>
          <input type="text" id="rule-optionItemSelector" value="${escapeHtml(selectors.optionItemSelector || '')}" placeholder="dd">
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleOptionNumberLabel')}</label>
          <input type="text" id="rule-optionNumberSelector" value="${escapeHtml(selectors.optionNumberSelector || '')}" placeholder=".option-num">
        </div>

        <div class="rule-form-section">${getMessage('optionsRuleTypeIndicatorSection')}</div>
        <div class="hint" style="margin-bottom: 8px; font-size: 12px;">${getMessage('optionsRuleTypeIndicatorHint')}</div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleSingleIndicatorLabel')}</label>
          <input type="text" id="rule-singleIndicators" value="${escapeHtml(singleIndicators)}" placeholder="singleContainer, singleChoice">
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleMultipleIndicatorLabel')}</label>
          <input type="text" id="rule-multipleIndicators" value="${escapeHtml(multipleIndicators)}" placeholder="multipleContainer, multipleChoice">
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleJudgeIndicatorLabel')}</label>
          <input type="text" id="rule-judgeIndicators" value="${escapeHtml(judgeIndicators)}" placeholder="judgeContainer, true-false">
        </div>

        <div class="rule-form-section">${getMessage('optionsRuleFallbackSection')}</div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleFallbackLabel')}</label>
          <textarea id="rule-fallbackTextSelectors" rows="4">${escapeHtml(fallbackTextSelectors)}</textarea>
        </div>

        <div class="rule-form-section">${getMessage('optionsRuleKeywordSection')}</div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleKwSingleLabel')}</label>
          <input type="text" id="rule-kwSingle" value="${escapeHtml(singleKw)}" placeholder="${getMessage('optionsRuleKwSinglePlaceholder')}">
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleKwMultipleLabel')}</label>
          <input type="text" id="rule-kwMultiple" value="${escapeHtml(multipleKw)}" placeholder="${getMessage('optionsRuleKwMultiplePlaceholder')}">
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleKwJudgeLabel')}</label>
          <input type="text" id="rule-kwJudge" value="${escapeHtml(judgeKw)}" placeholder="${getMessage('optionsRuleKwJudgePlaceholder')}">
        </div>
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleKwFillLabel')}</label>
          <input type="text" id="rule-kwFill" value="${escapeHtml(fillKw)}" placeholder="${getMessage('optionsRuleKwFillPlaceholder')}">
        </div>
      </div>

      <div id="ruleViewJson" class="rule-json" style="display:none;">
        <div class="rule-form-group">
          <label>${getMessage('optionsRuleJsonLabel')}</label>
          <div class="rule-json-editor">
            <pre id="rule-json-highlight"><code></code></pre>
            <textarea id="rule-json" spellcheck="false"></textarea>
          </div>
          <div class="hint" style="margin-top: 6px;">${getMessage('optionsRuleJsonHint')}</div>
        </div>
      </div>
    `;

    drawerBodyEl.dataset.ruleView = 'form';
    ruleEditorView = 'form';

    // 视图切换委托（滑动指示器由全局 delegate 处理）
    const ruleSeg = drawerBodyEl.querySelector('.rule-view-seg');
    if (ruleSeg) {
      ruleSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) setRuleEditorView(btn.dataset.value);
      });
    }

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
          copyBtn.textContent = getMessage('optionsCopied');
          setTimeout(() => { copyBtn.textContent = originalText; }, 1500);
        } catch (e) {
          textarea.select();
          document.execCommand('copy');
          const originalText = copyBtn.textContent;
          copyBtn.textContent = getMessage('optionsCopied');
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
        single: parseKeywords(drawerBodyEl.querySelector('#rule-kwSingle').value),
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
    setValue('#rule-kwSingle', (typeKeywords.single || []).join(', '));
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
        single: normalizeArrayField(typeKeywords.single, 'keywords'),
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
        showRuleStatus(getMessage('optionsRuleDomainRequired'));
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
        showRuleStatus(getMessage('optionsRuleJsonInvalidBack'));
        return;
      }
      const updatedFields = normalizeRuleUpdatedFieldsFromJson(parsed);
      if (!updatedFields) {
        showRuleStatus(getMessage('optionsRuleJsonInvalidStructure'));
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
    const ruleSeg = drawerBodyEl.querySelector('.rule-view-seg');
    if (ruleSeg) setSegValue(ruleSeg, targetView);
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
        showRuleStatus(getMessage('optionsRuleJsonInvalidSave'));
        return;
      }
      updatedFields = normalizeRuleUpdatedFieldsFromJson(parsed);
      if (!updatedFields) {
        showRuleStatus(getMessage('optionsRuleJsonInvalidStructure'));
        return;
      }
    } else {
      updatedFields = getRuleUpdatedFieldsFromForm();
      if (!updatedFields) {
        showRuleStatus(getMessage('optionsRuleDomainRequired'));
        return;
      }
    }

    const result = await chrome.storage.local.get(['parse_rules']);
    const rules = result.parse_rules || [];

    if (updatedFields.domain !== originalDomain) {
      const conflict = rules.find(r => r.domain === updatedFields.domain);
      if (conflict) {
        showRuleStatus(getMessage('optionsRuleDomainConflictFormat', [updatedFields.domain]));
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
    showRuleStatus(getMessage('optionsRuleSaved'));
    onCloseDrawer();
    await loadParseRules();
  }

  return { loadParseRules, openRuleDrawer, saveRuleFromDrawer };
}
