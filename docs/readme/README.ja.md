# Tag Ontology

[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
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

- **サイドバーで階層を構築**: ノートで既に使用されているタグや新しいタグを追加し、名前・説明・エイリアス・親タグ・子タグ・関連タグを編集したり、削除したりできます。ファイルの直接編集は不要で、保存時に外部の変更を上書きすることもありません。
- **標準グラフビューの拡張**: ノート、内部リンク、フィルター、カラーグループ、矢印表示などの標準設定がそのまま動作します。
- **折りたたみ可能なタグ階層**: 辞書のタグはルートまで折りたたまれた状態で表示され、各ノートは最も近い可視の親タグにリンクされます。タグをクリックして選択し、ダブルクリックすると 1 段階展開され、ノートがより具体的な子タグへと再配置されます。再度ダブルクリックすると折りたたまれます。
- **下位タグを含むノート数カウント (Roll-up)**: タグごとに、直接付けられたノート数と、すべての子孫タグを含むノート数の両方を確認できます。
- **複数の親タグと関連タグのサポート**: 実線矢印は親から子への階層関係を示し、破線は非階層の関連タグを繋ぎます。
- **3 つのレイアウト**: Force（力学モデル）、垂直ツリー（Vertical tree）、水平ツリー（Horizontal tree）。
- **3D ビュー (Beta)**: 同じ階層構造を 3 次元空間で探索。視点を回転させたり、タグをクリックしてスムーズにズーム移動できます。
- **専用サイドバータブ**: タグ名やエイリアスによる検索、詳細情報の確認、ワンクリックでの辞書整合性チェックを実行できます。
- **辞書チェック (Dictionary Check)**: 保管庫で使用されているが辞書に未登録のタグや、辞書に定義されているがノートで使われていないタグを一覧表示します。報告のみを行い、勝手にファイルを書き換えることはありません。
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

辞書ファイルは `.tow/` 内を含め、保管庫内の `.json` ファイルパスに保存できます。設定でパスを一度も選んでいない場合、`.tow/tag-dictionary.json` があればそれを使い、なければ保管庫のルートにある `Tag-Dictionary.json` を使います。設定でパスを選んだ場合は、`.tow/` の辞書があっても選択したパスを使います。

**Obsidian Sync は `.obsidian` 以外のドットフォルダーを同期しません** ([Sync の設定](https://obsidian.md/help/sync/settings))。Obsidian Sync を使う場合は、辞書を非表示フォルダー以外のパスに保存してください。Git やファイル単位の同期ツールは、除外設定がない限りドットフォルダーも同期します。

## プライバシーとセキュリティ

- 完全オフライン動作: 外部ネットワーク通信、テレメトリ収集、ユーザーアカウント等は一切不要です。
- ノートのメタデータとタグ辞書 JSON ファイルのみを読み取ります。
- プラグイン自体の設定ファイル (`data.json`) と、サイドバーで保存したときに使用中のタグ辞書だけを書き込みます。辞書は設定で選んだパスを使い、未選択の場合は `.tow/tag-dictionary.json` があればそれを、なければ `Tag-Dictionary.json` を使います。

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
