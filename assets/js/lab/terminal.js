/**
 * TerminalView — 출력 렌더링과 입력(히스토리, 탭 자동완성)만 담당하는 UI 컴포넌트.
 * 명령 실행은 주입받은 onSubmit 이 처리한다.
 */
import { el } from '../ui/dom.js';

const GIT_SUBCOMMANDS = ['add', 'branch', 'checkout', 'clone', 'commit', 'config', 'diff', 'fetch', 'help', 'init', 'log', 'merge', 'pull', 'push', 'remote', 'reset', 'restore', 'revert', 'rm', 'show', 'status', 'switch', 'tag'];
const SHELL_COMMANDS = ['cat', 'cd', 'clear', 'echo', 'edit', 'git', 'help', 'history', 'ls', 'mkdir', 'mv', 'pwd', 'rm', 'touch', 'tree'];

export class TerminalView {
  #history = [];
  #historyIndex = 0;
  #busy = false;

  /**
   * @param {HTMLElement} root
   * @param {{ onSubmit: (input: string) => Promise<object[]>, getPrompt: () => {path: string, branch: string|null}, complete: (partial: string) => string[] }} deps
   */
  constructor(root, { onSubmit, getPrompt, complete }) {
    this.onSubmit = onSubmit;
    this.getPrompt = getPrompt;
    this.complete = complete;
    this.output = el('div', { class: 'term-output', role: 'log', 'aria-live': 'polite' });
    this.promptEl = el('span', { class: 'term-prompt' });
    this.input = el('input', {
      class: 'term-input',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      'aria-label': '터미널 명령 입력',
    });
    const form = el('form', { class: 'term-line' }, this.promptEl, this.input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#submit();
    });
    this.input.addEventListener('keydown', (e) => this.#onKey(e));
    root.append(this.output, form);
    root.addEventListener('click', () => {
      if (!window.getSelection()?.toString()) this.input.focus();
    });
    this.refreshPrompt();
  }

  refreshPrompt() {
    const { path, branch } = this.getPrompt();
    this.promptEl.replaceChildren(
      el('span', { class: 't-user' }, 'student@git-lab'),
      ':',
      el('span', { class: 't-path' }, path),
      branch ? el('span', { class: 't-branch' }, ` (${branch})`) : '',
      '$ ',
    );
  }

  insert(text) {
    this.input.value = text;
    this.input.focus();
    this.input.setSelectionRange(text.length, text.length);
  }

  clear() {
    this.output.replaceChildren();
  }

  print(lines) {
    const frag = document.createDocumentFragment();
    for (const l of lines) {
      const row = el('div', { class: `t-line t-${l.kind ?? 'out'}` });
      if (l.parts) l.parts.forEach((p) => row.append(p.kind ? el('span', { class: `t-${p.kind}` }, p.text) : p.text));
      else row.textContent = l.text || ' ';
      frag.append(row);
    }
    this.output.append(frag);
    this.output.scrollTop = this.output.scrollHeight;
  }

  async #submit() {
    if (this.#busy) return;
    const input = this.input.value;
    this.print([{ text: '', kind: 'cmd', parts: [{ text: this.promptEl.textContent, kind: 'prompt' }, { text: input }] }]);
    this.input.value = '';
    if (input.trim()) {
      this.#history.push(input);
      this.#historyIndex = this.#history.length;
    }
    this.#busy = true;
    this.input.classList.add('is-busy');
    try {
      this.print(await this.onSubmit(input));
    } catch (error) {
      this.print([{ text: `내부 오류: ${error.message}`, kind: 'err' }]);
      console.error(error);
    } finally {
      this.#busy = false;
      this.input.classList.remove('is-busy');
      this.refreshPrompt();
      this.input.focus();
    }
  }

  #onKey(e) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!this.#history.length) return;
      e.preventDefault();
      this.#historyIndex = Math.max(0, Math.min(this.#history.length, this.#historyIndex + (e.key === 'ArrowUp' ? -1 : 1)));
      this.insert(this.#history[this.#historyIndex] ?? '');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.#autocomplete();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      this.clear();
    }
  }

  #autocomplete() {
    const value = this.input.value;
    const words = value.split(' ');
    const last = words.at(-1);
    let candidates;
    if (words.length === 1) candidates = SHELL_COMMANDS.filter((c) => c.startsWith(last));
    else if (words[0] === 'git' && words.length === 2) candidates = GIT_SUBCOMMANDS.filter((c) => c.startsWith(last));
    else candidates = this.complete(last);
    if (!candidates.length) return;
    if (candidates.length === 1) {
      words[words.length - 1] = candidates[0] + (candidates[0].endsWith('/') ? '' : ' ');
      this.insert(words.join(' '));
      return;
    }
    const prefix = candidates.reduce((a, b) => {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    });
    if (prefix.length > last.length) {
      words[words.length - 1] = prefix;
      this.insert(words.join(' '));
    } else {
      this.print([{ text: candidates.join('   '), kind: 'dim' }]);
    }
  }
}
