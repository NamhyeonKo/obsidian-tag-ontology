# Tag Ontology

[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
[![Build](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml/badge.svg)](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

[English](../../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md)

**像連結筆記一樣連結標籤。**

Tag Ontology 讓你在側邊欄分頁中為每個標籤指定父層、子層與關聯標籤，無需手動修改任何檔案。你可以在 Obsidian 原生的**關聯圖（Graph view）**中探索這些層級結構：展開或摺疊分支、切換為樹狀排列，並讓選取的標籤維持焦點。筆記、雙向連結、篩選器、顏色群組與顯示設定皆維持原有運作方式。

此外掛絕不會修改你的筆記內容。它僅在側邊欄中新增、編輯或刪除標籤時，將資料寫入保管庫中的純 JSON 標籤字典。

> **開始使用：** 標籤層級是由標籤節點構建，因此必須在關聯圖設定中開啟 **篩選 → 標籤 (Filters → Tags)**。全新安裝時系統會自動為你開啟。

![Tag Ontology 演示](../../assets/0.9.0/demo.gif)

> [!TIP]
> **搭配 AI Agent 使用**：與 [TOW](https://github.com/NamhyeonKo/tag-ontology-wiki) 搭配使用，可透過 AI Agent 自動維護標籤與字典，並進行全面的知識庫整理。

## 主要功能

- **在側邊欄建構層級**：直接新增筆記中已有的標籤或新名稱，編輯標籤的名稱、描述、別名、父層、子層與關聯標籤，或刪除標籤。無需編輯檔案，儲存時絕不覆蓋外部變更。
- **核心關聯圖的原生擴充**：筆記、雙向連結、篩選器、色彩群組、箭頭等核心關聯圖功能完全相容。
- **可摺疊展開的標籤層級**：字典中的標籤初始摺疊至根節點，各筆記連結至其最接近的可見祖先節點。按一下選取標籤，連按兩下展開一層，筆記會自動移至更具體的子標籤。再次連按兩下即可摺疊。
- **包含子層的筆記計數（Roll-up）**：清楚檢視直接標記該標籤的筆記數量，以及包含所有後代標籤的筆記總數。
- **多重繼承與關聯標籤**：實線箭頭表示父子階層關係，虛線連接非階層的相關標籤。
- **三種圖表配置**：力導向配置（Force）、垂直樹狀（Vertical tree）與水平樹狀（Horizontal tree）。
- **3D 視圖（Beta）**：在三維空間中探索標籤層級，支援旋轉環顧，按一下標籤即可平滑飛行定位。
- **側邊欄專屬分頁**：依名稱或別名搜尋標籤，查閱詳細資訊，並一鍵執行字典檢查。
- **字典檢查（Dictionary Check）**：列出庫中使用但尚未在字典登記的標籤，以及字典中已定義但尚無筆記使用的標籤。僅回報狀態，絕不擅自修改任何內容。
- **自訂標籤配色（選用）**：為關聯圖與側邊欄中的標籤指定單一色彩（預設為強調色）。
- **聚焦突顯（選用）**：保持選取的標籤及其相鄰節點高亮，淡化其餘不相干節點。
- **狀態記憶**：已展開的標籤與顯示切換開關會自動儲存，並在所有關聯圖分頁中共用。

| 側邊欄面板 | 字典檢查 |
| --- | --- |
| ![側邊欄面板](../../assets/0.9.0/tag-panel.png) | ![字典檢查](../../assets/0.9.0/dictionary-check.png) |
| **摺疊至根節點** | **完全展開** |
| ![摺疊狀態](../../assets/0.9.0/collapsed.png) | ![展開狀態](../../assets/0.9.0/expanded.png) |
| **垂直樹狀** | **水平樹狀** |
| ![垂直樹狀](../../assets/0.9.0/tree-vertical.png) | ![水平樹狀](../../assets/0.9.0/tree-horizontal.png) |

## 安裝與更新

詳細安裝步驟、更新指令、BRAT 設定與疑難排解，請參閱完整的 **[安裝與更新指南 (英文)](../installation.md)**。

- **Obsidian 社群外掛市場**：
  - 安裝：進入 **設定 → 社群外掛 → 瀏覽**，搜尋 "Tag Ontology"，點選安裝並啟用（[社群主頁](https://community.obsidian.md/plugins/tag-ontology)）。
  - 更新：進入 **設定 → 社群外掛 → 檢查更新**，點選全部更新或個別更新 Tag Ontology。
- **透過 BRAT（測試版）**：
  - 執行指令 `BRAT: Add a beta plugin for testing`，輸入 `NamhyeonKo/obsidian-tag-ontology`。
  - 更新：執行指令 `BRAT: Check for updates to all beta plugins`。
- **獨立 CLI 工具 (`tag-ontology`)**：
  - 直接執行最新版本：`npx tag-ontology@latest check --root /path/to/vault --json`
  - 全域安裝 / 更新：`npm install -g tag-ontology@latest` / `npm update -g tag-ontology`

> **環境需求**：必須在 Obsidian 中啟用核心 **關聯圖（Graph view）** 外掛，並在圖表設定中開啟 **篩選 → 標籤 (Filters → Tags)**。

## 設定

字典可以儲存在保管庫中任何以 `.json` 結尾的路徑，包括 `.tow/` 資料夾。此版本之前儲存的自訂路徑也視為使用者已選擇，預設的 `Tag-Dictionary.json` 除外。若未選擇路徑，外掛會在 `.tow/tag-dictionary.json` 存在時使用它；否則使用保管庫根目錄下的 `Tag-Dictionary.json`。若已選擇路徑，即使 `.tow/` 字典存在，也一律使用所選路徑。

**Obsidian Sync 不會同步 `.obsidian` 以外以點開頭的隱藏資料夾**（[Sync 設定](https://obsidian.md/help/sync/settings)）。如果使用 Obsidian Sync，請為字典選擇可見路徑。除非設定為忽略，Git 和檔案層級同步工具會同步點開頭的資料夾。

## 隱私與安全

- 完全離線運作：無任何網路請求、遙測追蹤或使用者帳號系統。
- 僅讀取筆記中繼資料與標籤字典 JSON 檔案。
- 外掛只會寫入自身設定檔（`data.json`），以及在側邊欄儲存時寫入目前使用的字典檔案：設定中選擇的路徑（包括先前版本儲存的自訂路徑）；若未選擇，則在 `.tow/tag-dictionary.json` 存在時使用它，否則使用 `Tag-Dictionary.json`。絕不修改庫內的 Markdown 檔案。

## 獨立套件與 CLI

獨立 npm 套件 [`tag-ontology`](../../packages/tag-ontology/README.md) 提供了同等規格的字典驗證規則、ESM 函式庫與 Node.js 命令列工具，無需開啟 Obsidian 即可在自動化流程中快速驗證標籤完整性：

```sh
npx tag-ontology@latest check --root /path/to/vault --json
```

## 參與貢獻 (Contributing)

竭誠歡迎社群參與貢獻！無論是回報問題、提出新功能構想或提交修復：

1. 請查閱現有的 [Issues](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues)。
2. Fork 本存放庫並基於 `dev` 分支建立特性分支。
3. 遵循 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 提交規範。
4. 確認所有檢查通過：`npm run lint && npm test && npm run build`。
5. 提交 Pull Request 至 `dev` 分支。

完整開發指南請參閱 [CONTRIBUTING.md](../../CONTRIBUTING.md) 與 [行為準則 (Code of Conduct)](../../CODE_OF_CONDUCT.md)。

## 贊助支持

Tag Ontology 是一套免費且開放原始碼的軟體。若它對你的工作有所助益，歡迎透過 [Buy Me a Coffee](https://buymeacoffee.com/namhyunko) 給予支持。

## 開源授權

Copyright (c) 2026 NamhyeonKo

本專案採用 [MIT License](../../LICENSE) 授權釋出，你可以自由使用、修改及發布本軟體。
