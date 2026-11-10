/** 비밀번호 → SHA-256 해시 생성기 (대시보드 config.js 용) */
import { el } from '../ui/dom.js';
import { sha256Hex } from '../ui/crypto.js';

export function mount(node) {
  const input = el('input', { type: 'text', placeholder: '대시보드 비밀번호 입력', autocomplete: 'off', 'aria-label': '비밀번호' });
  const output = el('output', {}, '여기에 해시가 표시됩니다');
  const snippet = el('output', {});
  const copy = el('button', { type: 'button', class: 'btn btn-sm', disabled: true }, 'config.js 줄 복사');
  let line = '';
  input.addEventListener('input', async () => {
    const value = input.value;
    if (!value) {
      output.textContent = '여기에 해시가 표시됩니다';
      snippet.textContent = '';
      copy.disabled = true;
      return;
    }
    const hash = await sha256Hex(value);
    if (input.value !== value) return;
    output.textContent = hash;
    line = `  passwordSha256: '${hash}',`;
    snippet.textContent = line;
    copy.disabled = false;
  });
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(line).catch(() => {});
    copy.textContent = '✓ 복사됨';
    setTimeout(() => (copy.textContent = 'config.js 줄 복사'), 1500);
  });
  node.replaceChildren(
    el('div', { class: 'widget' },
      el('p', { class: 'widget-title' }, '🔑 SHA-256 해시 생성기'),
      el('div', { class: 'widget-row' }, input),
      el('p', { class: 'muted', style: 'font-size:13px;margin:4px 0' }, 'SHA-256 해시'),
      output,
      el('p', { class: 'muted', style: 'font-size:13px;margin:12px 0 4px' }, 'config.js 에 넣을 줄'),
      snippet,
      el('div', { class: 'widget-row', style: 'margin-top:10px' }, copy,
        el('span', { class: 'muted', style: 'font-size:13px' }, '⚠️ 최소 12자 이상, 다른 곳에서 쓰지 않는 비밀번호를 쓰세요. 이유는 "한계" 장에서!')),
    ),
  );
}
