/**
 * GitLab — 실습 화면 조립: 미션 패널 + 터미널 + 시각화 + 편집기.
 * 상태 판정은 missions.js, 실행은 LabSession, 그리기는 각 View가 맡는다.
 */
import { el } from '../ui/dom.js';
import { store } from '../ui/store.js';
import { LabSession } from './lab-session.js';
import { MISSIONS } from './missions.js';
import { TerminalView } from './terminal.js';
import { renderVisualizer } from './visualizer.js';

const PROGRESS_KEY = 'lab.missionsDone';
const sessionState = { activeMission: null, stepsDone: {}, missionSince: {}, transcript: [] };

export async function mountGitLab(container) {
  container.classList.add('lab');
  container.replaceChildren(el('div', { class: 'lab-loading' }, el('span', { class: 'spinner' }), 'Git 엔진(libgit2 · WebAssembly)을 불러오는 중…'));
  let session;
  try {
    session = await LabSession.shared();
  } catch (error) {
    console.error(error);
    container.replaceChildren(el('div', { class: 'callout callout-danger' }, el('strong', {}, 'Git 엔진을 불러오지 못했어요. '), '최신 Chrome/Edge/Firefox에서 다시 시도해 주세요. (', String(error.message ?? error), ')'));
    return;
  }
  new GitLabView(container, session);
}

class GitLabView {
  #snap = null;
  #renderToken = 0;

  constructor(container, session) {
    this.session = session;
    this.container = container;
    this.requested = container.dataset.mission;
    sessionState.activeMission ??= this.requested ?? MISSIONS[0].id;
    if (this.requested) sessionState.activeMission = this.requested;
    this.#build();
    this.terminal.print(
      sessionState.transcript.length
        ? sessionState.transcript
        : [
            { text: '🧪 Git 실습실에 오신 것을 환영합니다!', kind: 'ok' },
            { text: '이 터미널은 진짜 Git 엔진(libgit2)을 WebAssembly로 브라우저 안에서 실행합니다. 아무것도 서버로 전송되지 않아요.', kind: 'info' },
            { text: '왼쪽 미션의 명령 칩을 누르면 입력창에 채워집니다. Enter로 실행하세요. (help · git help · ↑↓ 히스토리 · Tab 자동완성)', kind: 'info' },
            { text: '' },
          ],
    );
    this.unsubscribe = session.onChange(() => this.#refresh());
    this.#refresh();
  }

  #build() {
    this.missionPanel = el('aside', { class: 'lab-missions', 'aria-label': '미션' });
    const termBox = el('div', { class: 'terminal' });
    this.vizBox = el('div', { class: 'lab-viz', 'aria-label': '저장소 시각화' });
    const toolbar = el(
      'div',
      { class: 'lab-toolbar' },
      el('span', { class: 'lab-badge' }, el('span', { class: 'dot' }), 'libgit2 · WebAssembly'),
      el('span', { class: 'lab-hint' }, '새로고침하면 실습 환경이 초기화돼요'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => this.terminal.clear() }, '화면 지우기'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => confirm('실습 환경을 처음 상태로 초기화할까요? (모든 파일과 커밋이 사라집니다)') && location.reload() }, '초기화'),
    );
    this.container.replaceChildren(
      el('div', { class: 'lab-grid' }, this.missionPanel, el('div', { class: 'lab-term' }, toolbar, termBox), this.vizBox),
      this.#buildEditor(),
    );
    this.terminal = new TerminalView(termBox, {
      onSubmit: async (input) => {
        const r = await this.session.run(input);
        this.#remember(input, r.lines);
        return r.lines;
      },
      getPrompt: () => {
        const root = this.session.reader.findRoot(this.session.shell.cwd);
        return { path: this.session.vfs.display(this.session.shell.cwd), branch: root ? this.session.reader.readHead(root.gitdir).branch : null };
      },
      complete: (partial) => this.#completePath(partial),
    });
    this.session.shell.onEdit = (abs) => this.#openEditor(abs);
    this.session.shell.onClear = () => {
      this.terminal.clear();
      sessionState.transcript = [];
    };
  }

  #remember(input, lines) {
    sessionState.transcript.push({ text: '', kind: 'cmd', parts: [{ text: '$ ', kind: 'prompt' }, { text: input }] }, ...lines);
    if (sessionState.transcript.length > 400) sessionState.transcript.splice(0, sessionState.transcript.length - 400);
  }

  #completePath(partial) {
    const { vfs, shell } = this.session;
    const slash = partial.lastIndexOf('/');
    const dirPart = slash === -1 ? '' : partial.slice(0, slash + 1);
    const base = slash === -1 ? partial : partial.slice(slash + 1);
    const dir = vfs.resolve(dirPart || '.', shell.cwd);
    if (!vfs.isDir(dir)) return [];
    return vfs
      .list(dir)
      .filter((n) => n.startsWith(base) && n !== '.git')
      .map((n) => dirPart + n + (vfs.isDir(`${dir}/${n}`) ? '/' : ''));
  }

  // ── 편집기 ─────────────────────────────────────────

  #buildEditor() {
    this.editorTitle = el('h3', {});
    this.editorArea = el('textarea', { class: 'editor-area', spellcheck: 'false', 'aria-label': '파일 내용' });
    this.editorTip = el('p', { class: 'editor-tip', hidden: true }, '⚠️ 충돌 표시가 남아 있어요: <<<<<<< (내 브랜치) ======= (가져온 브랜치) >>>>>>> — 남길 내용만 두고 세 줄의 표시를 모두 지우세요.');
    this.editorArea.addEventListener('input', () => this.#updateEditorTip());
    this.editorArea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.#saveEditor();
      }
    });
    this.editor = el(
      'dialog',
      { class: 'editor' },
      el('form', { method: 'dialog', class: 'editor-form' },
        el('header', {}, el('span', { class: 'editor-icon' }, '✏️'), this.editorTitle),
        this.editorTip,
        this.editorArea,
        el('footer', {},
          el('span', { class: 'lab-hint' }, 'Ctrl+S 저장 · Esc 취소'),
          el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => this.editor.close() }, '취소'),
          el('button', { type: 'button', class: 'btn btn-primary', onclick: () => this.#saveEditor() }, '저장'),
        ),
      ),
    );
    return this.editor;
  }

  #openEditor(abs) {
    const { vfs } = this.session;
    this.editingPath = abs;
    this.editorTitle.textContent = vfs.display(abs) + (vfs.exists(abs) ? '' : ' (새 파일)');
    this.editorArea.value = vfs.readOr(abs, '');
    this.#updateEditorTip();
    this.editor.showModal();
    this.editorArea.focus();
  }

  #updateEditorTip() {
    this.editorTip.hidden = !/^(<<<<<<<|=======|>>>>>>>)/m.test(this.editorArea.value);
  }

  #saveEditor() {
    const text = this.editorArea.value;
    this.session.vfs.write(this.editingPath, text.endsWith('\n') || !text ? text : text + '\n');
    this.editor.close();
    const msg = [{ text: `💾 ${this.session.vfs.display(this.editingPath)} 저장됨`, kind: 'ok' }];
    this.terminal.print(msg);
    this.#remember('(편집기 저장)', msg);
    this.#refresh();
    this.terminal.input.focus();
  }

  // ── 상태 갱신 ───────────────────────────────────────

  async #refresh() {
    const token = ++this.#renderToken;
    const snap = await this.session.snapshot();
    if (token !== this.#renderToken) return;
    this.#snap = snap;
    this.#evaluateMissions();
    this.vizBox.replaceChildren(renderVisualizer(snap, { vfs: this.session.vfs, onOpenFile: (rel) => this.#openEditor(`${snap.repo.workdir}/${rel}`) }));
    this.#renderMissions();
    this.terminal.refreshPrompt();
  }

  #state(missionId) {
    const since = sessionState.missionSince[missionId] ?? 0;
    const log = this.session.commandLog.filter((e) => e.at >= since);
    return {
      snap: this.#snap,
      flags: this.session.flags,
      read: (p) => this.session.vfs.readOr(p),
      ran: (...words) => log.some((e) => words.every((w, i) => e.args[i] === w)),
    };
  }

  #evaluateMissions() {
    const id = sessionState.activeMission;
    const mission = MISSIONS.find((m) => m.id === id);
    sessionState.missionSince[id] ??= this.session.commandLog.length;
    const done = (sessionState.stepsDone[id] ??= []);
    const state = this.#state(id);
    // 순서대로: 앞 단계가 끝나야 다음 단계를 판정 (한 번 통과한 단계는 유지)
    for (let i = 0; i < mission.steps.length; i++) {
      if (done[i]) continue;
      let ok = false;
      try {
        ok = !!mission.steps[i].check(state);
      } catch {
        ok = false;
      }
      if (!ok) break;
      done[i] = true;
    }
    if (done.filter(Boolean).length === mission.steps.length) {
      const finished = new Set(store.get(PROGRESS_KEY, []));
      if (!finished.has(id)) {
        finished.add(id);
        store.set(PROGRESS_KEY, [...finished]);
        this.celebrate = id;
      }
    }
  }

  #selectMission(id) {
    sessionState.activeMission = id;
    this.#refresh();
  }

  #renderMissions() {
    const finished = new Set(store.get(PROGRESS_KEY, []));
    const active = MISSIONS.find((m) => m.id === sessionState.activeMission);
    const done = sessionState.stepsDone[active.id] ?? [];
    const current = mission => (sessionState.stepsDone[mission.id] ?? []).filter(Boolean).length;
    const tabs = el(
      'nav',
      { class: 'mission-tabs', 'aria-label': '미션 선택' },
      MISSIONS.map((m, i) =>
        el(
          'button',
          {
            type: 'button',
            class: `mission-tab${m.id === active.id ? ' is-active' : ''}${finished.has(m.id) ? ' is-done' : ''}`,
            'aria-current': m.id === active.id ? 'step' : false,
            title: m.title,
            onclick: () => this.#selectMission(m.id),
          },
          el('span', { class: 'mission-num' }, finished.has(m.id) ? '✓' : String(i + 1)),
          el('span', { class: 'mission-tab-title' }, m.title),
        ),
      ),
    );
    const index = MISSIONS.indexOf(active);
    const count = done.filter(Boolean).length;
    const nextIndex = done.findIndex((d) => !d);
    const firstOpen = nextIndex === -1 ? (count === active.steps.length ? -1 : count) : nextIndex;
    const actions = [];
    if (active.setup) actions.push(el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => this.#runAction(active.setup.action) }, '⚙️ ', active.setup.label));
    if (active.id === 'remote') actions.push(el('button', { type: 'button', class: 'btn btn-accent btn-sm', onclick: () => this.#runAction('teammatePush') }, '👥 동료가 push 하기'));
    if (active.requires && !finished.has(active.requires) && !(sessionState.stepsDone[active.requires] ?? []).length) {
      actions.push(el('p', { class: 'mission-warn' }, `이 미션은 "${MISSIONS.find((m) => m.id === active.requires).title}" 미션의 저장소(~/my-project)를 이어서 사용해요.`));
    }
    const steps = el(
      'ol',
      { class: 'mission-steps' },
      active.steps.map((step, i) =>
        el(
          'li',
          { class: `mission-step${done[i] ? ' is-done' : ''}${i === firstOpen ? ' is-current' : ''}` },
          el('span', { class: 'step-mark', 'aria-label': done[i] ? '완료' : '미완료' }, done[i] ? '✓' : String(i + 1)),
          el(
            'div',
            { class: 'step-body' },
            el('p', { html: step.text }),
            step.cmds.length
              ? el('div', { class: 'cmd-chips' }, step.cmds.map((c) => el('button', { type: 'button', class: 'cmd-chip', title: '클릭하면 입력창에 채워져요', onclick: () => this.terminal.insert(c) }, c)))
              : '',
          ),
        ),
      ),
    );
    const complete = count === active.steps.length;
    const next = MISSIONS[index + 1];
    this.missionPanel.replaceChildren(
      tabs,
      el(
        'div',
        { class: 'mission-card' },
        el('p', { class: 'eyebrow' }, `MISSION ${index + 1} / ${MISSIONS.length}`),
        el('h3', {}, active.title),
        el('p', { class: 'mission-summary' }, active.summary),
        el('div', { class: 'concept-chips' }, active.concepts.map((c) => el('span', {}, c))),
        el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': active.steps.length, 'aria-valuenow': count }, el('span', { style: `width:${(count / active.steps.length) * 100}%` })),
        actions.length ? el('div', { class: 'mission-actions' }, actions) : '',
        steps,
        complete
          ? el(
              'div',
              { class: `mission-complete${this.celebrate === active.id ? ' is-new' : ''}` },
              el('strong', {}, '🎉 미션 완료!'),
              next ? el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => this.#selectMission(next.id) }, `다음: ${next.title} →`) : el('span', {}, '모든 Git 미션을 끝냈어요. 이제 GitHub로 넘어가 볼까요?'),
            )
          : '',
      ),
    );
    this.celebrate = null;
  }

  async #runAction(action) {
    try {
      const lines = await this.session[action]();
      this.terminal.print(lines);
      this.#remember(`(${action})`, lines);
    } catch (error) {
      this.terminal.print([{ text: `준비 중 오류: ${error.message}`, kind: 'err' }]);
    }
    this.terminal.refreshPrompt();
    this.#refresh();
  }
}
