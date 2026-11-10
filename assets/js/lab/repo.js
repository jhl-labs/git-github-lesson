/**
 * RepoReader — .git 디렉터리와 lg2 출력을 읽어 저장소 상태를 구조화한다.
 * (읽기 전용: 상태를 바꾸는 일은 GitCommands가 담당)
 */
import { HOME } from './vfs.js';

const NOISE = [/^error: reference 'refs\/heads\/[^']+' not found$/];

export function parseIni(text) {
  const sections = {};
  let current = null;
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[([^\s\]"]+)(?:\s+"([^"]*)")?\]$/.exec(line);
    if (header) {
      current = header[2] !== undefined ? `${header[1].toLowerCase()}.${header[2]}` : header[1].toLowerCase();
      sections[current] ??= {};
      continue;
    }
    const kv = /^([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (kv && current) sections[current][kv[1].toLowerCase()] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return sections;
}

export function parsePorcelain(lines) {
  const result = { staged: [], unstaged: [], untracked: [], conflicts: [] };
  for (const line of lines) {
    const conflict = /^conflict: a:(\S+)/.exec(line) ?? /^conflict: [ot]:(\S+)/.exec(line);
    if (conflict) {
      if (!result.conflicts.includes(conflict[1])) result.conflicts.push(conflict[1]);
      continue;
    }
    // lg2가 덧붙이는 추적 브랜치 안내(# Your branch is ahead by …)는 파일 항목이 아니다
    if (line.length < 4 || line.startsWith('#')) continue;
    const x = line[0];
    const y = line[1];
    let path = line.slice(3);
    if (path.includes(' -> ')) path = path.split(' -> ')[1];
    if (x === '?' && y === '?') {
      result.untracked.push(path);
      continue;
    }
    if (x !== ' ') result.staged.push({ code: x, path });
    if (y !== ' ') result.unstaged.push({ code: y, path });
  }
  // 충돌 파일은 스테이징/수정 목록에서 따로 보여준다
  const isConflict = (e) => result.conflicts.includes(e.path);
  result.staged = result.staged.filter((e) => !isConflict(e));
  result.unstaged = result.unstaged.filter((e) => !isConflict(e));
  return result;
}

export class RepoReader {
  #commitCache = new Map();

  constructor(engine, vfs, github) {
    this.engine = engine;
    this.vfs = vfs;
    this.github = github;
  }

  /** cwd에서 위로 올라가며 작업 디렉터리 루트를 찾는다 */
  findRoot(cwd) {
    let dir = cwd;
    while (true) {
      if (this.vfs.isDir(`${dir}/.git`)) return { workdir: dir, gitdir: `${dir}/.git` };
      if (dir === '/' || !dir) return null;
      dir = dir.slice(0, dir.lastIndexOf('/')) || '/';
    }
  }

  readHead(gitdir) {
    const text = (this.vfs.readOr(`${gitdir}/HEAD`, '') ?? '').trim();
    if (text.startsWith('ref: ')) {
      const ref = text.slice(5);
      const sha = this.resolveRef(gitdir, ref);
      return { ref, branch: ref.replace(/^refs\/heads\//, ''), sha, detached: false, unborn: !sha };
    }
    return { ref: null, branch: null, sha: text || null, detached: true, unborn: !text };
  }

  #packedRefs(gitdir) {
    const refs = {};
    for (const line of (this.vfs.readOr(`${gitdir}/packed-refs`, '') ?? '').split('\n')) {
      const m = /^([0-9a-f]{40}) (refs\/\S+)$/.exec(line.trim());
      if (m) refs[m[2]] = m[1];
    }
    return refs;
  }

  resolveRef(gitdir, ref) {
    const loose = this.vfs.readOr(`${gitdir}/${ref}`);
    if (loose) {
      const t = loose.trim();
      return t.startsWith('ref: ') ? this.resolveRef(gitdir, t.slice(5)) : t;
    }
    return this.#packedRefs(gitdir)[ref] ?? null;
  }

  /** prefix(예: refs/heads) 아래의 ref → sha 목록 */
  readRefs(gitdir, prefix) {
    const refs = {};
    for (const [ref, sha] of Object.entries(this.#packedRefs(gitdir))) {
      if (ref.startsWith(prefix + '/')) refs[ref.slice(prefix.length + 1)] = sha;
    }
    const base = `${gitdir}/${prefix}`;
    for (const rel of this.vfs.walkFiles(base, { skipGit: false })) {
      const text = (this.vfs.readOr(`${base}/${rel}`, '') ?? '').trim();
      if (/^[0-9a-f]{40}$/.test(text)) refs[rel] = text;
    }
    return refs;
  }

  config(gitdir) {
    return parseIni(this.vfs.readOr(`${gitdir}/config`, ''));
  }

  globalConfig() {
    return parseIni(this.vfs.readOr(`${HOME}/.gitconfig`, ''));
  }

  identity(gitdir) {
    const local = gitdir ? this.config(gitdir).user ?? {} : {};
    const global = this.globalConfig().user ?? {};
    return { name: local.name ?? global.name ?? null, email: local.email ?? global.email ?? null };
  }

  remotes(gitdir) {
    const cfg = this.config(gitdir);
    return Object.entries(cfg)
      .filter(([key]) => key.startsWith('remote.'))
      .map(([key, value]) => ({ name: key.slice(7), url: value.url ?? '' }));
  }

  isMerging(gitdir) {
    return this.vfs.exists(`${gitdir}/MERGE_HEAD`);
  }

  /** 커밋 객체 조회 (sha는 불변이므로 캐시) */
  async commit(sha, cwd) {
    if (this.#commitCache.has(sha)) return this.#commitCache.get(sha);
    const { code, lines } = await this.engine.run(['cat-file', '-p', sha], { cwd });
    if (code !== 0) return null;
    const out = lines.filter((l) => l.kind === 'out').map((l) => l.text);
    const commit = { sha, parents: [], tree: null, author: '', email: '', time: 0, message: '' };
    let i = 0;
    for (; i < out.length && out[i] !== ''; i++) {
      const [key, ...rest] = out[i].split(' ');
      const value = rest.join(' ');
      if (key === 'tree') commit.tree = value;
      else if (key === 'parent') commit.parents.push(value);
      else if (key === 'author') {
        const m = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(value);
        if (m) Object.assign(commit, { author: m[1], email: m[2], time: Number(m[3]), tz: m[4] });
      }
    }
    commit.message = out.slice(i + 1).join('\n').trim();
    if (!commit.tree) return null;
    this.#commitCache.set(sha, commit);
    return commit;
  }

  /** 여러 시작점에서 도달 가능한 커밋을 모두 모은다 */
  async walk(tips, cwd, limit = 300) {
    const commits = new Map();
    const stack = [...new Set(tips.filter(Boolean))];
    while (stack.length && commits.size < limit) {
      const sha = stack.pop();
      if (commits.has(sha)) continue;
      const c = await this.commit(sha, cwd);
      if (!c) continue;
      commits.set(sha, c);
      stack.push(...c.parents);
    }
    return commits;
  }

  /** 최신 → 과거 순으로 위상 정렬 (자식이 항상 부모보다 앞) */
  static topoOrder(commits) {
    const childCount = new Map([...commits.keys()].map((s) => [s, 0]));
    for (const c of commits.values()) {
      for (const p of c.parents) if (childCount.has(p)) childCount.set(p, childCount.get(p) + 1);
    }
    const ready = [...commits.values()].filter((c) => childCount.get(c.sha) === 0);
    const order = [];
    while (ready.length) {
      ready.sort((a, b) => b.time - a.time || (a.sha < b.sha ? 1 : -1));
      const c = ready.shift();
      order.push(c.sha);
      for (const p of c.parents) {
        if (!childCount.has(p)) continue;
        childCount.set(p, childCount.get(p) - 1);
        if (childCount.get(p) === 0) ready.push(commits.get(p));
      }
    }
    return order;
  }

  async status(workdir) {
    const { lines } = await this.engine.run(['status', '--porcelain'], { cwd: workdir });
    const text = lines
      .map((l) => l.text)
      .filter((t) => !NOISE.some((re) => re.test(t)));
    return parsePorcelain(text);
  }

  /** a에서만 도달 가능한 커밋 수 (ahead/behind 계산용) */
  async countOnly(a, b, cwd) {
    if (!a) return 0;
    const fromA = await this.walk([a], cwd);
    const fromB = b ? await this.walk([b], cwd) : new Map();
    let n = 0;
    for (const sha of fromA.keys()) if (!fromB.has(sha)) n++;
    return n;
  }

  /** 시각화·미션 판정에 쓰는 전체 스냅샷 */
  async snapshot(cwd) {
    const root = this.findRoot(cwd);
    const github = await this.#githubSnapshot();
    const identity = this.identity(root?.gitdir);
    if (!root) return { cwd, repo: null, github, identity };

    const { workdir, gitdir } = root;
    const head = this.readHead(gitdir);
    const branches = this.readRefs(gitdir, 'refs/heads');
    const remoteBranches = this.readRefs(gitdir, 'refs/remotes');
    const tags = this.readRefs(gitdir, 'refs/tags');
    const tips = [head.sha, ...Object.values(branches), ...Object.values(remoteBranches), ...Object.values(tags)];
    const commits = await this.walk(tips, workdir);
    const status = await this.status(workdir);
    return {
      cwd,
      github,
      identity,
      repo: {
        workdir,
        gitdir,
        head,
        branches,
        remoteBranches,
        tags,
        commits,
        order: RepoReader.topoOrder(commits),
        status,
        merging: this.isMerging(gitdir),
        files: this.vfs.walkFiles(workdir),
        remotes: this.remotes(gitdir).map((r) => ({ ...r, display: this.github.toDisplay(r.url) })),
        identity: this.identity(gitdir),
      },
    };
  }

  async #githubSnapshot() {
    const repos = [];
    for (const path of this.github.listRepos()) {
      const branches = this.readRefs(path, 'refs/heads');
      const commits = await this.walk(Object.values(branches), path);
      repos.push({ path, url: this.github.toDisplay(path), branches, commits, order: RepoReader.topoOrder(commits) });
    }
    return repos;
  }
}
