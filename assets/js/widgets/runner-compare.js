/**
 * Windows 순차 처리 vs Linux matrix 병렬 처리의 소요 시간·과금 분 비교.
 * 수치는 설명용 가정치이며 화면에 그대로 노출한다.
 */
import { el } from '../ui/dom.js';

const ASSUME = {
  windows: { boot: 90, perFile: 45, multiplier: 2 }, // Windows 부팅/셋업 + Excel(xlwings) 파일당 처리
  linux: { boot: 25, perFile: 4, multiplier: 1, maxParallel: 20 }, // Linux 셋업 + openpyxl 파일당 처리
};

const fmt = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초` : `${Math.round(sec)}초`);

export function mount(node) {
  const range = el('input', { type: 'range', min: 1, max: 50, value: 10, 'aria-label': '엑셀 파일 수' });
  const count = el('strong', {}, '10');
  const stats = el('div', { class: 'stat-row' });
  const bars = el('div', { class: 'bar-compare' });

  function update() {
    const n = Number(range.value);
    count.textContent = String(n);
    const w = ASSUME.windows;
    const l = ASSUME.linux;
    const winWall = w.boot + w.perFile * n;
    const winBilled = Math.ceil(winWall / 60) * w.multiplier;
    const waves = Math.ceil(n / l.maxParallel);
    const linWall = l.boot + l.perFile * waves;
    const linBilled = n * Math.ceil((l.boot + l.perFile) / 60) * l.multiplier;
    const max = Math.max(winWall, linWall);
    stats.replaceChildren(
      el('div', { class: 'stat' }, el('small', {}, '🪟 Windows · 순차'), el('strong', {}, fmt(winWall)), el('span', {}, `과금 환산 ${winBilled}분 (×${w.multiplier})`)),
      el('div', { class: 'stat' }, el('small', {}, '🐧 Linux · matrix 병렬'), el('strong', {}, fmt(linWall)), el('span', {}, `과금 환산 ${linBilled}분 (×${l.multiplier}, Job ${n}개)`)),
      el('div', { class: 'stat' }, el('small', {}, '결과를 받기까지'), el('strong', {}, `${(winWall / linWall).toFixed(1)}배 빠름`), el('span', {}, 'Linux 병렬 기준')),
    );
    bars.replaceChildren(
      el('div', { class: 'bar-line' }, el('span', {}, 'Windows 순차'), el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${(winWall / max) * 100}%;background:var(--c-work)` })), el('b', {}, fmt(winWall))),
      el('div', { class: 'bar-line' }, el('span', {}, 'Linux 병렬'), el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${(linWall / max) * 100}%;background:var(--c-stage)` })), el('b', {}, fmt(linWall))),
    );
  }

  range.addEventListener('input', update);
  update();
  node.replaceChildren(
    el('div', { class: 'widget' },
      el('p', { class: 'widget-title' }, '⚖️ Runner 비교 계산기'),
      el('div', { class: 'widget-row' }, el('span', {}, '엑셀 파일 수'), range, count, el('span', {}, '개')),
      stats,
      bars,
      el('p', { class: 'muted', style: 'font-size:12.5px;margin:12px 0 0' },
        `가정: Windows 준비 ${ASSUME.windows.boot}초 + 파일당 ${ASSUME.windows.perFile}초(Excel 실행), Linux 준비 ${ASSUME.linux.boot}초 + 파일당 ${ASSUME.linux.perFile}초, 최대 동시 ${ASSUME.linux.maxParallel}개. ` +
        '과금은 Job마다 분 단위로 올림되며 private 저장소의 OS 배수(Linux 1, Windows 2)를 적용했습니다. 병렬은 "총 과금 분"보다 "기다리는 시간"을 줄이는 데 결정적입니다.'),
    ),
  );
}
