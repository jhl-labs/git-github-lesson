/**
 * 정적 사이트 "로그인 흉내"를 우회하는 두 가지 방법을 시연한다.
 * 실습 대시보드와 같은 로직(SHA-256 비교 + sessionStorage)을 축소해 재현.
 */
import { el } from '../ui/dom.js';
import { sha256Hex } from '../ui/crypto.js';

const DEMO_HASH = 'e889aea099222ee8301e20d92dea73b3fc708b4ff388775e20e4b830a1e3880b';
const SESSION_KEY = 'gitlesson-demo-auth';
const DATA_URL = 'templates/excel-dashboard/sample-data/data.json';

export function mount(node) {
  const body = el('div', { class: 'mock-body' });
  const log = el('div', { class: 'attack-log', hidden: true });
  const say = (text) => {
    log.hidden = false;
    log.textContent += text + '\n';
    log.scrollTop = log.scrollHeight;
  };

  async function renderDashboard() {
    const res = await fetch(DATA_URL);
    const data = await res.json();
    const sheet = data.sheets[0];
    const total = sheet.summary.totals['매출액'] ?? 0;
    body.replaceChildren(
      el('strong', {}, '🔓 상반기 매출 대시보드'),
      el('p', { style: 'margin:6px 0' }, `총 매출액 ${total.toLocaleString('ko-KR')}원 · ${sheet.summary.rowCount}행`),
      el('p', { class: 'muted', style: 'font-size:13px;margin:0' }, '비밀번호 없이 들어왔습니다.'),
    );
  }

  function renderLogin() {
    const input = el('input', { type: 'password', placeholder: '비밀번호 (모른다고 가정)', 'aria-label': '데모 비밀번호' });
    const msg = el('p', { class: 'muted', style: 'font-size:13px;margin:6px 0 0' }, '');
    const form = el('form', { class: 'widget-row' }, input, el('button', { type: 'submit', class: 'btn btn-sm btn-primary' }, '로그인'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if ((await sha256Hex(input.value)) === DEMO_HASH) {
        sessionStorage.setItem(SESSION_KEY, 'ok');
        renderDashboard();
      } else msg.textContent = '❌ 비밀번호가 올바르지 않습니다.';
    });
    body.replaceChildren(el('strong', {}, '🔒 상반기 매출 대시보드'), form, msg);
  }

  const attack1 = el('button', { type: 'button', class: 'btn btn-sm' }, '공격 A · 콘솔에서 로그인 표시 조작');
  attack1.addEventListener('click', () => {
    say(`> sessionStorage.setItem('${SESSION_KEY}', 'ok')   // 개발자 도구 콘솔에 한 줄 입력`);
    sessionStorage.setItem(SESSION_KEY, 'ok');
    say('> location.reload()');
    say('✅ 로그인 화면 통과. 서버가 확인하지 않으니 브라우저가 믿는 대로 됩니다.\n');
    renderDashboard();
  });
  const attack2 = el('button', { type: 'button', class: 'btn btn-sm' }, '공격 B · data.json 주소 직접 열기');
  attack2.addEventListener('click', async () => {
    say(`> fetch('${DATA_URL}')   // 또는 주소창에 data/data.json 입력`);
    const text = await (await fetch(DATA_URL)).text();
    say(text.slice(0, 420) + '\n... (전체 데이터가 그대로 내려옵니다)\n');
  });
  const reset = el('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '처음으로');
  reset.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    log.textContent = '';
    log.hidden = true;
    renderLogin();
  });

  sessionStorage.removeItem(SESSION_KEY);
  renderLogin();
  node.replaceChildren(
    el('div', { class: 'widget' },
      el('p', { class: 'widget-title' }, '🕵️ 비밀번호 없이 들어가기'),
      el('div', { class: 'mock-browser' }, el('div', { class: 'mock-bar' }, el('i'), el('i'), el('i'), el('span', {}, 'https://you.github.io/excel-dashboard/')), body),
      el('div', { class: 'widget-row', style: 'margin-top:12px' }, attack1, attack2, reset),
      log,
    ),
  );
}
