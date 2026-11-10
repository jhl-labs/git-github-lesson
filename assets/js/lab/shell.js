/**
 * Shell — 터미널 한 줄을 해석해 셸 내장 명령 또는 git 으로 보낸다.
 * 지원: 따옴표, 리다이렉션(> >>), && 연결.
 */
import { HOME } from './vfs.js';

const line = (text, kind = 'out') => ({ text, kind });

/** "echo 'a b' > f.txt && git add ." → [[...tokens], ...] */
export function tokenize(input) {
  const commands = [[]];
  let token = '';
  let quote = null;
  let hasToken = false;
  const push = () => {
    if (hasToken) commands.at(-1).push(token);
    token = '';
    hasToken = false;
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < input.length) token += input[++i];
      else token += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (ch === ' ' || ch === '\t') push();
    else if (ch === '&' && input[i + 1] === '&') {
      push();
      commands.push([]);
      i++;
    } else if (ch === '>') {
      push();
      const op = input[i + 1] === '>' ? '>>' : '>';
      if (op === '>>') i++;
      commands.at(-1).push({ redirect: op });
    } else {
      token += ch;
      hasToken = true;
    }
  }
  if (quote) throw new Error('따옴표가 닫히지 않았어요.');
  push();
  return commands.filter((c) => c.length);
}

export class Shell {
  constructor({ vfs, git, onEdit, onClear }) {
    this.vfs = vfs;
    this.git = git;
    this.onEdit = onEdit;
    this.onClear = onClear;
    this.cwd = HOME;
    this.history = [];
    this.builtins = {
      help: this.help,
      pwd: () => [line(this.vfs.display(this.cwd))],
      ls: this.ls,
      cd: this.cd,
      cat: this.cat,
      echo: (args) => [line(args.join(' '))],
      touch: this.touch,
      mkdir: this.mkdir,
      rm: this.rm,
      mv: this.mv,
      tree: this.tree,
      edit: this.edit,
      code: this.edit,
      nano: this.edit,
      vim: this.edit,
      vi: this.edit,
      clear: () => {
        this.onClear?.();
        return [];
      },
      history: () => this.history.map((h, i) => line(`${String(i + 1).padStart(4)}  ${h}`)),
    };
  }

  /** @returns {Promise<{lines: object[], ok: boolean, commands: string[][]}>} */
  async run(input) {
    const trimmed = input.trim();
    if (!trimmed) return { lines: [], ok: true, commands: [] };
    this.history.push(trimmed);
    let commands;
    try {
      commands = tokenize(trimmed);
    } catch (e) {
      return { lines: [line(e.message, 'err')], ok: false, commands: [] };
    }
    const output = [];
    const executed = [];
    for (const tokens of commands) {
      const redirectIndex = tokens.findIndex((t) => typeof t === 'object');
      const args = (redirectIndex === -1 ? tokens : tokens.slice(0, redirectIndex)).filter((t) => typeof t === 'string');
      const redirect = redirectIndex === -1 ? null : { op: tokens[redirectIndex].redirect, file: tokens[redirectIndex + 1] };
      executed.push(args);
      const { lines, ok } = await this.#exec(args);
      if (redirect) {
        if (!redirect.file || typeof redirect.file !== 'string') {
          output.push(line('syntax error: 리다이렉션 뒤에 파일 이름이 필요해요.', 'err'));
          return { lines: output, ok: false, commands: executed };
        }
        const abs = this.vfs.resolve(redirect.file, this.cwd);
        const text = lines.filter((l) => l.kind !== 'err').map((l) => l.text).join('\n') + '\n';
        const before = redirect.op === '>>' ? this.vfs.readOr(abs, '') : '';
        this.vfs.write(abs, before + text);
        output.push(...lines.filter((l) => l.kind === 'err'));
      } else {
        output.push(...lines);
      }
      if (!ok) return { lines: output, ok: false, commands: executed };
    }
    return { lines: output, ok: true, commands: executed };
  }

  async #exec([cmd, ...args]) {
    if (cmd === 'git') {
      const result = await this.git.execute(args, { cwd: this.cwd });
      return { lines: result.lines, ok: result.code === 0 };
    }
    const builtin = this.builtins[cmd];
    if (!builtin) {
      return { ok: false, lines: [line(`${cmd}: command not found`, 'err'), line('💡 help 를 입력하면 사용할 수 있는 명령을 볼 수 있어요.', 'info')] };
    }
    try {
      return { lines: (await builtin.call(this, args)) ?? [], ok: true };
    } catch (e) {
      return { lines: [line(`${cmd}: ${e.message}`, 'err')], ok: false };
    }
  }

  #path(arg) {
    return this.vfs.resolve(arg, this.cwd);
  }

  help() {
    return [
      line('셸 명령', 'info'),
      line('  ls [-a]  cd <폴더>  pwd  cat <파일>  tree  mkdir <폴더>  touch <파일>  rm [-r] <파일>  mv <원본> <대상>  clear  history'),
      line('  echo "내용" > 파일   (덮어쓰기)        echo "내용" >> 파일   (이어쓰기)'),
      line('  edit <파일>          (편집기 창으로 파일 수정 — vim/nano/code 도 같은 동작)'),
      line(''),
      line('git 명령은 git help 로 확인하세요. 명령은 && 로 이어서 실행할 수 있어요.', 'info'),
    ];
  }

  ls(args) {
    const showAll = args.includes('-a') || args.includes('-la') || args.includes('-al');
    const targets = args.filter((a) => !a.startsWith('-'));
    const abs = this.#path(targets[0] ?? '.');
    if (!this.vfs.exists(abs)) throw new Error(`cannot access '${targets[0]}': No such file or directory`);
    if (!this.vfs.isDir(abs)) return [line(targets[0])];
    const names = this.vfs.list(abs).filter((n) => showAll || !n.startsWith('.'));
    if (!names.length) return [];
    return [
      {
        text: names.join('  '),
        kind: 'out',
        parts: names.flatMap((n, i) => [
          { text: n + (this.vfs.isDir(`${abs}/${n}`) ? '/' : ''), kind: this.vfs.isDir(`${abs}/${n}`) ? 'dir' : n.startsWith('.') ? 'dim' : undefined },
          ...(i < names.length - 1 ? [{ text: '  ' }] : []),
        ]),
      },
    ];
  }

  cd([target]) {
    const abs = this.#path(target ?? '~');
    if (!this.vfs.isDir(abs)) throw new Error(`${target}: No such file or directory`);
    this.cwd = abs;
    return [];
  }

  cat(args) {
    if (!args.length) throw new Error('파일 이름을 입력하세요');
    return args.flatMap((a) => {
      const abs = this.#path(a);
      if (this.vfs.isDir(abs)) throw new Error(`${a}: Is a directory`);
      const text = this.vfs.readOr(abs);
      if (text === null) throw new Error(`${a}: No such file or directory`);
      return text.replace(/\n$/, '').split('\n').map((t) => line(t, /^(<<<<<<<|=======|>>>>>>>)/.test(t) ? 'conflict' : 'out'));
    });
  }

  touch(args) {
    for (const a of args) {
      const abs = this.#path(a);
      if (!this.vfs.exists(abs)) this.vfs.write(abs, '');
    }
    return [];
  }

  mkdir(args) {
    for (const a of args.filter((x) => x !== '-p')) this.vfs.mkdirp(this.#path(a));
    return [];
  }

  rm(args) {
    const recursive = args.some((a) => /^-\w*r/.test(a));
    for (const a of args.filter((x) => !x.startsWith('-'))) {
      const abs = this.#path(a);
      if (!this.vfs.exists(abs)) throw new Error(`cannot remove '${a}': No such file or directory`);
      if (this.vfs.isDir(abs) && !recursive) throw new Error(`cannot remove '${a}': Is a directory`);
      if (abs.split('/').includes('.git') && !this.confirmGitDelete) {
        throw new Error('.git 폴더를 지우면 저장소의 모든 기록이 사라져요! 실습에서는 막아 두었습니다.');
      }
      this.vfs.remove(abs);
    }
    return [];
  }

  mv([from, to]) {
    if (!from || !to) throw new Error('usage: mv <원본> <대상>');
    const src = this.#path(from);
    let dst = this.#path(to);
    if (this.vfs.isDir(dst)) dst = `${dst}/${src.split('/').pop()}`;
    this.vfs.fs.rename(src, dst);
    return [];
  }

  tree([target]) {
    const root = this.#path(target ?? '.');
    const lines = [line('.', 'dir')];
    const visit = (dir, prefix) => {
      const names = this.vfs.list(dir).filter((n) => n !== '.git');
      names.forEach((name, i) => {
        const last = i === names.length - 1;
        const abs = `${dir}/${name}`;
        const isDir = this.vfs.isDir(abs);
        lines.push({ text: `${prefix}${last ? '└── ' : '├── '}${name}`, kind: 'out', parts: [{ text: `${prefix}${last ? '└── ' : '├── '}`, kind: 'dim' }, { text: name + (isDir ? '/' : ''), kind: isDir ? 'dir' : undefined }] });
        if (isDir) visit(abs, prefix + (last ? '    ' : '│   '));
      });
    };
    visit(root, '');
    return lines;
  }

  edit([file]) {
    if (!file) throw new Error('편집할 파일 이름을 입력하세요. 예: edit README.md');
    const abs = this.#path(file);
    if (this.vfs.isDir(abs)) throw new Error(`${file}: Is a directory`);
    this.onEdit?.(abs);
    return [line(`✏️  편집기에서 ${file} 을(를) 열었어요. 저장하면 터미널로 돌아옵니다.`, 'info')];
  }
}
