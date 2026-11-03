# Installation & Updating Guide

This guide covers how to install and update **Tag Ontology** across all supported methods, including the Obsidian Community Plugins directory, BRAT for beta testing, manual releases, and the standalone CLI tool.

---

## Prerequisites

- **Obsidian**: Desktop version 1.14.0 or higher.
- **Core Graph View**: Must be enabled (**Settings → Core plugins → Graph view**).
- **Graph Filter**: In Graph settings (gear icon), ensure **Filters → Tags** is toggled **ON** so tag nodes are rendered.

---

## Methods Summary

| Method | Best For | Auto-Updates |
| --- | --- | --- |
| [Community Plugins](#1-community-plugins-recommended) | General users | Yes (Obsidian prompt) |
| [BRAT (Beta Releases)](#2-obsidian42---brat-beta-releases) | Early testers & pre-releases | Yes (BRAT command) |
| [Manual Release](#3-manual-installation) | Offline / Firewalled environments | Manual overwrite |
| [Development Build](#4-local-development-build) | Developers / Custom forks | Via `npm run deploy` |
| [Standalone CLI](#5-standalone-cli--library-tag-ontology) | Headless CI / Automation / Scripts | Via `npm` / `npx` |

---

## 1. Community Plugins (Recommended)

### Installation
1. In Obsidian, open **Settings → Community plugins**.
2. Turn off **Restricted mode** if prompted.
3. Click **Browse** and search for **Tag Ontology**.
4. Click **Install**, then click **Enable**.
5. Alternatively, open the directory page: [Tag Ontology on Obsidian Community Plugins](https://community.obsidian.md/plugins/tag-ontology).

### Updating
1. Open **Settings → Community plugins**.
2. Click **Check for updates**.
3. If an update is available, click **Update all** or click **Update** next to **Tag Ontology**.
4. Reload Obsidian or restart the app if prompted.

---

## 2. Obsidian42 - BRAT (Beta Releases)

Use [BRAT](https://github.com/TfTHacker/obsidian42-brat) to receive prerelease updates directly from GitHub.

### Installation
1. Install and enable the **Obsidian42 - BRAT** community plugin.
2. Open the Command Palette (`Ctrl+P` or `Cmd+P`).
3. Run the command:
   ```text
   BRAT: Add a beta plugin for testing
   ```
4. Enter the GitHub repository path:
   ```text
   NamhyeonKo/obsidian-tag-ontology
   ```
5. Click **Add Plugin**. BRAT will download the files and enable the plugin.

### Updating
To check for and install updates to beta plugins:
1. Open the Command Palette (`Ctrl+P` or `Cmd+P`).
2. Run either:
   - `BRAT: Check for updates to all beta plugins`
   - or `BRAT: Check for plugin updates`
3. If an update is downloaded, BRAT will notify you and reload the plugin automatically.

---

## 3. Manual Installation

Use this method if your machine cannot access GitHub directly or you want to freeze a specific version.

### Installation
1. Go to the [GitHub Releases](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest) page.
2. Download three files from the latest release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. Navigate to your Obsidian vault folder and locate or create the plugin directory:
   ```text
   <Your-Vault-Path>/.obsidian/plugins/tag-ontology/
   ```
   *(Note: `.obsidian` is a hidden directory on macOS and Linux. Use `Cmd+Shift+.` on macOS or `Ctrl+H` on Linux to view hidden folders.)*
4. Place `main.js`, `manifest.json`, and `styles.css` into that directory.
5. In Obsidian, go to **Settings → Community plugins**, click the **Reload plugins** button, and toggle **Tag Ontology** on.

### Updating
1. Download the new release files (`main.js`, `manifest.json`, `styles.css`) from [Releases](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases).
2. Overwrite the existing files inside `<Your-Vault-Path>/.obsidian/plugins/tag-ontology/`.
3. Open the Command Palette in Obsidian and run:
   ```text
   Reload app without saving
   ```
   *(Or disable and re-enable **Tag Ontology** in **Settings → Community plugins**.)*

---

## 4. Local Development Build

To build the plugin from source and deploy directly to your test vault:

```sh
# 1. Clone repository
git clone https://github.com/NamhyeonKo/obsidian-tag-ontology.git
cd obsidian-tag-ontology

# 2. Install dependencies (Node.js 22.18+ required)
npm ci

# 3. Build plugin and library
npm run build

# 4. Deploy build assets directly to your vault
npm run deploy -- "/path/to/your/vault"
```

The `deploy` script automatically copies `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/tag-ontology/` in the target vault while preserving any existing `data.json` settings file.

---

## 5. Standalone CLI & Library (`tag-ontology`)

The core ontology validator and scanner is also available as a standalone npm package for headless use without running Obsidian.

### Installation & Execution with `npx` (No Install Required)
Always runs the latest version without manual updates:
```sh
npx tag-ontology@latest check --root /path/to/vault --json
```

### Global Installation via `npm`
```sh
npm install -g tag-ontology@latest
```

### Updating Global CLI
```sh
npm update -g tag-ontology
# or force reinstall latest:
npm install -g tag-ontology@latest
```

### Check Installed CLI Version
```sh
tag-ontology --version
```

---

## Post-Installation Verification

1. **Open the Ontology View**:
   - Click the ribbon icon (book icon) on the left sidebar, or
   - Press `Cmd/Ctrl+P` and execute `Tag Ontology: Open graph`.
2. **Enable Tags in Graph Settings**:
   - In the Graph view, click the **Gear** icon to open Graph settings.
   - Under **Filters**, verify that **Tags** is turned **ON**.
3. **Verify Tag Dictionary Tab**:
   - A **Tag dictionary** panel appears in your left sidebar, displaying root tags, note counts, search, and validation tools.

---

## Troubleshooting

- **Tag hierarchy is not showing in Graph view**:
  - Check that **Filters → Tags** is enabled in Obsidian's Graph settings.
  - Check that your vault contains a valid `Tag-Dictionary.json` or create your first tags using the **+** button in the sidebar panel.
- **Plugin does not appear in Community plugins after manual install**:
  - Ensure the files are placed directly in `.obsidian/plugins/tag-ontology/`, not inside a nested subfolder.
  - Ensure the file names match exactly: `main.js`, `manifest.json`, `styles.css`.
- **Plugin updates do not take effect**:
  - Run `Reload app without saving` from the Obsidian Command Palette (`Cmd/Ctrl+P`) or restart Obsidian completely.
