# 아키텍처 결정 기록 (ADR)

튜터 사이트를 만들며 내린 결정과 그 이유를 기록한다.

## ADR-1. 빌드 도구 없는 정적 SPA

- **결정**: `index.html` + ES 모듈(`assets/js`) + 페이지 조각(`pages/*.html`)을 해시 라우팅(`#/page-id`)으로 불러온다. 번들러·프레임워크 없음.
- **이유**: GitHub Pages에 "Deploy from a branch"만으로 서빙 가능(워크플로우·runner 불필요). 강사가 HTML만 고쳐 내용을 수정할 수 있다.
- **결과**: 로컬에서 `index.html`을 파일로 직접 열면 `fetch`가 막힌다 → `python3 -m http.server`로 실행해야 한다(README에 안내).

## ADR-2. Git 실습 엔진: wasm-git(libgit2 → WebAssembly)

- **결정**: `wasm-git@0.0.17`의 `lg2_async` 빌드를 `assets/vendor/wasm-git/`에 고정(vendoring)한다.
- **검토한 대안**
  - isomorphic-git: 순수 JS라 WASM 요구사항에 맞지 않고, CLI 형태가 아니다.
  - 명령 흉내(JS 시뮬레이터): 가볍지만 "진짜 Git"이 아니어서 객체·해시·충돌 동작을 재현하기 어렵다.
  - v86 등 리눅스 VM: 수십 MB, 초기 로딩이 너무 길다.
- **이유**: 실제 libgit2가 커밋 객체를 만들고 병합 충돌까지 계산한다. async 빌드라 Worker·COOP/COEP 헤더 없이 메인 스레드에서 동작한다(Pages는 커스텀 헤더 불가).
- **CDN이 아닌 vendoring 이유**: 교육장 네트워크 환경과 버전 고정. 라이선스(GPLv2 with linking exception)는 `COPYING`을 함께 배포.

## ADR-3. lg2 CLI 보완 계층(`git-commands.js`)

lg2는 libgit2 예제 CLI라 다음이 없거나 출력이 다르다. 실제 git과 같은 경험을 위해 어댑터에서 보완한다.

| 명령 | 처리 |
| --- | --- |
| `branch`, `switch`, `checkout -b` | `.git/refs/heads/*`, `HEAD` 파일을 직접 갱신 |
| `restore --staged`, `reset <파일>` | `reset HEAD`(mixed) 후 대상 외 스테이징 파일을 다시 `add` (근사치: 해당 파일의 "부분 스테이징" 상태는 보존되지 않음) |
| `rm`, `add -A/-u/.` | 삭제 후 `add <경로>`로 삭제를 스테이징 / porcelain 상태로 경로 확장 |
| `status`, `commit`, `log`, `merge` 출력 | 실제 git 문구로 재구성(ahead/behind, 충돌 안내, 데코레이션) |
| `pull` | `fetch` + `merge origin/<branch>` |
| `push <remote> <branch>` | lg2는 인자를 받지 않음 → 현재 브랜치만 허용, non-fast-forward는 사전 검사로 거부 |
| `show` | `cat-file` + 트리 간 `diff` |

- 확인된 lg2 특성: `init.defaultBranch` 지원, 로컬 경로 원격(clone/fetch/push) 지원, 충돌 시 `conflict: a:… o:… t:…` 출력 + `MERGE_HEAD` 생성.
- 홈 디렉터리는 Emscripten 기본값 `/home/web_user`(lg2가 `~/.gitconfig`를 읽는 위치). 화면에는 `~`로만 표시한다.

## ADR-4. 가상 GitHub

- `https://github.com/<owner>/<repo>.git` 주소를 `/github/<owner>/<repo>.git` bare 저장소로 매핑한다. 원격 설정에는 로컬 경로를 저장하고 화면 출력 시 다시 URL로 바꾼다.
- "동료 push"는 `/teammate`에 clone → 다른 작성자로 커밋 → push 하는 시나리오로 재현한다.

## ADR-5. 미션 판정은 상태 기반

- 각 미션 단계의 `check(state)`는 출력 문자열이 아니라 **저장소 스냅샷**(HEAD, refs, 커밋 그래프, porcelain status, 파일 목록)과 실행한 명령 기록을 본다. 사용자가 다른 방법으로 같은 결과를 만들어도 통과한다.
- 단계는 순서대로 판정하고 한 번 통과하면 유지한다(sticky). 미션 완료 여부만 localStorage에 저장한다(새로고침 시 파일시스템은 초기화되므로).

## ADR-6. 실습 프로젝트 설계

- **xlwings + windows-latest**: 요구사항(Excel 앱 기반 읽기, OS 선택 경험)을 따른다. GitHub-hosted Windows 이미지에 Excel이 없을 수 있으므로 `--engine auto`로 openpyxl 대체 + `::warning::`으로 사실을 드러낸다. 이 한계를 마지막 장의 교육 소재로 사용한다.
- **보안 기본값**: 이슈 본문/제목은 `env`로만 전달(스크립트 인젝션 방지), `author_association` 필터, 최소 `permissions`, 첨부 다운로드 도메인 허용 목록·크기 제한, 대시보드 출력은 `textContent`.
- **로그인 흉내**: SHA-256 해시 비교 + `sessionStorage`. 의도적으로 약한 구조이며, "한계" 장의 위젯으로 우회·역산을 직접 시연한다.
- **docs 브랜치 + Actions 배포**: `git worktree`로 main 작업 폴더를 건드리지 않고 orphan `docs` 브랜치에 커밋한다. 화면만 바뀔 때는 Linux runner(`deploy-dashboard.yml`)가 데이터는 유지한 채 반영한다.
  - **수정(ADR-10)**: 처음에는 Pages Source를 "Deploy from a branch(docs)"로 두었으나, GitHub 공식 문서상 *GITHUB_TOKEN으로 push한 커밋은 Pages 빌드를 트리거하지 않는다*. 봇의 데이터 커밋이 사이트에 반영되지 않는 결함이었다. Source를 **GitHub Actions**로 바꾸고, 재사용 워크플로우 `pages-deploy.yml`(docs 체크아웃 → upload-pages-artifact → deploy-pages, ubuntu)을 `excel-to-dashboard.yml`·`deploy-dashboard.yml`의 마지막 `deploy` job에서 호출한다. docs 브랜치는 배포 결과물·데이터 이력 보관소로 유지한다. PAT를 쓰는 대안은 비밀 관리 부담 때문에 택하지 않았다.
- `templates/excel-dashboard/`는 강사용 정답 예시이며, 이 저장소에서 워크플로우로 실행되지 않는다(루트 `.github`가 아님).

## ADR-7. 디자인 원칙

- Git의 세 공간과 원격에 고정 색을 부여해 이론 다이어그램·실습 시각화·배지에서 일관되게 사용: 작업 디렉터리(주황) · 스테이징(청록) · 저장소(남색) · GitHub(자홍).
- 라이트/다크 모드, 960px 이하 서랍형 목차, 640px 이하 단일 열. `prefers-reduced-motion` 존중.
- 스크린샷은 `figure.shot[data-src]`로 자리를 잡아두고, 파일이 없으면 경로가 적힌 자리표시를 보여준다.

## ADR-8. 넓은 화면(1920×1080) 레이아웃 보정

실제 배포 사이트를 1920×1080에서 점검하며 정한 규칙이다.

- **실습실은 "한 화면 작업대"**: 1501px 이상에서 미션·터미널·시각화 세 칸을 `clamp(540px, 100vh - 상단바 - 260px, 860px)` 높이로 고정하고 각 칸은 내부 스크롤만 한다. 이전에는 터미널이 `100vh` 높이의 sticky여서, 제목 아래(약 300px 지점)에서 시작하면 화면 밖으로 잘렸다. 1500px 이하는 기존(터미널 560px, 시각화 아래 배치)을 유지한다.
- 미션 패널은 다시 그릴 때 진행 중인 단계가 보이도록 **패널 내부만** 스크롤한다(`scrollIntoView`는 페이지 전체를 움직이므로 쓰지 않음).
- **본문 폭**: 1600px 이상에서 760px → 880px. 실습실 페이지(`.page-wide`)는 제외.
- **복사 버튼**은 언어 라벨처럼 코드 블록 윗 테두리에 걸친다. 코드 영역 위에 떠 있으면 긴 줄이 가로 스크롤될 때 버튼 밑으로 파고든다.
- **카드가 정확히 4개**면 4열(1180px 이하 2열, 640px 이하 1열)로 둬 3+1 고아 카드를 없앤다(`:has()` 사용).
- 히어로 장식 그래프는 본문 위에 겹치지 않도록 히어로 오른쪽에 전용 여백(250px)을 둔다. 640px 이하에서는 숨긴다.
- 복사 버튼 없는 `pre[data-nocopy]`(디렉터리 트리, 예시 JSON)도 배경·가로 스크롤을 갖는다.

## ADR-9. 실습실 미션 9개와 한 화면 작업대

- **미션 확장**: 사용자가 pull/push/fetch/branch/merge/reset/checkout/clone을 모두 실습할 수 있어야 한다는 요구에 따라 미션을 6개 → 9개로 늘렸다.
  - `checkout으로 오가기`: `branch 이름`(만들기만) · `checkout 브랜치` · `checkout -b` · `checkout HEAD~1`(detached HEAD) · `checkout -- 파일`.
  - `clone으로 팀 프로젝트 참여`: 동료 커밋이 있는 `team/web-app`을 clone → 기능 브랜치 `push -u` → 동료의 main push(버튼) → `fetch` → `merge origin/main` → push → main에 병합 후 push.
  - `reset 세 가지 모드`: `--soft`(스테이징에 남김) · `--mixed`(작업 디렉터리에 남김) · `--hard`(모두 버림).
  - `실수 되돌리기`의 마지막 단계는 `reset --hard` 대신 `revert`로 바꿨다. reset은 별도 미션에서 다루고, "push한 커밋은 revert"를 체득시키기 위함.
- **`git revert` 구현**: lg2에 없어서 `GitCommands.revert`로 구현했다. 대상 커밋이 바꾼 파일(`diff --name-status 부모 대상`)마다 현재 HEAD 내용이 대상 커밋 내용과 같으면 부모 버전으로 되돌리고(추가된 파일은 삭제), 하나라도 이후에 다시 바뀌었으면 3-way 병합이 필요하므로 **안전하게 중단**한다. 병합 커밋 revert(`-m`)는 지원하지 않는다.
- **`checkout <리비전>`**: 브랜치도 파일도 아니면 `rev-parse`로 해석해 `HEAD~2`, 태그, 해시 모두 detached HEAD로 이동한다.
- **porcelain 파서 버그 수정**: 추적 브랜치가 뒤처지면 lg2가 `# Your branch is ahead by …` 줄을 출력하는데, 이를 스테이징 항목으로 오인해 merge/pull이 "로컬 변경 있음"으로 막혔다. `#`로 시작하는 줄은 무시한다.
- **한 화면 작업대(1201px 이상)**: 미션 | 터미널 | (시각화 + 팁) 3열. 높이는 `lab.js`가 `innerHeight - 실습실 시작 위치`로 계산해 `--lab-h`에 넣는다(제목 높이가 바뀌어도 정확). 실습실 페이지는 제목·소개를 압축한다. 팁(명령 빠른 참조 칩 · 단축키 · 동작 원리)은 페이지 하단 표에서 오른쪽 칸 아래로 옮기고 접을 수 있게 했다(접힘 상태는 localStorage). 1201~1500px은 칸을 좁히고 팁 높이를 제한한다. 1200px 이하는 기존 세로 배치.
