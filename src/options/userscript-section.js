// 用户脚本管理模块：状态检测 + 列表 + 抽屉编辑器
// 依赖：shared/constants.js（STORAGE_KEYS / RUN_AT_OPTIONS）、utils.js（escapeHtml/parseLines）、
//       message.js（QuizHelperMessage）、shared/storage-utils.js（safeSet）
// 注意：与其它 options 模块一致，const 声明放在 initUserScripts 函数体内，
//       避免与 index.js 顶层同名 const（如 safeSet）在共享全局词法作用域下重复声明。

function getChromeVersion() {
  const m = navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+)/);
  return m ? Number(m[1]) : 0;
}

// Chrome match pattern 简单校验（<all_urls> 与 scheme:// 开头的 pattern 视为合法）
function isValidMatchPattern(p) {
  const pattern = String(p || '').trim();
  if (!pattern) return false;
  if (pattern === '<all_urls>') return true;
  return /^(\*|https?|file|ftp):\/\//i.test(pattern);
}

/**
 * 探测用户脚本功能可用状态
 * @returns {Promise<{state: 'ready'|'permission-needed'|'toggle-needed'|'unsupported', chromeVersion: number}>}
 */
async function checkUserScriptsStatus() {
  const chromeVersion = getChromeVersion();

  let permissionGranted = false;
  try {
    if (chrome.permissions && chrome.permissions.contains) {
      permissionGranted = await chrome.permissions.contains({ permissions: ['userScripts'] });
    }
  } catch (e) {
    permissionGranted = false;
  }

  let apiAvailable = false;
  try {
    if (typeof chrome !== 'undefined' && chrome.userScripts) {
      chrome.userScripts.getScripts();
      apiAvailable = true;
    }
  } catch (e) {
    apiAvailable = false;
  }

  if (apiAvailable) return { state: 'ready', chromeVersion };
  if (chromeVersion < 120) return { state: 'unsupported', chromeVersion };
  if (!permissionGranted) return { state: 'permission-needed', chromeVersion };
  return { state: 'toggle-needed', chromeVersion };
}

function initUserScripts({
  listEl,
  statusEl,
  addBtnEl,
  drawerBodyEl,
  drawerTitleEl,
  drawerMetaEl,
  drawerSaveBtn,
  drawerOverlay,
  onCloseDrawer
}) {
  const { STORAGE_KEYS, RUN_AT_OPTIONS } = globalThis.QuizHelperConstants;
  const { safeSet } = globalThis.QuizHelperStorageUtils;

  const RUN_AT_LABEL_KEYS = {
    document_start: 'userscriptRunAtStart',
    document_end: 'userscriptRunAtEnd',
    document_idle: 'userscriptRunAtIdle'
  };

  // 用户脚本代码编辑器（CodeMirror 实例），抽屉重开前需销毁
  let userScriptEditor = null;

  function showMsg(msg, type) {
    globalThis.QuizHelperMessage[type || 'info'](msg);
  }

  // ---- 列表 ----

  async function loadUserScripts() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.USER_SCRIPTS]);
    renderUserScripts(result[STORAGE_KEYS.USER_SCRIPTS] || []);
  }

  function renderUserScripts(scripts) {
    if (!scripts || scripts.length === 0) {
      listEl.innerHTML = '<div class="list-empty">' + getMessage('userscriptEmpty') + '</div>';
      return;
    }

    listEl.innerHTML = '';
    scripts.forEach((script, idx) => {
      const item = document.createElement('div');
      item.className = 'list-item' + (script.enabled ? '' : ' model-inactive');
      const runAtKey = RUN_AT_LABEL_KEYS[script.runAt] || RUN_AT_LABEL_KEYS.document_idle;
      const matchesText = (script.matches || []).join(' · ');
      item.innerHTML = `
        <div class="list-item-header">
          <div class="list-item-info">
            <div class="list-item-title">${escapeHtml(script.name || getMessage('userscriptNameLabel'))}${script.enabled
              ? `<span class="model-badge model-enabled-badge">${getMessage('userscriptEnabledBadge')}</span>`
              : `<span class="model-badge model-inactive-badge">${getMessage('userscriptDisabledBadge')}</span>`}</div>
            <div class="list-item-meta">${escapeHtml(matchesText)} · ${getMessage(runAtKey)}</div>
          </div>
          <div class="list-item-actions">
            <label class="switch userscript-enable-switch" title="${getMessage('userscriptEnabledLabel')}">
              <input type="checkbox"${script.enabled ? ' checked' : ''} data-idx="${idx}">
              <span class="switch-slider"></span>
            </label>
            <button class="action-btn action-edit" data-idx="${idx}"><span data-icon="pencil"></span>${getMessage('optionsEdit')}</button>
            <button class="action-btn action-delete" data-idx="${idx}"><span data-icon="trash"></span>${getMessage('commonDelete')}</button>
          </div>
        </div>
      `;
      item.querySelector('.action-edit').addEventListener('click', () => openUserScriptDrawer(scripts[idx]));
      item.querySelector('.action-delete').addEventListener('click', () => deleteUserScript(idx));
      listEl.appendChild(item);
    });

    window.QuizHelperIcons?.replaceIcons(listEl);
  }

  async function updateScriptAt(idx, patch) {
    const result = await chrome.storage.local.get([STORAGE_KEYS.USER_SCRIPTS]);
    const scripts = result[STORAGE_KEYS.USER_SCRIPTS] || [];
    if (idx < 0 || idx >= scripts.length) return;
    scripts[idx] = { ...scripts[idx], ...patch, timestamp: Date.now() };
    await safeSet({ [STORAGE_KEYS.USER_SCRIPTS]: scripts });
    // 刷新列表，让启用 / 停用状态（灰色与徽章）立即呈现
    await loadUserScripts();
  }

  listEl.addEventListener('change', event => {
    const input = event.target.closest('input[type="checkbox"][data-idx]');
    if (!input) return;
    updateScriptAt(Number(input.dataset.idx), { enabled: input.checked });
  });

  async function deleteUserScript(idx) {
    if (!confirm(getMessage('userscriptDeleteConfirm'))) return;
    const result = await chrome.storage.local.get([STORAGE_KEYS.USER_SCRIPTS]);
    const scripts = result[STORAGE_KEYS.USER_SCRIPTS] || [];
    if (idx < 0 || idx >= scripts.length) return;
    scripts.splice(idx, 1);
    await safeSet({ [STORAGE_KEYS.USER_SCRIPTS]: scripts });
    showMsg(getMessage('userscriptDeleted'), 'success');
    await loadUserScripts();
  }

  // ---- 状态横幅 ----

  async function refreshStatus() {
    const status = await checkUserScriptsStatus();
    renderStatus(status);
  }

  function renderStatus(status) {
    if (status.state === 'ready') {
      statusEl.innerHTML = '';
      return;
    }
    let html = '';
    if (status.state === 'unsupported') {
      html = `
        <div class="userscript-status-banner userscript-status-unsupported">
          <span class="userscript-status-icon" data-icon="warning" aria-hidden="true"></span>
          <span class="userscript-status-text">${getMessage('userscriptStatusUnsupported')}</span>
        </div>`;
    } else if (status.state === 'permission-needed') {
      html = `
        <div class="userscript-status-banner userscript-status-permission">
          <span class="userscript-status-icon" data-icon="warning" aria-hidden="true"></span>
          <span class="userscript-status-text">${getMessage('userscriptStatusPermissionNeeded')}</span>
          <div class="userscript-status-actions">
            <button type="button" class="action-btn action-edit" id="userscriptEnableBtn"><span data-icon="plug"></span>${getMessage('userscriptEnableBtn')}</button>
            <button type="button" class="action-btn action-secondary" id="userscriptRedetectBtn"><span data-icon="refresh-cw"></span>${getMessage('userscriptRedetectBtn')}</button>
          </div>
        </div>`;
    } else {
      // Chrome 138+ 用「允许用户脚本」开关，更早版本用「开发者模式」
      const toggleMsg = status.chromeVersion >= 138
        ? getMessage('userscriptStatusToggleHintAllow')
        : getMessage('userscriptStatusToggleHintDev');
      html = `
        <div class="userscript-status-banner userscript-status-toggle">
          <span class="userscript-status-icon" data-icon="warning" aria-hidden="true"></span>
          <span class="userscript-status-text">${toggleMsg}</span>
          <div class="userscript-status-actions">
            <button type="button" class="action-btn action-secondary" id="userscriptRedetectBtn"><span data-icon="refresh-cw"></span>${getMessage('userscriptRedetectBtn')}</button>
          </div>
        </div>`;
    }
    statusEl.innerHTML = html;
    window.QuizHelperIcons?.replaceIcons(statusEl);

    const enableBtn = statusEl.querySelector('#userscriptEnableBtn');
    if (enableBtn) enableBtn.addEventListener('click', requestUserScriptsPermission);
    const redetectBtn = statusEl.querySelector('#userscriptRedetectBtn');
    if (redetectBtn) redetectBtn.addEventListener('click', refreshAll);
  }

  async function requestUserScriptsPermission() {
    try {
      const granted = await chrome.permissions.request({ permissions: ['userScripts'] });
      if (granted) {
        // 通知后台立即注册；即便当前 SW 上下文拿不到 API，也会在下次启动时兜底
        await chrome.runtime.sendMessage({ action: 'syncUserScripts' }).catch(() => {});
        showMsg(getMessage('userscriptReadyMsg'), 'success');
      } else {
        showMsg(getMessage('userscriptStatusPermissionNeeded'), 'info');
      }
    } catch (e) {
      // Chrome < 120 等场景：请求失败，重新检测展示不可用提示
    }
    await refreshAll();
  }

  async function refreshAll() {
    await refreshStatus();
    await loadUserScripts();
  }

  // ---- 抽屉编辑器 ----

  function openUserScriptDrawer(script) {
    const isEdit = !!(script && script.id);
    drawerTitleEl.textContent = getMessage(isEdit ? 'userscriptEditTitle' : 'userscriptNewTitle');
    drawerMetaEl.textContent = '';
    drawerSaveBtn.style.display = '';
    drawerSaveBtn.dataset.action = 'save-userscript';
    drawerSaveBtn.dataset.userscriptId = isEdit ? script.id : '';
    renderUserScriptForm(script);
    drawerOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // 初始化分段滑块指示器（同步执行，确保首次绘制前 CSS 变量已就位）
    initDrawerSegControls(drawerBodyEl);

    // 抽屉从 display:none 变为可见后，CodeMirror 需要重新测量才会渲染内容
    requestAnimationFrame(() => {
      sizeUserScriptEditor();
    });
    // 抽屉滑入动画（0.3s）结束后再次校准高度，避免动画期间测量偏差
    setTimeout(() => {
      sizeUserScriptEditor();
    }, 320);
  }

  // 代码编辑器高度：占满抽屉剩余空间（空间不足时同样占满、不溢出）
  function sizeUserScriptEditor() {
    const wrapper = drawerBodyEl.querySelector('.userscript-code-editor');
    if (!userScriptEditor || !wrapper) return;
    const bodyRect = drawerBodyEl.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const remaining = bodyRect.bottom - wrapperRect.top - 16; // 底部留白
    wrapper.style.height = Math.max(remaining, 0) + 'px';
    userScriptEditor.refresh();
  }

  function renderUserScriptForm(script) {
    // 先销毁上一个代码编辑器实例，避免残留 DOM / 事件
    destroyUserScriptEditor();

    const s = script || {};
    const runAt = RUN_AT_OPTIONS.includes(s.runAt) ? s.runAt : 'document_idle';
    const runAtButtons = RUN_AT_OPTIONS.map(r =>
      `<button type="button" data-value="${r}"${r === runAt ? ' class="seg-active"' : ''}>${getMessage(RUN_AT_LABEL_KEYS[r])}</button>`
    ).join('');

    drawerBodyEl.innerHTML = `
      <div class="rule-form-group">
        <label>${getMessage('userscriptNameLabel')}</label>
        <input type="text" id="us-name" value="${escapeHtml(s.name || '')}" placeholder="${getMessage('userscriptNameLabel')}">
      </div>
      <div class="rule-form-group">
        <label>${getMessage('userscriptMatchesLabel')}</label>
        <textarea id="us-matches" rows="3" spellcheck="false" placeholder="https://example.com/*">${escapeHtml((s.matches || []).join('\n'))}</textarea>
        <div class="hint" style="margin-top:6px;">${getMessage('userscriptMatchesHint')}</div>
      </div>
      <div class="rule-form-group">
        <label>${getMessage('userscriptRunAtLabel')}</label>
        <div class="segmented-control" id="us-runat" data-active="${runAt}">${runAtButtons}</div>
      </div>
      <div class="rule-form-group">
        <label>${getMessage('userscriptCodeLabel')}</label>
        <div class="userscript-code-editor">
          <textarea id="us-code" spellcheck="false">${escapeHtml(s.code || '')}</textarea>
        </div>
      </div>
    `;

    // 代码编辑器：CodeMirror 自带 JS 语法高亮（替代此前的透明层叠加方案）
    initUserScriptEditor();
  }

  function destroyUserScriptEditor() {
    if (!userScriptEditor) return;
    try {
      userScriptEditor.toTextArea();
    } catch (e) {
      // 编辑器 DOM 已被清空时忽略
    }
    userScriptEditor = null;
  }

  function initUserScriptEditor() {
    const codeTextarea = drawerBodyEl.querySelector('#us-code');
    if (userScriptEditor || !codeTextarea || typeof CodeMirror === 'undefined') return;
    userScriptEditor = CodeMirror.fromTextArea(codeTextarea, {
      mode: 'javascript',
      theme: 'quiz-helper',
      lineNumbers: false,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2
    });
  }

  async function saveUserScriptFromDrawer() {
    const id = drawerSaveBtn.dataset.userscriptId || '';
    const name = drawerBodyEl.querySelector('#us-name').value.trim();
    const matches = parseLines(drawerBodyEl.querySelector('#us-matches').value);
    const runAtEl = drawerBodyEl.querySelector('#us-runat .seg-active');
    const runAt = runAtEl ? runAtEl.dataset.value : 'document_idle';
    // 优先取 CodeMirror 编辑器的值（存在时 textarea 已被替换）
    const code = userScriptEditor
      ? userScriptEditor.getValue()
      : drawerBodyEl.querySelector('#us-code').value;

    if (!name) {
      showMsg(getMessage('userscriptValidationName'), 'info');
      return;
    }
    if (!matches.length) {
      showMsg(getMessage('userscriptValidationMatches'), 'info');
      return;
    }
    if (matches.some(m => !isValidMatchPattern(m))) {
      showMsg(getMessage('userscriptMatchesInvalid'), 'info');
      return;
    }
    if (!code.trim()) {
      showMsg(getMessage('userscriptValidationCode'), 'info');
      return;
    }

    const result = await chrome.storage.local.get([STORAGE_KEYS.USER_SCRIPTS]);
    const scripts = result[STORAGE_KEYS.USER_SCRIPTS] || [];
    const idx = scripts.findIndex(s => s.id === id);
    const now = Date.now();
    if (idx >= 0) {
      // 编辑：保留列表侧已有的启用状态
      scripts[idx] = { ...scripts[idx], name, matches, runAt, code, timestamp: now };
    } else {
      // 新增：默认启用
      scripts.push({ id: `us-${now}`, name, matches, runAt, enabled: true, code, timestamp: now });
    }
    await safeSet({ [STORAGE_KEYS.USER_SCRIPTS]: scripts });
    showMsg(getMessage('userscriptSaved'), 'success');
    onCloseDrawer();
    await loadUserScripts();
  }

  // ---- 事件 ----
  addBtnEl.addEventListener('click', () => openUserScriptDrawer(null));

  refreshAll();

  return { loadUserScripts, openUserScriptDrawer, saveUserScriptFromDrawer };
}
