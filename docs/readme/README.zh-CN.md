# Tag Ontology

[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
[![Build](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml/badge.svg)](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

[English](../../README.md) | [한국어](README.ko.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md)

**像连接笔记一样连接标签。**

Tag Ontology 允许你在侧边栏标签页中为每个标签指定父级、子级和关联标签，无需手动编辑任何文件。你可以在 Obsidian 原生的**关系图谱（Graph view）**中探索这些层级结构：折叠或展开分支、切换到树形布局，并保持选中的标签处于焦点。笔记、双链、过滤器、颜色组及显示设置均一如既往地正常工作。

插件绝不会修改你的笔记内容。它仅在侧边栏中添加、编辑或删除标签时，将数据写入保管库中的纯 JSON 标签字典。

> **开始使用：** 层级结构由标签节点构建，因此需要开启关系图谱设置中的 **过滤器 → 标签 (Filters → Tags)**。全新安装时会自动为你开启。

![Tag Ontology 演示](../../assets/0.9.0/demo.gif)

> [!TIP]
> **结合 AI Agent 使用**：与 [TOW](https://github.com/NamhyeonKo/tag-ontology-wiki) 搭配使用，可以通过 AI Agent 自动管理标签与字典，并执行更广泛的知识库整理工作。

## 主要功能

- **在侧边栏中构建层级**：直接添加笔记中已有的标签或新标签，编辑名称、描述、别名、父级、子级及相关联标签，或删除标签。无需手动编辑文件，保存时绝不会覆盖外部修改。
- **核心关系图谱的原生扩展**：笔记、双向链接、筛选过滤器、颜色分组、箭头等核心图谱功能完全兼容。
- **可折叠展开的标签层级**：字典中的标签初始折叠至根节点，各笔记链接到其最近的可见祖先节点。单击选中标签，双击展开一级，笔记会自动归属到更具体的子标签下。再次双击即可折叠。
- **包含下级的笔记计数（Roll-up）**：直观查看直接标记该标签的笔记数量，以及包含所有后代标签的总笔记数。
- **多重继承与关联标签**：实线箭头表示父子继承关系，虚线连接非层级的相关标签。
- **三种图谱布局**：力导向布局（Force）、垂直树形（Vertical tree）与水平树形（Horizontal tree）。
- **3D 视图（Beta）**：在三维空间中探索标签层级，支持 360 度旋转，点击标签平滑飞跃定位。
- **侧边栏专用面板**：按名称或别名搜索标签，查阅详细信息，并一键运行字典检查。
- **字典检查（Dictionary Check）**：列出库中已使用但未在字典登记的标签，以及字典中已定义但尚未被任何笔记使用的标签。仅报告状态，不擅自修改任何内容。
- **自定义标签配色（可选）**：为图谱与侧边栏中的标签统一指定颜色（默认为强调色）。
- **聚焦高亮（可选）**：保持选中的标签及其邻近节点高亮，淡化其余无关节点。
- **视图记忆**：已展开的标签及显示开关会自动保存，并在所有图谱视图间同步。

| 侧边栏面板 | 字典检查 |
| --- | --- |
| ![侧边栏面板](../../assets/0.9.0/tag-panel.png) | ![字典检查](../../assets/0.9.0/dictionary-check.png) |
| **折叠至根节点** | **完全展开** |
| ![折叠状态](../../assets/0.9.0/collapsed.png) | ![展开状态](../../assets/0.9.0/expanded.png) |
| **垂直树形** | **水平树形** |
| ![垂直树形](../../assets/0.9.0/tree-vertical.png) | ![水平树形](../../assets/0.9.0/tree-horizontal.png) |

## 安装与更新

详细安装步骤、更新命令、BRAT 配置与故障排查，请参阅完整的 **[安装与更新指南 (英文)](../installation.md)**。

- **Obsidian 社区插件市场**：
  - 安装：进入 **设置 → 社区插件 → 浏览**，搜索 "Tag Ontology"，点击安装并启用（[社区主页](https://community.obsidian.md/plugins/tag-ontology)）。
  - 更新：进入 **设置 → 社区插件 → 检查更新**，点击全部更新或单独更新 Tag Ontology。
- **通过 BRAT（测试版）**：
  - 运行命令 `BRAT: Add a beta plugin for testing`，输入 `NamhyeonKo/obsidian-tag-ontology`。
  - 更新：运行命令 `BRAT: Check for updates to all beta plugins`。
- **独立 CLI 工具 (`tag-ontology`)**：
  - 运行最新版：`npx tag-ontology@latest check --root /path/to/vault --json`
  - 全局安装 / 更新：`npm install -g tag-ontology@latest` / `npm update -g tag-ontology`

> **环境要求**：必须在 Obsidian 中启用核心的 **关系图谱（Graph view）** 插件，并在图谱设置中开启 **过滤器 → 标签 (Filters → Tags)**。

## 设置

字典可以保存在库中任意以 `.json` 结尾的路径，包括 `.tow/` 文件夹。此版本之前保存的自定义路径也视为用户已选择，默认的 `Tag-Dictionary.json` 除外。如果没有选择路径，插件会在 `.tow/tag-dictionary.json` 存在时使用它；否则使用库根目录下的 `Tag-Dictionary.json`。如果已选择路径，即使 `.tow/` 字典存在，也始终使用所选路径。

**Obsidian Sync 不会同步 `.obsidian` 以外以点开头的隐藏文件夹**（[Sync 设置](https://obsidian.md/help/sync/settings)）。如果使用 Obsidian Sync，请为字典选择一个可见路径。除非配置为忽略，Git 和按文件同步工具会同步点开头的文件夹。

## 隐私与安全

- 完全离线运行：无任何网络请求、遥测或用户账号系统。
- 仅读取笔记元数据与标签字典 JSON 文件。
- 插件只会写入自身配置文件（`data.json`），以及在侧边栏保存时写入当前使用的字典文件：设置中选择的路径（包括此前版本保存的自定义路径）；若未选择，则在 `.tow/tag-dictionary.json` 存在时使用它，否则使用 `Tag-Dictionary.json`。绝不修改库内的 Markdown 文档。

## 独立库与 CLI

独立 npm 包 [`tag-ontology`](../../packages/tag-ontology/README.md) 提供了同等规格的字典验证规则、ESM 库与 Node.js 命令行工具，无需运行 Obsidian 即可在自动化脚本中快速校验标签完整性：

```sh
npx tag-ontology@latest check --root /path/to/vault --json
```

## 参与贡献 (Contributing)

热烈欢迎社区贡献！无论是报告 Bug、提出新功能建议还是提交代码：

1. 请查阅现有的 [Issues](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues)。
2. Fork 本仓库并基于 `dev` 分支创建特性分支。
3. 遵循 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 提交规范。
4. 确保所有校验通过：`npm run lint && npm test && npm run build`。
5. 提交 Pull Request 至 `dev` 分支。

详细开发规范请参见 [CONTRIBUTING.md](../../CONTRIBUTING.md) 与 [行为准则 (Code of Conduct)](../../CODE_OF_CONDUCT.md)。

## 赞助支持

Tag Ontology 是一款免费且开源的软件。如果它对你的工作流有所帮助，欢迎通过 [Buy Me a Coffee](https://buymeacoffee.com/namhyunko) 为作者买一杯咖啡。

## 开源协议

Copyright (c) 2026 NamhyeonKo

本项目采用 [MIT License](../../LICENSE) 开源协议授权，你可以自由使用、修改与分发本软件。
