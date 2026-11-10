/**
 * enhance — 정적 페이지 HTML에 인터랙션을 붙인다.
 * 페이지 작성자는 아래 마크업 규칙만 지키면 된다 (docs/content-authoring.md 참고).
 *
 *  <pre>                         → 복사 버튼
 *  <figure class="prompt-card">  → "Claude Code에 붙여넣기" 프롬프트 카드
 *  <figure class="shot" data-src> → 스크린샷 (파일이 없으면 자리표시)
 *  <div class="tabs">            → 탭 (자식 section[data-tab])
 *  <ul class="checklist" data-checklist="id"> → 저장되는 체크리스트
 *  <div class="quiz" data-answer="b">         → 퀴즈
 *  <div data-git-lab>            → Git 실습실
 *  <div data-widget="name">      → assets/js/widgets/<name>.js 의 mount()
 */
import { el } from './dom.js';
import { store } from './store.js';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { style: 'position:fixed;opacity:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function copyButton(getText, label = '복사') {
  const btn = el('button', { type: 'button', class: 'copy-btn', 'aria-label': `${label}하기` }, label);
  btn.addEventListener('click', async () => {
    const ok = await copyText(getText());
    btn.textContent = ok ? '✓ 복사됨' : '복사 실패';
    btn.classList.toggle('is-copied', ok);
    setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove('is-copied');
    }, 1600);
  });
  return btn;
}

function enhanceCode(root) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.closest('.prompt-card') || pre.dataset.nocopy !== undefined) return;
    const wrap = el('div', { class: 'code-block' });
    if (pre.dataset.lang) wrap.append(el('span', { class: 'code-lang' }, pre.dataset.lang));
    pre.replaceWith(wrap);
    wrap.append(pre, copyButton(() => pre.innerText.replace(/\n$/, '')));
  });
}

function enhancePrompts(root) {
  root.querySelectorAll('figure.prompt-card').forEach((card) => {
    const pre = card.querySelector('pre');
    const caption = card.querySelector('figcaption');
    const head = el(
      'div',
      { class: 'prompt-head' },
      el('span', { class: 'prompt-icon', 'aria-hidden': 'true' }, '✦'),
      el('span', { class: 'prompt-title' }, caption?.textContent ?? '프롬프트'),
      copyButton(() => pre.innerText.trim(), '프롬프트 복사'),
    );
    caption?.remove();
    card.prepend(head);
  });
}

function enhanceShots(root) {
  root.querySelectorAll('figure.shot').forEach((fig) => {
    const src = fig.dataset.src;
    const caption = fig.querySelector('figcaption')?.textContent ?? '';
    const img = el('img', { src, alt: caption, loading: 'lazy' });
    img.addEventListener('error', () => {
      img.replaceWith(
        el(
          'div',
          { class: 'shot-placeholder' },
          el('span', { class: 'shot-icon', 'aria-hidden': 'true' }, '📷'),
          el('strong', {}, '스크린샷 자리'),
          el('span', {}, caption),
          el('code', {}, src),
        ),
      );
    });
    fig.prepend(img);
  });
}

function enhanceTabs(root) {
  root.querySelectorAll('.tabs').forEach((tabs, n) => {
    const sections = [...tabs.querySelectorAll(':scope > section[data-tab]')];
    const list = el('div', { class: 'tab-list', role: 'tablist' });
    const select = (i) => {
      sections.forEach((s, j) => (s.hidden = i !== j));
      [...list.children].forEach((b, j) => {
        b.setAttribute('aria-selected', String(i === j));
        b.tabIndex = i === j ? 0 : -1;
      });
    };
    sections.forEach((s, i) => {
      s.setAttribute('role', 'tabpanel');
      s.id ||= `tab-${n}-${i}`;
      const btn = el('button', { type: 'button', role: 'tab', 'aria-controls': s.id }, s.dataset.tab);
      btn.addEventListener('click', () => select(i));
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
        select(next);
        list.children[next].focus();
      });
      list.append(btn);
    });
    tabs.prepend(list);
    select(0);
  });
}

function enhanceChecklists(root) {
  root.querySelectorAll('ul.checklist[data-checklist]').forEach((ul) => {
    const key = `check:${ul.dataset.checklist}`;
    const saved = new Set(store.get(key, []));
    [...ul.children].forEach((li, i) => {
      const box = el('input', { type: 'checkbox', id: `${key}-${i}` });
      box.checked = saved.has(i);
      box.addEventListener('change', () => {
        box.checked ? saved.add(i) : saved.delete(i);
        store.set(key, [...saved]);
        li.classList.toggle('is-checked', box.checked);
      });
      li.classList.toggle('is-checked', box.checked);
      const label = el('label', { for: box.id });
      label.append(...li.childNodes);
      li.append(box, label);
    });
  });
}

function enhanceQuizzes(root) {
  root.querySelectorAll('.quiz[data-answer]').forEach((quiz) => {
    const explain = quiz.querySelector('.quiz-explain');
    if (explain) explain.hidden = true;
    quiz.querySelectorAll('button[data-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const correct = btn.dataset.opt === quiz.dataset.answer;
        quiz.querySelectorAll('button[data-opt]').forEach((b) => b.classList.remove('is-right', 'is-wrong'));
        btn.classList.add(correct ? 'is-right' : 'is-wrong');
        if (correct && explain) explain.hidden = false;
        quiz.classList.toggle('is-solved', correct);
      });
    });
  });
}

async function mountDynamic(root) {
  const jobs = [];
  root.querySelectorAll('[data-git-lab]').forEach((node) => {
    jobs.push(import('../lab/lab.js').then((m) => m.mountGitLab(node)));
  });
  root.querySelectorAll('[data-widget]').forEach((node) => {
    const name = node.dataset.widget;
    if (!/^[a-z-]+$/.test(name)) return;
    jobs.push(
      import(`../widgets/${name}.js`)
        .then((m) => m.mount(node))
        .catch((e) => {
          console.error(e);
          node.replaceChildren(el('p', { class: 'callout callout-danger' }, `위젯(${name})을 불러오지 못했어요.`));
        }),
    );
  });
  await Promise.all(jobs);
}

export async function enhance(root) {
  enhancePrompts(root);
  enhanceCode(root);
  enhanceShots(root);
  enhanceTabs(root);
  enhanceChecklists(root);
  enhanceQuizzes(root);
  await mountDynamic(root);
}
