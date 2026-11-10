/**
 * GitCommands — 학습자가 입력한 `git ...` 명령을 처리한다.
 *
 * - 실제 동작은 가능한 한 libgit2(wasm-git)에 위임한다.
 * - lg2 예제 CLI에 없는 명령(branch, switch, restore, rm, show, pull 등)과
 *   불친절한 출력(status, commit, log)은 실제 git과 같은 모양으로 보완한다.
 */
import { RepoReader } from './repo.js';
import { HOME } from './vfs.js';

const short = (sha) => (sha ? sha.slice(0, 7) : '');
const line = (text, kind = 'out') => ({ text, kind });
const STATUS_WORD = { A: 'new file', M: 'modified', D: 'deleted', R: 'renamed', T: 'typechange' };
const LG2_NOISE = [
  /^checkout started: /,
  /^checkout: /,
  /set up to track remote branch/,
  /^HEAD not found\. Creating first commit$/,
  /^error: reference 'refs\/heads\/[^']+' not found$/,
  /^Bad news:$/,
];

class GitError extends Error {}

/** 명령행 옵션을 간단히 분리: 플래그 Set + 위치 인자 + 값 옵션 */
function parseArgs(args, valueFlags = []) {
  const flags = new Set();
  const values = {};
  const positional = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) positional.push(a);
    else if (a === '--') afterDashDash = true;
    else if (valueFlags.includes(a)) values[a] = (values[a] ?? []).concat(args[++i] ?? '');
    else if (/^-\d+$/.test(a)) values['-n'] = [a.slice(1)];
    else if (a.startsWith('--') || (a.startsWith('-') && a.length > 1)) {
      if (!a.startsWith('--') && a.length > 2) {
        // 묶인 짧은 옵션(-am "msg"): 마지막 글자가 값 옵션이면 다음 인자를 값으로 사용
        const chars = [...a.slice(1)];
        const last = '-' + chars.at(-1);
        chars.slice(0, -1).forEach((ch) => flags.add('-' + ch));
        if (valueFlags.includes(last)) values[last] = (values[last] ?? []).concat(args[++i] ?? '');
        else flags.add(last);
      } else flags.add(a);
    } else positional.push(a);
  }
  return { flags, values, positional, afterDashDash };
}

export class GitCommands {
  constructor({ engine, vfs, reader, github }) {
    this.engine = engine;
    this.vfs = vfs;
    this.reader = reader;
    this.github = github;
    this.handlers = {
      help: this.help,
      init: this.init,
      config: this.config,
      status: this.status,
      add: this.add,
      commit: this.commit,
      log: this.log,
      show: this.show,
      diff: this.diff,
      branch: this.branch,
      switch: this.switch,
      checkout: this.checkout,
      merge: this.merge,
      restore: this.restore,
      reset: this.reset,
      revert: this.revert,
      rm: this.rm,
      remote: this.remote,
      push: this.push,
      fetch: this.fetch,
      pull: this.pull,
      clone: this.clone,
      tag: this.tag,
    };
  }

  /** @returns {Promise<{lines: object[], code: number, cwd?: string}>} */
  async execute(args, ctx) {
    const [sub, ...rest] = args;
    if (!sub || sub === '--help' || sub === '-h') return { lines: this.#helpLines(), code: 0 };
    if (sub === '--version') return { lines: [line('git version 2.x (libgit2 via WebAssembly)')], code: 0 };
    const handler = this.handlers[sub];
    if (!handler) {
      return {
        code: 1,
        lines: [
          line(`git: '${sub}' is not a git command. See 'git help'.`, 'err'),
          line('💡 이 실습 환경에서 지원하는 명령은 `git help` 로 확인할 수 있어요.', 'info'),
        ],
      };
    }
    try {
      const result = await handler.call(this, rest, ctx);
      return { code: 0, ...result };
    } catch (error) {
      if (error instanceof GitError) return { code: 1, lines: error.message.split('\n').map((t) => line(t, 'err')) };
      throw error;
    }
  }

  // ── 공통 도우미 ────────────────────────────────────────────

  #repo(ctx) {
    const root = this.reader.findRoot(ctx.cwd);
    if (!root) throw new GitError('fatal: not a git repository (or any of the parent directories): .git\n💡 먼저 `git init` 으로 저장소를 만들어 주세요.');
    return root;
  }

  async #lg2(args, cwd) {
    const result = await this.engine.run(args, { cwd });
    const lines = result.lines
      .filter((l) => !LG2_NOISE.some((re) => re.test(l.text)))
      .map((l) => line(l.text, l.kind === 'err' ? 'err' : 'out'));
    return { code: result.code, lines };
  }

  async #lg2OrThrow(args, cwd) {
    const r = await this.#lg2(args, cwd);
    const failed = r.code !== 0 || r.lines.some((l) => l.kind === 'err');
    if (failed) throw new GitError(r.lines.map((l) => l.text).join('\n') || `fatal: git ${args[0]} failed`);
    return r;
  }

  async #revParse(rev, cwd) {
    const r = await this.engine.run(['rev-parse', rev], { cwd });
    const out = r.lines.find((l) => l.kind === 'out' && /^[0-9a-f]{40}$/.test(l.text));
    return out?.text ?? null;
  }

  #decorations(gitdir) {
    const head = this.reader.readHead(gitdir);
    const map = new Map();
    const add = (sha, label) => map.set(sha, [...(map.get(sha) ?? []), label]);
    const branches = this.reader.readRefs(gitdir, 'refs/heads');
    if (head.detached && head.sha) add(head.sha, { text: 'HEAD', kind: 'head' });
    for (const [name, sha] of Object.entries(branches)) {
      const isHead = !head.detached && head.branch === name;
      add(sha, { text: isHead ? `HEAD -> ${name}` : name, kind: isHead ? 'head' : 'branch' });
    }
    for (const [name, sha] of Object.entries(this.reader.readRefs(gitdir, 'refs/remotes'))) add(sha, { text: name, kind: 'remote' });
    for (const [name, sha] of Object.entries(this.reader.readRefs(gitdir, 'refs/tags'))) add(sha, { text: `tag: ${name}`, kind: 'tag' });
    return map;
  }

  #colorDiff(lines) {
    return lines.map((l) => {
      if (l.kind === 'err') return l;
      if (/^(diff --git|index |--- |\+\+\+ )/.test(l.text)) return line(l.text, 'meta');
      if (l.text.startsWith('@@')) return line(l.text, 'hunk');
      if (l.text.startsWith('+')) return line(l.text, 'add');
      if (l.text.startsWith('-')) return line(l.text, 'del');
      return l;
    });
  }

  #requireIdentity(gitdir) {
    const id = this.reader.identity(gitdir);
    if (id.name && id.email) return id;
    throw new GitError(
      [
        'Author identity unknown',
        '',
        '*** Please tell me who you are.',
        '',
        'Run',
        '',
        '  git config --global user.email "you@example.com"',
        '  git config --global user.name "Your Name"',
        '',
        '💡 커밋에는 "누가" 만들었는지가 기록돼요. 위 두 명령을 먼저 실행해 주세요.',
      ].join('\n'),
    );
  }

  // ── 명령 구현 ──────────────────────────────────────────────

  #helpLines() {
    const rows = [
      ['시작', 'init · clone <url> · config --global user.name "이름"'],
      ['변경 기록', 'status [-s] · add <파일|.> · commit -m "메시지" [-a] · diff [--staged]'],
      ['기록 보기', 'log [--oneline] [--all] [-n N] · show [커밋]'],
      ['브랜치', 'branch [이름] [-d 이름] · switch [-c] <브랜치> · checkout [-b] <브랜치> · merge <브랜치> [--abort]'],
      ['이동', 'checkout <브랜치|커밋|HEAD~N> · checkout -- <파일> · switch main'],
      ['되돌리기', 'restore [--staged] <파일> · reset [--soft|--mixed|--hard] <커밋> · revert <커밋> · rm <파일>'],
      ['원격(GitHub)', 'clone <url> · remote add origin <url> · remote -v · push [-u origin <브랜치>] · fetch · pull · branch -a'],
      ['기타', 'tag <이름>'],
    ];
    return [
      line('사용 가능한 git 명령 (libgit2 WebAssembly 기반 실습 환경)', 'info'),
      ...rows.map(([k, v]) => line(`  ${k.padEnd(8, ' ')}  ${v}`)),
    ];
  }

  async help() {
    return { lines: this.#helpLines() };
  }

  async init(args, ctx) {
    const { positional, flags } = parseArgs(args);
    const target = this.vfs.resolve(positional[0] ?? '.', ctx.cwd);
    this.vfs.mkdirp(target);
    const reinit = this.vfs.isDir(`${target}/.git`);
    if (reinit) return { lines: [line(`Reinitialized existing Git repository in ${this.vfs.display(target)}/.git/`)] };
    await this.#lg2OrThrow(['init', ...(flags.has('--bare') ? ['--bare'] : []), '.'], target);
    return {
      lines: [
        line(`Initialized empty Git repository in ${this.vfs.display(target)}/.git/`, 'ok'),
        line('💡 숨김 폴더 .git 이 생겼어요. 이 폴더가 곧 "저장소"이고, 모든 기록이 여기에 쌓입니다. (ls -a 로 확인)', 'info'),
      ],
    };
  }

  async config(args, ctx) {
    const { flags, positional } = parseArgs(args);
    const global = flags.has('--global');
    const root = this.reader.findRoot(ctx.cwd);
    if (!global && !root) throw new GitError('fatal: not in a git directory\n💡 저장소 밖에서는 --global 옵션을 붙여 주세요.');
    const file = global ? `${HOME}/.gitconfig` : `${root.gitdir}/config`;

    if (flags.has('--list') || flags.has('-l')) {
      const lines = [];
      for (const [section, values] of Object.entries(this.reader.globalConfig())) {
        for (const [k, v] of Object.entries(values)) lines.push(line(`${section}.${k}=${v}`));
      }
      if (root) {
        for (const [section, values] of Object.entries(this.reader.config(root.gitdir))) {
          for (const [k, v] of Object.entries(values)) lines.push(line(`${section}.${k}=${v}`));
        }
      }
      return { lines };
    }

    const [key, ...valueParts] = positional;
    if (!key || !key.includes('.')) throw new GitError('usage: git config [--global] <section.key> [<value>]');
    const dot = key.lastIndexOf('.');
    const section = key.slice(0, dot).toLowerCase();
    const name = key.slice(dot + 1).toLowerCase();

    if (!valueParts.length) {
      const id = this.reader.identity(root?.gitdir);
      const value =
        section === 'user' && !global ? id[name] : this.reader[global ? 'globalConfig' : 'config'](root?.gitdir)?.[section]?.[name];
      return value ? { lines: [line(value)] } : { lines: [], code: 1 };
    }
    this.vfs.write(file, setIniValue(this.vfs.readOr(file, ''), section, name, valueParts.join(' ')));
    return { lines: [] };
  }

  async status(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags } = parseArgs(args);
    const st = await this.reader.status(workdir);
    if (flags.has('-s') || flags.has('--short') || flags.has('--porcelain')) {
      const lines = [
        ...st.conflicts.map((p) => line(`UU ${p}`, 'del')),
        ...mergeShort(st).map(({ x, y, path }) => line(`${x}${y} ${path}`, x !== ' ' ? 'add' : 'del')),
        ...st.untracked.map((p) => line(`?? ${p}`, 'del')),
      ];
      return { lines };
    }

    const head = this.reader.readHead(gitdir);
    const lines = [line(head.detached ? `HEAD detached at ${short(head.sha)}` : `On branch ${head.branch}`)];
    if (head.unborn) lines.push(line(''), line('No commits yet'));
    lines.push(...(await this.#trackingLines(gitdir, workdir, head)));
    if (this.reader.isMerging(gitdir)) {
      lines.push(line(''));
      if (st.conflicts.length) {
        lines.push(line('You have unmerged paths.'), line('  (fix conflicts and run "git commit")'), line('  (use "git merge --abort" to abort the merge)'));
      } else {
        lines.push(line('All conflicts fixed but you are still merging.'), line('  (use "git commit" to conclude merge)'));
      }
    }
    if (st.staged.length) {
      lines.push(line(''), line('Changes to be committed:'));
      lines.push(line(head.unborn ? '  (use "git rm --cached <file>..." to unstage)' : '  (use "git restore --staged <file>..." to unstage)', 'dim'));
      st.staged.forEach((e) => lines.push(line(`\t${((STATUS_WORD[e.code] ?? e.code) + ':').padEnd(12, ' ')}${e.path}`, 'add')));
    }
    if (st.conflicts.length) {
      lines.push(line(''), line('Unmerged paths:'), line('  (use "git add <file>..." to mark resolution)', 'dim'));
      st.conflicts.forEach((p) => lines.push(line(`\tboth modified:   ${p}`, 'del')));
    }
    if (st.unstaged.length) {
      lines.push(line(''), line('Changes not staged for commit:'));
      lines.push(line('  (use "git add <file>..." to update what will be committed)', 'dim'));
      lines.push(line('  (use "git restore <file>..." to discard changes in working directory)', 'dim'));
      st.unstaged.forEach((e) => lines.push(line(`\t${((STATUS_WORD[e.code] ?? e.code) + ':').padEnd(12, ' ')}${e.path}`, 'del')));
    }
    if (st.untracked.length) {
      lines.push(line(''), line('Untracked files:'), line('  (use "git add <file>..." to include in what will be committed)', 'dim'));
      st.untracked.forEach((p) => lines.push(line(`\t${p}`, 'del')));
    }
    const clean = !st.staged.length && !st.unstaged.length && !st.untracked.length && !st.conflicts.length;
    if (clean) {
      lines.push(line(''), line(head.unborn ? 'nothing to commit (create/copy files and use "git add" to track)' : 'nothing to commit, working tree clean'));
    } else if (!st.staged.length && !st.conflicts.length) {
      lines.push(line(''), line('no changes added to commit (use "git add" and/or "git commit -a")'));
    }
    return { lines };
  }

  async #trackingLines(gitdir, workdir, head) {
    if (head.detached || head.unborn) return [];
    const upstreamRef = `refs/remotes/origin/${head.branch}`;
    const upstream = this.reader.resolveRef(gitdir, upstreamRef);
    if (!upstream) return [];
    const ahead = await this.reader.countOnly(head.sha, upstream, workdir);
    const behind = await this.reader.countOnly(upstream, head.sha, workdir);
    const name = `origin/${head.branch}`;
    if (!ahead && !behind) return [line(`Your branch is up to date with '${name}'.`)];
    if (ahead && !behind) return [line(`Your branch is ahead of '${name}' by ${ahead} commit${ahead > 1 ? 's' : ''}.`), line('  (use "git push" to publish your local commits)', 'dim')];
    if (!ahead && behind) return [line(`Your branch is behind '${name}' by ${behind} commit${behind > 1 ? 's' : ''}, and can be fast-forwarded.`), line('  (use "git pull" to update your local branch)', 'dim')];
    return [line(`Your branch and '${name}' have diverged, and have ${ahead} and ${behind} different commits each, respectively.`), line('  (use "git pull" to merge the remote branch into yours)', 'dim')];
  }

  /** pathspec(파일/디렉터리/.)에 해당하는 변경 경로를 고른다 */
  #matchChanges(st, specs, workdir, cwd, { includeUntracked = true } = {}) {
    const changed = [
      ...st.unstaged.map((e) => e.path),
      ...st.conflicts,
      ...(includeUntracked ? st.untracked : []),
    ];
    const rels = specs.map((spec) => {
      const abs = this.vfs.resolve(spec, cwd);
      if (abs !== workdir && !abs.startsWith(workdir + '/')) throw new GitError(`fatal: ${spec}: '${spec}' is outside repository`);
      return abs === workdir ? '' : abs.slice(workdir.length + 1);
    });
    const picked = new Set();
    rels.forEach((rel, i) => {
      const hits = changed.filter((p) => rel === '' || p === rel || p.startsWith(rel + '/') || (p.endsWith('/') && rel.startsWith(p)));
      const exists = this.vfs.exists(rel ? `${workdir}/${rel}` : workdir);
      if (!hits.length && !exists && !st.staged.some((e) => e.path === rel)) {
        throw new GitError(`fatal: pathspec '${specs[i]}' did not match any files`);
      }
      hits.forEach((p) => picked.add(p));
    });
    return [...picked];
  }

  async add(args, ctx) {
    const { workdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    const all = flags.has('-A') || flags.has('--all');
    const update = flags.has('-u') || flags.has('--update');
    const specs = positional.length ? positional : all || update ? ['.'] : [];
    if (!specs.length) {
      return { code: 1, lines: [line('Nothing specified, nothing added.', 'err'), line("hint: Maybe you wanted to say 'git add .'?", 'info')] };
    }
    const st = await this.reader.status(workdir);
    const paths = this.#matchChanges(st, specs, workdir, ctx.cwd, { includeUntracked: !update });
    for (const p of paths) {
      // 디렉터리 단위 untracked(예: "src/")는 안의 파일을 하나씩 추가
      const files = p.endsWith('/') ? this.vfs.walkFiles(`${workdir}/${p.slice(0, -1)}`).map((f) => p + f) : [p];
      if (files.length) await this.#lg2OrThrow(['add', ...files], workdir);
    }
    return { lines: [] };
  }

  async commit(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, values } = parseArgs(args, ['-m', '--message']);
    const messages = [...(values['-m'] ?? []), ...(values['--message'] ?? [])];
    if (flags.has('--amend')) throw new GitError('💡 --amend 는 이 실습 환경에서 지원하지 않아요. 새 커밋을 하나 더 만들어 보세요.');
    if (!messages.length || !messages.join('').trim()) {
      throw new GitError('error: 커밋 메시지가 필요해요.\n💡 이 환경에는 편집기(vim)가 없으니 -m 옵션을 사용하세요: git commit -m "README 추가"');
    }
    this.#requireIdentity(gitdir);

    let st = await this.reader.status(workdir);
    if (flags.has('-a') || flags.has('--all')) {
      const tracked = st.unstaged.map((e) => e.path);
      if (tracked.length) await this.#lg2OrThrow(['add', ...tracked], workdir);
      st = await this.reader.status(workdir);
    }
    const merging = this.reader.isMerging(gitdir);
    if (st.conflicts.length) {
      throw new GitError(
        'error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use \'git add <file>\'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.',
      );
    }
    if (!st.staged.length && !merging) {
      const head = this.reader.readHead(gitdir);
      const hint = st.untracked.length || st.unstaged.length ? 'no changes added to commit (use "git add" and/or "git commit -a")' : 'nothing to commit, working tree clean';
      return { code: 1, lines: [line(`On branch ${head.branch ?? 'HEAD'}`), line(hint)] };
    }
    const wasUnborn = this.reader.readHead(gitdir).unborn;
    await this.#lg2OrThrow(['commit', '-m', messages.join('\n\n')], workdir);
    if (merging) ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE'].forEach((f) => this.vfs.exists(`${gitdir}/${f}`) && this.vfs.remove(`${gitdir}/${f}`));
    const head = this.reader.readHead(gitdir);
    const n = st.staged.length;
    return {
      lines: [
        line(`[${head.branch ?? 'detached HEAD'}${wasUnborn ? ' (root-commit)' : ''} ${short(head.sha)}] ${messages[0]}`, 'ok'),
        line(` ${n} file${n === 1 ? '' : 's'} changed${merging ? ' (merge commit)' : ''}`),
      ],
    };
  }

  async #resolveOrThrow(rev, cwd) {
    const sha = await this.#revParse(rev, cwd);
    if (!sha) throw new GitError(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.`);
    return sha;
  }

  async log(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, values, positional } = parseArgs(args, ['-n', '--max-count']);
    const head = this.reader.readHead(gitdir);
    if (head.unborn && !flags.has('--all')) {
      throw new GitError(`fatal: your current branch '${head.branch}' does not have any commits yet`);
    }
    const tips = [];
    if (flags.has('--all')) {
      tips.push(head.sha, ...Object.values(this.reader.readRefs(gitdir, 'refs/heads')), ...Object.values(this.reader.readRefs(gitdir, 'refs/remotes')));
    } else if (positional.length) {
      for (const rev of positional) tips.push(await this.#resolveOrThrow(rev, workdir));
    } else tips.push(head.sha);

    const commits = await this.reader.walk(tips, workdir);
    const order = RepoReader.topoOrder(commits);
    const limit = Number((values['-n'] ?? values['--max-count'] ?? [])[0] ?? Infinity);
    const deco = this.#decorations(gitdir);
    const oneline = flags.has('--oneline');
    const lines = [];
    if (flags.has('--graph')) lines.push(line('💡 그래프는 오른쪽 "저장소 시각화" 패널에서 더 보기 좋게 볼 수 있어요.', 'info'));
    for (const sha of order.slice(0, limit)) {
      const c = commits.get(sha);
      const labels = deco.get(sha);
      const decoText = labels ? ` (${labels.map((l) => l.text).join(', ')})` : '';
      if (oneline) {
        lines.push({ text: `${short(sha)}${decoText} ${c.message.split('\n')[0]}`, kind: 'out', parts: [
          { text: short(sha), kind: 'sha' },
          ...(labels ? [{ text: decoText, kind: 'deco' }] : []),
          { text: ' ' + c.message.split('\n')[0] },
        ] });
        continue;
      }
      lines.push({ text: `commit ${sha}${decoText}`, kind: 'out', parts: [{ text: `commit ${sha}`, kind: 'sha' }, ...(labels ? [{ text: decoText, kind: 'deco' }] : [])] });
      if (c.parents.length > 1) lines.push(line(`Merge: ${c.parents.map(short).join(' ')}`));
      lines.push(line(`Author: ${c.author} <${c.email}>`));
      lines.push(line(`Date:   ${formatDate(c.time)}`));
      lines.push(line(''));
      c.message.split('\n').forEach((m) => lines.push(line(`    ${m}`)));
      lines.push(line(''));
    }
    return { lines };
  }

  async show(args, ctx) {
    const { workdir } = this.#repo(ctx);
    const rev = parseArgs(args).positional[0] ?? 'HEAD';
    const sha = await this.#resolveOrThrow(rev, workdir);
    const c = await this.reader.commit(sha, workdir);
    const lines = [
      { text: `commit ${sha}`, kind: 'out', parts: [{ text: `commit ${sha}`, kind: 'sha' }] },
      line(`Author: ${c.author} <${c.email}>`),
      line(`Date:   ${formatDate(c.time)}`),
      line(''),
      ...c.message.split('\n').map((m) => line(`    ${m}`)),
      line(''),
    ];
    if (c.parents.length) {
      const parent = await this.reader.commit(c.parents[0], workdir);
      const diff = await this.#lg2(['diff', parent.tree, c.tree], workdir);
      lines.push(...this.#colorDiff(diff.lines));
    } else {
      lines.push(line('(첫 커밋이라 비교할 부모 커밋이 없어요)', 'dim'));
    }
    return { lines };
  }

  async diff(args, ctx) {
    const { workdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    const lgArgs = ['diff'];
    if (flags.has('--staged') || flags.has('--cached')) {
      if (this.reader.readHead(this.#repo(ctx).gitdir).unborn) {
        return { lines: [line('💡 첫 커밋 전에는 비교 기준(HEAD)이 없어요. 스테이징된 파일은 git status 로 확인하세요.', 'info')] };
      }
      lgArgs.push('--cached');
    }
    lgArgs.push(...positional);
    const r = await this.#lg2(lgArgs, workdir);
    if (!r.lines.length) {
      const hint = lgArgs.includes('--cached')
        ? '(스테이징된 변경이 없어요)'
        : '(작업 디렉터리와 스테이징 영역 사이에 차이가 없어요. 스테이징된 변경은 git diff --staged 로 확인)';
      return { lines: [line(hint, 'dim')] };
    }
    return { lines: this.#colorDiff(r.lines) };
  }

  async branch(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    const head = this.reader.readHead(gitdir);
    const branches = this.reader.readRefs(gitdir, 'refs/heads');

    if (flags.has('-d') || flags.has('-D') || flags.has('--delete')) {
      const name = positional[0];
      if (!name) throw new GitError('fatal: branch name required');
      if (!branches[name]) throw new GitError(`error: branch '${name}' not found.`);
      if (name === head.branch) throw new GitError(`error: Cannot delete branch '${name}' checked out at '${this.vfs.display(workdir)}'`);
      if (flags.has('-d') && head.sha) {
        const unmerged = await this.reader.countOnly(branches[name], head.sha, workdir);
        if (unmerged) {
          throw new GitError(`error: The branch '${name}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${name}'.`);
        }
      }
      this.vfs.remove(`${gitdir}/refs/heads/${name}`);
      return { lines: [line(`Deleted branch ${name} (was ${short(branches[name])}).`)] };
    }

    if (positional.length) {
      const [name, start] = positional;
      validateBranchName(name);
      if (branches[name]) throw new GitError(`fatal: a branch named '${name}' already exists`);
      const sha = start ? await this.#resolveOrThrow(start, workdir) : head.sha;
      if (!sha) throw new GitError(`fatal: not a valid object name: '${head.branch}'\n💡 브랜치는 커밋을 가리키는 이름표예요. 먼저 커밋을 하나 만들어 주세요.`);
      this.vfs.write(`${gitdir}/refs/heads/${name}`, sha + '\n');
      return { lines: [] };
    }

    const lines = [];
    const names = Object.keys(branches).sort();
    if (head.detached) lines.push(line(`* (HEAD detached at ${short(head.sha)})`, 'branch'));
    if (head.unborn && !names.length) return { lines: [] };
    for (const name of names) {
      const current = !head.detached && name === head.branch;
      const verbose = flags.has('-v') ? `  ${short(branches[name])} ${(await this.reader.commit(branches[name], workdir))?.message.split('\n')[0] ?? ''}` : '';
      lines.push(line(`${current ? '*' : ' '} ${name}${verbose}`, current ? 'branch' : 'out'));
    }
    if (flags.has('-a') || flags.has('-r')) {
      if (flags.has('-r')) lines.length = 0;
      for (const name of Object.keys(this.reader.readRefs(gitdir, 'refs/remotes')).sort()) lines.push(line(`  remotes/${name}`, 'remote'));
    }
    return { lines };
  }

  async #checkoutBranch(name, ctx, { create = false } = {}) {
    const { workdir, gitdir } = this.#repo(ctx);
    const head = this.reader.readHead(gitdir);
    const branches = this.reader.readRefs(gitdir, 'refs/heads');
    if (create) {
      validateBranchName(name);
      if (branches[name]) throw new GitError(`fatal: a branch named '${name}' already exists`);
      if (head.unborn) {
        this.vfs.write(`${gitdir}/HEAD`, `ref: refs/heads/${name}\n`);
        return { lines: [line(`Switched to a new branch '${name}'`, 'ok')] };
      }
      this.vfs.write(`${gitdir}/refs/heads/${name}`, head.sha + '\n');
      this.vfs.write(`${gitdir}/HEAD`, `ref: refs/heads/${name}\n`);
      return { lines: [line(`Switched to a new branch '${name}'`, 'ok')] };
    }
    if (name === head.branch && !head.detached) return { lines: [line(`Already on '${name}'`)] };
    if (!branches[name]) {
      const remoteSha = this.reader.resolveRef(gitdir, `refs/remotes/origin/${name}`);
      if (!remoteSha) {
        throw new GitError(`fatal: invalid reference: ${name}\n💡 브랜치 목록은 git branch 로 확인하고, 새 브랜치는 git switch -c ${name} 으로 만들어요.`);
      }
      // 원격에만 있는 브랜치 → 추적 브랜치를 만들어 전환 (실제 git의 DWIM 동작)
      this.vfs.write(`${gitdir}/refs/heads/${name}`, remoteSha + '\n');
    }
    if (this.reader.isMerging(gitdir)) throw new GitError('error: you need to resolve your current index first');
    const r = await this.#lg2(['checkout', name], workdir);
    if (r.code !== 0 || r.lines.some((l) => l.kind === 'err')) {
      throw new GitError(
        [...r.lines.map((l) => l.text), '💡 커밋하지 않은 변경 사항이 브랜치 전환과 충돌할 수 있어요. 먼저 commit 하거나 restore 로 되돌려 주세요.'].join('\n'),
      );
    }
    const msg = [line(`Switched to branch '${name}'`, 'ok')];
    if (!branches[name]) msg.push(line(`branch '${name}' set up to track 'origin/${name}'.`));
    return { lines: msg };
  }

  async switch(args, ctx) {
    const { flags, positional } = parseArgs(args);
    const name = positional[0];
    if (!name) throw new GitError('fatal: missing branch or commit argument');
    return this.#checkoutBranch(name, ctx, { create: flags.has('-c') || flags.has('--create') });
  }

  async checkout(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, positional, afterDashDash } = parseArgs(args);
    if (flags.has('-b')) {
      if (!positional[0]) throw new GitError("error: switch `b' requires a value");
      return this.#checkoutBranch(positional[0], ctx, { create: true });
    }
    const first = positional[0];
    if (!first) throw new GitError('💡 사용법: git checkout <브랜치> 또는 git checkout -- <파일>');
    const isBranch = !!this.reader.readRefs(gitdir, 'refs/heads')[first] || !!this.reader.resolveRef(gitdir, `refs/remotes/origin/${first}`);
    if (!afterDashDash && isBranch) return this.#checkoutBranch(first, ctx);
    // 브랜치도 파일도 아니면 커밋(해시·HEAD~2·태그 등)으로 해석 → detached HEAD
    const commitSha = !afterDashDash && !this.vfs.exists(this.vfs.resolve(first, ctx.cwd)) ? await this.#revParse(first, workdir) : null;
    if (commitSha) {
      if (this.reader.isMerging(gitdir)) throw new GitError('error: you need to resolve your current index first');
      const sha = commitSha;
      await this.#lg2OrThrow(['checkout', sha], workdir);
      this.vfs.write(`${gitdir}/HEAD`, sha + '\n');
      return {
        lines: [
          line(`Note: switching to '${first}'.`),
          line(''),
          line("You are in 'detached HEAD' state.", 'err'),
          line(`HEAD is now at ${short(sha)} ${(await this.reader.commit(sha, workdir))?.message.split('\n')[0] ?? ''}`),
          line('💡 HEAD가 브랜치가 아닌 커밋을 직접 가리키고 있어요(과거 구경 모드). 돌아가려면 git switch main', 'info'),
        ],
      };
    }
    return this.restore(positional, ctx);
  }

  async merge(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    if (flags.has('--abort')) {
      if (!this.reader.isMerging(gitdir)) throw new GitError('fatal: There is no merge to abort (MERGE_HEAD missing).');
      await this.#lg2OrThrow(['reset', '--hard', 'HEAD'], workdir);
      ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE'].forEach((f) => this.vfs.exists(`${gitdir}/${f}`) && this.vfs.remove(`${gitdir}/${f}`));
      return { lines: [line('병합을 취소하고 병합 전 상태로 돌아왔어요.', 'ok')] };
    }
    const target = positional[0];
    if (!target) throw new GitError('fatal: No remote for the current branch.\n💡 사용법: git merge <브랜치이름>');
    this.#requireIdentity(gitdir);
    const head = this.reader.readHead(gitdir);
    const theirs = await this.#resolveOrThrow(target, workdir);
    if (theirs === head.sha || !(await this.reader.countOnly(theirs, head.sha, workdir))) return { lines: [line('Already up to date.')] };
    const st = await this.reader.status(workdir);
    if (st.staged.length || st.unstaged.length) {
      throw new GitError('error: Your local changes would be overwritten by merge.\n💡 병합 전에 변경 사항을 commit 하거나 되돌려 주세요.');
    }
    const before = head.sha;
    const r = await this.#lg2(['merge', target], workdir);
    const text = r.lines.map((l) => l.text);
    if (text.some((t) => t.startsWith('conflict:'))) {
      const conflicts = (await this.reader.status(workdir)).conflicts;
      return {
        code: 1,
        lines: [
          ...conflicts.map((p) => line(`Auto-merging ${p}`)),
          ...conflicts.map((p) => line(`CONFLICT (content): Merge conflict in ${p}`, 'err')),
          line('Automatic merge failed; fix conflicts and then commit the result.', 'err'),
          line('💡 충돌 파일을 열어(edit 파일명) <<<<<<< ======= >>>>>>> 표시를 정리한 뒤 git add → git commit 하세요.', 'info'),
        ],
      };
    }
    if (text.includes('Fast-forward')) {
      const after = this.reader.readHead(gitdir).sha;
      return { lines: [line(`Updating ${short(before)}..${short(after)}`), line('Fast-forward', 'ok'), line('💡 main이 앞으로 "빨리 감기"만 했어요. 갈라진 적이 없어 병합 커밋이 필요 없었습니다.', 'info')] };
    }
    if (r.code !== 0 || r.lines.some((l) => l.kind === 'err')) throw new GitError(text.join('\n'));
    // 갈라진 브랜치의 깨끗한 병합 → 병합 커밋 생성
    if (this.reader.isMerging(gitdir)) {
      await this.#lg2OrThrow(['commit', '-m', `Merge branch '${target}' into ${head.branch}`], workdir);
      ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE'].forEach((f) => this.vfs.exists(`${gitdir}/${f}`) && this.vfs.remove(`${gitdir}/${f}`));
    }
    return { lines: [line(`Merge made by the 'ort' strategy.`, 'ok'), line('💡 두 갈래의 기록을 합친 "병합 커밋"이 만들어졌어요. 시각화 패널을 보세요.', 'info')] };
  }

  async restore(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    if (!positional.length) throw new GitError('fatal: you must specify path(s) to restore');
    if (flags.has('--staged') || flags.has('-S')) return this.#unstage(positional, ctx, workdir, gitdir);
    const st = await this.reader.status(workdir);
    const targets = this.#matchChanges(st, positional, workdir, ctx.cwd, { includeUntracked: false });
    if (targets.length) await this.#lg2OrThrow(['checkout', '--', ...targets], workdir);
    return { lines: [] };
  }

  /** git restore --staged: 인덱스만 HEAD로 되돌리고 작업 파일은 그대로 둔다 */
  async #unstage(specs, ctx, workdir, gitdir) {
    if (this.reader.readHead(gitdir).unborn) {
      throw new GitError('💡 아직 커밋이 없어 되돌릴 기준(HEAD)이 없어요. 첫 커밋 후에 사용해 보세요.');
    }
    const st = await this.reader.status(workdir);
    const rels = specs.map((s) => this.vfs.resolve(s, ctx.cwd)).map((abs) => (abs === workdir ? '' : abs.slice(workdir.length + 1)));
    const matches = (p) => rels.some((r) => r === '' || p === r || p.startsWith(r + '/'));
    const keepStaged = st.staged.filter((e) => !matches(e.path)).map((e) => e.path);
    // 인덱스 전체를 HEAD로 리셋(mixed) 후, 대상이 아닌 파일만 다시 스테이징
    await this.#lg2OrThrow(['reset', 'HEAD'], workdir);
    if (keepStaged.length) await this.#lg2OrThrow(['add', ...keepStaged], workdir);
    return { lines: [] };
  }

  async reset(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    const mode = ['--hard', '--soft', '--mixed'].find((m) => flags.has(m)) ?? '--mixed';
    const [first, ...others] = positional;
    // git reset <파일> / git reset HEAD <파일>
    const pathArgs = first === 'HEAD' ? others : first && !(await this.#revParse(first, workdir)) ? positional : [];
    if (pathArgs.length) return this.#unstage(pathArgs, ctx, workdir, gitdir);

    const rev = first ?? 'HEAD';
    const sha = await this.#resolveOrThrow(rev, workdir);
    await this.#lg2OrThrow(['reset', mode, sha], workdir);
    if (mode === '--hard') {
      ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE'].forEach((f) => this.vfs.exists(`${gitdir}/${f}`) && this.vfs.remove(`${gitdir}/${f}`));
      const c = await this.reader.commit(sha, workdir);
      return { lines: [line(`HEAD is now at ${short(sha)} ${c?.message.split('\n')[0] ?? ''}`)] };
    }
    const st = await this.reader.status(workdir);
    return { lines: st.unstaged.length ? [line('Unstaged changes after reset:'), ...st.unstaged.map((e) => line(`${e.code}\t${e.path}`))] : [] };
  }

  /**
   * git revert <커밋>: 그 커밋이 바꾼 내용을 거꾸로 적용한 "새 커밋"을 만든다.
   * lg2에 revert가 없어 파일 단위로 구현한다. 대상 커밋 이후 같은 파일이 다시 바뀌었으면
   * (3-way 병합이 필요한 경우) 안전하게 중단한다.
   */
  async revert(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    if (flags.has('--abort') || flags.has('--continue')) throw new GitError('💡 이 실습 환경의 revert는 충돌 없는 경우만 한 번에 처리해요. --abort/--continue 는 필요 없어요.');
    const rev = positional[0];
    if (!rev) throw new GitError('usage: git revert <commit>\n💡 예: git revert HEAD  (가장 최근 커밋을 되돌리는 새 커밋 만들기)');
    this.#requireIdentity(gitdir);
    const head = this.reader.readHead(gitdir);
    if (head.unborn) throw new GitError('fatal: bad revision \'HEAD\'');
    const st = await this.reader.status(workdir);
    if (st.staged.length || st.unstaged.length || this.reader.isMerging(gitdir)) {
      throw new GitError('error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.\n💡 먼저 변경 사항을 commit 하거나 restore 로 정리해 주세요.');
    }
    const sha = await this.#resolveOrThrow(rev, workdir);
    const target = await this.reader.commit(sha, workdir);
    if (target.parents.length > 1) throw new GitError(`error: commit ${short(sha)} is a merge but no -m option was given.\n💡 병합 커밋 되돌리기는 이 실습 환경에서 지원하지 않아요.`);
    if (!target.parents.length) throw new GitError('💡 첫 커밋(root commit)은 되돌릴 부모가 없어요. 다른 커밋으로 연습해 보세요.');
    const parent = target.parents[0];
    const changes = (await this.#lg2OrThrow(['diff', '--name-status', parent, sha], workdir)).lines
      .map((l) => l.text.split('\t'))
      .filter((parts) => parts.length === 2)
      .map(([, path]) => path);
    const plan = [];
    for (const path of changes) {
      const [current, after, before] = await Promise.all([this.#blob(head.sha, path, workdir), this.#blob(sha, path, workdir), this.#blob(parent, path, workdir)]);
      if (current !== after) {
        throw new GitError(
          [`error: could not revert ${short(sha)}... ${target.message.split('\n')[0]}`, `CONFLICT: ${path} 가 그 커밋 이후에 다시 수정되었어요.`, '💡 이 실습 환경에서는 충돌이 없는 revert만 지원해요. 가장 최근 커밋(HEAD)부터 되돌려 보세요.'].join('\n'),
        );
      }
      plan.push({ path, before });
    }
    for (const { path, before } of plan) {
      const abs = `${workdir}/${path}`;
      if (before === null) this.vfs.remove(abs);
      else this.vfs.write(abs, before);
      await this.#lg2OrThrow(['add', path], workdir);
    }
    const subject = target.message.split('\n')[0];
    await this.#lg2OrThrow(['commit', '-m', `Revert "${subject}"`], workdir);
    const after = this.reader.readHead(gitdir).sha;
    return {
      lines: [
        line(`[${head.branch ?? 'detached HEAD'} ${short(after)}] Revert "${subject}"`, 'ok'),
        line(` ${plan.length} file${plan.length === 1 ? '' : 's'} changed`),
        line('💡 기록을 지우지 않고 "되돌리는 새 커밋"을 쌓았어요. 이미 push 한 커밋은 reset 대신 revert 로 되돌립니다.', 'info'),
      ],
    };
  }

  /** 커밋 안의 파일 내용(없으면 null) */
  async #blob(sha, path, workdir) {
    const r = await this.engine.run(['cat-file', '-p', `${sha}:${path}`], { cwd: workdir });
    if (r.code !== 0 || r.lines.some((l) => l.kind === 'err')) return null;
    return r.lines.map((l) => l.text).join('\n') + '\n';
  }

  async rm(args, ctx) {
    const { workdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    if (!positional.length) throw new GitError('usage: git rm [--cached] [-r] <file>...');
    const lines = [];
    for (const spec of positional) {
      const abs = this.vfs.resolve(spec, ctx.cwd);
      const rel = abs.slice(workdir.length + 1);
      if (!this.vfs.exists(abs)) throw new GitError(`fatal: pathspec '${spec}' did not match any files`);
      const files = this.vfs.isDir(abs) ? this.vfs.walkFiles(abs).map((f) => `${rel}/${f}`) : [rel];
      if (this.vfs.isDir(abs) && !flags.has('-r')) throw new GitError(`fatal: not removing '${spec}' recursively without -r`);
      for (const f of files) {
        const fileAbs = `${workdir}/${f}`;
        const backup = flags.has('--cached') ? this.vfs.read(fileAbs) : null;
        this.vfs.remove(fileAbs);
        await this.#lg2OrThrow(['add', f], workdir);
        if (backup !== null) this.vfs.write(fileAbs, backup);
        lines.push(line(`rm '${f}'`));
      }
    }
    return { lines };
  }

  async remote(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { flags, positional } = parseArgs(args);
    const [action, name, url] = positional;
    if (!action) {
      return {
        lines: this.reader.remotes(gitdir).flatMap((r) =>
          flags.has('-v')
            ? [line(`${r.name}\t${this.github.toDisplay(r.url)} (fetch)`), line(`${r.name}\t${this.github.toDisplay(r.url)} (push)`)]
            : [line(r.name)],
        ),
      };
    }
    if (action === 'add') {
      if (!name || !url) throw new GitError('usage: git remote add <name> <url>');
      if (this.reader.remotes(gitdir).some((r) => r.name === name)) throw new GitError(`error: remote ${name} already exists.`);
      await this.#lg2OrThrow(['remote', 'add', name, this.github.toLocal(url)], workdir);
      const lines = [];
      if (this.github.isGitHubUrl(url) && !this.github.exists(this.github.toLocal(url))) {
        lines.push(line('⚠️ 가상 GitHub에 아직 이 저장소가 없어요. 실습 패널의 "가상 GitHub" 저장소 주소를 확인하세요.', 'info'));
      }
      return { lines };
    }
    if (action === 'remove' || action === 'rm') {
      if (!name) throw new GitError('usage: git remote remove <name>');
      await this.#lg2OrThrow(['remote', 'remove', name], workdir);
      return { lines: [] };
    }
    if (action === 'set-url') {
      if (!name || !url) throw new GitError('usage: git remote set-url <name> <newurl>');
      await this.#lg2OrThrow(['remote', 'set-url', name, this.github.toLocal(url)], workdir);
      return { lines: [] };
    }
    throw new GitError(`error: Unknown subcommand: ${action}`);
  }

  #originOrThrow(gitdir) {
    const origin = this.reader.remotes(gitdir).find((r) => r.name === 'origin');
    if (!origin) {
      throw new GitError("fatal: No configured push destination.\n💡 먼저 원격 저장소를 연결하세요: git remote add origin <GitHub 저장소 주소>");
    }
    if (!this.github.exists(origin.url)) {
      throw new GitError(`remote: Repository not found.\nfatal: repository '${this.github.toDisplay(origin.url)}' not found`);
    }
    return origin;
  }

  async push(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { positional } = parseArgs(args);
    const head = this.reader.readHead(gitdir);
    if (head.unborn) throw new GitError("error: src refspec main does not match any\n💡 push 할 커밋이 없어요. 먼저 commit 하세요.");
    if (head.detached) throw new GitError('fatal: You are not currently on a branch.');
    const [remoteName = 'origin', branchArg] = positional;
    if (remoteName !== 'origin') throw new GitError(`💡 이 실습 환경에서는 origin 원격만 지원해요.`);
    if (branchArg && branchArg !== head.branch) {
      throw new GitError(`💡 이 실습 환경에서는 현재 브랜치만 push 할 수 있어요. 먼저 git switch ${branchArg} 후 push 하세요.`);
    }
    const origin = this.#originOrThrow(gitdir);
    const remoteSha = this.reader.resolveRef(origin.url, `refs/heads/${head.branch}`);
    if (remoteSha && remoteSha !== head.sha && (await this.reader.countOnly(remoteSha, head.sha, workdir)) > 0) {
      throw new GitError(
        [
          ` ! [rejected]        ${head.branch} -> ${head.branch} (fetch first)`,
          `error: failed to push some refs to '${this.github.toDisplay(origin.url)}'`,
          'hint: Updates were rejected because the remote contains work that you do not',
          'hint: have locally. This is usually caused by another repository pushing to',
          "hint: the same ref. You may want to first integrate the remote changes",
          "hint: (e.g., 'git pull ...') before pushing again.",
          '💡 동료가 먼저 올린 커밋이 있어요. git pull 로 받아서 합친 뒤 다시 push 하세요.',
        ].join('\n'),
      );
    }
    if (remoteSha === head.sha) return { lines: [line('Everything up-to-date')] };
    await this.#lg2OrThrow(['push'], workdir);
    this.vfs.write(`${gitdir}/refs/remotes/origin/${head.branch}`, head.sha + '\n');
    return {
      lines: [
        line(`To ${this.github.toDisplay(origin.url)}`),
        line(`   ${remoteSha ? `${short(remoteSha)}..${short(head.sha)}` : '* [new branch]     '}  ${head.branch} -> ${head.branch}`, 'ok'),
        ...(remoteSha ? [] : [line(`branch '${head.branch}' set up to track 'origin/${head.branch}'.`)]),
      ],
    };
  }

  async fetch(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const origin = this.#originOrThrow(gitdir);
    const before = this.reader.readRefs(gitdir, 'refs/remotes/origin');
    await this.#lg2(['fetch', 'origin'], workdir);
    const after = this.reader.readRefs(gitdir, 'refs/remotes/origin');
    const lines = [];
    for (const [name, sha] of Object.entries(after)) {
      if (before[name] === sha) continue;
      lines.push(line(before[name] ? `   ${short(before[name])}..${short(sha)}  ${name.padEnd(10)} -> origin/${name}` : ` * [new branch]      ${name.padEnd(10)} -> origin/${name}`, 'ok'));
    }
    return { lines: lines.length ? [line(`From ${this.github.toDisplay(origin.url)}`), ...lines] : [] };
  }

  async pull(args, ctx) {
    const { gitdir } = this.#repo(ctx);
    const head = this.reader.readHead(gitdir);
    const fetched = await this.fetch([], ctx);
    if (!this.reader.resolveRef(gitdir, `refs/remotes/origin/${head.branch}`)) {
      return { code: 1, lines: [...fetched.lines, line(`There is no tracking information for the current branch. (origin/${head.branch} 없음)`, 'err')] };
    }
    if (head.unborn) {
      const sha = this.reader.resolveRef(gitdir, `refs/remotes/origin/${head.branch}`);
      this.vfs.write(`${gitdir}/refs/heads/${head.branch}`, sha + '\n');
      await this.#lg2OrThrow(['reset', '--hard', sha], this.reader.findRoot(ctx.cwd).workdir);
      return { lines: [...fetched.lines, line('Fast-forward', 'ok')] };
    }
    const merged = await this.merge([`origin/${head.branch}`], ctx);
    return { code: merged.code ?? 0, lines: [...fetched.lines, ...merged.lines] };
  }

  async clone(args, ctx) {
    const { positional } = parseArgs(args);
    const [url, dir] = positional;
    if (!url) throw new GitError('usage: git clone <repository> [<directory>]');
    const local = this.github.toLocal(url);
    if (!this.github.exists(local)) throw new GitError(`remote: Repository not found.\nfatal: repository '${url}' not found`);
    const name = dir ?? url.replace(/\/$/, '').split('/').pop().replace(/\.git$/, '');
    const target = this.vfs.resolve(name, ctx.cwd);
    if (this.vfs.exists(target) && this.vfs.list(target).length) {
      throw new GitError(`fatal: destination path '${name}' already exists and is not an empty directory.`);
    }
    const r = await this.engine.run(['clone', local, target], { cwd: ctx.cwd });
    if (!this.vfs.isDir(`${target}/.git`)) throw new GitError(r.lines.map((l) => l.text).join('\n') || 'fatal: clone failed');
    // 빈 저장소를 clone 하면 HEAD가 main을 가리키도록 맞춘다
    if (!this.reader.readHead(`${target}/.git`).sha) this.vfs.write(`${target}/.git/HEAD`, 'ref: refs/heads/main\n');
    return { lines: [line(`Cloning into '${name}'...`), line('done.', 'ok'), line(`💡 cd ${name} 로 들어가 보세요.`, 'info')] };
  }

  async tag(args, ctx) {
    const { workdir, gitdir } = this.#repo(ctx);
    const { positional } = parseArgs(args);
    if (!positional.length) return { lines: Object.keys(this.reader.readRefs(gitdir, 'refs/tags')).sort().map((t) => line(t)) };
    const [name, rev = 'HEAD'] = positional;
    const sha = await this.#resolveOrThrow(rev, workdir);
    this.vfs.write(`${gitdir}/refs/tags/${name}`, sha + '\n');
    return { lines: [] };
  }
}

function validateBranchName(name) {
  if (!name || /[\s~^:?*[\\]|\.\.|^-|\/$|\.lock$/.test(name)) throw new GitError(`fatal: '${name}' is not a valid branch name`);
}

function mergeShort(st) {
  const map = new Map();
  st.staged.forEach((e) => map.set(e.path, { x: e.code, y: ' ', path: e.path }));
  st.unstaged.forEach((e) => map.set(e.path, { x: map.get(e.path)?.x ?? ' ', y: e.code, path: e.path }));
  return [...map.values()];
}

function formatDate(epochSeconds) {
  return new Date(epochSeconds * 1000).toString().replace(/ \(.*\)$/, '');
}

/** INI 텍스트에 section.key = value 를 설정 (git config 파일 형식) */
export function setIniValue(text, section, key, value) {
  const [base, sub] = section.includes('.') ? [section.slice(0, section.indexOf('.')), section.slice(section.indexOf('.') + 1)] : [section, null];
  const header = sub ? `[${base} "${sub}"]` : `[${base}]`;
  const lines = (text ?? '').split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === header.toLowerCase());
  const entry = `\t${key} = ${value}`;
  if (start === -1) return `${text?.trimEnd() ? text.trimEnd() + '\n' : ''}${header}\n${entry}\n`;
  let end = start + 1;
  while (end < lines.length && !lines[end].trim().startsWith('[')) end++;
  const existing = lines.slice(start + 1, end).findIndex((l) => l.trim().toLowerCase().startsWith(key.toLowerCase() + ' ') || l.trim().toLowerCase().startsWith(key.toLowerCase() + '='));
  if (existing !== -1) lines[start + 1 + existing] = entry;
  else lines.splice(end, 0, entry);
  return lines.join('\n');
}
