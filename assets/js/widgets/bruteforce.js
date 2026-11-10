/**
 * 공개된 SHA-256 해시를 무차별 대입으로 역산하는 데모.
 * 이 브라우저 탭 하나의 속도를 측정해, 비밀번호 길이별 예상 시간을 보여준다.
 */
import { el } from '../ui/dom.js';
import { sha256Hex } from '../ui/crypto.js';

const CHARSETS = {
  digits: { label: '숫자만', chars: '0123456789' },
  lower: { label: '영문 소문자', chars: 'abcdefghijklmnopqrstuvwxyz' },
  mixed: { label: '영문 대소문자+숫자', size: 62 },
  full: { label: '대소문자+숫자+특수문자', size: 94 },
};
const GPU_PER_SEC = 1e10; // 고성능 GPU 한 장의 SHA-256 시도 횟수 (대략적인 규모)

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '∞';
  if (seconds < 1) return '1초 미만';
  const units = [['년', 31536000], ['일', 86400], ['시간', 3600], ['분', 60], ['초', 1]];
  for (const [name, size] of units) {
    if (seconds >= size) {
      const v = seconds / size;
      if (name === '년' && v > 1e6) return `${v.toExponential(1)}년`;
      return `${v >= 100 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(1)}${name}`;
    }
  }
  return `${seconds.toFixed(1)}초`;
}

function* candidates(chars, length) {
  const idx = new Array(length).fill(0);
  while (true) {
    yield idx.map((i) => chars[i]).join('');
    let p = length - 1;
    while (p >= 0 && ++idx[p] === chars.length) idx[p--] = 0;
    if (p < 0) return;
  }
}

export function mount(node) {
  const presetSelect = el('select', { 'aria-label': '목표 비밀번호' },
    el('option', { value: '4826' }, '4826 (숫자 4자리)'),
    el('option', { value: '031225' }, '031225 (생일 6자리)'),
    el('option', { value: 'dash' }, 'dash (소문자 4자리)'),
  );
  const start = el('button', { type: 'button', class: 'btn btn-sm btn-primary' }, '▶ 해시 깨기 시작');
  const stop = el('button', { type: 'button', class: 'btn btn-sm', disabled: true }, '중지');
  const status = el('div', { class: 'stat-row' });
  const table = el('table');
  let running = false;

  const stat = (label, value, note = '') => el('div', { class: 'stat' }, el('small', {}, label), el('strong', {}, value), note ? el('span', {}, note) : '');

  function renderEstimates(perSec) {
    const rows = [];
    for (const len of [4, 6, 8, 10, 12]) {
      const cells = Object.values(CHARSETS).map((cs) => {
        const space = (cs.chars?.length ?? cs.size) ** len;
        return el('td', {}, formatDuration(space / GPU_PER_SEC));
      });
      rows.push(el('tr', {}, el('td', {}, `${len}자리`), ...cells));
    }
    table.replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, '길이 \\ 문자 종류'), ...Object.values(CHARSETS).map((c) => el('th', {}, c.label)))),
      el('tbody', {}, rows),
    );
    if (perSec) status.append(stat('이 브라우저 탭의 속도', `${Math.round(perSec).toLocaleString('ko-KR')}/초`, `GPU 한 장은 약 ${GPU_PER_SEC.toExponential(0)}/초`));
  }

  async function run() {
    const target = presetSelect.value;
    const charset = /^\d+$/.test(target) ? CHARSETS.digits : CHARSETS.lower;
    const targetHash = await sha256Hex(target);
    running = true;
    start.disabled = true;
    stop.disabled = false;
    const began = performance.now();
    let tries = 0;
    let found = null;
    const tick = () => {
      const sec = (performance.now() - began) / 1000;
      status.replaceChildren(
        stat('목표 해시 (config.js에 공개됨)', targetHash.slice(0, 16) + '…'),
        stat('시도 횟수', tries.toLocaleString('ko-KR')),
        stat('경과 시간', `${sec.toFixed(2)}초`),
      );
    };
    const gen = candidates(charset.chars, target.length);
    for (const guess of gen) {
      if (!running) break;
      tries++;
      if ((await sha256Hex(guess)) === targetHash) {
        found = guess;
        break;
      }
      if (tries % 500 === 0) {
        tick();
        await new Promise((r) => setTimeout(r));
      }
    }
    tick();
    const sec = (performance.now() - began) / 1000;
    status.append(stat(found ? '🔓 찾은 비밀번호' : '중지됨', found ?? '-', found ? `${sec.toFixed(2)}초 만에` : ''));
    renderEstimates(tries / Math.max(sec, 0.001));
    running = false;
    start.disabled = false;
    stop.disabled = true;
  }

  start.addEventListener('click', run);
  stop.addEventListener('click', () => (running = false));
  renderEstimates(null);
  node.replaceChildren(
    el('div', { class: 'widget' },
      el('p', { class: 'widget-title' }, '💥 무차별 대입 체험'),
      el('div', { class: 'widget-row' }, presetSelect, start, stop),
      status,
      el('p', { class: 'muted', style: 'font-size:13px;margin:12px 0 6px' }, 'GPU 한 장으로 모든 경우를 시도하는 데 걸리는 최대 시간 (대략적 추정):'),
      table,
      el('p', { class: 'muted', style: 'font-size:13px;margin:0' }, '👉 길고 무작위한 비밀번호는 시간을 벌어 주지만, "공개된 해시"라는 구조적 문제는 해결하지 못합니다.'),
    ),
  );
}
