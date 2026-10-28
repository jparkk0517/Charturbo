---
layout: home

hero:
  name: Charturbo
  text: GPU로 그리는 웹 차트
  tagline: 100만~1000만 포인트를 60 FPS로 줌·팬합니다. Rust + WebGPU 기반이며, WebGPU가 없으면 WebGL2로 자동 전환됩니다.
  actions:
    - theme: brand
      text: 시작하기
      link: /ko/guide/getting-started
    - theme: alt
      text: 차트 매뉴얼
      link: /ko/charts/line
    - theme: alt
      text: 라이브 예제
      link: https://jparkk0517.github.io/Charturbo/

features:
  - title: 큰 데이터에서 빠름
    details: 데이터 축약(M4), 마우스 위치 판정, 누적 계산, 눈금 배치를 Rust(WebAssembly)에서 하고 GPU로 그립니다. DOM은 라벨·범례·툴팁만 담당합니다.
  - title: 25종 이상의 차트
    details: 선, 영역, 막대, 산점도, 캔들스틱, 히트맵, 박스·바이올린, 파이, 레이더, 게이지, 퍼널, 워터폴, 트리맵, 선버스트, 생키, 스파크라인, 3D 뷰.
  - title: 실서비스용 기능
    details: 실시간 스트리밍, 시간·로그 축, 줌·핀치, 범위 내비게이터, 브러시 선택, 대시보드 동기화, PNG·SVG·PDF 내보내기.
  - title: 접근성과 다국어
    details: 자동 요약, 데이터 표, 키보드 탐색을 영어·한국어·중국어 간체로 제공합니다.
  - title: React · Vue
    details: 공식 컴포넌트와 TypeScript 타입을 함께 제공합니다.
  - title: 대규모 3D
    details: Barnes-Hut 네트워크 그래프, 임베딩 투영과 코사인 유사도 검색, 강체 물리가 있는 3D 장면.
---
