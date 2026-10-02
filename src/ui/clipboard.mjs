/** Clipboard helpers with a fallback for insecure contexts. */

import { el } from './dom.mjs';

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = el('textarea', { readonly: true, 'aria-hidden': 'true' });
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Button that copies text from `getText()` and shows transient feedback. */
export function copyButton(getText, { label = 'Copy', copiedLabel = 'Copied' } = {}) {
  const button = el(
    'button',
    { type: 'button', class: 'button button--ghost button--small', 'aria-label': label },
    [label],
  );
  button.addEventListener('click', async () => {
    const ok = await copyText(String(getText() ?? ''));
    button.textContent = ok ? copiedLabel : 'Copy failed';
    if (ok) button.disabled = true;
    setTimeout(() => {
      button.textContent = label;
      button.disabled = false;
    }, 1200);
  });
  return button;
}

/**
 * Event delegation for pre-rendered pages: any `[data-copy]` element copies
 * its value. Dynamic result buttons use copyButton() instead.
 */
export function wireCopyButtons(root = document) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-copy]');
    if (!button) return;
    const ok = await copyText(button.dataset.copy);
    const original = button.textContent;
    button.textContent = ok ? 'Copied' : 'Copy failed';
    if (ok) button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  });
}
