// Popup 逻辑：向当前标签页发送分析指令

// 分析当前页面按钮
document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    // 尝试直接发送消息（Content Script 已加载时）
    await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
  } catch (e) {
    // Content Script 未加载，动态注入后再发送
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
      }, 300);
    } catch (injectErr) {
      console.error('注入失败:', injectErr);
    }
  }

  window.close();
});

// 打开设置页面按钮
document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
