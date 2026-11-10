/**
 * VirtualFS — Emscripten FS 위의 얇은 경로/파일 유틸.
 * 셸 명령, 저장소 조회, 편집기가 같은 규칙으로 파일을 다루도록 한 곳에 모은다.
 */
/** lg2(Emscripten)가 ~/.gitconfig 를 읽는 홈 디렉터리 */
export const HOME = '/home/web_user';

export class VirtualFS {
  constructor(fs) {
    this.fs = fs;
  }

  /** cwd 기준 상대 경로·`~`를 절대 경로로 정규화 */
  resolve(path, cwd = '/') {
    let raw = path ?? '';
    if (raw === '~' || raw.startsWith('~/')) raw = HOME + raw.slice(1);
    const base = raw.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
    for (const part of raw.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') base.pop();
      else base.push(part);
    }
    return '/' + base.join('/');
  }

  /** 사용자에게 보여줄 경로 (홈은 ~ 로 축약) */
  display(abs) {
    if (abs === HOME) return '~';
    return abs.startsWith(HOME + '/') ? '~' + abs.slice(HOME.length) : abs;
  }

  stat(abs) {
    try {
      return this.fs.stat(abs);
    } catch {
      return null;
    }
  }

  exists(abs) {
    return this.stat(abs) !== null;
  }

  isDir(abs) {
    const st = this.stat(abs);
    return !!st && this.fs.isDir(st.mode);
  }

  isFile(abs) {
    const st = this.stat(abs);
    return !!st && this.fs.isFile(st.mode);
  }

  read(abs) {
    return this.fs.readFile(abs, { encoding: 'utf8' });
  }

  readOr(abs, fallback = null) {
    try {
      return this.read(abs);
    } catch {
      return fallback;
    }
  }

  write(abs, text) {
    this.mkdirp(abs.slice(0, abs.lastIndexOf('/')) || '/');
    this.fs.writeFile(abs, text);
  }

  mkdirp(abs) {
    let current = '';
    for (const part of abs.split('/').filter(Boolean)) {
      current += '/' + part;
      if (!this.exists(current)) this.fs.mkdir(current);
    }
  }

  list(abs) {
    return this.fs.readdir(abs).filter((n) => n !== '.' && n !== '..').sort();
  }

  remove(abs) {
    if (this.isDir(abs)) {
      for (const name of this.list(abs)) this.remove(`${abs}/${name}`);
      this.fs.rmdir(abs);
    } else {
      this.fs.unlink(abs);
    }
  }

  /** 디렉터리 아래 모든 파일의 상대 경로 (.git 제외) */
  walkFiles(root, { skipGit = true } = {}) {
    const result = [];
    const visit = (dir, prefix) => {
      for (const name of this.list(dir)) {
        if (skipGit && name === '.git') continue;
        const abs = `${dir}/${name}`;
        const rel = prefix ? `${prefix}/${name}` : name;
        if (this.isDir(abs)) visit(abs, rel);
        else result.push(rel);
      }
    };
    if (this.isDir(root)) visit(root === '/' ? '' : root, '');
    return result;
  }
}
