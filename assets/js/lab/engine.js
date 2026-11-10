/**
 * GitEngine — wasm-git(libgit2 → WebAssembly) 래퍼.
 *
 * 책임: WASM 모듈 로딩, 명령 직렬 실행, 출력 캡처, 파일시스템(FS) 노출.
 * git 명령의 "의미"(출력 가공, 미지원 명령 보완)는 GitCommands(adapter.js)가 담당한다.
 */
const DEFAULT_MODULE_URL = new URL('../../vendor/wasm-git/lg2_async.js', import.meta.url).href;

export class GitEngine {
  #lg = null;
  #sink = null;
  #queue = Promise.resolve();

  /** @param {string} [moduleUrl] lg2_async.js 위치 (테스트에서 교체 가능) */
  static async create(moduleUrl = DEFAULT_MODULE_URL) {
    const engine = new GitEngine();
    const mod = await import(/* @vite-ignore */ moduleUrl);
    engine.#lg = await mod.default({
      print: (text) => engine.#sink?.push({ kind: 'out', text }),
      printErr: (text) => engine.#sink?.push({ kind: 'err', text }),
    });
    return engine;
  }

  /** Emscripten FS 객체 */
  get fs() {
    return this.#lg.FS;
  }

  /**
   * libgit2 예제 CLI(lg2)를 실행한다. 동시에 하나만 실행되도록 큐로 직렬화.
   * @param {string[]} args 예: ['commit', '-m', 'msg']
   * @param {{cwd?: string}} [opts]
   * @returns {Promise<{code: number, lines: {kind: 'out'|'err', text: string}[]}>}
   */
  run(args, { cwd } = {}) {
    const task = this.#queue.then(() => this.#runNow(args, cwd));
    this.#queue = task.catch(() => {});
    return task;
  }

  async #runNow(args, cwd) {
    const fs = this.fs;
    const previous = fs.cwd();
    const lines = [];
    let code = 0;
    this.#sink = lines;
    try {
      if (cwd) fs.chdir(cwd);
      code = await this.#lg.callMain(args);
    } catch (error) {
      code = 1;
      lines.push({ kind: 'err', text: String(error?.message ?? error) });
    } finally {
      this.#sink = null;
      try {
        fs.chdir(previous);
      } catch {
        fs.chdir('/');
      }
    }
    return { code: code ?? 0, lines };
  }
}
