# Tag Ontology

[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
[![Build](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml/badge.svg)](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | **한국어**

Tag Ontology는 Obsidian 기본 **그래프 뷰**를 태그 계층 지도로 바꿔 줍니다. 태그의 정의, 별칭, 상위 태그, 연관 태그를 JSON 사전에 적어 두면, 내장 그래프 렌더러로 그 계층을 그리고 각 태그를 사용하는 노트를 연결합니다.

**읽기 전용**입니다. 노트와 사전 파일은 절대 수정하지 않습니다.

![Tag Ontology 데모](assets/demo.gif)

## 기능

- **기본 그래프 안의 태그 계층.** Obsidian 그래프 뷰의 렌더러와 물리 엔진을 그대로 쓰기 때문에, 익숙한 그래프와 똑같이 보이고 똑같이 움직입니다.
- **단계적 펼침.** 처음에는 루트 태그만 보입니다. 태그를 클릭하면 하위 태그와 그 태그가 달린 노트가 나타납니다.
- **하위 포함 노트 수.** 태그마다 *직접* 달린 노트 수와, *하위 태그까지 포함한* 노트 수를 보여 줍니다. 노트에 여러 태그가 달렸거나 태그가 여러 부모를 가져도 같은 노트는 한 번만 셉니다.
- **다중 부모와 연관 관계.** 실선 화살표는 상위에서 하위로 향하고, 점선은 연관 태그를 잇습니다.
- **세 가지 배치.** Force, Tree, Radial.
- **검색.** 태그 이름이나 별칭으로 찾습니다.
- **사전 대조.** vault에서 쓰이지만 사전에 없는 태그와, 사전에는 있지만 아직 아무 노트도 쓰지 않는 태그를 보여 줍니다. 보고만 하고 아무것도 바꾸지 않습니다.
- **노트 열기.** 노트 노드나 노트 목록을 클릭하면 해당 노트가 열립니다.

| 태그 패널 | 사전 대조 |
| --- | --- |
| ![상위·하위 태그와 노트 수가 표시된 태그 패널](assets/tag-panel.png) | ![미등록 태그와 쓰이지 않는 태그를 보여 주는 사전 대조](assets/dictionary-check.png) |

## 동작 방식

플러그인이 켜져 있는 동안에는 **모든 기본 그래프 뷰 탭이** 일반 노트 그래프 대신 **태그 온톨로지를 보여 줍니다**. 로컬 그래프에는 영향이 없습니다. 플러그인을 끄면 기본 그래프의 데이터, 클릭 동작, 텍스처가 원래대로 복원됩니다.

태그 사용 정보는 Obsidian 메타데이터 캐시에서 가져옵니다. 모든 Markdown 노트의 frontmatter `tags`와 본문 `#태그`가 포함되며, 이름이 `.`으로 시작하는 파일과 폴더는 제외됩니다.

## 설치

### 커뮤니티 플러그인

**설정 → 커뮤니티 플러그인 → 탐색**에서 "Tag Ontology"를 검색해 설치하고 켭니다. [디렉터리 페이지](https://community.obsidian.md/plugins/tag-ontology)에서도 설치할 수 있습니다.

### BRAT (베타)

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat)을 설치합니다.
2. **BRAT: Add a beta plugin**을 실행하고 `NamhyeonKo/obsidian-tag-ontology`를 입력합니다.

### 수동 설치

1. [최신 릴리스](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases)에서 `main.js`, `manifest.json`, `styles.css`를 내려받습니다.
2. 세 파일을 vault 안의 `.obsidian/plugins/tag-ontology/`에 복사합니다. Obsidian에서 설정 폴더 이름을 바꿨다면 `.obsidian` 대신 그 폴더를 씁니다.
3. Obsidian을 다시 불러온 뒤 **설정 → 커뮤니티 플러그인**에서 **Tag Ontology**를 켭니다.

기본 **그래프 뷰** 코어 플러그인이 켜져 있어야 합니다.

## 예제 vault로 바로 써 보기

저장소에 작은 예제 vault가 들어 있습니다. [`examples/sample-vault`](examples/sample-vault)에는 태그 12개짜리 사전과 노트 6개가 있습니다.

1. Obsidian에서 **폴더를 vault로 열기**를 선택하고 `examples/sample-vault`를 고릅니다.
2. 위 방법 중 하나로 그 vault에 플러그인을 설치합니다.
3. 리본의 **graph** 아이콘을 누르거나, 명령 팔레트에서 **Tag Ontology: Open graph**를 실행합니다.

`computer-science`와 `security` 두 루트가 보이면 정상입니다. `cryptography`와 `ai-security`는 부모가 둘이고, 사전 대조에는 `#to-read`가 미등록 태그로 나옵니다.

## 태그 사전 형식

기본값으로 vault 루트의 `Tag-Dictionary.json`을 읽습니다. 경로는 플러그인 설정에서 바꿀 수 있습니다.

파일 전체가 하나의 JSON 객체입니다. 각 키는 **`#`을 뺀 태그 이름**이며, 노트에 적힌 그대로 써야 합니다. 대소문자를 구분하므로 소문자 키를 권장합니다. `#lang/python` 같은 중첩 태그는 키를 `lang/python`으로 씁니다.

```json
{
  "machine-learning": {
    "aliases": ["ML", "머신러닝"],
    "description": "데이터로부터 학습해 성능이 향상되는 알고리즘",
    "broader": ["computer-science"]
  },
  "dropout": {
    "description": "학습 중 일부 유닛을 무작위로 끄는 과적합 완화 기법",
    "broader": ["deep-learning"],
    "related": ["overfitting"],
    "facet": "technique"
  },
  "computer-science": {
    "description": "계산, 정보, 자동화를 다루는 학문",
    "broader": []
  }
}
```

| 필드 | 필수 | 타입 | 의미 |
| --- | --- | --- | --- |
| `description` | 예 | string | 태그 정보 패널에 표시됩니다. |
| `aliases` | 아니오 | string[] | 다른 이름입니다. 검색에 쓰이고, 사전 대조에서 미등록 태그와 일치하는 별칭을 알려 줄 때도 쓰입니다. |
| `broader` | 아니오 | string[] | 상위 태그입니다. **`[]`이면 루트 태그입니다.** |
| `related` | 아니오 | string[] | 계층이 아닌 연관 관계이며, 점선으로 그려집니다. |
| `facet` | 아니오 | string | 자유 분류입니다. 형식 검사만 하고 아직 화면에는 표시하지 않습니다. |

규칙:

- **루트 태그에는 `"broader": []`가 꼭 있어야 합니다.** `broader` 키가 아예 없는 태그는 아직 분류되지 않은 것으로 보고 그래프에 나타나지 않습니다.
- `broader`나 `related`에 적은 태그는 모두 사전에 있어야 합니다.
- 자기 자신을 참조할 수 없고, `broader` 관계가 순환해서도 안 됩니다.
- 사전에 오류가 있으면 뷰를 열 때 이유를 알림으로 보여 줍니다. 자동 새로고침 때는 마지막으로 정상이던 그래프를 유지합니다.

전체 예시는 [`examples/sample-vault/Tag-Dictionary.json`](examples/sample-vault/Tag-Dictionary.json)을 참고하세요.

## 사용법

### 도구 모음과 태그 패널

UI는 영어로 표시됩니다.

- **Search tags or aliases**: 태그 이름이나 별칭을 정확히 입력하고 Enter를 누르면 그 태그까지 펼쳐서 선택합니다.
- **Collapse all** / **Expand all**: 루트 태그만 보이도록 모두 접거나, 모든 태그와 노트를 펼칩니다.
- **Fit**: 그래프를 화면에 맞춥니다.
- **Notes** / **Related**: 노트 노드와 점선 연관 관계를 켜거나 끕니다. 태그는 계층의 뼈대라서 항상 표시됩니다.
- **Dictionary check**: 사전에 없는 태그와 쓰이지 않는 태그를 보여 줍니다.
- **Layout**: Force, Tree, Radial 중에서 고릅니다.
- 태그를 클릭하면 펼쳐지면서 정보 패널이 열립니다. 정의, 별칭, 노트 수(직접 / 하위 포함), 상위·하위·연관 태그, 노트 목록이 표시됩니다. 이미 펼친 태그를 클릭하면 패널만 다시 열립니다. 접으려면 패널의 **Collapse children and notes**를 누릅니다.
- 기본 그래프는 많이 축소하면 라벨과 화살표를 숨깁니다. 확대하면 보입니다.

### 명령

| 명령 | 설명 |
| --- | --- |
| Tag Ontology: Open graph | 기본 그래프 뷰에서 온톨로지를 엽니다. 이미 열린 그래프 탭이 있으면 그 탭을 씁니다. |
| Tag Ontology: Reload dictionary | 사전과 노트 색인을 다시 불러옵니다. |
| Tag Ontology: Open compatibility viewer | 호환용으로 남겨 둔 Cytoscape 기반 독립 뷰어입니다. 큰 vault에서는 느립니다. |

### 설정

| 설정 | 설명 |
| --- | --- |
| Dictionary path | 태그 사전 경로. vault 기준 상대 경로의 `.json` 파일이며 기본값은 `Tag-Dictionary.json`입니다. vault 설정 폴더(보통 `.obsidian/`)와 `.git/` 안의 경로는 쓸 수 없습니다. |
| Layout | 그래프 배치. Force, Tree, Radial 중 하나를 고릅니다. |

## 개인정보

- 네트워크 요청, 사용 통계 수집, 계정이 없습니다.
- 노트의 메타데이터와 사전 파일만 읽습니다.
- 자체 설정 파일(설정 폴더 안의 `plugins/tag-ontology/data.json`, 보통 `.obsidian/` 아래, `dictionaryPath`와 `layout`만 저장)에만 씁니다.

## 호환성과 알려진 한계

- **데스크톱 전용**입니다. Obsidian 1.14.4(macOS)에서 검증했습니다.
- 기본 그래프 뷰의 **비공개 내부 구조**(렌더러, PIXI, 배치 Worker)에 연결합니다. 이후 Obsidian 업데이트에서 동작하지 않을 수 있습니다. 내부 구조가 예상과 다르면 플러그인은 연결을 해제하고 기본 그래프를 그대로 둡니다.
- 온톨로지를 보는 동안에는 기본 그래프의 필터, 색상 그룹, 화살표 설정이 숨겨집니다.
- 모든 태그를 펼치면 라벨이 빽빽해지고, 그 상태에서 Tree/Radial로 바꾸면 잠깐 지연이 있습니다.
- 그래프 뷰를 고치는 다른 플러그인과 함께 쓰는 경우는 검증하지 않았습니다.

## 로드맵

- 온톨로지 표시 중에도 기본 그래프 설정(색상 그룹, 화살표, 태그·첨부파일·고아 노트 표시 토글) 지원

버그 제보와 기능 제안은 [Issues](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues)에 남겨 주세요. 버그라면 Obsidian 버전과 OS를 함께 적어 주세요.

## 개발

Node.js **22.18 이상**이 필요합니다. 테스트가 Node의 내장 타입 제거 기능으로 TypeScript를 바로 실행하기 때문입니다.

```sh
npm ci
npm run lint        # Obsidian 심사 규칙 검사 (eslint-plugin-obsidianmd)
npm test            # 단위 테스트, vault 불필요
npm run build       # 타입 검사 후 main.js로 번들
npm run deploy -- "/path/to/vault"   # main.js, manifest.json, styles.css를 vault에 복사
```

`deploy`는 대상 vault에 `.obsidian/` 폴더가 있어야 하며, 기존 `data.json`은 보존합니다. 복사한 뒤 Obsidian에서 플러그인을 다시 불러오세요.

`npm run test:vault`는 메인테이너의 개인 vault(`OBSIDIAN_VAULT_PATH`)를 대상으로 하는 연동 테스트입니다. 다른 기여자는 실행하지 않아도 됩니다.

### 프로젝트 구조

```text
src/
├── main.ts         # Plugin entry: commands, settings tab, vault/metadata events
├── ontology.ts     # Dictionary validation, hierarchy, note roll-up, dictionary check
├── native.ts       # Hooks the core Graph view renderer (toolbar, panel, layouts)
├── native-data.ts  # Converts the visible ontology into the core graph's data format
├── layout.ts       # Tree/Radial positions (headless Cytoscape)
├── view.ts         # Compatibility viewer (standalone Cytoscape view)
├── renderer.ts     # Cytoscape setup for the compatibility viewer
└── settings.ts     # Settings shape and path validation
tests/              # node:test unit tests (tests/integration is maintainer-only)
examples/           # Sample vault with a Tag-Dictionary.json
scripts/deploy.mjs  # Copies the build into a local vault
```

### 기여와 릴리스

커밋 규칙(Conventional Commits), 커밋 전 검사, Obsidian에서 테스트하는 방법, 메인테이너용 릴리스 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다(영어).

## 감사의 말

- 기본 그래프 렌더러에 사용자 데이터를 공급하는 방식은 [Nested tags graph](https://github.com/drpilman/obsidian-graph-nested-tags)에서 아이디어를 얻었습니다. 해당 플러그인을 설치할 필요는 없습니다.
- Tree/Radial 배치 계산과 호환 모드 뷰어에 [Cytoscape.js](https://js.cytoscape.org/)와 [d3-force](https://github.com/d3/d3-force)를 사용합니다.

## 라이선스

[MIT](LICENSE)
