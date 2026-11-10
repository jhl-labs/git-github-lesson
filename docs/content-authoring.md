# 콘텐츠 작성 가이드

## 페이지 추가·순서 변경

1. `pages/<id>.html`에 본문 조각을 작성한다(`<html>`, `<body>` 없이 `<h1>`부터).
2. `assets/js/course.js`의 `COURSE`에 `{ id, title, minutes }`를 추가한다. 넓은 화면이 필요하면 `wide: true`.

`<h2>`가 3개 이상이면 오른쪽 목차가 자동 생성된다.

## 마크업 규칙 (`assets/js/ui/enhance.js`)

| 요소 | 마크업 | 동작 |
| --- | --- | --- |
| 코드 블록 | `<pre data-lang="bash">` | 복사 버튼. 복사 버튼이 필요 없으면 `data-nocopy` |
| 프롬프트 | `<figure class="prompt-card"><figcaption>제목</figcaption><pre>…</pre></figure>` | "프롬프트 복사" 카드 |
| 스크린샷 | `<figure class="shot" data-src="assets/img/screens/x.png"><figcaption>설명</figcaption></figure>` | 이미지가 없으면 자리표시 |
| 탭 | `<div class="tabs"><section data-tab="이름">…</section></div>` | 키보드(←/→) 지원 |
| 체크리스트 | `<ul class="checklist" data-checklist="고유id"><li>…</li></ul>` | 체크 상태 저장 |
| 퀴즈 | `<div class="quiz" data-answer="b"><p class="quiz-q">…</p><div class="quiz-options"><button data-opt="a">…</button></div><p class="quiz-explain">…</p></div>` | 정답 시 해설 표시 |
| 콜아웃 | `<div class="callout callout-tip|warn|danger|vibe">` | |
| 단계 | `<ol class="steps"><li><strong>제목</strong> 설명</li></ol>` | 번호 타임라인 |
| Git 실습실 | `<div data-git-lab></div>` (`data-mission="branch"`로 시작 미션 지정 가능) | |
| 위젯 | `<div data-widget="hash-generator"></div>` | `assets/js/widgets/<이름>.js`의 `mount(node)` |
| 시작 전 이론 | `<section class="theory"><h2>📚 시작 전 이론: …</h2> … <dl class="theory-terms"><div><dt>용어</dt><dd>설명</dd></div></dl> … <div class="theory-check">셀프 체크</div></section>` | 각 Step 맨 위, lede 바로 아래 |

## Git 미션 추가

`assets/js/lab/missions.js`에 미션 객체를 추가한다. `check(state)`는 화면 출력이 아니라 상태를 보도록 작성한다.

- `state.snap.repo` — `head`, `branches`, `remoteBranches`, `commits`(Map), `status`(`staged`/`unstaged`/`untracked`/`conflicts`), `files`, `merging`, `remotes`
- `state.snap.github` — 가상 GitHub 저장소 목록과 브랜치
- `state.ran('git', 'merge')` — 미션 시작 이후 해당 명령 실행 여부
- `state.read(path)`, `state.flags`

시나리오 준비가 필요하면 `LabSession`에 메서드를 추가하고 미션의 `setup.action`에 이름을 적는다.
미션 도중 일어나는 외부 사건(예: 동료의 push)은 `extra: { label, action }`으로 버튼을 하나 더 둔다.

미션을 바꾼 뒤에는 Node로 전체 미션을 끝까지 실행해 모든 단계가 통과하는지 확인한다(각 단계의 `cmds`를 순서대로 실행하고 `check`를 평가).
