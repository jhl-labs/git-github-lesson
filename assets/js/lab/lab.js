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
const TIPS_KEY = 'lab.tipsCollapsed';
const MIN_LAB_HEIGHT = 540;
const WIDE_LAYOUT = '(min-width: 1201px)';

/** 오른쪽 팁 패널의 명령 빠른 참조 (칩을 누르면 입력창에 채워진다) */
const QUICK_REFERENCE = [
  ['기록', ['git status', 'git add .', 'git commit -m "메시지"', 'git log --oneline --all', 'git diff']],
  ['브랜치', ['git branch', 'git switch -c 이름', 'git checkout 이름', 'git merge 이름', 'git branch -d 이름']],
  ['원격', ['git clone 주소', 'git remote -v', 'git push', 'git fetch', 'git pull']],
  ['되돌리기', ['git restore 파일', 'git reset --soft HEAD~1', 'git reset --hard HEAD~1', 'git revert HEAD']],
];
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
    const side = el('div', { class: 'lab-side' }, this.vizBox, this.#buildTips());
    const toolbar = el(
      'div',
      { class: 'lab-toolbar' },
      el('span', { class: 'lab-badge' }, el('span', { class: 'dot' }), 'libgit2 · WebAssembly'),
      el('span', { class: 'lab-hint' }, '새로고침하면 실습 환경이 초기화돼요'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => this.terminal.clear() }, '화면 지우기'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => confirm('실습 환경을 처음 상태로 초기화할까요? (모든 파일과 커밋이 사라집니다)') && location.reload() }, '초기화'),
    );
    this.container.replaceChildren(
      el('div', { class: 'lab-grid' }, this.missionPanel, el('div', { class: 'lab-term' }, toolbar, termBox), side),
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
    this.#fitToViewport();
    this.session.shell.onClear = () => {
      this.terminal.clear();
      sessionState.transcript = [];
    };
  }

  /** 넓은 화면에서 실습실이 화면 아래 끝까지 딱 맞도록 남은 높이를 계산한다(페이지 스크롤 없이 한 화면). */
  #fitToViewport() {
    const wide = matchMedia(WIDE_LAYOUT);
    const fit = () => {
      if (!this.container.isConnected) {
        removeEventListener('resize', fit);
        return;
      }
      if (!wide.matches) {
        this.container.style.removeProperty('--lab-h');
        return;
      }
      const top = this.container.getBoundingClientRect().top + scrollY;
      this.container.style.setProperty('--lab-h', `${Math.max(MIN_LAB_HEIGHT, innerHeight - top - 16)}px`);
    };
    addEventListener('resize', fit);
    requestAnimationFrame(fit);
    document.fonts?.ready.then(fit);
  }

  #buildTips() {
    const collapsed = store.get(TIPS_KEY, false);
    const chip = (cmd) => el('button', { type: 'button', class: 'tip-chip', title: `${cmd} — 클릭하면 입력창에 채워져요`, onclick: () => this.terminal.insert(cmd) }, cmd.replace(/^git /, ''));
    const body = el(
      'div',
      { class: 'lab-tips-body' },
      el(
        'dl',
        { class: 'tip-ref' },
        QUICK_REFERENCE.map(([group, cmds]) => el('div', {}, el('dt', {}, group), el('dd', {}, cmds.map(chip)))),
      ),
      el(
        'p',
        { class: 'tip-keys' },
        el('kbd', {}, '↑↓'), ' 이전 명령 · ', el('kbd', {}, 'Tab'), ' 자동완성 · ',
        el('code', {}, 'edit 파일'), ' 편집기 · ', el('code', {}, 'echo "글" > 파일'), ' 덮어쓰기 · ', el('code', {}, '>>'), ' 끝에 추가 · ',
        el('code', {}, 'ls'), ' ', el('code', {}, 'cd'), ' ', el('code', {}, 'cat'), ' ', el('code', {}, 'clear'), ' ', el('code', {}, 'help'),
      ),
      el(
        'details',
        { class: 'tip-more' },
        el('summary', {}, '이 실습실은 어떻게 동작하나요? · 실제 Git과 다른 점'),
        el('p', { html: 'C로 만든 Git 라이브러리 <b>libgit2</b>를 WebAssembly로 컴파일한 <a href="https://github.com/petersalomonsen/wasm-git" target="_blank" rel="noopener">wasm-git</a>이 브라우저 메모리 안에서 진짜 커밋 객체를 만듭니다. "가상 GitHub"도 메모리 속 bare 저장소예요. 일부 명령(branch·switch·restore·pull·revert 등)은 실제 git과 같은 결과가 나오도록 실습실이 보완합니다.' }),
        el('p', { html: '편집기(vim)가 없어 커밋 메시지는 <code>-m "메시지"</code>로 적어요. <code>rebase</code>·<code>stash</code>·<code>--amend</code>는 지원하지 않고, 새로고침하면 실습 내용이 사라집니다.' }),
      ),
    );
    const box = el('section', { class: `lab-tips${collapsed ? ' is-collapsed' : ''}`, 'aria-label': '실습 팁' });
    const toggle = el('button', { type: 'button', class: 'lab-tips-toggle', 'aria-expanded': String(!collapsed) }, collapsed ? '펼치기' : '접기');
    toggle.addEventListener('click', () => {
      const next = !box.classList.toggle('is-collapsed') ? false : true;
      store.set(TIPS_KEY, next);
      toggle.textContent = next ? '펼치기' : '접기';
      toggle.setAttribute('aria-expanded', String(!next));
    });
    box.append(el('header', { class: 'lab-tips-head' }, el('strong', {}, '💡 팁 · 명령 빠른 참조'), toggle), body);
    return box;
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
    if (active.extra) actions.push(el('button', { type: 'button', class: 'btn btn-accent btn-sm', onclick: () => this.#runAction(active.extra.action) }, active.extra.label));
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
    this.#revealCurrentStep();
  }

  /** 진행 중인 단계(또는 완료 안내)가 미션 패널 안에 보이도록 패널 내부만 스크롤한다. */
  #revealCurrentStep() {
    const panel = this.missionPanel;
    const target = panel.querySelector('.mission-complete, .mission-step.is-current');
    if (!target || panel.scrollHeight <= panel.clientHeight) return;
    const tabsHeight = panel.querySelector('.mission-tabs')?.offsetHeight ?? 0;
    const top = target.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
    const bottom = top + target.offsetHeight;
    const viewTop = panel.scrollTop + tabsHeight;
    const viewBottom = panel.scrollTop + panel.clientHeight;
    if (top < viewTop || bottom > viewBottom) {
      panel.scrollTo({ top: Math.max(0, top - tabsHeight - 12), behavior: 'smooth' });
    }
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
