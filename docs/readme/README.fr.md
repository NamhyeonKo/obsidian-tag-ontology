# Tag Ontology

[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
[![Build](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml/badge.svg)](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

[English](../../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [Español](README.es.md) | **Français**

**Liez vos étiquettes comme vous liez vos notes.**

Tag Ontology vous permet de définir des étiquettes parentes, enfants et associées directement depuis un onglet latéral, sans avoir à modifier manuellement vos fichiers. Vous pouvez ensuite explorer cette hiérarchie dans la **Vue graphique (Graph view)** native d'Obsidian : repliez et développez chaque branche, passez à une disposition en arbre et gardez l'étiquette sélectionnée au centre de l'attention. Vos notes, liens, filtres, groupes de couleurs et paramètres d'affichage continuent de fonctionner normalement.

Le plugin ne modifie jamais vos notes Markdown. Il écrit uniquement dans le dictionnaire d'étiquettes (un simple fichier JSON situé dans votre coffre), et seulement lorsque vous ajoutez, modifiez ou supprimez une étiquette depuis l'onglet latéral.

> **Pour démarrer :** La hiérarchie étant construite à partir des nœuds d'étiquettes, l'option **Filtres → Étiquettes (Filters → Tags)** doit être activée dans les paramètres du graphique. Une nouvelle installation l'active automatiquement.

![Démonstration de Tag Ontology](../../assets/0.9.0/demo.gif)

> [!TIP]
> **Utilisation avec des agents IA** : Associez-le à [TOW](https://github.com/NamhyeonKo/tag-ontology-wiki) pour gérer vos étiquettes et dictionnaires avec des agents d'IA, ainsi que pour organiser l'ensemble de votre coffre.

## Fonctionnalités principales

- **Construisez votre hiérarchie dans la barre latérale** : Ajoutez des étiquettes déjà présentes dans vos notes ou de nouveaux termes, modifiez leur nom, description, alias, parents, enfants et liens associés, ou supprimez des étiquettes. Aucune modification manuelle de fichier, et l'enregistrement n'écrase jamais les changements externes.
- **Extension transparente du graphique natif** : Les notes, liens entre notes, filtres, groupes de couleurs et flèches fonctionnent comme d'habitude.
- **Hiérarchie repliable et dépliable** : Les étiquettes du dictionnaire sont initialement repliées sur leurs racines, et chaque note est reliée à son ancêtre visible le plus proche. Cliquez pour sélectionner, double-cliquez pour développer d'un niveau (les notes se repositionnent sur les étiquettes enfants plus spécifiques), et double-cliquez à nouveau pour replier.
- **Compteur de notes cumulé (Roll-up)** : Visualisez instantanément les notes associées *directement* à une étiquette, ainsi que le total incluant toutes ses sous-étiquettes.
- **Parents multiples et étiquettes associées** : Des flèches pleines indiquent les liens hiérarchiques parent-enfant ; des traits pointillés relient les étiquettes associées.
- **Trois dispositions** : Force (physique), arbre vertical et arbre horizontal.
- **Vue 3D (Bêta)** : Explorez la même hiérarchie en trois dimensions : pivotez librement dans l'espace et cliquez sur une étiquette pour zoomer vers elle.
- **Onglet dédié dans la barre latérale** : Recherchez par nom ou par alias, consultez les détails d'une étiquette et lancez une vérification du dictionnaire en un clic.
- **Vérification du dictionnaire (Dictionary Check)** : Répertorie les étiquettes utilisées dans votre coffre mais absentes du dictionnaire, ainsi que les étiquettes enregistrées qu'aucune note n'utilise encore. Génère un simple rapport sans rien modifier de son propre chef.
- **Couleur personnalisée (optionnel)** : Attribuez une couleur uniforme à toutes les étiquettes dans le graphique et le panneau latéral (la couleur d'accentuation par défaut).
- **Mise en valeur ciblée (optionnel)** : Gardez l'étiquette sélectionnée et ses nœuds voisins lumineux pendant que le reste s'estompe.
- **Mémorisation de l'affichage** : Les étiquettes développées et les options d'affichage sont conservées et partagées entre tous les onglets de graphique.

| Onglet latéral | Vérification du dictionnaire |
| --- | --- |
| ![Onglet latéral](../../assets/0.9.0/tag-panel.png) | ![Vérification](../../assets/0.9.0/dictionary-check.png) |
| **Replié sur les racines** | **Entièrement développé** |
| ![Replié](../../assets/0.9.0/collapsed.png) | ![Développé](../../assets/0.9.0/expanded.png) |
| **Arbre vertical** | **Arbre horizontal** |
| ![Arbre vertical](../../assets/0.9.0/tree-vertical.png) | ![Arbre horizontal](../../assets/0.9.0/tree-horizontal.png) |

## Installation et Mise à jour

Pour consulter des instructions détaillées, les builds de développement et le dépannage, reportez-vous au **[Guide complet d'installation et de mise à jour (en anglais)](../installation.md)**.

- **Depuis les plugins communautaires d'Obsidian** :
  - Installation : Ouvrez **Paramètres → Plugins communautaires → Parcourir**, recherchez "Tag Ontology", puis cliquez sur Installer et Activer ([Page du plugin](https://community.obsidian.md/plugins/tag-ontology)).
  - Mise à jour : Rendez-vous dans **Paramètres → Plugins communautaires → Vérifier les mises à jour**.
- **Avec BRAT (versions bêta)** :
  - Exécutez la commande : `BRAT: Add a beta plugin for testing` et entrez `NamhyeonKo/obsidian-tag-ontology`.
  - Mise à jour : Exécutez la commande : `BRAT: Check for updates to all beta plugins`.
- **Outil CLI autonome (`tag-ontology`)** :
  - Exécuter la dernière version : `npx tag-ontology@latest check --root /path/to/vault --json`
  - Installation / mise à jour globale : `npm install -g tag-ontology@latest` / `npm update -g tag-ontology`

> **Prérequis indispensable** : Le plugin de base **Vue graphique (Graph view)** doit être activé dans Obsidian, avec l'option **Filtres → Étiquettes (Filters → Tags)** cochée.

## Paramètres

Le dictionnaire peut se trouver dans n'importe quel chemin du coffre se terminant par `.json`, y compris dans un dossier `.tow/`. Si vous n'avez jamais choisi de chemin dans les paramètres, le plugin utilise `.tow/tag-dictionary.json` s'il existe ; sinon, il utilise `Tag-Dictionary.json` à la racine du coffre. Si vous choisissez un chemin dans les paramètres, celui-ci est toujours utilisé, même si le dictionnaire `.tow/` existe.

**Obsidian Sync ne synchronise pas les dossiers cachés commençant par un point, à l'exception de `.obsidian`** ([paramètres de Sync](https://obsidian.md/help/sync/settings)). Si vous utilisez Obsidian Sync, choisissez un chemin visible pour le dictionnaire. Git et les outils de synchronisation au niveau des fichiers prennent en charge les dossiers cachés, sauf s'ils sont ignorés.

## Confidentialité et Sécurité

- Fonctionnement 100 % hors ligne : Aucune requête réseau, aucune télémétrie et aucun compte requis.
- Lit uniquement les métadonnées de vos notes et le fichier JSON du dictionnaire.
- Ne modifie jamais vos fichiers Markdown ; seuls le fichier de configuration interne (`data.json`) et, lors de l'enregistrement dans la barre latérale, le fichier dictionnaire utilisé sont modifiés : le chemin choisi ou, si aucun chemin n'a été choisi, `.tow/tag-dictionary.json` s'il existe, sinon `Tag-Dictionary.json`.

## Bibliothèque et CLI

Le paquet npm indépendant [`tag-ontology`](../../packages/tag-ontology/README.md) fournit les mêmes règles de validation sous la forme d'une bibliothèque ESM et d'un outil CLI Node.js, ce qui permet d'automatiser le contrôle de votre dictionnaire sans lancer Obsidian :

```sh
npx tag-ontology@latest check --root /path/to/vault --json
```

## Contribuer (Contributing)

Les contributions de la communauté sont vivement appréciées ! Pour signaler une anomalie, proposer une amélioration ou soumettre du code :

1. Consultez les [Issues](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues) existantes.
2. Forkez le dépôt et créez une branche basée sur `dev`.
3. Respectez la convention [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
4. Vérifiez que tous les tests réussissent : `npm run lint && npm test && npm run build`.
5. Ouvrez une Pull Request ciblant la branche `dev`.

Consultez [CONTRIBUTING.md](../../CONTRIBUTING.md) et le [Code de conduite](../../CODE_OF_CONDUCT.md) pour plus d'informations.

## Soutenir le projet

Tag Ontology est un logiciel libre et open source. Si ce projet vous est utile, vous pouvez [m'offrir un café](https://buymeacoffee.com/namhyunko) pour soutenir son développement.

## Licence

Copyright (c) 2026 NamhyeonKo

Ce projet est sous licence [MIT License](../../LICENSE). Vous êtes libre de l'utiliser, de le modifier et de le redistribuer selon les termes de cette licence.
