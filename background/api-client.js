const DEFAULT_API_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';

export async function getApiConfig() {
  const config = await chrome.storage.local.get([
    'api_url',
    'api_key',
    'model',
    'system_prompt',
    'extra_context_prompt'
  ]);

  return {
    apiUrl: (config.api_url || DEFAULT_API_URL).replace(/\/+$/, ''),
    apiKey: config.api_key || '',
    extraContextPrompt: config.extra_context_prompt || '',
    model: config.model || DEFAULT_MODEL,
    systemPrompt: config.system_prompt || ''
  };
}

export async function postChatCompletion({
  apiKey,
  apiUrl,
  messages,
  model,
  temperature = 0.2
}) {
  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
