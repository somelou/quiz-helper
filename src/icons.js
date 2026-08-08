(() => {
  const cache = new Map();

  async function getSvg(name) {
    const iconName = String(name || '').trim();
    if (!iconName) return '';
    if (cache.has(iconName)) return cache.get(iconName);

    const url = chrome.runtime.getURL(`icons/${iconName}.svg`);
    const res = await fetch(url);
    if (!res.ok) return '';
    const svgText = await res.text();
    cache.set(iconName, svgText);
    return svgText;
  }

  async function replaceIcons(root = document) {
    if (!root || !root.querySelectorAll) return;
    const elements = Array.from(root.querySelectorAll('[data-icon]'));
    await Promise.all(elements.map(async el => {
      const iconName = el.getAttribute('data-icon');
      if (!iconName) return;
      if (el.dataset.iconLoaded === '1') return;
      const svgText = await getSvg(iconName);
      if (!svgText) return;
      el.innerHTML = svgText;
      el.dataset.iconLoaded = '1';
    }));
  }

  window.QuizHelperIcons = { replaceIcons };
})();
