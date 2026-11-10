/**
 * GitHubSim — 브라우저 안의 "가상 GitHub".
 *
 * 실제 네트워크 대신 WASM 파일시스템의 bare 저장소(/github/<owner>/<repo>.git)를
 * 원격 저장소로 사용한다. 학습자는 실제와 같은 https://github.com/... 주소를 입력하고,
 * 내부적으로만 로컬 경로로 변환된다.
 */
const ROOT = '/github';
const URL_PATTERN = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export class GitHubSim {
  constructor(engine, vfs) {
    this.engine = engine;
    this.vfs = vfs;
  }

  /** https://github.com/a/b.git → /github/a/b.git (그 외 주소는 그대로) */
  toLocal(url) {
    const match = URL_PATTERN.exec(url ?? '');
    return match ? `${ROOT}/${match[1]}/${match[2]}.git` : url;
  }

  /** /github/a/b.git → https://github.com/a/b.git */
  toDisplay(path) {
    if (!path?.startsWith(ROOT + '/')) return path;
    return 'https://github.com' + path.slice(ROOT.length);
  }

  isGitHubUrl(url) {
    return URL_PATTERN.test(url ?? '');
  }

  exists(localPath) {
    return this.vfs.isFile(`${localPath}/HEAD`);
  }

  /** GitHub에서 "New repository"를 누른 것과 같은 효과 */
  async createRepo(owner, name) {
    const path = `${ROOT}/${owner}/${name}.git`;
    if (this.exists(path)) return path;
    this.vfs.mkdirp(`${ROOT}/${owner}`);
    await this.engine.run(['init', '--bare', `${name}.git`], { cwd: `${ROOT}/${owner}` });
    this.vfs.write(`${path}/HEAD`, 'ref: refs/heads/main\n');
    return path;
  }

  /** 가상 GitHub에 있는 모든 저장소 경로 */
  listRepos() {
    if (!this.vfs.isDir(ROOT)) return [];
    const repos = [];
    for (const owner of this.vfs.list(ROOT)) {
      for (const repo of this.vfs.list(`${ROOT}/${owner}`)) {
        if (repo.endsWith('.git')) repos.push(`${ROOT}/${owner}/${repo}`);
      }
    }
    return repos;
  }
}
