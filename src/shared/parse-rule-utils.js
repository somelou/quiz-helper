// 解析规则种子化共享工具（content 与 options 共用）
// 收敛两端各自维护一份的「种子合并/推送」逻辑，避免规则字段补齐规则漂移。
(() => {
  'use strict';

  /**
   * 合并已有规则与种子规则：保留用户修改字段，仅合并补齐缺失的种子字段
   * （如新增的 single 关键词、新选择的 rootSelectors 等）
   * @param {Object} existingRule - 已存储的用户规则（可为空对象）
   * @param {Object} seedRule - 种子规则
   * @returns {Object} 合并后的规则对象
   */
  function mergeSeedRuleInto(existingRule, seedRule) {
    const current = existingRule || {};
    const seedSelectors = (seedRule && seedRule.selectors) || {};
    const existingSelectors = current.selectors || {};
    return {
      ...current,
      id: current.id || seedRule.id,
      domain: current.domain || seedRule.domain,
      name: current.name || seedRule.name,
      selectors: {
        ...seedSelectors,
        ...existingSelectors,
        typeIndicators: {
          ...(seedSelectors.typeIndicators || {}),
          ...(existingSelectors.typeIndicators || {})
        }
      },
      typeKeywords: {
        ...((seedRule && seedRule.typeKeywords) || {}),
        ...(current.typeKeywords || {})
      }
    };
  }

  /**
   * 将种子规则应用到规则列表（幂等）：
   * - 已存在同 id 规则 → 合并补齐缺失字段
   * - 不存在 → 推送种子规则
   * @param {Array} rules - 现有规则列表（不会被原地修改）
   * @param {Object} seedRule - 种子规则（含 id / selectors / typeKeywords）
   * @returns {Array} 应用后的新列表
   */
  function applySeedRule(rules, seedRule) {
    const list = Array.isArray(rules) ? rules.slice() : [];
    if (!seedRule || !seedRule.id) return list;
    const idx = list.findIndex(r => r && r.id === seedRule.id);
    if (idx >= 0) {
      list[idx] = mergeSeedRuleInto(list[idx], seedRule);
    } else {
      list.push(seedRule);
    }
    return list;
  }

  globalThis.QuizHelperParseRuleUtils = {
    mergeSeedRuleInto,
    applySeedRule
  };
})();