// 状态面板全量探测（仅「重新检测」按钮手动触发）
// 大模型：探测当前生效模型；搜索：探测所有已配置 key 的服务商；
// 结果写入 status_cache（shared/status-utils.js），popup 下次打开直接读取。
import '../shared/status-utils.js';
import '../shared/llm-utils.js';
import { executeWebSearch } from './search-proxy.js';

const { getMessage } = globalThis.QuizHelperI18n;
const { buildOpenAIBody, buildAnthropicBody, buildResponsesBody } = globalThis.QuizHelperLLMUtils;

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_TEXT = 'ping';

/**
 * 大模型最小请求探测（复用 llm-utils 请求体构建，按 API 格式分发）
 * @returns {Promise<{status:'ok'|'err', latencyMs?:number, error?:string}>}
 */
async function probeLlm(config) {
  const baseUrl = String(config.apiUrl || '').replace(/\/+$/, '');
  let url;
  let body;

  if (config.apiFormat === 'anthropic') {
    url = `${baseUrl}/messages`;
    body = buildAnthropicBody({
      model: config.model,
      messages: [{ role: 'user', content: PROBE_TEXT }],
      maxTokens: 16,
      temperature: 0,
      enableThinking: false,
      stream: false
    });
  } else if (config.apiFormat === 'responses') {
    url = `${baseUrl}/responses`;
    body = buildResponsesBody({
      model: config.model,
      input: PROBE_TEXT,
      instructions: '',
      temperature: 0,
      enableThinking: false,
      stream: false
    });
  } else {
    url = `${baseUrl}/chat/completions`;
    body = buildOpenAIBody({
      model: config.model,
      messages: [{ role: 'user', content: PROBE_TEXT }],
      temperature: 0,
      enableThinking: false,
      stream: false
    });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiFormat === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    await res.json();
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { status: 'err', error: (err && err.message) ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 搜索服务商最小请求探测（复用 search-proxy 的真实请求链路，认证头由 DNR 注入）
 * @returns {Promise<{status:'ok'|'err', latencyMs?:number, error?:string}>}
 */
async function probeSearch(provider, settings) {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await executeWebSearch(provider, settings, PROBE_TEXT, controller.signal);
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { status: 'err', error: (err && err.message) ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 全量探测入口：当前生效模型 + 所有配置过 key 的搜索服务商，写回缓存
 * @returns {Promise<{success:true}>}
 */
export async function handleDetectStatus() {
  const storage = await chrome.storage.local.get([
    'llm_models',
    'web_search_providers',
    'web_search_settings'
  ]);

  const models = storage.llm_models || [];
  const activeModels = models.filter(m => m.isActive);

  // ---- 大模型：并行探测所有 active 模型（每个模型都有各自状态点） ----
  const llmMap = {};
  await Promise.all(activeModels.map(async model => {
    if (model.apiKey && model.apiUrl && model.modelId) {
      const config = {
        apiKey: model.apiKey,
        apiUrl: model.apiUrl,
        apiFormat: model.apiFormat || 'openai',
        model: model.modelId
      };
      const result = await probeLlm(config);
      llmMap[model.id] = { ...result, checkedAt: Date.now() };
    } else {
      llmMap[model.id] = { status: 'none', error: getMessage('statusNotConfigured'), checkedAt: Date.now() };
    }
  }));

  // ---- 搜索：并行探测所有配置过 key 的 provider ----
  const providers = storage.web_search_providers || [];
  const providersWithKey = providers.filter(p => p.apiKey && p.endpoint);
  const settings = storage.web_search_settings || { count: 5, timeRange: '', language: 'zh' };
  const searchMap = {};

  await Promise.all(providersWithKey.map(async provider => {
    const probeSettings = { ...settings, count: 5 };
    const result = await probeSearch(provider, probeSettings);
    searchMap[provider.id] = { ...result, checkedAt: Date.now() };
  }));

  await globalThis.QuizHelperStatusUtils.setStatusCache(llmMap, searchMap);

  return { success: true };
}
