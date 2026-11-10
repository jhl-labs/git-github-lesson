/**
 * LabSession — Git 실습 환경의 조립 지점(composition root).
 * 엔진·파일시스템·가상 GitHub·명령 처리기·셸을 만들고, 미션용 시나리오를 제공한다.
 * 페이지를 이동해도 실습 상태가 유지되도록 모듈 단위 싱글턴으로 사용한다.
 */
import { GitEngine } from './engine.js';
import { VirtualFS, HOME } from './vfs.js';
import { GitHubSim } from './github-sim.js';
import { RepoReader } from './repo.js';
import { GitCommands } from './git-commands.js';
import { Shell } from './shell.js';

const GITHUB_OWNER = 'student';
const GITHUB_REPO = 'my-project';
const BASE_GITCONFIG = '[init]\n\tdefaultBranch = main\n';

export class LabSession {
  static #instance = null;

  /** 같은 탭 안에서는 하나의 실습 환경을 공유한다 */
  static async shared() {
    LabSession.#instance ??= LabSession.#create();
    return LabSession.#instance;
  }

  static async #create() {
    const session = new LabSession();
    session.engine = await GitEngine.create();
    session.vfs = new VirtualFS(session.engine.fs);
    session.github = new GitHubSim(session.engine, session.vfs);
    session.reader = new RepoReader(session.engine, session.vfs, session.github);
    session.git = new GitCommands(session);
    session.shell = new Shell({ vfs: session.vfs, git: session.git });
    await session.#seed();
    return session;
  }

  flags = {};
  /** 실행한 명령 기록: [{ args: string[], at: number }] */
  commandLog = [];
  #listeners = new Set();

  async #seed() {
    this.vfs.mkdirp(HOME);
    this.vfs.write(`${HOME}/.gitconfig`, BASE_GITCONFIG);
    await this.github.createRepo(GITHUB_OWNER, GITHUB_REPO);
    this.shell.cwd = HOME;
  }

  get githubUrl() {
    return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`;
  }

  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    this.#listeners.forEach((l) => l());
  }

  async run(input) {
    const result = await this.shell.run(input);
    const now = this.commandLog.length;
    result.commands.forEach((args, i) => this.commandLog.push({ args, at: now + i }));
    this.#notify();
    return result;
  }

  snapshot() {
    return this.reader.snapshot(this.shell.cwd);
  }

  /** 시나리오 실행용: 출력 없이 명령을 실행하고 실패하면 예외 */
  async #quiet(input, cwd) {
    const saved = this.shell.cwd;
    this.shell.cwd = cwd;
    try {
      const r = await this.shell.run(input);
      this.shell.history.pop();
      if (!r.ok) throw new Error(r.lines.map((l) => l.text).join('\n'));
    } finally {
      this.shell.cwd = saved;
    }
  }

  #ensureIdentityFor(repoDir) {
    const id = this.reader.identity(null);
    if (id.name && id.email) return;
    this.vfs.write(`${repoDir}/.git/config`, this.vfs.readOr(`${repoDir}/.git/config`, '') + '[user]\n\tname = 실습봇\n\temail = bot@example.com\n');
  }

  /** 미션 4: main과 feature/menu가 같은 줄을 다르게 바꾼 저장소 */
  async prepareConflict() {
    const dir = `${HOME}/conflict-lab`;
    if (this.vfs.exists(dir)) this.vfs.remove(dir);
    this.vfs.mkdirp(dir);
    await this.#quiet('git init', dir);
    this.#ensureIdentityFor(dir);
    const steps = [
      'echo "오늘의 점심 메뉴: 김치찌개" > menu.txt',
      'git add menu.txt && git commit -m "점심 메뉴 정하기"',
      'git switch -c feature/menu',
      'echo "오늘의 점심 메뉴: 돈가스" > menu.txt',
      'git commit -am "메뉴를 돈가스로 변경"',
      'git switch main',
      'echo "오늘의 점심 메뉴: 비빔밥" > menu.txt',
      'git commit -am "메뉴를 비빔밥으로 변경"',
    ];
    for (const step of steps) await this.#quiet(step, dir);
    this.shell.cwd = dir;
    this.#notify();
    return [
      { text: '✅ ~/conflict-lab 저장소를 만들고 이동했어요.', kind: 'ok' },
      { text: '   main 브랜치: 점심 메뉴를 "비빔밥"으로 변경', kind: 'info' },
      { text: '   feature/menu 브랜치: 같은 줄을 "돈가스"로 변경', kind: 'info' },
    ];
  }

  /** 미션 5: 동료가 같은 GitHub 저장소에 커밋을 push */
  async teammatePush() {
    const remote = this.github.toLocal(this.githubUrl);
    if (!this.reader.resolveRef(remote, 'refs/heads/main')) {
      return [{ text: '⚠️ GitHub 저장소가 아직 비어 있어요. 먼저 내 커밋을 git push 해 주세요.', kind: 'err' }];
    }
    const dir = '/teammate';
    if (this.vfs.exists(dir)) this.vfs.remove(dir);
    this.vfs.mkdirp(dir);
    await this.#quiet(`git clone ${this.githubUrl} work`, dir);
    const work = `${dir}/work`;
    this.vfs.write(`${work}/.git/config`, this.vfs.readOr(`${work}/.git/config`, '') + '[user]\n\tname = 김동료\n\temail = teammate@example.com\n');
    this.vfs.write(`${work}/TEAM.md`, '# 팀 규칙\n- 커밋 메시지는 한국어로 짧게 쓴다\n');
    await this.#quiet('git add TEAM.md && git commit -m "팀 규칙 문서 추가 (동료)" && git push', work);
    this.flags.teammatePushed = true;
    this.#notify();
    return [
      { text: '👥 김동료 님이 TEAM.md를 추가하고 GitHub에 push 했어요.', kind: 'ok' },
      { text: '   이제 GitHub의 main이 내 컴퓨터의 main보다 한 커밋 앞서 있습니다.', kind: 'info' },
    ];
  }
}
