# Git·GitHub 실전 입문 — 튜터 사이트

Git 개념이 아직 잡히지 않은 초보 개발자를 위한 웹 기반 튜터 사이트입니다. GitHub Pages로 그대로 서빙됩니다.

**사이트 주소:** https://jhl-labs.github.io/git-github-lesson/ (main 브랜치 루트를 Pages로 배포, 별도 워크플로우 없음)

- **PART 1 · Git** — 핵심 개념 + 브라우저 속 **진짜 Git(libgit2 → WebAssembly)** 실습실. 미션 6개(첫 커밋, 스테이징, 브랜치·병합, 충돌, 원격 push/pull, 되돌리기)를 저장소 상태로 자동 판정하고 작업 디렉터리·스테이징·커밋 그래프·가상 GitHub를 실시간으로 시각화합니다.
- **PART 2 · GitHub / Actions / Pages** — Claude Code 프롬프트(복사·붙여넣기)로 만드는 실전 프로젝트:
  이슈에 엑셀 첨부 → Windows runner + xlwings 변환 → `docs` 브랜치에 JSON 커밋 → Pages 대시보드(비밀번호 화면) + PR과 AI 코드 리뷰(`claude -p`, `opencode run`).
- **마무리 · 한계** — 로그인 우회/해시 무차별 대입 시연, 백엔드가 필요한 이유, Windows 순차 vs Linux 병렬 비교 계산기.

## 로컬 실행

```bash
python3 -m http.server 8000
# http://localhost:8000
```

`index.html`을 파일로 직접 열면 페이지 로딩(fetch)이 동작하지 않습니다.

## GitHub Pages 배포

Settings → Pages → Source: **Deploy from a branch**, Branch: `main` / `/(root)`. 빌드 단계가 없어 워크플로우가 필요 없습니다.

## 구조

```
index.html              앱 셸 (상단바, 목차)
pages/*.html            강의 본문 조각
assets/css/main.css     디자인 시스템
assets/js/app.js        라우팅·진행률·테마
assets/js/ui/           공통 컴포넌트(복사, 탭, 퀴즈, 체크리스트, 스크린샷 자리)
assets/js/lab/          Git 실습실 (엔진, 셸, git 명령 보완, 미션, 시각화)
assets/js/widgets/      해시 생성기, 로그인 우회, 무차별 대입, runner 비교
assets/vendor/wasm-git/ wasm-git 0.0.17 (libgit2, GPLv2 + linking exception)
templates/excel-dashboard/  실습 프로젝트 정답 예시 (워크플로우, 스크립트, 대시보드, 테스트, 샘플 엑셀)
demo/                   정답 예시 대시보드 미리보기 (비밀번호 gitpages2026)
docs/                   아키텍처 결정, 콘텐츠 작성 가이드, 스크린샷 목록, 강사 가이드
```

## 문서

- [아키텍처 결정 기록](docs/architecture.md)
- [콘텐츠 작성 가이드](docs/content-authoring.md) — 페이지·프롬프트·미션 추가 방법
- [스크린샷 자리 목록](docs/screenshots.md)
- [강사 가이드](docs/instructor-guide.md)
