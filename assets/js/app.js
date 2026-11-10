/**
 * 앱 진입점 — 해시 라우팅(#/page-id), 사이드바, 진행률, 테마.
 * 페이지 본문(pages/*.html)을 불러온 뒤 enhance()로 인터랙티브 요소를 붙인다.
 */
import { COURSE, PAGES, findPage, neighbors } from './course.js';
import { el } from './ui/dom.js';
import { store } from './ui/store.js';
import { enhance } from './ui/enhance.js';

const DONE_KEY = 'pagesDone';
const content = document.getElementById('content');
const sidebar = document.getElementById('sidebar');
const scrim = document.querySelector('.scrim');
const navToggle = document.querySelector('.nav-toggle');
const pageCache = new Map();

function donePages() {
  return new Set(store.get(DONE_KEY, []));
}

function setDone(id, done) {
  const set = donePages();
  done ? set.add(id) : set.delete(id);
  store.set(DONE_KEY, [...set]);
  renderSidebar(currentId());
  renderProgress();
}

function currentId() {
  const id = location.hash.replace(/^#\/?/, '').split('#')[0];
  return findPage(id) ? id : 'home';
}

// ── 사이드바 / 진행률 ─────────────────────────────────

function renderSidebar(activeId) {
  const done = donePages();
  sidebar.replaceChildren(
    ...COURSE.map((section) =>
      el(
        'div',
        { class: 'nav-section' },
        el('p', { class: 'nav-part' }, section.part),
        el(
          'ol',
          {},
          section.pages.map((p) =>
            el(
              'li',
              {},
              el(
                'a',
                { href: `#/${p.id}`, class: `nav-link${p.id === activeId ? ' is-active' : ''}${done.has(p.id) ? ' is-done' : ''}`, 'aria-current': p.id === activeId ? 'page' : false },
                el('span', { class: 'nav-check', 'aria-hidden': 'true' }),
                el('span', { class: 'nav-title' }, p.title),
                p.badge ? el('span', { class: 'nav-badge' }, p.badge) : '',
              ),
            ),
          ),
        ),
      ),
    ),
    el('p', { class: 'nav-foot' }, '진행 상황은 이 브라우저에만 저장돼요.'),
  );
}

function renderProgress() {
  const pct = Math.round((donePages().size / PAGES.length) * 100);
  document.getElementById('course-progress-bar').style.width = `${pct}%`;
  document.getElementById('course-progress-text').textContent = `${pct}%`;
}

function setNavOpen(open) {
  document.body.classList.toggle('nav-open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  scrim.hidden = !open;
}

// ── 페이지 로딩 ─────────────────────────────────────

async function loadPage(id) {
  if (!pageCache.has(id)) {
    pageCache.set(
      id,
      fetch(`pages/${id}.html`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      }),
    );
  }
  return pageCache.get(id).catch((e) => {
    pageCache.delete(id);
    throw e;
  });
}

function pageFooter(page) {
  const { prev, next } = neighbors(page.id);
  const isDone = donePages().has(page.id);
  const doneBtn = el(
    'button',
    { type: 'button', class: `btn ${isDone ? 'btn-ghost' : 'btn-primary'} done-btn`, 'aria-pressed': String(isDone) },
    isDone ? '✓ 완료한 장' : '이 장을 마쳤어요',
  );
  doneBtn.addEventListener('click', () => {
    const now = !donePages().has(page.id);
    setDone(page.id, now);
    doneBtn.className = `btn ${now ? 'btn-ghost' : 'btn-primary'} done-btn`;
    doneBtn.textContent = now ? '✓ 완료한 장' : '이 장을 마쳤어요';
    doneBtn.setAttribute('aria-pressed', String(now));
    if (now && next) location.hash = `#/${next.id}`;
  });
  return el(
    'footer',
    { class: 'page-footer' },
    el('div', { class: 'done-row' }, doneBtn),
    el(
      'nav',
      { class: 'pager', 'aria-label': '이전/다음' },
      prev ? el('a', { class: 'pager-link', href: `#/${prev.id}` }, el('small', {}, '← 이전'), el('span', {}, prev.title)) : el('span'),
      next ? el('a', { class: 'pager-link pager-next', href: `#/${next.id}` }, el('small', {}, '다음 →'), el('span', {}, next.title)) : el('span'),
    ),
  );
}

function buildToc(article) {
  const heads = [...article.querySelectorAll('h2')];
  if (heads.length < 3) return null;
  heads.forEach((h, i) => (h.id ||= `sec-${i + 1}`));
  return el(
    'aside',
    { class: 'toc', 'aria-label': '이 페이지 목차' },
    el('p', {}, '이 페이지에서'),
    el('ol', {}, heads.map((h) => el('li', {}, el('a', { href: `#/${currentId()}#${h.id}`, 'data-target': h.id }, h.textContent)))),
  );
}

async function render() {
  const id = currentId();
  const page = findPage(id);
  const anchor = location.hash.split('#')[2];
  setNavOpen(false);
  renderSidebar(id);
  document.title = `${page.title} · Git·GitHub 실전 입문`;
  try {
    const html = await loadPage(id);
    if (id !== currentId()) return;
    const article = el('article', { class: 'prose', html });
    const header = el(
      'div',
      { class: 'page-meta' },
      el('span', { class: 'page-part' }, page.part),
      el('span', {}, `⏱ 약 ${page.minutes}분`),
    );
    article.prepend(header);
    article.append(pageFooter(page));
    const layout = el('div', { class: `page${page.wide ? ' page-wide' : ''}` }, article);
    const toc = page.wide ? null : buildToc(article);
    if (toc) layout.append(toc);
    content.replaceChildren(layout);
    await enhance(article);
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
    else window.scrollTo({ top: 0 });
    content.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    content.replaceChildren(el('div', { class: 'page' }, el('article', { class: 'prose' }, el('h1', {}, '페이지를 불러오지 못했어요'), el('p', {}, `pages/${id}.html — ${error.message}`), el('p', {}, '로컬에서 index.html을 직접 열었다면 정적 서버로 실행해 주세요: python3 -m http.server'))));
  }
}

// TOC 내부 링크: 라우팅 대신 스크롤
document.addEventListener('click', (e) => {
  const link = e.target.closest('.toc a[data-target]');
  if (!link) return;
  e.preventDefault();
  document.getElementById(link.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  history.replaceState(null, '', link.getAttribute('href'));
});

// ── 테마 ────────────────────────────────────────────

document.querySelector('.theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const isDark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = isDark ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
});

navToggle.addEventListener('click', () => setNavOpen(!document.body.classList.contains('nav-open')));
scrim.addEventListener('click', () => setNavOpen(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setNavOpen(false));

let lastPage = null;
window.addEventListener('hashchange', () => {
  // 같은 페이지 내 앵커 이동이면 다시 그리지 않는다
  if (currentId() === lastPage && location.hash.split('#').length > 2) return;
  lastPage = currentId();
  render();
});
lastPage = currentId();
renderProgress();
render();
