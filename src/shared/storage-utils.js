(() => {
  // 配额超限提示语
  const QUOTA_EXCEEDED_HINT = '本地存储空间已满，无法保存数据。请前往设置页清理题库或历史记录后重试。';

  // 统一的写入封装：捕获配额超限错误并提示用户
  async function safeSet(items) {
    try {
      await chrome.storage.local.set(items);
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      if (/quota/i.test(msg)) {
        // service worker 中 alert 不可用，降级为 console
        if (typeof alert === 'function') {
          try { alert(QUOTA_EXCEEDED_HINT); } catch (_) { console.error(QUOTA_EXCEEDED_HINT); }
        } else {
          console.error(QUOTA_EXCEEDED_HINT);
        }
      }
      throw err;
    }
  }

  globalThis.QuizHelperStorageUtils = {
    safeSet
  };
})();
