// 状态面板缓存工具（popup / options / background 共用）
// 提供状态缓存的统一读写：检测结果按模型 / 搜索服务商分别存储，
// popup 打开时读取显示上次检测状态，options 测试与后台探测写入。
(() => {
  const STORAGE_KEY = 'status_cache';

  async function readCache() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const cache = result[STORAGE_KEY];
    if (cache && typeof cache === 'object') {
      return {
        llm: cache.llm || {},
        search: cache.search || {},
        updatedAt: cache.updatedAt || 0,
        ...cache
      };
    }
    return { llm: {}, search: {}, updatedAt: 0 };
  }

  async function writeCache(cache) {
    await chrome.storage.local.set({ [STORAGE_KEY]: cache });
  }

  /** 读取完整状态缓存 */
  async function getStatusCache() {
    return readCache();
  }

  /**
   * 更新单个模型的状态缓存条目
   * @param {string} modelId - 模型 id
   * @param {{status:'ok'|'err', latencyMs?:number, error?:string}} entry
   */
  async function updateLlmStatus(modelId, { status, latencyMs, error }) {
    if (!modelId) return;
    const cache = await readCache();
    cache.llm[modelId] = { status, latencyMs, error, checkedAt: Date.now() };
    cache.updatedAt = Date.now();
    await writeCache(cache);
  }

  /**
   * 更新单个搜索服务商的状态缓存条目
   * @param {string} providerId - 服务商 id
   * @param {{status:'ok'|'err', latencyMs?:number, error?:string}} entry
   */
  async function updateSearchProviderStatus(providerId, { status, latencyMs, error }) {
    if (!providerId) return;
    const cache = await readCache();
    cache.search[providerId] = { status, latencyMs, error, checkedAt: Date.now() };
    cache.updatedAt = Date.now();
    await writeCache(cache);
  }

  /** 全量写入（后台探测完成后调用） */
  async function setStatusCache(llm, search) {
    await writeCache({ llm: llm || {}, search: search || {}, updatedAt: Date.now() });
  }

  globalThis.QuizHelperStatusUtils = {
    getStatusCache,
    updateLlmStatus,
    updateSearchProviderStatus,
    setStatusCache
  };
})();
