# Tag Ontology

[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
[![Build](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml/badge.svg)](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

[English](../../README.md) | **한국어** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md)

**노트를 잇듯 태그도 이어 보세요.**

Tag Ontology는 사이드바 탭에서 태그마다 상위·하위·연관 태그를 정할 수 있게 해 줍니다. 파일을 직접 고칠 필요가 없습니다. 만든 구조는 Obsidian 기본 **그래프 뷰**에서 가지별로 접고 펼치고, 트리 배치로 바꾸고, 선택한 태그에 포커스를 둘 수 있습니다. 노트, 노트 사이 링크, 필터, 색상 그룹, 표시 설정은 그대로 동작합니다.

노트는 절대 수정하지 않습니다. 태그 사전(vault 안의 JSON 파일)에만 쓰고, 그것도 사이드바 탭에서 태그를 추가·편집·삭제할 때만 씁니다.

> **시작하기:** 계층은 태그 노드로 만들어지므로 그래프 설정의 **필터 → Tags**가 켜져 있어야 합니다. 처음 설치하면 자동으로 켜 드립니다.

![Tag Ontology 데모](../../assets/0.9.0/demo.gif)

> [!TIP]
> **AI 에이전트와 함께 쓰기**: [TOW](https://github.com/NamhyeonKo/tag-ontology-wiki)를 함께 사용하면 AI 에이전트로 태그와 사전을 자동 관리하고 vault 전반을 정리할 수 있습니다. ([자세히 보기](#관련-프로젝트))

## 주요 기능

- **사이드바에서 계층 만들기.** 노트에서 이미 쓰는 태그나 새 이름을 추가하고, 태그의 이름·설명·별칭·상위·하위·연관 태그를 고치고, 태그를 삭제합니다. 파일을 직접 고칠 필요가 없고, 저장할 때 다른 곳에서 바뀐 내용을 덮어쓰지 않습니다.
- **기본 그래프의 확장.** 노트, 노트 링크, 필터, 색상 그룹, 화살표 등 기본 설정이 평소처럼 동작합니다.
- **접고 펼치는 태그 계층.** 사전 태그는 루트까지 접힌 상태로 시작하고, 각 노트는 보이는 가장 가까운 상위 태그에 연결됩니다. 태그를 클릭하면 선택되고 더블 클릭하면 한 단계 펼쳐지며, 노트가 더 구체적인 하위 태그로 옮겨 붙습니다. 다시 더블 클릭하면 접힙니다.
- **하위 포함 노트 수.** 태그마다 *직접* 달린 노트 수와, *하위 태그까지 포함한* 노트 수를 보여 줍니다.
- **다중 부모와 연관 관계.** 실선 화살표는 상위에서 하위로 향하고, 점선은 연관 태그를 잇습니다.
- **세 가지 배치.** Force, 세로 트리, 가로 트리.
- **3D 보기 (beta).** 같은 계층을 입체로 봅니다. 주위를 돌려 보고, 태그를 클릭하면 그 태그로 날아갑니다. 그래프 도구 모음 맨 아래 버튼으로 엽니다.
- **사이드바 탭.** 파일·검색 탭 옆의 탭에서 태그 이름이나 별칭으로 찾고, 태그 정보를 보고, 사전 대조를 합니다. 여기서 태그를 고르면 열린 그래프가 그 태그를 가운데로 옮깁니다.
- **사전 대조.** vault에서 쓰이지만 사전에 없는 태그와, 사전에는 있지만 아직 아무 노트도 쓰지 않는 태그를 보여 줍니다. 보고만 하고 아무것도 바꾸지 않습니다.
- **사용자 색상(선택).** 그래프와 사이드바의 모든 태그를 한 가지 색(따로 고르지 않으면 강조색)으로 칠합니다.
- **포커스(선택).** 선택한 태그와 바로 옆 태그(상위·하위·연관 태그)는 밝게 두고 나머지는 흐리게 합니다. 옵션으로 아래의 모든 하위 태그와 노트를 더할 수 있습니다.
- **보던 상태 기억.** 펼친 태그와 Notes·Related 토글이 저장되고, 모든 그래프 탭이 같은 상태를 씁니다.

| 사이드바 탭 | 사전 대조 |
| --- | --- |
| ![사이드바 탭](../../assets/0.9.0/tag-panel.png) | ![사전 대조](../../assets/0.9.0/dictionary-check.png) |
| **루트까지 접기** | **모두 펼치기** |
| ![모든 태그 접기](../../assets/0.9.0/collapsed.png) | ![모든 태그 펼치기](../../assets/0.9.0/expanded.png) |
| **세로 트리** | **가로 트리** |
| ![세로 트리](../../assets/0.9.0/tree-vertical.png) | ![가로 트리](../../assets/0.9.0/tree-horizontal.png) |

## 동작 방식

Tag Ontology는 기본 그래프 뷰 안에서 동작합니다. Obsidian이 필터와 색상 그룹을 적용해 만든 그래프를 받아, 사전 태그를 접고 태그 사이에 계층·연관 선을 더합니다. 사전에 없는 태그는 일반 태그 노드로 그대로 둡니다. 로컬 그래프에는 영향이 없고, 플러그인을 끄면 그래프 뷰가 원래대로 돌아옵니다.

3D 보기(beta)는 별도 탭으로 열리며, 동일한 사전 데이터를 three.js를 이용해 3차원 공간에 시각화합니다.

태그 사용 정보는 Obsidian 메타데이터 캐시에서 가져오며, 모든 Markdown 노트의 frontmatter `tags`와 본문 내 `#태그`를 포함합니다.

## 설치 및 업데이트

자세한 설치 단계, 업데이트 명령, BRAT 설정 및 트러블슈팅은 **[설치 및 업데이트 안내서 (영문)](../installation.md)**를 참고하세요.

- **Obsidian 커뮤니티 플러그인**:
  - 설치: **설정 → 커뮤니티 플러그인 → 탐색**에서 "Tag Ontology" 검색 후 설치 및 활성화 ([디렉터리 페이지](https://community.obsidian.md/plugins/tag-ontology))
  - 업데이트: **설정 → 커뮤니티 플러그인 → 업데이트 확인**
- **BRAT (베타 테스트)**:
  - `BRAT: Add a beta plugin for testing` 실행 후 `NamhyeonKo/obsidian-tag-ontology` 입력
  - 업데이트: `BRAT: Check for updates to all beta plugins`
- **독립형 CLI (`tag-ontology`)**:
  - `npx tag-ontology@latest check --root /path/to/vault --json`
  - 전역 설치/업데이트: `npm install -g tag-ontology@latest`

> **필수 요구사항**: Obsidian의 코어 **그래프 뷰(Graph view)** 플러그인이 켜져 있어야 하며, 그래프 설정에서 **필터 → Tags**가 활성화되어 있어야 합니다.

## 설정

사전 경로는 설정에서 선택하지 않으면 `tow/tag-dictionary.json` → `.tow/tag-dictionary.json` → `Tag-Dictionary.json` 순서로 확인합니다. 새로 설치하면 첫 위치에 빈 사전을 만듭니다. 기존 `Tag-Dictionary.json`은 계속 작동하며, TOW 0.5.0–0.5.1의 `.tow/` 사전도 계속 읽습니다. 설정에서 선택한 경로가 항상 우선합니다.

**Obsidian Sync는 `.obsidian` 외의 점으로 시작하는 폴더를 동기화하지 않습니다** ([Sync 설정](https://obsidian.md/help/sync/settings)). Obsidian Sync를 사용한다면 사전 경로를 숨김 폴더 밖으로 지정하세요. Git과 파일 단위 동기화 도구는 무시 설정이 없는 한 점으로 시작하는 폴더도 동기화합니다.

## 사용법

UI는 기본 영어로 제공됩니다.

- **사이드바 탭 열기**: 리본의 책 아이콘을 누르거나 명령 팔레트에서 `Tag Ontology: Open graph`를 실행합니다.
- **태그 탐색 및 검색**: 상단 검색창에 태그명이나 별칭을 입력하여 해당 노드로 빠르게 이동하고 그래프를 포커스할 수 있습니다.
- **태그 추가 / 수정**: 사이드바 상단의 `+` 버튼으로 새 태그를 추가하거나 `Edit`을 눌러 상위(`broader`), 하위(`narrower`), 연관(`related`) 관계를 설정할 수 있습니다.

## 개인정보 보호 및 보안

- 외부 네트워크 요청, 원격 분석(telemetry), 별도 계정 등록이 전혀 없습니다.
- 볼트 내 노트의 메타데이터와 사전 JSON 파일만 읽습니다.
- 플러그인 설정 파일과 사이드바에서 저장할 때 사용 중인 사전만 씁니다. 새 설치는 `tow/tag-dictionary.json`을 사용하며, 기존 `Tag-Dictionary.json`은 계속 작동하고 `.tow/tag-dictionary.json`도 읽습니다.

## 라이브러리와 CLI

독립 패키지인 [`tag-ontology`](../../packages/tag-ontology/README.md)는 MIT 라이선스의 ESM 라이브러리와 Node CLI로 동일한 사전 규칙을 제공합니다. Obsidian 없이도 CI 환경이나 스크립트에서 사전을 검사하고 태그 사용 현황을 스캔할 수 있습니다.

```sh
npx tag-ontology@latest check --root /path/to/vault --json
```

## 관련 프로젝트

### [TOW (Tag Ontology Wiki)](https://github.com/NamhyeonKo/tag-ontology-wiki)

[TOW](https://github.com/NamhyeonKo/tag-ontology-wiki)와 함께 사용하면 AI 에이전트를 활용해 태그와 사전을 자동으로 관리하고 볼트 전반의 지식 베이스를 체계화할 수 있습니다.

## 기여하기 (Contributing)

버그 제보, 기능 제안, 문서 번역 등 커뮤니티의 모든 기여를 환영합니다!
자세한 개발 환경 설정과 기여 가이드라인은 [CONTRIBUTING.md](../../CONTRIBUTING.md) 및 [행동강령 (Code of Conduct)](../../CODE_OF_CONDUCT.md)을 확인해 주세요.

## 후원하기

Tag Ontology는 무료 오픈 소스 소프트웨어입니다. 유용하게 사용하고 계시다면 [Buy Me a Coffee](https://buymeacoffee.com/namhyunko)를 통해 후원해 주실 수 있습니다.

## 라이선스

Copyright (c) 2026 NamhyeonKo

이 프로젝트는 [MIT 라이선스](../../LICENSE) 하에 배포됩니다.
자유롭게 사용, 수정, 배포할 수 있습니다.
