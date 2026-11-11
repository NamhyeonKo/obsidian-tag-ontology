# Tag Ontology

[![GitHub stars](https://img.shields.io/github/stars/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/stargazers)
[![Obsidian downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%22tag-ontology%22%5D.downloads&label=downloads&logo=obsidian&color=7C3AED)](https://community.obsidian.md/plugins/tag-ontology)
[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
[![npm](https://img.shields.io/npm/v/tag-ontology?logo=npm)](https://www.npmjs.com/package/tag-ontology)
[![Build](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml/badge.svg)](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

[English](../../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語** | [Español](README.es.md) | [Français](README.fr.md)

**ノートをリンクするように、タグをつなぐ。**

Tag Ontology は、サイドバータブからタグごとに親・子・関連タグを定義できる Obsidian プラグインです。ファイルを直接編集する必要はありません。設定した階層構造は、Obsidian 標準の**グラフビュー**上で枝ごとに折りたたみ・展開したり、ツリーレイアウトへ切り替えたり、選択したタグにフォーカスを当てて視覚的に探索できます。ノート、リンク、フィルター、カラーグループなどの標準機能はそのまま動作します。

ノート本文を変更することは一切ありません。サイドバータブでタグを追加・編集・削除したときにのみ、保管庫内のプレーンな JSON タグ辞書に書き込みます。

> **はじめに:** タグの階層はタグノードをもとに構築されるため、グラフ設定の **フィルター → タグ (Filters → Tags)** が有効になっている必要があります。新規インストール時には自動的にオンになります。

![Tag Ontology デモ](../../assets/0.9.0/demo.gif)

> [!TIP]
> **AI エージェントとの連携**: [TOW](https://github.com/NamhyeonKo/tag-ontology-wiki) と組み合わせることで、AI エージェントを活用してタグや辞書を自動管理し、保管庫全体のナレッジを整理できます。

## 主な機能

- **サイドバーで階層を構築**: ノートで既に使用されているタグや新しいタグを追加し、名前・説明・エイリアス・facet・親タグ・子タグ・関連タグを編集したり、削除したりできます。ファイルの直接編集は不要で、保存時に外部の変更を上書きすることもありません。
- **標準グラフビューの拡張**: ノート、内部リンク、フィルター、カラーグループ、矢印表示などの標準設定がそのまま動作します。
- **折りたたみ可能なタグ階層**: 辞書のタグはルートまで折りたたまれた状態で表示され、各ノートは最も近い可視の親タグにリンクされます。タグをクリックして選択し、ダブルクリックすると 1 段階展開され、ノートがより具体的な子タグへと再配置されます。再度ダブルクリックすると折りたたまれます。
- **下位タグを含むノート数カウント (Roll-up)**: タグごとに、直接付けられたノート数と、すべての子孫タグを含むノート数の両方を確認できます。
- **複数の親タグと関連タグのサポート**: 実線矢印は親から子への階層関係を示し、破線は非階層の関連タグを繋ぎます。
- **3 つのレイアウト**: Force（力学モデル）、垂直ツリー（Vertical tree）、水平ツリー（Horizontal tree）。
- **3D ビュー (Beta)**: 同じ階層構造を 3 次元空間で探索。視点を回転させたり、タグをクリックしてスムーズにズーム移動できます。
- **専用サイドバータブ**: タグ名やエイリアスによる検索、詳細情報の確認、ワンクリックでの辞書整合性チェックを実行できます。
- **辞書チェック (Dictionary Check)**: 保管庫で使用されているが辞書にないタグ（類似する辞書名つき）、辞書にはあるがまだノートで使われていないタグ、タグをエイリアスとして、または大文字・小文字を変えて記述しているノート、より上位のタグとその下位タグを併記しているノートを一覧表示します。報告のみを行い、何も変更しません。
- **カスタムタグカラー (オプション)**: グラフおよびサイドバーのすべてのタグに統一色を適用できます（デフォルトはアクセントカラー）。
- **フォーカス表示 (オプション)**: 選択したタグとその隣接ノード（親・子・関連タグ）のみを明るく保ち、他のノードをフェードアウトさせます。
- **表示状態の保持**: 展開されたタグや表示トグルは保存され、すべてのグラフトレイで共有されます。

| サイドバータブ | 辞書チェック |
| --- | --- |
| ![サイドバータブ](../../assets/0.9.0/tag-panel.png) | ![辞書チェック](../../assets/0.9.0/dictionary-check.png) |
| **ルートまで折りたたみ** | **全展開** |
| ![折りたたみ状態](../../assets/0.9.0/collapsed.png) | ![全展開状態](../../assets/0.9.0/expanded.png) |
| **垂直ツリー** | **水平ツリー** |
| ![垂直ツリー](../../assets/0.9.0/tree-vertical.png) | ![水平ツリー](../../assets/0.9.0/tree-horizontal.png) |

## インストールとアップデート

詳しいインストール手順、アップデートコマンド、BRAT 設定、トラブルシューティングについては、**[インストール・アップデートガイド (英語版)](../installation.md)** をご覧ください。

- **Obsidian コミュニティプラグイン**:
  - インストール: **設定 → コミュニティプラグイン → 閲覧** から "Tag Ontology" を検索してインストール・有効化（[プラグインページ](https://community.obsidian.md/plugins/tag-ontology)）。
  - アップデート: **設定 → コミュニティプラグイン → 更新を確認** から更新を実行。
- **BRAT (ベータ版テスト)**:
  - コマンド `BRAT: Add a beta plugin for testing` を実行し、`NamhyeonKo/obsidian-tag-ontology` を入力。
  - アップデート: コマンド `BRAT: Check for updates to all beta plugins` を実行。
- **スタンドアロン CLI ツール (`tag-ontology`)**:
  - 最新版を直接実行: `npx tag-ontology@latest check --root /path/to/vault --json`
  - グローバルインストール / 更新: `npm install -g tag-ontology@latest` / `npm update -g tag-ontology`

> **必須要件**: Obsidian の標準 **グラフビュー (Graph view)** プラグインが有効であり、グラフ設定で **フィルター → タグ (Filters → Tags)** がオンになっている必要があります。

## 設定

パスを選択していない場合、プラグインは `tow/tag-dictionary.json` → `.tow/tag-dictionary.json` → `Tag-Dictionary.json` の順に確認します。新規インストールでは最初の場所に辞書を作成します。既存の `Tag-Dictionary.json` は引き続き使用でき、TOW 0.5.0–0.5.1 の `.tow/` 辞書も読み込みます。

**Obsidian Sync は `.obsidian` 以外のドットフォルダーを同期しません** ([Sync の設定](https://obsidian.md/help/sync/settings))。Obsidian Sync を使う場合は、辞書を非表示フォルダー以外のパスに保存してください。Git やファイル単位の同期ツールは、除外設定がない限りドットフォルダーも同期します。

**Kebab-case tag names**（デフォルトではオフ）：オンにすると、編集フォームでは新規タグまたは名前を変更したタグを、`machine-learning` のように小文字と数字をハイフンでつないだ形式（TOW が検証する形式）でのみ受け付けます。既存の名前はそのままです。

## プライバシーとセキュリティ

- 完全オフライン動作: 外部ネットワーク通信、テレメトリ収集、ユーザーアカウント等は一切不要です。
- ノートのメタデータとタグ辞書 JSON ファイルのみを読み取ります。
- プラグインは自身の設定ファイルと、サイドバーで保存するときに使用中の辞書だけを書き込みます。新規インストールでは `tow/tag-dictionary.json` を使用し、既存の `Tag-Dictionary.json` は引き続き動作し、`.tow/tag-dictionary.json` も読み込みます。

## ライブラリと CLI

スタンドアロンの npm パッケージ [`tag-ontology`](../../packages/tag-ontology/README.md) は、同じ辞書検証ルールを ESM ライブラリおよび Node.js CLI として提供します。Obsidian を起動することなく、自動スクリプト等で保管庫内のタグ整合性を検証できます。

```sh
npx tag-ontology@latest check --root /path/to/vault --json
```

## コントリビューション (Contributing)

バグ報告、機能提案、ドキュメントの改善など、コミュニティからの貢献を歓迎します！
開発環境のセットアップやプルリクエストの作成手順については、[CONTRIBUTING.md](../../CONTRIBUTING.md) および [行動規範 (Code of Conduct)](../../CODE_OF_CONDUCT.md) をご参照ください。

## サポート

Tag Ontology はオープンソースの無料ソフトウェアです。お役に立てましたら、[Buy Me a Coffee](https://buymeacoffee.com/namhyunko) よりご支援いただけると幸いです。

## ライセンス

Copyright (c) 2026 NamhyeonKo

本プロジェクトは [MIT License](../../LICENSE) のもとで公開されています。自由に利用、改変、配布することができます。
