/**
 * 코스 구조(목차). 페이지 본문은 pages/<id>.html 에 있다.
 * 순서를 바꾸면 사이드바·이전/다음 버튼·진행률이 함께 바뀐다.
 */
export const COURSE = [
  {
    part: '시작하기',
    pages: [
      { id: 'home', title: '과정 소개', minutes: 5 },
      { id: 'setup', title: '준비물 체크', minutes: 10 },
    ],
  },
  {
    part: 'PART 1 · Git',
    pages: [
      { id: 'git-concepts', title: 'Git 핵심 개념', minutes: 20 },
      { id: 'git-lab', title: '인터랙티브 Git 실습실', minutes: 50, wide: true, badge: 'LAB' },
    ],
  },
  {
    part: 'PART 2 · GitHub 실전 프로젝트',
    pages: [
      { id: 'project', title: '오늘 만들 서비스', minutes: 10 },
      { id: 'github', title: 'Step 1 · GitHub 저장소와 Claude Code', minutes: 20 },
      { id: 'step-converter', title: 'Step 2 · 엑셀 → JSON 변환기', minutes: 20 },
      { id: 'step-actions', title: 'Step 3 · GitHub Actions 자동화', minutes: 30 },
      { id: 'step-pages', title: 'Step 4 · Pages 대시보드와 로그인', minutes: 30 },
      { id: 'step-run', title: 'Step 5 · 이슈로 엑셀 올려 전체 실행', minutes: 15 },
      { id: 'step-review', title: 'Step 6 · PR과 AI 코드 리뷰', minutes: 25 },
    ],
  },
  {
    part: '마무리',
    pages: [
      { id: 'limits', title: '한계와 다음 단계', minutes: 20, badge: '중요' },
      { id: 'cheatsheet', title: '치트시트 · 프롬프트 모음', minutes: 5 },
    ],
  },
];

export const PAGES = COURSE.flatMap((section) => section.pages.map((p) => ({ ...p, part: section.part })));

export function findPage(id) {
  return PAGES.find((p) => p.id === id) ?? null;
}

export function neighbors(id) {
  const i = PAGES.findIndex((p) => p.id === id);
  return { prev: PAGES[i - 1] ?? null, next: PAGES[i + 1] ?? null };
}
