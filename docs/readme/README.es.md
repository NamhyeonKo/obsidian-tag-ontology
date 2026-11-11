# Tag Ontology

[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
[![Build](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml/badge.svg)](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

[English](../../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | **Español** | [Français](README.fr.md)

**Vincula tus etiquetas de la misma forma que vinculas tus notas.**

Tag Ontology te permite asignar padres, hijos y etiquetas relacionadas a cada etiqueta desde una pestaña lateral, sin necesidad de editar ningún archivo manualmente. Explora la jerarquía directamente en la **Vista de gráfico (Graph view)** nativa de Obsidian: contrae y expande ramas, cambia a disposiciones de árbol y mantén la etiqueta seleccionada en foco. Las notas, enlaces entre notas, filtros, grupos de colores y configuraciones siguen funcionando como siempre.

Nunca modifica tus notas. Solo escribe en el diccionario de etiquetas (un archivo JSON plano en tu bóveda) cuando agregas, editas o eliminas una etiqueta desde la barra lateral.

> **Para comenzar:** La jerarquía se construye a partir de los nodos de etiquetas, por lo que requiere activar **Filtros → Etiquetas (Filters → Tags)** en los ajustes del gráfico. Una instalación limpia lo activa automáticamente.

![Demostración de Tag Ontology](../../assets/0.9.0/demo.gif)

> [!TIP]
> **Uso con agentes de IA**: Combínalo con [TOW](https://github.com/NamhyeonKo/tag-ontology-wiki) para administrar etiquetas y diccionarios con agentes de IA, junto con tareas generales de mantenimiento de tu bóveda.

## Características principales

- **Construye tu jerarquía en la barra lateral**: Agrega etiquetas que tus notas ya usan o nuevos términos, edita nombre, descripción, alias, facet, padres, hijos y etiquetas relacionadas, o elimina etiquetas. Sin edición manual de archivos y sin sobrescribir cambios externos al guardar.
- **Extensión nativa del gráfico principal**: Las notas, enlaces entre notas, filtros, grupos de color y flechas funcionan con total normalidad.
- **Jerarquía de etiquetas colapsable**: Las etiquetas del diccionario comienzan colapsadas en sus raíces y cada nota se enlaza a su ancestro visible más cercano. Haz clic para seleccionar una etiqueta y doble clic para expandirla un nivel, viendo cómo las notas se desplazan hacia las etiquetas hijas más específicas. Vuelve a hacer doble clic para colapsar.
- **Recuento de notas acumulado (Roll-up)**: Visualiza tanto las notas etiquetadas *directamente* como el total que incluye a todos sus descendientes.
- **Múltiples padres y etiquetas relacionadas**: Flechas sólidas indican relaciones padre-hijo; líneas discontinuas conectan etiquetas relacionadas sin relación jerárquica.
- **Tres disposiciones de gráfico**: Fuerza (Force), árbol vertical (Vertical tree) y árbol horizontal (Horizontal tree).
- **Vista 3D (Beta)**: Explora la misma jerarquía en tres dimensiones: orbita libremente y haz clic en una etiqueta para volar hacia ella.
- **Panel dedicado en la barra lateral**: Busca por nombre o alias, consulta los detalles de una etiqueta y ejecuta comprobaciones de integridad del diccionario en un clic.
- **Comprobación del diccionario (Dictionary Check)**: Enumera las etiquetas utilizadas en tu bóveda pero ausentes del diccionario, junto con nombres similares del diccionario; las etiquetas del diccionario que aún no usa ninguna nota; las notas que usan una etiqueta como alias o con mayúsculas y minúsculas distintas; y las notas que incluyen una etiqueta más amplia junto a otra más específica. Solo informa y nunca modifica nada.
- **Colores personalizados (opcional)**: Asigna un color unificado a todas las etiquetas en el gráfico y la barra lateral (por defecto, el color de acento).
- **Enfoque resaltado (opcional)**: Mantén la etiqueta seleccionada y sus nodos vecinos (padres, hijos y relacionados) iluminados mientras el resto se atenúa.
- **Memoria de estado de vista**: Las etiquetas expandidas y las opciones de visualización se guardan y comparten en todas las pestañas de gráfico.

| Pestaña lateral | Comprobación de diccionario |
| --- | --- |
| ![Pestaña lateral](../../assets/0.9.0/tag-panel.png) | ![Comprobación de diccionario](../../assets/0.9.0/dictionary-check.png) |
| **Colapsado a las raíces** | **Totalmente expandido** |
| ![Colapsado](../../assets/0.9.0/collapsed.png) | ![Expandido](../../assets/0.9.0/expanded.png) |
| **Árbol vertical** | **Árbol horizontal** |
| ![Árbol vertical](../../assets/0.9.0/tree-vertical.png) | ![Árbol horizontal](../../assets/0.9.0/tree-horizontal.png) |

## Instalación y Actualización

Para obtener instrucciones completas paso a paso, compilaciones de desarrollo y solución de problemas, consulta la **[Guía completa de instalación y actualización (en inglés)](../installation.md)**.

- **Plugins de la comunidad de Obsidian**:
  - Instalación: Abre **Ajustes → Plugins de la comunidad → Explorar**, busca "Tag Ontology", e instala y activa el plugin ([Página del directorio](https://community.obsidian.md/plugins/tag-ontology)).
  - Actualización: Ve a **Ajustes → Plugins de la comunidad → Comprobar actualizaciones**.
- **Con BRAT (versiones beta)**:
  - Ejecuta el comando: `BRAT: Add a beta plugin for testing` e ingresa `NamhyeonKo/obsidian-tag-ontology`.
  - Actualización: Ejecuta el comando: `BRAT: Check for updates to all beta plugins`.
- **Herramienta CLI independiente (`tag-ontology`)**:
  - Ejecutar la versión más reciente: `npx tag-ontology@latest check --root /path/to/vault --json`
  - Instalación / actualización global: `npm install -g tag-ontology@latest` / `npm update -g tag-ontology`

> **Requisito indispensable**: El plugin principal **Vista de gráfico (Graph view)** debe estar habilitado en Obsidian, con la opción **Filtros → Etiquetas (Filters → Tags)** activada.

## Configuración

Sin una ruta elegida, el plugin busca `tow/tag-dictionary.json`, después `.tow/tag-dictionary.json` y, por último, `Tag-Dictionary.json`. Una instalación nueva crea el diccionario en la primera ubicación. Los archivos `Tag-Dictionary.json` existentes siguen funcionando y también se leen los diccionarios `.tow/` de TOW 0.5.0–0.5.1.

**Obsidian Sync no sincroniza las carpetas ocultas que empiezan por punto, excepto `.obsidian`** ([ajustes de Sync](https://obsidian.md/help/sync/settings)). Si usas Obsidian Sync, elige una ruta visible para el diccionario. Git y las herramientas de sincronización por archivos incluyen las carpetas ocultas, salvo que estén excluidas.

**Kebab-case tag names** (desactivado de forma predeterminada): al activarlo, el formulario de edición solo acepta etiquetas nuevas o renombradas con letras minúsculas y números unidos por guiones, como `machine-learning`, el formato que comprueba TOW. Se conservan los nombres existentes.

## Privacidad y Seguridad

- Funcionamiento 100% local y offline: Sin peticiones de red, sin telemetría y sin necesidad de cuentas.
- Solo lee los metadatos de las notas y el archivo JSON del diccionario.
- El plugin solo escribe su archivo de configuración y, al guardar desde la barra lateral, el diccionario en uso: la ruta elegida o, si no hay ninguna, `tow/tag-dictionary.json`, `.tow/tag-dictionary.json` y `Tag-Dictionary.json`, en ese orden.

## Biblioteca y CLI

El paquete independiente publicado en npm como [`tag-ontology`](../../packages/tag-ontology/README.md) ofrece las mismas reglas de validación en forma de biblioteca ESM y CLI de Node.js, permitiendo inspeccionar la bóveda en pipelines y scripts sin necesidad de tener Obsidian abierto:

```sh
npx tag-ontology@latest check --root /path/to/vault --json
```

## Contribuir (Contributing)

¡Las contribuciones de la comunidad son muy bienvenidas! Ya sea reportando errores, sugiriendo mejoras o enviando pull requests:

1. Revisa los [Issues](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues) existentes.
2. Haz un fork del repositorio y crea una rama a partir de `dev`.
3. Sigue la convención de [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
4. Asegúrate de que todas las pruebas pasen: `npm run lint && npm test && npm run build`.
5. Envía tu Pull Request apuntando a la rama `dev`.

Consulta [CONTRIBUTING.md](../../CONTRIBUTING.md) y el [Código de Conducta](../../CODE_OF_CONDUCT.md) para más detalles.

## Apoyo y Donaciones

Tag Ontology es software libre y de código abierto. Si te resulta útil, puedes [invitarme a un café](https://buymeacoffee.com/namhyunko).

## Licencia

Copyright (c) 2026 NamhyeonKo

Este proyecto está bajo la [Licencia MIT](../../LICENSE). Eres libre de usarlo, modificarlo y distribuirlo bajo los términos de la misma.
