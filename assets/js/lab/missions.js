/**
 * 미션 정의 (데이터). 각 단계의 check(state)는 저장소 스냅샷만 보고 판정한다.
 *
 * state = {
 *   snap:   RepoReader.snapshot() 결과,
 *   ran(...words): 해당 명령을 실행한 적이 있는지 (예: ran('git','status')),
 *   read(path): 홈 기준 파일 읽기,
 *   flags:  세션 이벤트 (예: teammatePushed)
 * }
 */

const repo = (s) => s.snap.repo;
const inProject = (s, name = 'my-project') => !!repo(s) && repo(s).workdir.endsWith('/' + name);
const commitCount = (s) => repo(s)?.commits.size ?? 0;
const headCommit = (s) => repo(s)?.commits.get(repo(s).head.sha);
const otherBranches = (s) => Object.keys(repo(s)?.branches ?? {}).filter((b) => b !== 'main');
const ghRepo = (s, name = 'my-project') => s.snap.github.find((r) => r.url.endsWith(`/${name}.git`));

/** a 커밋이 b의 조상(또는 같음)인지 */
function isAncestor(commits, a, b) {
  if (!a || !b) return false;
  const stack = [b];
  const seen = new Set();
  while (stack.length) {
    const sha = stack.pop();
    if (sha === a) return true;
    if (seen.has(sha)) continue;
    seen.add(sha);
    stack.push(...(commits.get(sha)?.parents ?? []));
  }
  return false;
}

export const MISSIONS = [
  {
    id: 'first-commit',
    title: '첫 저장소, 첫 커밋',
    summary: '저장소를 만들고 파일 하나를 "작업 → 스테이징 → 커밋" 3단계로 기록합니다.',
    concepts: ['저장소(Repository)', '작업 디렉터리', '스테이징 영역', '커밋'],
    steps: [
      {
        text: 'Git에게 <b>내가 누구인지</b> 알려줍니다. 모든 커밋에 이 이름과 이메일이 기록돼요.',
        cmds: ['git config --global user.name "홍길동"', 'git config --global user.email "hong@example.com"'],
        check: (s) => !!s.snap.identity.name && !!s.snap.identity.email,
      },
      {
        text: '프로젝트 폴더를 만들고 그 안으로 들어갑니다.',
        cmds: ['mkdir my-project', 'cd my-project'],
        check: (s) => s.snap.cwd.endsWith('/my-project'),
      },
      {
        text: '이 폴더를 Git 저장소로 만듭니다. 숨김 폴더 <code>.git</code>이 생기는 것을 확인해 보세요.',
        cmds: ['git init', 'ls -a'],
        check: (s) => inProject(s),
      },
      {
        text: '파일을 하나 만듭니다. 오른쪽 <b>작업 디렉터리</b>에 파일이 나타나요.',
        cmds: ['echo "# 나의 첫 프로젝트" > README.md'],
        check: (s) => inProject(s) && repo(s).files.includes('README.md'),
      },
      {
        text: '<code>git status</code>로 현재 상태를 봅니다. README.md가 <b>Untracked</b>(아직 Git이 모르는 파일)로 보여요.',
        cmds: ['git status'],
        check: (s) => inProject(s) && s.ran('git', 'status'),
      },
      {
        text: '커밋할 파일을 <b>스테이징 영역</b>에 올립니다. "이번 기록에 이 파일을 포함할게요"라는 뜻이에요.',
        cmds: ['git add README.md', 'git status'],
        check: (s) => inProject(s) && (repo(s).status.staged.some((e) => e.path === 'README.md') || commitCount(s) > 0),
      },
      {
        text: '스테이징된 내용을 <b>커밋</b>으로 저장합니다. 메시지는 "무엇을 왜 바꿨는지" 짧게 적어요.',
        cmds: ['git commit -m "README 추가"'],
        check: (s) => inProject(s) && commitCount(s) >= 1,
      },
      {
        text: '<code>git log</code>로 기록을 확인합니다. 커밋마다 고유한 ID(해시)가 붙어 있어요.',
        cmds: ['git log', 'git log --oneline'],
        check: (s) => inProject(s) && commitCount(s) >= 1 && s.ran('git', 'log'),
      },
    ],
  },
  {
    id: 'staging',
    title: '변경 추적과 선택적 스테이징',
    summary: '무엇이 바뀌었는지 diff로 보고, 원하는 파일만 골라 커밋합니다. 비밀 파일은 .gitignore로 제외해요.',
    concepts: ['diff', '선택적 add', '.gitignore'],
    requires: 'first-commit',
    steps: [
      {
        text: '미션 1의 저장소에서 README.md에 한 줄을 <b>이어서</b> 씁니다. (<code>&gt;&gt;</code>는 이어쓰기)',
        cmds: ['cd ~/my-project', 'echo "Git 연습 중입니다" >> README.md'],
        check: (s) => inProject(s) && repo(s).status.unstaged.some((e) => e.path === 'README.md'),
      },
      {
        text: '<code>git diff</code>로 <b>무엇이 바뀌었는지</b> 확인합니다. 초록색 <code>+</code>가 추가된 줄이에요.',
        cmds: ['git diff'],
        check: (s) => inProject(s) && s.ran('git', 'diff'),
      },
      {
        text: '파일 두 개를 더 만듭니다. 하나는 <b>절대 올리면 안 되는</b> 비밀 파일이에요.',
        cmds: ['echo "console.log(\'hello\')" > app.js', 'echo "DB_PASSWORD=1234" > secret.env'],
        check: (s) => inProject(s) && repo(s).files.includes('app.js') && repo(s).files.includes('secret.env'),
      },
      {
        text: '<b>원하는 파일만</b> 골라 스테이징합니다. secret.env는 빼고요!',
        cmds: ['git add README.md app.js', 'git status'],
        check: (s) => {
          if (!inProject(s)) return false;
          const staged = repo(s).status.staged.map((e) => e.path);
          return staged.includes('README.md') && staged.includes('app.js') && !staged.includes('secret.env');
        },
      },
      {
        text: '<code>git diff --staged</code>는 "커밋될 내용"을 보여줍니다. 그리고 커밋!',
        cmds: ['git diff --staged', 'git commit -m "앱 시작 파일 추가"'],
        check: (s) => inProject(s) && commitCount(s) >= 2 && repo(s).status.untracked.includes('secret.env'),
      },
      {
        text: '<code>.gitignore</code>에 비밀 파일을 적으면 Git이 아예 무시합니다. status에서 secret.env가 사라지는지 보세요.',
        cmds: ['echo "secret.env" > .gitignore', 'git status', 'git add .gitignore', 'git commit -m "비밀 파일 무시 설정"'],
        check: (s) =>
          inProject(s) &&
          !repo(s).status.untracked.includes('secret.env') &&
          !repo(s).status.untracked.includes('.gitignore') &&
          !repo(s).status.staged.some((e) => e.path === '.gitignore') &&
          repo(s).files.includes('.gitignore'),
      },
    ],
  },
  {
    id: 'branch',
    title: '브랜치와 병합',
    summary: 'main을 건드리지 않고 새 기능을 브랜치에서 만든 뒤, 완성되면 main에 합칩니다.',
    concepts: ['브랜치', 'HEAD', 'switch', 'merge'],
    requires: 'first-commit',
    steps: [
      {
        text: '현재 브랜치 목록을 봅니다. <code>*</code> 표시가 지금 있는 브랜치(HEAD)예요.',
        cmds: ['cd ~/my-project', 'git branch'],
        check: (s) => inProject(s) && s.ran('git', 'branch'),
      },
      {
        text: '새 브랜치를 만들고 바로 이동합니다. 시각화에서 <b>HEAD</b>가 옮겨가는 것을 보세요.',
        cmds: ['git switch -c feature/greeting'],
        check: (s) => inProject(s) && otherBranches(s).length > 0 && repo(s).head.branch !== 'main',
      },
      {
        text: '브랜치에서 작업하고 커밋합니다. main은 그대로이고 이 브랜치만 앞으로 나아가요.',
        cmds: ['echo "안녕하세요!" > hello.txt', 'git add hello.txt', 'git commit -m "인사말 추가"'],
        check: (s) =>
          inProject(s) &&
          otherBranches(s).some((b) => repo(s).branches[b] !== repo(s).branches.main && isAncestor(repo(s).commits, repo(s).branches.main, repo(s).branches[b])),
      },
      {
        text: 'main으로 돌아갑니다. <code>ls</code>를 해보면 hello.txt가 <b>사라져</b> 있어요. (지워진 게 아니라 다른 브랜치에 있을 뿐!)',
        cmds: ['git switch main', 'ls'],
        check: (s) => inProject(s) && repo(s).head.branch === 'main' && otherBranches(s).length > 0,
      },
      {
        text: '브랜치의 작업을 main으로 <b>병합</b>합니다.',
        cmds: ['git merge feature/greeting', 'git log --oneline'],
        check: (s) =>
          inProject(s) &&
          s.ran('git', 'merge') &&
          otherBranches(s).some((b) => isAncestor(repo(s).commits, repo(s).branches[b], repo(s).branches.main) && repo(s).branches[b] !== undefined),
      },
      {
        text: '다 쓴 브랜치는 정리합니다. (병합된 브랜치만 <code>-d</code>로 지울 수 있어요)',
        cmds: ['git branch -d feature/greeting', 'git branch'],
        check: (s) => inProject(s) && s.ran('git', 'branch', '-d') && otherBranches(s).length === 0,
      },
    ],
  },
  {
    id: 'checkout',
    title: 'checkout으로 오가기',
    summary: 'checkout 하나로 브랜치 이동, 새 브랜치 만들기, 과거 커밋 구경, 파일 되살리기를 모두 해 봅니다. (요즘은 switch/restore로 나눠 쓰지만 checkout도 꼭 읽을 줄 알아야 해요)',
    concepts: ['checkout', 'checkout -b', 'detached HEAD', 'checkout --'],
    requires: 'first-commit',
    steps: [
      {
        text: '연습용 커밋을 하나 더 쌓아 둡니다. (과거로 가 볼 커밋이 필요해요)',
        cmds: ['cd ~/my-project', 'echo "- checkout 연습" >> README.md', 'git commit -am "checkout 연습 준비"'],
        check: (s) => inProject(s) && commitCount(s) >= 2 && [...repo(s).commits.values()].some((c) => c.message.includes('checkout 연습')),
      },
      {
        text: '<code>git branch 이름</code>은 브랜치를 <b>만들기만</b> 하고 이동하지 않아요. 프롬프트의 (main)이 그대로인지 보세요.',
        cmds: ['git branch experiment', 'git branch'],
        check: (s) => inProject(s) && !!repo(s).branches.experiment && repo(s).head.branch === 'main',
      },
      {
        text: '<code>git checkout 브랜치</code>로 이동합니다. (= <code>git switch experiment</code>)',
        cmds: ['git checkout experiment'],
        check: (s) => inProject(s) && repo(s).head.branch === 'experiment' && s.ran('git', 'checkout', 'experiment'),
      },
      {
        text: '<code>checkout -b</code>는 "만들고 바로 이동"을 한 번에 합니다. (= <code>git switch -c</code>)',
        cmds: ['git checkout -b hotfix', 'git branch'],
        check: (s) => inProject(s) && repo(s).head.branch === 'hotfix' && s.ran('git', 'checkout', '-b'),
      },
      {
        text: '커밋 하나 전으로 <b>시간 여행</b>을 해 봅니다. <code>HEAD~1</code>은 "지금보다 한 커밋 전"이에요. 브랜치가 아닌 커밋에 서 있는 이 상태를 <b>detached HEAD</b>라고 불러요.',
        cmds: ['git checkout main', 'git checkout HEAD~1', 'cat README.md', 'git status'],
        check: (s) => inProject(s) && repo(s).head.detached,
      },
      {
        text: '구경이 끝났으면 브랜치로 돌아옵니다. (detached 상태에서 만든 커밋은 브랜치가 없어 잃어버리기 쉬워요)',
        cmds: ['git switch main', 'cat README.md'],
        check: (s) => inProject(s) && !repo(s).head.detached && repo(s).head.branch === 'main',
      },
      {
        text: '<code>git checkout -- 파일</code>은 수정한 파일을 마지막 커밋 상태로 되돌려요. (= <code>git restore 파일</code>)',
        cmds: ['echo "망가뜨림" > README.md', 'git checkout -- README.md', 'cat README.md'],
        check: (s) => inProject(s) && s.ran('git', 'checkout', '--') && !repo(s).status.unstaged.some((e) => e.path === 'README.md'),
      },
      {
        text: '연습용 브랜치를 정리합니다.',
        cmds: ['git branch -d experiment', 'git branch -d hotfix', 'git branch'],
        check: (s) => inProject(s) && !repo(s).branches.experiment && !repo(s).branches.hotfix,
      },
    ],
  },
  {
    id: 'conflict',
    title: '충돌(Conflict) 해결',
    summary: '두 브랜치가 같은 줄을 다르게 고쳤을 때 Git은 사람에게 결정을 맡깁니다. 직접 해결해 봐요.',
    concepts: ['merge conflict', '충돌 표시', '해결 후 커밋'],
    setup: { label: '충돌 실습 저장소 준비하기', action: 'prepareConflict' },
    steps: [
      {
        text: '위의 <b>"충돌 실습 저장소 준비하기"</b> 버튼을 누르세요. main과 feature/menu가 같은 줄을 서로 다르게 고친 저장소가 만들어집니다.',
        cmds: [],
        check: (s) => inProject(s, 'conflict-lab'),
      },
      {
        text: '두 브랜치의 기록이 <b>갈라진</b> 모습을 확인합니다.',
        cmds: ['git log --oneline --all', 'cat menu.txt'],
        check: (s) => inProject(s, 'conflict-lab') && s.ran('git', 'log'),
      },
      {
        text: '병합을 시도합니다. <b>CONFLICT</b> 메시지가 나오면 정상이에요!',
        cmds: ['git merge feature/menu'],
        check: (s) => inProject(s, 'conflict-lab') && (repo(s).merging || (headCommit(s)?.parents.length ?? 0) > 1),
      },
      {
        text: '파일을 열어 보면 <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> ~ <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> 사이에 양쪽 내용이 모두 들어 있어요. 편집기에서 <b>남길 내용만</b> 남기고 표시줄은 지운 뒤 저장하세요.',
        cmds: ['cat menu.txt', 'edit menu.txt'],
        check: (s) => {
          if (!inProject(s, 'conflict-lab')) return false;
          const text = s.read(`${repo(s).workdir}/menu.txt`) ?? '';
          return !/^(<<<<<<<|=======|>>>>>>>)/m.test(text) && (repo(s).merging || (headCommit(s)?.parents.length ?? 0) > 1);
        },
      },
      {
        text: '해결한 파일을 <code>git add</code>로 "해결 완료" 표시합니다.',
        cmds: ['git add menu.txt', 'git status'],
        check: (s) => inProject(s, 'conflict-lab') && repo(s).status.conflicts.length === 0 && (repo(s).merging || (headCommit(s)?.parents.length ?? 0) > 1),
      },
      {
        text: '병합 커밋으로 마무리합니다. 시각화에서 두 갈래가 하나로 합쳐지는 것을 확인하세요.',
        cmds: ['git commit -m "메뉴 충돌 해결"', 'git log --oneline'],
        check: (s) => inProject(s, 'conflict-lab') && (headCommit(s)?.parents.length ?? 0) > 1,
      },
    ],
  },
  {
    id: 'remote',
    title: '원격 저장소(GitHub)와 협업',
    summary: '내 컴퓨터의 기록을 GitHub에 올리고(push), 동료의 작업을 받아(pull) 합칩니다.',
    concepts: ['remote', 'push', 'fetch', 'pull', 'clone'],
    requires: 'first-commit',
    extra: { label: '👥 동료가 push 하기', action: 'teammatePush' },
    steps: [
      {
        text: '이 실습에는 <b>가상 GitHub</b>에 빈 저장소 <code>https://github.com/student/my-project.git</code>가 미리 만들어져 있어요. 내 저장소로 이동하세요.',
        cmds: ['cd ~/my-project', 'git log --oneline'],
        check: (s) => inProject(s) && commitCount(s) >= 1,
      },
      {
        text: '원격 저장소를 <b>origin</b>이라는 별명으로 연결합니다.',
        cmds: ['git remote add origin https://github.com/student/my-project.git', 'git remote -v'],
        check: (s) => inProject(s) && repo(s).remotes.some((r) => r.name === 'origin'),
      },
      {
        text: '내 커밋을 GitHub에 <b>올립니다</b>. 오른쪽 "GitHub" 영역에 커밋이 나타나요.',
        cmds: ['git push -u origin main'],
        check: (s) => inProject(s) && !!ghRepo(s)?.branches.main && isAncestor(repo(s).commits, ghRepo(s).branches.main, repo(s).head.sha),
      },
      {
        text: '이제 동료가 같은 저장소에 커밋을 올렸다고 해봅시다. 위의 <b>"동료가 push 하기"</b> 버튼을 누르세요.',
        cmds: [],
        check: (s) => !!s.flags.teammatePushed,
      },
      {
        text: '<code>git status</code>는 아직 "up to date"라고 해요. 내 컴퓨터가 GitHub 소식을 모르기 때문! <code>git fetch</code>로 소식만 받아옵니다.',
        cmds: ['git status', 'git fetch', 'git status'],
        check: (s) => inProject(s) && !!s.flags.teammatePushed && repo(s).remoteBranches['origin/main'] === ghRepo(s)?.branches.main,
      },
      {
        text: '<code>git pull</code> = fetch + merge. 동료의 커밋을 내 main에 합칩니다.',
        cmds: ['git pull', 'git log --oneline', 'ls'],
        check: (s) => inProject(s) && !!s.flags.teammatePushed && isAncestor(repo(s).commits, ghRepo(s)?.branches.main, repo(s).branches.main),
      },
      {
        text: '내 변경도 만들어서 다시 올려 봅시다.',
        cmds: ['echo "- pull 후 push 성공" >> README.md', 'git commit -am "협업 기록 추가"', 'git push'],
        check: (s) => inProject(s) && !!s.flags.teammatePushed && s.ran('git', 'commit') && ghRepo(s)?.branches.main === repo(s).branches.main && commitCount(s) >= 4,
      },
      {
        text: '새 컴퓨터에서 처음 받을 때는 <code>git clone</code>을 씁니다. 원격의 전체 기록이 통째로 복사돼요.',
        cmds: ['cd ~', 'git clone https://github.com/student/my-project.git my-project-copy', 'cd my-project-copy', 'git log --oneline'],
        check: (s) => inProject(s, 'my-project-copy'),
      },
    ],
  },
  {
    id: 'team',
    title: 'clone으로 팀 프로젝트 참여',
    summary: '이미 GitHub에 있는 팀 저장소를 clone 해서, 내 브랜치를 push 하고, 동료의 변경을 fetch·merge 하는 실제 협업 흐름을 연습합니다.',
    concepts: ['clone', 'branch -a', 'push -u origin 브랜치', 'fetch', 'merge origin/main'],
    setup: { label: '팀 저장소 준비하기', action: 'prepareTeamRepo' },
    extra: { label: '👥 동료가 main에 push', action: 'teamMainPush' },
    steps: [
      {
        text: '위의 <b>"팀 저장소 준비하기"</b>를 누른 뒤, 팀 저장소를 <b>clone</b> 합니다. 원격의 모든 기록과 브랜치 정보가 통째로 복사돼요.',
        cmds: ['cd ~', 'git clone https://github.com/team/web-app.git', 'cd web-app', 'git log --oneline'],
        check: (s) => inProject(s, 'web-app') && commitCount(s) >= 2,
      },
      {
        text: 'clone 하면 <b>origin</b>이 자동으로 연결되고, 원격 브랜치는 <code>origin/main</code>처럼 보여요.',
        cmds: ['git remote -v', 'git branch -a'],
        check: (s) => inProject(s, 'web-app') && s.ran('git', 'branch', '-a'),
      },
      {
        text: 'main에 바로 커밋하지 않고 <b>내 기능 브랜치</b>에서 작업합니다.',
        cmds: ['git switch -c feature/about', 'echo "회사 소개 페이지" > about.html', 'git add about.html', 'git commit -m "소개 페이지 추가"'],
        check: (s) => inProject(s, 'web-app') && repo(s).head.branch === 'feature/about' && repo(s).branches['feature/about'] !== repo(s).branches.main,
      },
      {
        text: '내 브랜치를 GitHub에 올립니다. <code>-u</code>는 "앞으로 이 브랜치는 origin의 같은 브랜치와 짝"이라는 뜻이에요. (실무에서는 이 다음에 PR을 만들어요)',
        cmds: ['git push -u origin feature/about', 'git branch -a'],
        check: (s) => inProject(s, 'web-app') && !!ghRepo(s, 'web-app')?.branches['feature/about'] && ghRepo(s, 'web-app').branches['feature/about'] === repo(s).branches['feature/about'],
      },
      {
        text: '그 사이 동료가 main에 새 커밋을 올렸다고 해 봅시다. 위의 <b>"동료가 main에 push"</b> 버튼을 누르세요.',
        cmds: [],
        check: (s) => !!s.flags.teamMainPushed,
      },
      {
        text: '<code>git fetch</code>는 원격 소식만 받아 <code>origin/main</code>을 갱신해요. 내 파일과 브랜치는 그대로! 시각화에서 갈라진 기록을 확인하세요.',
        cmds: ['git fetch', 'git log --oneline --all'],
        check: (s) => inProject(s, 'web-app') && !!s.flags.teamMainPushed && repo(s).remoteBranches['origin/main'] === ghRepo(s, 'web-app')?.branches.main,
      },
      {
        text: '받아 온 <code>origin/main</code>을 내 브랜치에 합쳐 최신 상태를 따라잡습니다. (<code>git pull origin main</code>과 같은 효과)',
        cmds: ['git merge origin/main', 'ls'],
        check: (s) => inProject(s, 'web-app') && repo(s).head.branch === 'feature/about' && isAncestor(repo(s).commits, ghRepo(s, 'web-app')?.branches.main, repo(s).branches['feature/about']),
      },
      {
        text: '합친 결과를 다시 push 합니다. 이미 짝이 지어져 있어 <code>git push</code>만 쳐도 돼요.',
        cmds: ['git push'],
        check: (s) => inProject(s, 'web-app') && !!s.flags.teamMainPushed && ghRepo(s, 'web-app')?.branches['feature/about'] === repo(s).branches['feature/about'] && isAncestor(repo(s).commits, ghRepo(s, 'web-app')?.branches.main, repo(s).branches['feature/about']),
      },
      {
        text: '리뷰가 끝나 PR이 승인됐다고 치고, main에 합쳐 올립니다. (GitHub의 "Merge" 버튼이 하는 일을 직접!)',
        cmds: ['git switch main', 'git pull', 'git merge feature/about', 'git push'],
        check: (s) => inProject(s, 'web-app') && !!ghRepo(s, 'web-app')?.branches.main && isAncestor(repo(s).commits, repo(s).branches['feature/about'] ?? ghRepo(s, 'web-app')?.branches['feature/about'], ghRepo(s, 'web-app').branches.main),
      },
    ],
  },
  {
    id: 'undo',
    title: '실수 되돌리기',
    summary: 'Git이 있으면 실수가 두렵지 않습니다. 파일 수정, 스테이징, 커밋을 각각 되돌려 봐요.',
    concepts: ['restore', 'restore --staged', 'revert'],
    requires: 'first-commit',
    steps: [
      {
        text: '실수로 README.md를 망가뜨려 봅시다. (<code>&gt;</code>는 덮어쓰기!)',
        cmds: ['cd ~/my-project', 'echo "앗 실수" > README.md', 'cat README.md'],
        check: (s) => inProject(s) && repo(s).status.unstaged.some((e) => e.path === 'README.md'),
      },
      {
        text: '마지막 커밋 상태로 <b>파일을 되살립니다</b>.',
        cmds: ['git restore README.md', 'cat README.md'],
        check: (s) => inProject(s) && s.ran('git', 'restore') && !repo(s).status.unstaged.some((e) => e.path === 'README.md'),
      },
      {
        text: '이번엔 올리면 안 되는 파일을 실수로 스테이징했어요.',
        cmds: ['echo "임시 메모" > temp.txt', 'git add temp.txt', 'git status'],
        check: (s) => inProject(s) && repo(s).status.staged.some((e) => e.path === 'temp.txt'),
      },
      {
        text: '스테이징만 취소합니다. 파일은 그대로 남고 다시 Untracked가 돼요.',
        cmds: ['git restore --staged temp.txt', 'git status'],
        check: (s) => inProject(s) && s.ran('git', 'restore', '--staged') && repo(s).status.untracked.includes('temp.txt'),
      },
      {
        text: '이번엔 잘못된 커밋을 만들어 봅니다.',
        cmds: ['git add temp.txt', 'git commit -m "실수로 한 커밋"', 'git log --oneline'],
        check: (s) => inProject(s) && [...(repo(s).commits.values())].some((c) => c.message.includes('실수')),
      },
      {
        text: '<code>git revert</code>는 그 커밋을 <b>거꾸로 적용한 새 커밋</b>을 만듭니다. 기록을 지우지 않으니 이미 push 한 커밋도 안전하게 되돌릴 수 있어요.',
        cmds: ['git revert HEAD', 'git log --oneline', 'ls'],
        check: (s) => inProject(s) && s.ran('git', 'revert') && (headCommit(s)?.message ?? '').startsWith('Revert') && !repo(s).files.includes('temp.txt'),
      },
    ],
  },
  {
    id: 'reset',
    title: 'reset 세 가지 모드',
    summary: 'reset은 브랜치를 과거 커밋으로 되감습니다. --soft / --mixed / --hard는 "되감은 뒤 변경 내용을 어디에 남기느냐"만 달라요.',
    concepts: ['reset --soft', 'reset --mixed', 'reset --hard', 'HEAD~N'],
    requires: 'first-commit',
    steps: [
      {
        text: '연습용 커밋 3개를 쌓습니다. (명령 칩을 차례로 실행하세요)',
        cmds: [
          'cd ~/my-project',
          'echo "1" > reset.txt && git add reset.txt && git commit -m "리셋 연습 1"',
          'echo "2" >> reset.txt && git commit -am "리셋 연습 2"',
          'echo "3" >> reset.txt && git commit -am "리셋 연습 3"',
        ],
        check: (s) => inProject(s) && (headCommit(s)?.message ?? '').includes('리셋 연습 3'),
      },
      {
        text: '<b>--soft</b>: 커밋만 취소하고 변경은 <span class="c-stage">스테이징</span>에 남겨요. "커밋 메시지를 고치고 싶을 때" 써요.',
        cmds: ['git reset --soft HEAD~1', 'git status', 'git log --oneline -n 3'],
        check: (s) => inProject(s) && s.ran('git', 'reset', '--soft') && (headCommit(s)?.message ?? '').includes('리셋 연습 2') && repo(s).status.staged.some((e) => e.path === 'reset.txt'),
      },
      {
        text: '스테이징에 남은 변경으로 바로 다시 커밋합니다.',
        cmds: ['git commit -m "리셋 연습 3 (메시지 수정)"'],
        check: (s) => inProject(s) && (headCommit(s)?.message ?? '').includes('메시지 수정'),
      },
      {
        text: '<b>--mixed</b>(기본값): 커밋과 스테이징을 취소하고 변경은 <span class="c-work">작업 디렉터리</span>에만 남겨요. "커밋을 다시 나눠 담고 싶을 때" 써요.',
        cmds: ['git reset HEAD~1', 'git status'],
        check: (s) => inProject(s) && (headCommit(s)?.message ?? '').includes('리셋 연습 2') && repo(s).status.unstaged.some((e) => e.path === 'reset.txt') && !repo(s).status.staged.some((e) => e.path === 'reset.txt'),
      },
      {
        text: '<b>--hard</b>: 커밋·스테이징·작업 파일까지 <b>모두</b> 과거로 되돌려요. 남아 있던 변경도 사라집니다 ⚠️',
        cmds: ['git reset --hard HEAD~1', 'git status', 'cat reset.txt'],
        check: (s) => inProject(s) && s.ran('git', 'reset', '--hard') && (headCommit(s)?.message ?? '').includes('리셋 연습 1') && !repo(s).status.unstaged.length && !repo(s).status.staged.length,
      },
      {
        text: '정리: reset은 <b>내 컴퓨터에만 있는 커밋</b>에 씁니다. 이미 push 한 커밋을 reset 하면 동료의 기록과 어긋나요 → 그때는 <code>git revert</code>!',
        cmds: ['git log --oneline -n 3'],
        check: (s) => inProject(s) && s.ran('git', 'log'),
      },
    ],
  },
];
