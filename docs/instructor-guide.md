# 강사 가이드

## 사전 점검 (수업 전날)

- [ ] 사이트 배포 주소 접속, Git 실습실 미션 1~6을 한 번씩 끝까지 진행
- [ ] `templates/excel-dashboard/`를 새 공개 저장소에 복사해 Step 5까지 실제 실행 (GitHub-hosted Windows 이미지 변화 확인)
  - `scripts/` 테스트: `pip install openpyxl pytest && python -m pytest -q templates/excel-dashboard/tests`
- [ ] Claude Code 로그인 방식(구독/API 키) 안내 준비, 사내 프록시 환경이면 npm 설치 확인
- [ ] AI 리뷰 실습용 `ANTHROPIC_API_KEY` 발급 방침 결정 (개인 키 vs 강사 제공 키 — 강사 키는 수업 후 폐기)
- [ ] `docs/screenshots.md` 목록의 스크린샷 추가

## 진행 팁

- PART 1 실습실은 "시각화 패널을 보면서" 진행하도록 계속 강조한다. `git add` 순간 파일이 스테이징 칸으로 이동하는 장면이 핵심.
- 미션 4(충돌)는 대부분 처음 겪는다. `edit menu.txt` 편집기에서 충돌 표시 3줄을 지우는 걸 같이 시연.
- PART 2는 Step마다 커밋을 강제한다. Claude 결과가 꼬이면 `git restore .` / `git reset --hard`로 되돌리는 경험 자체가 학습이다.
- Step 5의 `xlwings 실패 → openpyxl 대체` 경고는 버그가 아니라 마지막 장의 복선임을 미리 말해 둔다.

## 자주 막히는 지점

| 증상 | 대응 |
| --- | --- |
| `gh auth login` 실패 | 브라우저 인증 방식 선택, 사내망이면 토큰 방식 |
| 이슈 템플릿이 안 보임 | 템플릿 파일이 기본 브랜치(main)에 push 되었는지 |
| 워크플로우 skipped | 제목 `[EXCEL]` 접두사, 작성자 권한(포크 계정으로 올렸는지) |
| Pages 404 | Settings → Pages 브랜치가 `docs`인지, 첫 배포 1~2분 대기 |
| AI 리뷰 댓글 없음 | Secret 이름 `ANTHROPIC_API_KEY`, 포크 PR이 아닌지 |
