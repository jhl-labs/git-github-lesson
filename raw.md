git 의 기본 개념, github의 개념, github actions,  github pages 에 대한 개념  이렇게 4가지에 대해 교육하는 자료를 만들고 싶어

git에 대한 수업은 cli로 동작하기 떄문에 인터렉티브하게 wasm 을 통한 실습 연계형이 되게 할거야.  

github, github actions, github pages에 대해서는 묶어서 진행할거야.

하나의 실습 주제로 진행할건데,  github pages를 통해 만든 웹서비스를  github actions로 빌드 및 배포하는 과정을 할거야.

만들려는 실습 웹서비스는 github로 excel 파일을 github issue에 등록하면   windows runner를 통해 xlwings를 사용하여 엑셀 파일을 읽고, 그걸로 docs branch에 json 파일로 변환 시킨 후 커밋을 하여 github pages에서 그걸 기반으로 대시보드로 보여주는 실습이야.    근데 github pages 특성상 인증이 없기 때문에 비밀번호를 입력하여 로그인하는 개념을 넣자


이 실습을 진행하면서 github, github actions, github pages 를 모두  빠른 시간안에 이해시키는게 목적이며 (각 실습 전에 간단한 이론적인 내용을 스크린샷과 함께 추가할 예정)

바이브 코딩(claude code)를 통해 얼마나 쉽게 할 수 있는지 보여주게 할거야.  (그래서 실습하는 사람들을 위한 프롬프트를 복사, 붙여넣기할 수 있게 해줘야해 )

그리고 간단한 코드 리뷰 과정 (pull request)도 추가하여, 코드를 리뷰하는 내용도 추가하자. (agent 에 의한 코드리뷰, cli 도구로 claude -p 또는 opencode 를 사용하여 호출)


그리고 이 한계를 명확히 마지막에 알려줘야해. 이건 제대로 된 암호화가 아니어서 보완에 취약하다는 점, 진짜 백엔드 서버가 왜 필요한지 추가 설명,  그리고 github actions는 리눅스에서 병렬로 하는게 더 가치 있다는 점을 잘 설명해줘야해 


git, github 의 개념이 아직 안잡힌 초보 개발자를 대상으로 한다는 생각으로 웹 기반의 튜터 사이트를 github pages 로 서빙할 수 있게 잘 구성해줘 



