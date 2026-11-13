/**
 * Real "bigger controls" for expanded panel sections — no CSS zoom.
 *
 * Builds a copy of the app's style rules scoped to one container, with every
 * px length multiplied by `factor` (rounded to whole pixels; hairlines ≤ 1px
 * stay as they are). The section inside is then laid out at its true, larger
 * size, so text, knobs and borders render natively crisp instead of being
 * magnified.
 *
 * Every copied selector gains the same one extra class, so the relative
 * specificity (and therefore which rule wins) is unchanged.
 */

/** Rules about page chrome outside the section — never copied. */
const SKIP =
  /(^|[\s>+~,(])(?:html|body|:root|\.window|\.shell|\.titlebar|\.sidebar|\.nav\b|\.nav-|\.workspace|\.main\b|\.main-head|\.modal-|\.section-modal|\.confirm-|\.a2m|\.pb\b|\.pb-|\.saveload|\.panel-mode|\.fractal|\.menu-toggle|\.hw-modal-)/;

/** The board's own full-screen grid — the scaled copy lives in a modal frame instead. */
const BOARD_ITSELF = /^\.hw-board$/;

/** Split a selector list on top-level commas (not those inside :is(…) etc.). */
function splitSelectors(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function scopeSelector(sel, scope) {
  // A rule written for the panel board applies to the scaled board itself
  if (/^\.hw-board(?=[\s.:>[]|$)/.test(sel)) return sel.replace(/^\.hw-board/, `.hw-board${scope}`);
  return `${scope} ${sel}`;
}

function scalePx(cssText, factor) {
  return cssText.replace(/(-?\d*\.?\d+)px/g, (m, num) => {
    const v = parseFloat(num);
    if (Math.abs(v) <= 1) return m; // keep hairline borders crisp
    return `${Math.round(v * factor)}px`;
  });
}

function copyRules(rules, scope, factor, out) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const selectors = splitSelectors(rule.selectorText).filter(
        (s) => !SKIP.test(s) && !BOARD_ITSELF.test(s),
      );
      if (!selectors.length) continue;
      const body = scalePx(rule.style.cssText, factor);
      if (!body.trim()) continue;
      out.push(`${selectors.map((s) => scopeSelector(s, scope)).join(', ')} { ${body} }`);
    } else if (rule instanceof CSSImportRule) {
      // Unbundled @import (dev without inlining): follow into the imported sheet
      if (rule.styleSheet) copyRules(rule.styleSheet.cssRules, scope, factor, out);
    } else if (rule instanceof CSSMediaRule) {
      const inner = [];
      copyRules(rule.cssRules, scope, factor, inner);
      if (inner.length) out.push(`@media ${rule.conditionText} { ${inner.join('\n')} }`);
    } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
      const inner = [];
      copyRules(rule.cssRules, scope, factor, inner);
      if (inner.length) out.push(`@supports ${rule.conditionText} { ${inner.join('\n')} }`);
    }
  }
}

/**
 * Inject scaled styles for `scopeClass` (e.g. 'hw-scaled'). Returns a function
 * that removes them.
 */
export function applyScaledStyles(scopeClass, factor) {
  const scope = `.${scopeClass}`;
  const out = [];
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode?.dataset?.scaledStyles != null) continue;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet (e.g. web fonts)
    }
    copyRules(rules, scope, factor, out);
  }
  const style = document.createElement('style');
  style.dataset.scaledStyles = '';
  style.textContent = out.join('\n');
  document.head.append(style);
  return () => style.remove();
}
