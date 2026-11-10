/**
 * RepoVisualizer — 스냅샷을 "작업 디렉터리 / 스테이징 / 로컬 저장소 / GitHub" 4개 영역으로 그린다.
 * 상태 판단 로직은 없고, 스냅샷을 화면으로 옮기는 일만 한다.
 */
import { el, svg } from '../ui/dom.js';

const ROW = 30;
const LANE = 16;
const PAD = 12;
const LANE_COLORS = ['var(--c-repo)', 'var(--c-stage)', 'var(--c-work)', 'var(--c-remote)', '#7c3aed', '#0891b2'];
const CODE_LABEL = { A: '새 파일', M: '수정', D: '삭제', R: '이름 변경' };

/** 커밋 그래프 레인 배치 */
export function layoutGraph(order, commits) {
  const lanes = [];
  const pos = new Map();
  order.forEach((sha, row) => {
    let col = lanes.indexOf(sha);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) {
        col = lanes.length;
        lanes.push(null);
      }
    }
    for (let i = 0; i < lanes.length; i++) if (i !== col && lanes[i] === sha) lanes[i] = null;
    pos.set(sha, { row, col });
    const parents = commits.get(sha).parents.filter((p) => commits.has(p));
    lanes[col] = parents[0] ?? null;
    for (const p of parents.slice(1)) {
      if (lanes.includes(p)) continue;
      let free = lanes.indexOf(null);
      if (free === -1) {
        free = lanes.length;
        lanes.push(null);
      }
      lanes[free] = p;
    }
  });
  const edges = [];
  for (const [sha, from] of pos) {
    commits.get(sha).parents.forEach((p, i) => {
      const to = pos.get(p);
      if (to) edges.push({ from, to, merge: i > 0 });
    });
  }
  const width = Math.max(1, ...[...pos.values()].map((p) => p.col + 1));
  return { pos, edges, width };
}

function laneX(col) {
  return PAD + col * LANE;
}
function rowY(row) {
  return row * ROW + ROW / 2;
}

function edgePath({ from, to, merge }) {
  const x1 = laneX(from.col);
  const y1 = rowY(from.row);
  const x2 = laneX(to.col);
  const y2 = rowY(to.row);
  if (x1 === x2) return `M${x1} ${y1} L${x2} ${y2}`;
  if (merge) {
    // 병합 커밋 → 다른 레인의 부모: 바로 옆 레인으로 꺾은 뒤 내려간다
    const bend = y1 + ROW;
    return `M${x1} ${y1} C${x1} ${bend - ROW / 3} ${x2} ${y1 + ROW / 3} ${x2} ${bend} L${x2} ${y2}`;
  }
  // 브랜치 레인이 부모 레인으로 합류
  const bend = y2 - ROW;
  return `M${x1} ${y1} L${x1} ${bend} C${x1} ${y2 - ROW / 3} ${x2} ${bend + ROW / 3} ${x2} ${y2}`;
}

/**
 * @param {{order: string[], commits: Map, refs: {sha: string, text: string, kind: string}[], headSha?: string}} graph
 */
export function renderGraph({ order, commits, refs, headSha }) {
  if (!order.length) return el('p', { class: 'viz-empty' }, '아직 커밋이 없어요');
  const { pos, edges, width } = layoutGraph(order, commits);
  const svgWidth = PAD * 2 + (width - 1) * LANE;
  const canvas = svg('svg', { width: svgWidth, height: order.length * ROW, class: 'graph-svg', 'aria-hidden': 'true' });
  for (const e of edges) {
    canvas.append(svg('path', { d: edgePath(e), stroke: LANE_COLORS[(e.merge ? e.to.col : e.from.col) % LANE_COLORS.length], fill: 'none', 'stroke-width': 2 }));
  }
  for (const [sha, p] of pos) {
    const isHead = sha === headSha;
    canvas.append(
      svg('circle', {
        cx: laneX(p.col),
        cy: rowY(p.row),
        r: isHead ? 6.5 : 5,
        fill: isHead ? LANE_COLORS[p.col % LANE_COLORS.length] : 'var(--bg-elev)',
        stroke: LANE_COLORS[p.col % LANE_COLORS.length],
        'stroke-width': 2.5,
      }),
    );
  }
  const rows = el('ol', { class: 'graph-rows', style: `padding-left:${svgWidth + 4}px` });
  for (const sha of order) {
    const c = commits.get(sha);
    const chips = refs.filter((r) => r.sha === sha).map((r) => el('span', { class: `ref-chip ref-${r.kind}` }, r.text));
    rows.append(
      el(
        'li',
        { class: 'graph-row', title: `${sha}\n${c.author} · ${new Date(c.time * 1000).toLocaleString('ko-KR')}\n\n${c.message}` },
        el('code', { class: 'graph-sha' }, sha.slice(0, 7)),
        ...chips,
        el('span', { class: 'graph-msg' }, c.message.split('\n')[0]),
        c.parents.length > 1 ? el('span', { class: 'graph-merge' }, 'merge') : '',
      ),
    );
  }
  return el('div', { class: 'graph', style: `height:${order.length * ROW}px` }, canvas, rows);
}

function area(kind, title, subtitle, body) {
  return el('section', { class: `viz-area viz-${kind}` }, el('header', {}, el('h4', {}, title), el('span', {}, subtitle)), body);
}

function fileItem(path, badge, badgeKind, onOpen) {
  const item = el('li', {}, el('button', { type: 'button', class: 'file-btn', title: `${path} 편집`, onclick: () => onOpen?.(path) }, el('span', { class: 'file-name' }, path), badge ? el('span', { class: `badge badge-${badgeKind}` }, badge) : ''));
  return item;
}

export function renderVisualizer(snap, { onOpenFile, vfs }) {
  const root = el('div', { class: 'viz' });
  const repo = snap.repo;
  if (!repo) {
    root.append(
      el(
        'div',
        { class: 'viz-placeholder' },
        el('strong', {}, '아직 Git 저장소 밖에 있어요'),
        el('p', {}, `현재 위치: ${vfs.display(snap.cwd)} — 저장소 폴더로 이동(cd)하거나 git init 으로 새 저장소를 만들면 여기에 구조가 나타납니다.`),
      ),
    );
    root.append(renderGitHub(snap));
    return root;
  }
  const { status } = repo;
  const changed = new Map();
  status.untracked.forEach((p) => changed.set(p, ['U', 'untracked']));
  status.unstaged.forEach((e) => changed.set(e.path, [e.code, 'modified']));
  status.conflicts.forEach((p) => changed.set(p, ['충돌', 'conflict']));
  const wdList = el('ul', { class: 'file-list' });
  const files = new Set([...repo.files, ...status.unstaged.filter((e) => e.code === 'D').map((e) => e.path)]);
  if (!files.size) wdList.append(el('li', { class: 'viz-empty' }, '파일 없음'));
  [...files].sort().forEach((p) => {
    const [code, kind] = changed.get(p) ?? [null, null];
    const label = kind === 'untracked' ? 'Untracked' : kind === 'conflict' ? '충돌!' : code ? CODE_LABEL[code] ?? code : '';
    wdList.append(fileItem(p, label, kind ?? 'clean', code === 'D' ? null : onOpenFile));
  });

  const stageList = el('ul', { class: 'file-list' });
  if (!status.staged.length) stageList.append(el('li', { class: 'viz-empty' }, '비어 있음 — git add 로 올려요'));
  status.staged.forEach((e) => stageList.append(fileItem(e.path, CODE_LABEL[e.code] ?? e.code, 'staged', null)));

  const head = repo.head;
  const refs = [];
  for (const [name, sha] of Object.entries(repo.branches)) refs.push({ sha, text: !head.detached && head.branch === name ? `HEAD → ${name}` : name, kind: !head.detached && head.branch === name ? 'head' : 'branch' });
  if (head.detached && head.sha) refs.push({ sha: head.sha, text: 'HEAD', kind: 'head' });
  for (const [name, sha] of Object.entries(repo.remoteBranches)) refs.push({ sha, text: name, kind: 'remote' });
  for (const [name, sha] of Object.entries(repo.tags)) refs.push({ sha, text: `🏷 ${name}`, kind: 'tag' });

  const location = el(
    'div',
    { class: 'viz-location' },
    el('span', {}, '📁 ', vfs.display(repo.workdir)),
    el('span', { class: 'ref-chip ref-head' }, head.detached ? `HEAD (${head.sha?.slice(0, 7)})` : `HEAD → ${head.branch}`),
    repo.merging ? el('span', { class: 'badge badge-conflict' }, '병합 진행 중') : '',
    head.unborn ? el('span', { class: 'badge badge-untracked' }, '첫 커밋 전') : '',
  );

  root.append(
    location,
    el(
      'div',
      { class: 'viz-flow' },
      area('work', '작업 디렉터리', 'Working Directory · 내가 편집하는 파일', wdList),
      el('div', { class: 'viz-arrow', 'aria-hidden': 'true' }, el('span', {}, 'git add'), '→'),
      area('stage', '스테이징 영역', 'Staging Area · 다음 커밋 후보', stageList),
      el('div', { class: 'viz-arrow', 'aria-hidden': 'true' }, el('span', {}, 'git commit'), '→'),
    ),
    area('repo', '로컬 저장소', `.git · 커밋 ${repo.commits.size}개`, renderGraph({ order: repo.order, commits: repo.commits, refs, headSha: head.sha })),
    renderGitHub(snap),
  );
  return root;
}

function renderGitHub(snap) {
  const body = el('div', { class: 'gh-repos' });
  // 지금 있는 저장소의 origin을 맨 위에 보여 준다 (여러 GitHub 저장소가 있을 때 헷갈리지 않도록)
  const origin = snap.repo?.remotes?.find((r) => r.name === 'origin')?.display;
  const repos = [...snap.github].sort((a, b) => (b.url === origin) - (a.url === origin));
  for (const r of repos) {
    const refs = Object.entries(r.branches).map(([name, sha]) => ({ sha, text: name, kind: 'remote' }));
    const url = el('div', { class: 'gh-url' }, el('code', {}, r.url), r.url === origin ? el('span', { class: 'ref-chip ref-remote' }, '이 저장소의 origin') : '');
    body.append(el('div', { class: 'gh-repo' }, url, r.order.length ? renderGraph({ order: r.order, commits: r.commits, refs }) : el('p', { class: 'viz-empty' }, '빈 저장소 — git push 를 기다리는 중')));
  }
  return area('remote', '가상 GitHub', 'Remote · 인터넷 너머의 공유 저장소', body);
}
