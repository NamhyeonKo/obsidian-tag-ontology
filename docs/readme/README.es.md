# Tag Ontology

[![GitHub stars](https://img.shields.io/github/stars/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/stargazers)
[![Obsidian downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%22tag-ontology%22%5D.downloads&label=downloads&logo=obsidian&color=7C3AED)](https://community.obsidian.md/plugins/tag-ontology)
[![Latest release](https://img.shields.io/github/v/release/NamhyeonKo/obsidian-tag-ontology?logo=github)](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases/latest)
[![npm](https://img.shields.io/npm/v/tag-ontology?logo=npm)](https://www.npmjs.com/package/tag-ontology)
[![Build](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml/badge.svg)](https://github.com/NamhyeonKo/obsidian-tag-ontology/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

[English](../../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | **Español** | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md) | [Italiano](README.it.md)

**Vincula tus etiquetas de la misma forma que vinculas tus notas.**

Tag Ontology te permite asignar padres, hijas y etiquetas relacionadas a cada etiqueta desde una pestaña en la barra lateral, sin editar ningún archivo. Luego explóralas en la propia **Vista de grafo** de Obsidian: colapsa y expande cada rama, cambia a un diseño de árbol y mantén enfocada la etiqueta seleccionada. Las notas, los enlaces entre notas, los filtros, los grupos de color y los ajustes de visualización siguen funcionando como siempre.

Nunca modifica tus notas. Solo escribe en el diccionario de etiquetas, un archivo JSON simple en tu bóveda, y únicamente cuando añades, editas o eliminas una etiqueta en la pestaña lateral.

## ¿Por qué Tag Ontology?

Un concepto puede conectarse con varios campos a la vez. Por ejemplo, RAG está relacionado con los LLM, la recuperación de información y los grafos de conocimiento. Al organizarlo con carpetas o etiquetas anidadas, tenía que elegir bajo qué ruta colocarlo, y esa única ruta hacía difícil ver sus demás relaciones.

Quería gestionar y explorar las relaciones entre conceptos por separado, manteniendo intactos la ubicación de los documentos y el texto original. Creé Tag Ontology para que las etiquetas pudieran tener múltiples padres y etiquetas relacionadas, con esas relaciones navegables en el gráfico de Obsidian. Más adelante lo amplié para que la CLI y TOW pudieran usar las mismas relaciones y reglas.

> **Para empezar:** la jerarquía se construye a partir de los nodos de etiquetas, por lo que necesita **Filtros → Etiquetas** activado en los ajustes del gráfico. Una instalación nueva lo activa por ti.

![Demostración de Tag Ontology](../../assets/0.9.0/demo.gif)

> [!TIP]
> **Uso con agentes de IA**: Combínalo con [TOW](https://github.com/NamhyeonKo/tag-ontology-wiki) para gestionar etiquetas y diccionarios con agentes de IA, junto con tareas más amplias de tu bóveda. ([Más información](#proyectos-relacionados))

## Características

- **Construye tu jerarquía en la barra lateral.** Añade etiquetas que tus notas ya usan o nombres nuevos; edita el nombre, la descripción, los alias, el `facet`, los padres, las hijas y las etiquetas relacionadas de una etiqueta, y elimina etiquetas. Sin editar archivos manualmente, y guardar nunca sobrescribe cambios realizados en otro lugar.
- **Una extensión del gráfico nativo.** Las notas, los enlaces entre notas, los filtros, los grupos de color, las flechas y los demás ajustes nativos funcionan como de costumbre.
- **Jerarquía de etiquetas colapsable.** Las etiquetas del diccionario empiezan colapsadas en sus raíces, y cada nota se enlaza con su ancestro visible más cercano. Haz clic en una etiqueta para seleccionarla y doble clic para expandirla un nivel, y observa cómo sus notas pasan a las etiquetas hijas más específicas. Vuelve a hacer doble clic para colapsarla.
- **Recuento de notas con acumulado.** Para cada etiqueta ves las notas etiquetadas *directamente* y las notas etiquetadas con esa etiqueta *o cualquiera de sus descendientes*.
- **Múltiples padres y etiquetas relacionadas.** Las flechas sólidas van de padre a hija. Las líneas discontinuas conectan etiquetas relacionadas.
- **Cuatro diseños.** `Force`, **Mapa mental**, un árbol vertical y un árbol horizontal. Los árboles normales conservan su diseño según la jerarquía visible y distribuyen los árboles raíz en filas. Mapa mental inicia la raíz elegida en el nivel 0 y usa la ruta parental abierta más larga en ese momento para el espaciado. Los colores de las etiquetas siguen usando la profundidad completa del diccionario.
- **Mapa mental.** Mapa mental primero pregunta por dónde empezar: busca etiquetas de la jerarquía o elige una de las raíces sugeridas y explora únicamente la rama de esa etiqueta. Usa **Cambiar etiqueta inicial** (el botón de inicio en la fila inferior) para volver al selector. Al volver a otro diseño se restaura su expansión previa; al entrar de nuevo en Mapa mental se muestra el selector. Selecciona una etiqueta para ver sus detalles en la barra lateral; usa su botón de flecha para expandir o colapsar sus hijas. Arrastra el fondo para desplazarte, usa la rueda para hacer zoom y pulsa **Ajustar** para ver el mapa. Comparte los filtros del gráfico nativo y el estado de expansión guardado. Las etiquetas compartidas permanecen visibles mientras otro padre expandido llegue a ellas. Las notas permanecen ocultas en este diseño.
- **Vista 3D (beta).** La misma jerarquía en tres dimensiones: orbita alrededor y haz clic en una etiqueta para volar hacia ella. Cambia de modo en la barra de herramientas del gráfico. Force, Mapa mental, ambos árboles, 3D y el explorador de ontología comparten una sola pestaña; haz clic derecho en un botón de modo para abrir otra pestaña y compararlos. Ajusta **Filtros** (búsqueda, adjuntos, solo archivos existentes, huérfanos), **Mostrar** (flechas en enlaces de notas, umbral de desvanecimiento, tamaño del nodo, grosor de la línea, etiquetas en perspectiva y tamaño de etiqueta) y **Fuerzas** (tensión al arrastrar y deslizadores de fuerza) desde su panel de engranaje de 3 secciones, con botones para restablecer valores por sección o en todo el panel. Al cambiar a 3D o al explorador se conserva el otro lienzo; el renderizado 3D oculto se pausa y al cerrar la pestaña del gráfico se liberan sus recursos.
- **Explorador de ontología (beta).** Empieza desde una etiqueta en un lienzo vacío y saca sus hijas, padres, etiquetas relacionadas y notas con clic derecho, como tarjetas de objeto, al estilo de los grafos de ontología de Palantir.
- **Una pestaña en la barra lateral.** Busca por nombre de etiqueta o alias, lee los detalles de una etiqueta y ejecuta la revisión del diccionario en una pestaña junto a Archivos y Búsqueda. Al elegir una etiqueta allí, el gráfico abierto hace zoom sobre ella y la centra.
- **Revisión del diccionario.** Lista las etiquetas usadas en tu bóveda pero ausentes del diccionario, con nombres similares del diccionario; las etiquetas del diccionario que aún no usa ninguna nota; las notas que escriben una etiqueta como alias o con otra combinación de mayúsculas y minúsculas; y las notas que llevan una etiqueta más amplia junto a una más específica. Solo informa y nunca cambia nada.
- **Colores personalizados (opcional).** Asigna a todas las etiquetas del gráfico y de la barra lateral un único color: el color de acento, salvo que elijas otro.
- **Colores por profundidad jerárquica (opcional).** Selecciona **Colores → Modo de color → Profundidad jerárquica** para colorear las etiquetas según la ruta más larga desde la raíz hasta la etiqueta en todo el diccionario. Al filtrar y colapsar los colores se mantienen estables, y los niveles más profundos usan el último color de la paleta. Predeterminada y Pastel usan el mismo orden rojo→naranja→amarillo→verde→cian→azul→violeta→rosa de la [tabla de colores de Tailwind CSS 3.4](https://v3.tailwindcss.com/docs/customizing-colors), con los tonos 500 y 200 respectivamente. Se remuestrean en todo el rango cuando cambia el número de niveles; también están disponibles los ejemplos Arcoíris, Cálida y degradados de un solo tono. Edita los colores numerados en horizontal y añade o quita niveles. La leyenda compacta del gráfico ofrece selección de paleta, edición de colores y **Guardar paleta como…**. Los cambios allí o en los ajustes pasan a una **Copia de trabajo** compartida, conservada automáticamente entre reinicios. **Guardar como…** añade una instantánea independiente con nombre bajo **Mis paletas**; cambiar entre ejemplos o paletas guardadas mantiene disponible la copia de trabajo. Los nombres guardados son únicos y nunca sobrescriben otra paleta. **Mis paletas → Gestionar…** lista las paletas guardadas con eliminación confirmada; eliminar la paleta activa selecciona Predeterminada y conserva la copia de trabajo. Las paletas anteriores de tipo Custom se conservan como **My colors**, y los colores activos existentes se preservan cuando cambian los ejemplos. Los colores se aplican en 2D, 3D, tarjetas del explorador y la barra lateral. Inspirado en [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags).
- **Enfoque (opcional).** Mantén iluminadas la etiqueta seleccionada y las etiquetas adyacentes (padres, hijas y relacionadas) mientras el resto se atenúa. Hay opciones para añadir todas las etiquetas por debajo y sus notas.
- **Recuerda tu vista.** Las etiquetas expandidas y los interruptores de Notas y Relacionadas se guardan y los comparten todas las pestañas de gráfico.
- **Interfaz localizada (11 idiomas).** Sigue automáticamente el idioma de Obsidian de forma predeterminada, o cambia manualmente en **General → Idioma** entre English, 한국어, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português (Brasil), Русский e Italiano. Los ajustes, el diccionario lateral, los controles 3D, las leyendas de profundidad y las vistas de gráfico se actualizan en tiempo real.

| Pestaña lateral | Revisión del diccionario |
| --- | --- |
| ![Pestaña lateral que muestra una etiqueta con sus padres, hijas, etiquetas relacionadas y recuentos de notas](../../assets/0.9.0/tag-panel.png) | ![Revisión del diccionario que enumera etiquetas no registradas y sin usar en la pestaña lateral](../../assets/0.9.0/dictionary-check.png) |
| **Colapsado a las raíces** | **Expandido** |
| ![Cada etiqueta colapsada a su raíz, con cada nota enlazada a la raíz por encima de sus etiquetas](../../assets/0.9.0/collapsed.png) | ![Cada etiqueta expandida, con cada nota enlazada a sus propias etiquetas](../../assets/0.9.0/expanded.png) |
| **Árbol vertical** | **Árbol horizontal** |
| ![Árbol vertical: cada etiqueta bajo su padre más profundo, con los padres centrados sobre sus hijas](../../assets/0.9.0/tree-vertical.png) | ![Árbol horizontal: el mismo árbol con niveles de izquierda a derecha](../../assets/0.9.0/tree-horizontal.png) |
| **Tema original** | **Mantener enfocada la etiqueta seleccionada** |
| ![Con los colores personalizados desactivados, las etiquetas conservan los colores propios del gráfico](../../assets/0.9.0/original-theme.png) | ![La etiqueta seleccionada y sus enlaces permanecen iluminados mientras el resto se atenúa](../../assets/0.9.0/focus.png) |
| **Editar una etiqueta** | **Nueva etiqueta** |
| ![Formulario de edición en la barra lateral con nombre, descripción, alias, padres, hijas y relacionadas, y un cambio sin guardar](../../assets/0.9.0/edit-tag.png) | ![Formulario de nueva etiqueta que sugiere una etiqueta usada por las notas pero ausente en el diccionario, con su recuento de notas](../../assets/0.9.0/new-tag.png) |
| **Sugerencias de búsqueda** | **Eliminar una etiqueta** |
| ![Búsqueda lateral que sugiere una etiqueta por nombre y otra por alias](../../assets/0.9.0/search-suggestions.png) | ![Diálogo de eliminación que indica adónde pasan las hijas, qué etiquetas relacionadas deja y las notas que conservan la etiqueta](../../assets/0.9.0/delete-tag.png) |

## Cómo funciona

Tag Ontology funciona dentro de la Vista de grafo nativa. Toma el grafo que Obsidian ya ha construido con tus filtros y grupos de color, colapsa las etiquetas del diccionario y añade los enlaces de jerarquía y relacionados entre ellas. Las etiquetas que no están en el diccionario siguen siendo nodos de etiqueta normales. El gráfico local no se ve afectado, y desactivar el plugin devuelve la Vista de grafo a su estado normal.

La vista 3D (beta) es una pestaña independiente. Construye las mismas notas y etiquetas a partir de la bóveda, aplica el diccionario encima con el mismo código y las dibuja con three.js.

El explorador de ontología (beta) también es una pestaña independiente. No muestra todo el diccionario: vas añadiendo etiquetas a su lienzo una por una y se dibuja con Cytoscape.js.

La jerarquía que construyes en la pestaña lateral se guarda en el archivo del diccionario. Consulta [Avanzado: el archivo del diccionario](#avanzado-el-archivo-del-diccionario) si quieres leerlo o editarlo directamente.

El uso de etiquetas proviene de la caché de metadatos de Obsidian, que incluye `tags` en el frontmatter y `#etiquetas` en línea dentro de cada nota Markdown.

## Instalación y actualización

> Para ver todos los detalles, compilaciones de desarrollo y solución de problemas, consulta la [Guía completa de instalación y actualización](../installation.md) (en inglés).

### Desde Complementos de la comunidad

- **Instalar**: Abre **Configuración → Complementos de la comunidad → Explorar**, busca "Tag Ontology", instálalo y actívalo. También puedes instalarlo desde su [página del directorio](https://community.obsidian.md/plugins/tag-ontology).
- **Actualizar**: Ve a **Configuración → Complementos de la comunidad**, haz clic en **Buscar actualizaciones** y luego haz clic en **Actualizar todo** o **Actualizar** junto a Tag Ontology.

### Con BRAT (versiones beta)

- **Instalar**:
  1. Instala y activa [BRAT](https://github.com/TfTHacker/obsidian42-brat).
  2. Elige **BRAT: Add a beta plugin for testing** e introduce `NamhyeonKo/obsidian-tag-ontology`.
- **Actualizar**: Ejecuta el comando `BRAT: Check for updates to all beta plugins` (o `BRAT: Check for plugin updates`).

### Manualmente

- **Instalar**:
  1. Descarga `main.js`, `manifest.json` y `styles.css` de la [última versión](https://github.com/NamhyeonKo/obsidian-tag-ontology/releases).
  2. Cópialos en `.obsidian/plugins/tag-ontology/` dentro de tu bóveda.
  3. Recarga Obsidian y activa **Tag Ontology** en **Configuración → Complementos de la comunidad**.
- **Actualizar**:
  1. Descarga los archivos más recientes `main.js`, `manifest.json` y `styles.css`.
  2. Sobrescribe los archivos en `.obsidian/plugins/tag-ontology/`.
  3. Ejecuta el comando `Recargar aplicación sin guardar` o reinicia Obsidian.

### Herramienta CLI independiente

La CLI independiente está publicada en npm como [`tag-ontology`](https://www.npmjs.com/package/tag-ontology):

```sh
# Ejecutar la última versión directamente sin instalar:
npx tag-ontology@latest check --root /path/to/vault --json

# O instalar / actualizar de forma global:
npm install -g tag-ontology@latest
npm update -g tag-ontology
```

> **Requisito**: El complemento principal **Vista de grafo** debe estar activado, con **Filtros → Etiquetas** activado en los ajustes del gráfico.

## Inicio rápido con la bóveda de ejemplo

El repositorio incluye una pequeña bóveda en [`examples/sample-vault`](../../examples/sample-vault): un diccionario de 12 etiquetas y seis notas.

1. En Obsidian, elige **Abrir carpeta como bóveda** y selecciona `examples/sample-vault`.
2. Instala el plugin en esa bóveda usando uno de los métodos anteriores.
3. Haz clic en el icono de cinta **Abrir Tag Ontology** (un libro) o ejecuta **Tag Ontology: Abrir gráfico** desde la paleta de comandos.
4. Si el gráfico no muestra etiquetas, activa **Filtros → Etiquetas** en los ajustes del gráfico (icono de engranaje).

Deberías ver dos raíces, `computer-science` y `security`, con las seis notas enlazadas a ellas, más la etiqueta no registrada `#to-read`. Haz doble clic en `computer-science` y después en `machine-learning`: la nota `Dropout` se mueve a `deep-learning`. Tanto `cryptography` como `ai-security` tienen dos padres cada una.

Después prueba la pestaña lateral: pulsa **+** para añadir una etiqueta propia bajo `machine-learning`.

## Uso

### Pestaña lateral

**Abrir Tag Ontology** (el icono de libro en la cinta o el comando **Abrir gráfico**) abre el gráfico y muestra la pestaña **Diccionario de etiquetas** en la barra lateral izquierda, junto a Archivos y Búsqueda. Al hacer clic en una etiqueta del gráfico o en **Revisar diccionario** también pasa al frente. Puedes arrastrar la pestaña a la barra lateral derecha.

- **La barra superior** tiene atrás, adelante e inicio (las etiquetas raíz y todas las etiquetas) a la izquierda, y **Nueva etiqueta**, **Editar etiqueta** y un botón que expande o colapsa la etiqueta en el gráfico a la derecha. Si no hay ningún gráfico en pantalla, ese botón abre uno y muestra la etiqueta; una etiqueta sin hijas lo muestra desactivado, con **Sin etiquetas hijas**.
- **Buscar etiquetas o alias**: escribe parte del nombre de una etiqueta o alias y elige una sugerencia con un clic o Intro. Una coincidencia por alias muestra el alias debajo de la etiqueta, de modo que `convolution` o `합성곱` permiten encontrar `cnn`. El gráfico se expande hasta la etiqueta elegida, hace zoom sobre ella y la centra.
- Sin ninguna etiqueta seleccionada, la pestaña lista las etiquetas raíz y después todas las etiquetas en orden alfabético bajo su primera letra. La barra y el cuadro de búsqueda permanecen fijos mientras la lista se desplaza.
- Una etiqueta muestra su descripción, alias, recuentos de notas (directas e incluyendo descendientes), sus padres, hijas y etiquetas relacionadas como enlaces `#tag`, y sus notas. Haz clic en un `#tag` para ir a él.

### Editar el diccionario

- **Nueva etiqueta** (`+` en la barra): elige una etiqueta que tus notas usan pero falta en el diccionario, ordenadas según cuántas notas la usan, o escribe un nombre nuevo. Elige padres para ubicarla bajo otras etiquetas; sin padres se convierte en una etiqueta raíz. También puedes añadir hijas y etiquetas relacionadas entre las que ya existen en el diccionario.
- **Editar etiqueta** (el lápiz): cambia el nombre, la descripción, los alias, el facet, los padres, las hijas y las etiquetas relacionadas. Pulsa **+** después del último elemento de un campo para añadir otro. Los padres, hijas y etiquetas relacionadas deben existir ya en el diccionario, y las etiquetas relacionadas se guardan en ambos sentidos. Renombrar una etiqueta no cambia las notas que la usan: conservan la etiqueta antigua, que pasa a figurar como ausente del diccionario. Cambiar solo las mayúsculas o minúsculas (`ml` a `ML`) las mantiene vinculadas, ya que las etiquetas coinciden sin distinguir mayúsculas.
- **Nombres de etiqueta en kebab-case** (un ajuste, desactivado de forma predeterminada): una etiqueta nueva o renombrada solo puede usar letras minúsculas y números unidos por guiones, como `machine-learning`, el formato que comprueba TOW. Los nombres existentes se conservan.
- **Eliminar** (en el formulario de edición) pregunta primero y muestra qué ocurrirá: las hijas de la etiqueta pasan bajo sus padres, sale de las listas de relacionadas y las notas conservan sus etiquetas.
- Los cambios permanecen en el formulario hasta que pulses **Guardar**, y salir con cambios sin guardar pide confirmación antes. Si las etiquetas modificadas cambiaron en otro lugar mientras tanto, el guardado se detiene y te avisa, y tus cambios permanecen en el formulario.
- El diccionario se guarda con una etiqueta por línea, así que guardar solo modifica las líneas afectadas. Un archivo escrito con otra disposición se reformatea en su primer guardado. Se conservan sus saltos de línea (LF o CRLF).

### Barra de herramientas del gráfico

Colapsar todo, Expandir todo y Ajustar se encuentran en una fila en la parte inferior central del gráfico; el resto de botones redondos baja por el lado izquierdo, y la leyenda de profundidad se sitúa en la esquina inferior izquierda. Cada uno muestra su nombre al pasar el cursor por encima:

| Botón | Función |
| --- | --- |
| Colapsar todo | Colapsa cada etiqueta del diccionario hasta su raíz |
| Expandir todo | Expande todas las etiquetas del diccionario |
| Ajustar | Encuadra el gráfico en la zona de la vista que dejan libre la barra, la leyenda y los botones de ajustes |
| Notas | Muestra u oculta todos los nodos que no son etiquetas (notas, adjuntos, enlaces sin resolver) |
| Relacionadas | Muestra u oculta las líneas discontinuas de etiquetas relacionadas |
| Revisar diccionario | Lista en la pestaña lateral las etiquetas no registradas y las no usadas |
| Force / Mapa mental / Árbol vertical / Árbol horizontal / 3D / Explorador de ontología | Cambia el modo en esta pestaña, en este orden. El modo actual aparece resaltado. Haz clic derecho en uno para **Abrir en pestaña nueva** y comparar dos modos lado a lado. 3D y el explorador están ocultos mientras su ajuste **Activar…** esté desactivado |

- En los diseños de árbol y en Mapa mental cada etiqueta cuelga bajo su padre y las notas permanecen ocultas, para que las relaciones entre etiquetas sigan siendo legibles.
- Haz clic en una etiqueta del gráfico para centrarla y mostrarla en la pestaña lateral. Haz doble clic para expandirla y vuelve a hacer doble clic para colapsarla, igual que con el botón en la parte superior de la pestaña. Las etiquetas que hayas expandido por debajo permanecen expandidas para la próxima vez.
- Todo lo demás mantiene el comportamiento nativo: hacer clic en una nota la abre, y hacer clic en una etiqueta que no está en el diccionario abre la búsqueda.

### Vista 3D (beta)

El botón de modo **3D** en la barra de herramientas del gráfico, o **Abrir gráfico 3D**, cambia la pestaña del gráfico a la vista 3D; otro botón de modo la devuelve a 2D. Mientras se muestra otro modo, el renderizado 3D se pausa. Comparte con el gráfico 2D las etiquetas expandidas, los interruptores **Notas** y **Relacionadas**, los colores, **Enfoque** y la pestaña lateral, así que una etiqueta que expandas en uno aparece expandida en el otro.

![Vista 3D: etiquetas y notas en tres dimensiones, con la parte posterior del gráfico desvaneciéndose en el fondo](../../assets/0.9.0/view-3d.png)

- Arrastra el espacio vacío para orbitar, arrastra con el botón derecho para desplazarte y usa la rueda para hacer zoom.
- Arrastra un nodo para moverlo por separado. Al soltarlo vuelve a su lugar con efecto resorte, igual que en los diseños de árbol. El diseño se estabiliza tras abrir la vista y tras expandir, y luego queda quieto.
- Haz clic en una etiqueta para seleccionarla y volar hacia ella, y doble clic para expandirla o colapsarla. Haz clic en una nota para abrirla. Elegir una etiqueta en la barra lateral también vuela hacia ella. Hacer clic en una etiqueta que no está en el diccionario no hace nada aquí; en 2D abre la búsqueda.
- La barra de herramientas incluye **Colapsar todo**, **Expandir todo**, **Ajustar**, **Notas**, **Relacionadas**, **Revisar diccionario** y los botones de modo. **Ajustar** encuadra la mayoría de los nodos visibles para que el gráfico llene la vista; unos pocos nodos muy alejados pueden quedar fuera.
- El botón de engranaje en la esquina superior derecha abre el panel de ajustes 3D (**Filtros**, **Mostrar**, **Fuerzas**), reflejando el panel 2D de Obsidian. Su cabecera incluye un botón **Restaurar ajustes por defecto** para todas las secciones, cada sección tiene su propio botón **Restablecer valores**, y los cambios se sincronizan en todas las pestañas 3D abiertas.
  - **Filtros**: campo de búsqueda compatible con `path:`, `file:`, `tag:`, negación con `-` y frases entrecomilladas; **Adjuntos** (desactivado de forma predeterminada); **Solo archivos existentes** (activado de forma predeterminada); y **Huérfanos** (activado de forma predeterminada).
  - **Mostrar**: **Flechas** en enlaces de notas (desactivado de forma predeterminada; los enlaces de jerarquía siempre muestran flechas), **Umbral de desvanecimiento**, **Tamaño del nodo**, **Grosor de la línea**, **Etiquetas en perspectiva** (activado de forma predeterminada) y **Tamaño de etiqueta** (`0.5` a `2`, `0.8` de forma predeterminada).
  - **Fuerzas**: **Tensión al arrastrar** (activada de forma predeterminada: mantiene tirados los nodos conectados al arrastrar un nodo; desactivada mueve solo el nodo arrastrado), **Fuerza centrípeta**, **Fuerza de repelencia**, **Fuerza de enlace** y **Distancia de enlace** usando los rangos y valores predeterminados del gráfico 2D. Mover un deslizador de fuerza reactiva la simulación.
- La vista 3D construye sus notas, etiquetas, adjuntos y enlaces sin resolver directamente desde la bóveda, y guarda sus ajustes del engranaje por separado del gráfico 2D nativo.
- Si la vista 3D va lenta o no la utilizas, desactiva **Activar vista 3D (beta)** en los ajustes. Su botón de modo y comando desaparecen, y el gráfico 2D no cambia.

### Explorador de ontología (beta)

El botón de modo **Explorador de ontología** en la barra de herramientas del gráfico, o **Abrir explorador de ontología**, cambia la pestaña del gráfico al explorador. Su lienzo se conserva mientras se muestra otro modo. Comparte la pestaña lateral con los gráficos, pero no sus etiquetas expandidas, los interruptores **Notas** y **Relacionadas** ni **Enfoque**.

- Un lienzo vacío pregunta por dónde empezar: busca una etiqueta, elige una etiqueta raíz o continúa desde la etiqueta seleccionada en la barra lateral. Elegir una etiqueta en la búsqueda lateral o un enlace de etiqueta también la añade al lienzo.
- Cada etiqueta es una tarjeta de objeto con su `facet` (o `concepto`), sus notas directas, sus notas con descendientes y su número de hijas. Los facets reciben sus propios colores; las etiquetas sin uno toman el color de la etiqueta.
- Haz clic derecho en una etiqueta para ver **Expandir hijas**, **Expandir padres**, **Expandir relacionadas** y **Mostrar notas**. Cada opción muestra cuántas faltan aún por añadir al lienzo. Las tarjetas nuevas se colocan en columnas junto a ella, las hijas y notas a la derecha y los padres a la izquierda, sin mover nada de lo que ya está en el lienzo. Haz doble clic en una etiqueta para expandir sus hijas.
- Las líneas siguen al diccionario, como en el gráfico 2D: flechas de padre a hija y líneas discontinuas entre etiquetas relacionadas unen cualquier par de etiquetas en el lienzo, sin importar desde cuál se sacaron.
- Una etiqueta con más de 15 notas muestra en su lugar una tarjeta de grupo. Haz clic en ella para listar sus notas en la pestaña lateral, las más recientes primero, filtrarlas y sacar las que marques o las 10 últimas. Haz doble clic en ella para sacar las 10 últimas. El grupo contiene todas las notas de la etiqueta que no son tarjetas en el lienzo: las notas etiquetadas después se añaden a él, y una tarjeta de nota que quites vuelve a él.
- Haz clic en una tarjeta para mostrarla en la pestaña lateral; haz doble clic en una nota para abrirla. Arrastra las tarjetas a cualquier parte; se quedan donde las pongas. Haz clic derecho en una tarjeta para quitarla; las tarjetas sacadas desde ella permanecen.
- La barra de herramientas incluye **Ajustar**, **Limpiar lienzo** y los botones de modo. El lienzo no se guarda: cerrar la pestaña lo limpia.
- Editar el diccionario o las notas actualiza las tarjetas: las etiquetas y notas renombradas conservan su lugar, y las eliminadas salen del lienzo.
- Si no lo utilizas, desactiva **Activar explorador de ontología (beta)** en los ajustes. Su botón de modo y comando desaparecen.

### Comandos

| Comando | Descripción |
| --- | --- |
| Tag Ontology: Abrir gráfico | Abre la ontología en la Vista de grafo nativa. Reutiliza una pestaña abierta. |
| Tag Ontology: Abrir gráfico 3D | Cambia la pestaña de gráfico abierta a 3D, o abre una nueva. Solo aparece mientras **Activar vista 3D (beta)** esté activada. |
| Tag Ontology: Abrir explorador de ontología | Cambia la pestaña de gráfico abierta al explorador, o abre una nueva. Solo aparece mientras **Activar explorador de ontología (beta)** esté activado. |
| Tag Ontology: Recargar diccionario | Recarga el diccionario y el índice de notas. |

### Ajustes

Los ajustes usan el mismo orden de secciones y elementos en Obsidian 1.13+ y en versiones anteriores: **General**, **Diccionario**, **Colores**, **Barra lateral**, **Enfoque** y **Vistas adicionales**. Los modos Color único y Profundidad jerárquica muestran opciones de color; los controles de paleta aparecen en modo Profundidad jerárquica. Las opciones de Enfoque aparecen cuando el enfoque está activado.

| Ajuste | Descripción |
| --- | --- |
| **General** | |
| Idioma | Sigue el idioma de Obsidian (`Automático (Obsidian)`, por defecto) o elige uno de los 11 idiomas compatibles para los ajustes del plugin, el diccionario lateral, los controles 3D y las vistas de gráfico. Los nombres de comandos y títulos de pestañas ya abiertas se actualizan tras reiniciar Obsidian. |
| **Diccionario** | |
| Ruta del diccionario | Ruta relativa a la bóveda hacia un archivo `.json`. Déjala vacía para detectar el diccionario automáticamente: `tow/tag-dictionary.json`, después `.tow/tag-dictionary.json`, después `Tag-Dictionary.json`; cuando ninguno existe, `tow/tag-dictionary.json`. Una ruta introducida manualmente siempre se utiliza. El campo se guarda al pulsar Intro o salir de él. |
| Nombres de etiqueta en kebab-case | Desactivada por defecto. Activada: el formulario de edición acepta una etiqueta nueva o renombrada solo con letras minúsculas y números unidos por guiones, el formato que comprueba TOW. Los nombres existentes se conservan. |
| **Colores** | |
| Modo de color | Predeterminado de Obsidian, Color único o Profundidad jerárquica. Los colores existentes se conservan al cambiar de modo. |
| &nbsp;&nbsp;Paleta | Ejemplos, la Copia de trabajo actual y Mis paletas. Los ejemplos conservan el número activo de niveles; las paletas guardadas con nombre restauran sus colores y su número de niveles. |
| &nbsp;&nbsp;Colores por nivel | Edita los colores numerados en horizontal; añade o quita niveles (al menos uno). Los niveles posteriores al último color conservan ese color. |
| &nbsp;&nbsp;Mis paletas | Guardar como… abre un campo de nombre; Gestionar… lista las paletas para eliminarlas con confirmación. Eliminar la paleta activa cambia a Predeterminada y conserva la copia de trabajo. Se rechazan los nombres duplicados. |
| &nbsp;&nbsp;Color de etiqueta / Color para etiquetas fuera de la jerarquía | Color base en modo Color único, o color de respaldo para etiquetas fuera de la jerarquía en modo Profundidad jerárquica. Sigue el color de acento hasta que elijas uno; restablecer vuelve al color de acento. |
| &nbsp;&nbsp;Títulos laterales con color | Usa el color de la etiqueta seleccionada para su título en la barra lateral. |
| **Barra lateral** | |
| Listas de etiquetas | Muestra las etiquetas en la barra lateral (etiquetas raíz, todas las etiquetas, padres, hijas y etiquetas relacionadas) como fichas ajustadas o una por línea. Fichas por defecto. |
| **Enfoque** | |
| Mantener enfocada la etiqueta seleccionada | Mantiene iluminadas la etiqueta seleccionada y las etiquetas adyacentes (sus padres, hijas y relacionadas) y atenúa el resto. La etiqueta seleccionada y sus enlaces se ven como al pasar el cursor. Desactivado por defecto. Actívalo para mostrar las opciones siguientes. |
| &nbsp;&nbsp;Sus descendientes | También mantiene iluminadas todas las etiquetas por debajo, hasta donde estén expandidas. Activado por defecto. |
| &nbsp;&nbsp;Incluir notas | También mantiene iluminadas las notas de la etiqueta seleccionada, y de sus descendientes si la opción anterior está activada. Las notas de las etiquetas adyacentes siguen atenuándose. Activado por defecto. |
| **Vistas adicionales** | |
| Activar árbol vertical | Muestra el botón de modo árbol vertical en la barra de herramientas del gráfico. Desactivarlo devuelve a Force las pestañas que estén en ese modo. Activado por defecto. |
| Activar árbol horizontal | Lo mismo para el botón de modo árbol horizontal. Activado por defecto. |
| Activar vista 3D (beta) | Muestra el botón de modo 3D en la barra de herramientas del gráfico y el comando Abrir gráfico 3D. Desactivarla libera la vista 3D; una pestaña que la muestre vuelve a 2D. Activada por defecto. |
| Activar explorador de ontología (beta) | Muestra el botón de modo del explorador en la barra de herramientas del gráfico y el comando Abrir explorador de ontología. Desactivarlo limpia el lienzo del explorador; una pestaña que lo muestre vuelve a 2D. Activado por defecto. |

En niveles de zoom bajos, el gráfico nativo oculta las etiquetas y las flechas. Acércate para verlas.

## Avanzado: el archivo del diccionario

La pestaña lateral lee y escribe este archivo, así que nunca necesitas abrirlo. Es un JSON simple en tu bóveda, por lo que también puedes editarlo a mano.

El diccionario puede encontrarse en cualquier ruta relativa a la bóveda terminada en `.json`, incluso dentro de `tow/` o `.tow/`. Con el campo **Ruta del diccionario** vacío, el plugin comprueba `tow/tag-dictionary.json`, después `.tow/tag-dictionary.json` y después `Tag-Dictionary.json`. Las instalaciones nuevas crean `tow/tag-dictionary.json`; los archivos `Tag-Dictionary.json` existentes siguen funcionando, y `.tow/tag-dictionary.json` de TOW 0.5.0–0.5.1 sigue leyéndose. Una ruta elegida se usa siempre. Si el diccionario desaparece más adelante, la pestaña lateral ofrece crearlo.

**Obsidian Sync no sincroniza las carpetas que empiezan por punto distintas de `.obsidian`** ([ajustes de Sync](https://obsidian.md/help/sync/settings)). Si usas Obsidian Sync, elige una ruta visible para el diccionario. Git y las herramientas de sincronización a nivel de archivos sí incluyen las carpetas ocultas salvo que estén ignoradas.

El archivo es un único objeto JSON. Cada clave es una etiqueta **sin `#`**, tratada sin distinguir mayúsculas ni minúsculas como hace el gráfico nativo (`#ML` usa la clave `ml`). Se recomiendan claves en minúsculas. Una etiqueta anidada como `#lang/python` usa la clave `lang/python`.

```json
{
  "machine-learning": {
    "aliases": ["ML"],
    "description": "Algorithms that improve at a task by learning from data.",
    "broader": ["computer-science"]
  },
  "dropout": {
    "description": "Randomly disabling units during training to reduce overfitting.",
    "broader": ["deep-learning"],
    "related": ["overfitting"],
    "facet": "technique"
  },
  "computer-science": {
    "description": "The study of computation, information and automation.",
    "broader": []
  }
}
```

| Campo | Obligatorio | Tipo | Significado |
| --- | --- | --- | --- |
| `description` | sí | string | Se muestra en el panel de la etiqueta. |
| `aliases` | no | string[] | Otros nombres. Usados por la búsqueda y por la revisión del diccionario para sugerir una coincidencia a una etiqueta no registrada. |
| `broader` | no | string[] | Etiquetas padre. **`[]` marca una etiqueta raíz.** |
| `related` | no | string[] | Enlaces no jerárquicos, dibujados como líneas discontinuas. |
| `facet` | no | string | Categoría libre, como `language`. Establécela en el formulario de edición o en el borrador de un archivo de cambios de la CLI; una etiqueta de facet junto a sus etiquetas más específicas no se señala como redundante. |

Reglas:

- **Las raíces necesitan `"broader": []`.** Una etiqueta sin clave `broader` se trata como aún no ubicada y no aparece en el gráfico.
- Cada etiqueta nombrada en `broader` o `related` debe existir en el diccionario.
- Una etiqueta no puede referenciarse a sí misma, y los enlaces `broader` no pueden formar un ciclo.
- Si el diccionario no es válido, un aviso muestra el motivo al iniciar Obsidian o al abrir la vista, y la barra lateral sigue mostrándolo hasta que corrijas el archivo. El gráfico conserva la última versión cargada, y **Nueva etiqueta** y **Editar etiqueta** quedan desactivados hasta entonces.

Consulta [`examples/sample-vault/tow/tag-dictionary.json`](../../examples/sample-vault/tow/tag-dictionary.json) para ver un ejemplo completo.

## Privacidad

- Sin peticiones de red, telemetría ni cuentas.
- Solo lee los metadatos de tus notas y el archivo del diccionario.
- Escribe únicamente su propio archivo de ajustes (`plugins/tag-ontology/data.json` en la carpeta de configuración, normalmente `.obsidian/`) y, cuando guardas un cambio en la barra lateral, el archivo de diccionario en uso: la ruta que elegiste (incluida una ruta personalizada guardada en una versión anterior), o `tow/tag-dictionary.json`, `.tow/tag-dictionary.json`, o `Tag-Dictionary.json` en orden de búsqueda automática.

## Compatibilidad y limitaciones conocidas

- **Solo escritorio.** Probado en Obsidian 1.14.5 (macOS).
- El plugin se conecta a **componentes internos no documentados** de la Vista de grafo nativa (renderizador, PIXI, worker de diseño). Una futura actualización de Obsidian podría romperlo. Si los componentes internos no coinciden con lo esperado, el plugin se desvincula y deja intacto el gráfico nativo.
- En bóvedas grandes, expandir todas las etiquetas con las notas visibles redibuja varios miles de nodos y enlaces; es normal una breve pausa.
- Las etiquetas se vuelven densas cuando todas están expandidas, especialmente en Force.
- Sin probar junto a otros plugins que parchen la Vista de grafo.
- La vista 3D usa WebGL e incluye three.js, y el explorador incluye Cytoscape.js, por lo que el archivo del plugin pesa alrededor de 1,6 MB. Cada uno se carga solo cuando se abre su pestaña. Con muchos miles de notas mostradas, la vista 3D se vuelve más lenta; ocultar las notas la mantiene rápida.

## Hoja de ruta

- Mostrar también la jerarquía en el gráfico local.

Los informes de errores y solicitudes de funciones son bienvenidos en [Issues](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues). Por favor, incluye tu versión de Obsidian y sistema operativo al reportar errores.

## Biblioteca y CLI

El paquete independiente [`tag-ontology`](../../packages/tag-ontology/README.md) expone las mismas reglas del diccionario como una biblioteca ESM bajo licencia MIT y una CLI de Node. Comprueba y analiza una bóveda, informa sobre el uso de etiquetas, muestra la jerarquía de una etiqueta y previsualiza o aplica cambios en el diccionario con verificación por hash de contenido. No requiere tener Obsidian instalado.

Está publicado en npm como [`tag-ontology`](https://www.npmjs.com/package/tag-ontology):

```sh
npx tag-ontology check --root /path/to/vault --json
```

Consulta la [guía del paquete](../../packages/tag-ontology/README.md) para ver ejemplos de la biblioteca y el [contrato de la CLI](../cli.md) para comandos, campos JSON, códigos de salida y límites del analizador. El plugin y el paquete tienen versiones y etiquetas de lanzamiento independientes.

## Proyectos relacionados

### [TOW (Tag Ontology Wiki)](https://github.com/NamhyeonKo/tag-ontology-wiki)

Cuando se utiliza junto con [TOW](https://github.com/NamhyeonKo/tag-ontology-wiki), puedes aprovechar agentes de IA para gestionar etiquetas y diccionarios, junto con tareas más amplias en la bóveda como búsqueda de notas, gestión de frontmatter y formato de documentos.

- **Gestión del diccionario basada en CLI**: Usa la CLI `tag-ontology` para inspeccionar etiquetas, validar la integridad del diccionario y aplicar actualizaciones seguras.
- **Flujos de trabajo con agentes de IA**: Automatiza tareas repetitivas de mantenimiento de la bóveda como descubrir etiquetas no registradas, sincronizar entradas de ontología, verificar esquemas de frontmatter y limpiar la estructura de las notas.
- **Integración visual en el gráfico**: Explora y navega por las jerarquías de etiquetas gestionadas por agentes directamente dentro de la Vista de grafo de Obsidian con este plugin.

## Desarrollo

Requiere Node.js **22.18 o posterior**. Las pruebas ejecutan TypeScript directamente con la eliminación de tipos integrada de Node.

```sh
npm ci
npm run lint        # reglas de revisión de Obsidian + lint del paquete verificado
npm test            # pruebas unitarias, no requiere bóveda
npm run build       # comprobación de tipos + dist del paquete + main.js del plugin
npm run check:package  # inspecciona e instala el tarball real de npm
npm run deploy -- "/path/to/vault"   # copia main.js, manifest.json, styles.css en la bóveda
```

`deploy` requiere una carpeta `.obsidian/` existente en la bóveda de destino y preserva un `data.json` existente. Recarga el plugin en Obsidian después.

`npm run test:vault` es la prueba de integración del mantenedor frente a una bóveda privada (`OBSIDIAN_VAULT_PATH`). Otros colaboradores no necesitan ejecutarla.

### Estructura del proyecto

```text
src/
├── main.ts            # Entrada del plugin: comandos, pestaña de ajustes, eventos de bóveda/metadatos
├── search.ts          # Ventana emergente de sugerencias para el cuadro de búsqueda y formularios de edición
├── native.ts          # Conecta el renderizador de la Vista de grafo nativa (barra, pestaña lateral, clics, diseños)
├── graph-modes.ts     # Barra compartida de cambio de modo del gráfico y menú abrir en pestaña nueva
├── legend.ts          # Leyenda de profundidad jerárquica, selector de paleta y muestras de color
├── palettes.ts        # Preajustes de paleta, copia de trabajo y estado de biblioteca de paletas guardadas
├── colors.ts          # Remuestreo de colores y mapeo de profundidad jerárquica por ruta más larga
├── hierarchy.ts       # Adaptador del modelo de diccionario y recuentos acumulados de notas
├── layer.ts           # Funciones puras que superponen el diccionario sobre los datos del gráfico nativo
├── layout.ts          # Posiciones de árbol vertical y horizontal
├── mindmap.ts         # Vista de mapa mental respaldada por Cytoscape con tarjetas DOM accesibles
├── mindmap-layout.ts  # Espaciado de rama visible del mapa mental y ubicación de anclas
├── graph3d.ts         # La vista 3D: dibuja los mismos datos en capas con 3d-force-graph
├── controls3d.ts      # Panel de ajustes 3D plegable en 3 secciones (Filtros, Mostrar, Fuerzas)
├── filter3d.ts        # Analizador/evaluador de consultas de búsqueda y poda de huérfanos para 3D
├── geometry3d.ts      # Colocación de flechas 3D, escalado de etiquetas y auxiliares de profundidad de cámara
├── three.ts           # three.js y 3d-force-graph, importados solo cuando se abre una vista 3D
├── vault-data.ts      # Construye la forma de datos del gráfico nativo desde la bóveda para la vista 3D
├── explorer.ts        # El explorador de ontología: un lienzo Cytoscape.js de tarjetas de objeto
├── explorer-layout.ts # Funciones puras para el explorador: colocación de tarjetas, recuentos Search Around, líneas
├── explorer-card.ts   # Las tarjetas de objeto del explorador como imágenes SVG
├── check.ts           # Auxiliares que agrupan etiquetas no canónicas y redundantes para Revisar diccionario
├── settings.ts        # Esquema de ajustes, valores predeterminados y saneamiento
└── i18n/              # Catálogo de 11 idiomas, formateo en tiempo de ejecución y actualización en vivo
tests/              # Pruebas unitarias con node:test (tests/integration es solo para el mantenedor)
packages/tag-ontology/
├── src/core/       # Validación pura del diccionario, jerarquía, uso y ediciones
├── src/vault/      # Acceso a archivos en Node y lectores de Markdown/frontmatter
├── src/cli/        # Argumentos de línea de comandos, resultados JSON y códigos de salida
└── tests/          # Pruebas unitarias del paquete y de CLI en proceso real
docs/cli.md         # Contrato versionado de la CLI
examples/           # Bóveda de ejemplo con un diccionario de etiquetas
scripts/deploy.mjs  # Copia la compilación en una bóveda local
scripts/check-package.mjs  # Inspecciona y ejercita el paquete npm empaquetado
```

## Contribuir

¡Las contribuciones de la comunidad son muy bienvenidas! Ya sea corrigiendo errores, proponiendo nuevas funciones o mejorando la documentación:

1. Consulta los [Issues](https://github.com/NamhyeonKo/obsidian-tag-ontology/issues) existentes o abre uno nuevo.
2. Haz un fork del repositorio y crea tu rama de funcionalidad basada en `dev`.
3. Sigue [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) para los mensajes de commit.
4. Asegúrate de que todas las comprobaciones pasen: `npm run lint && npm test && npm run build`.
5. Envía una Pull Request apuntando a la rama `dev`.

Revisa [CONTRIBUTING.md](../../CONTRIBUTING.md) para consultar las directrices completas de desarrollo y flujos de prueba, y el [Código de Conducta](../../CODE_OF_CONDUCT.md).

## Apoyo

Tag Ontology es libre y de código abierto. Si te ahorra tiempo, puedes [invitarme a un café](https://buymeacoffee.com/namhyunko).

## Agradecimientos

- El enfoque de alimentar con datos personalizados el renderizador del gráfico nativo se inspiró en [Nested tags graph](https://github.com/drpilman/obsidian-graph-nested-tags). Ese plugin no es necesario.
- La vista 3D está construida sobre [3d-force-graph](https://github.com/vasturiano/3d-force-graph), [three-spritetext](https://github.com/vasturiano/three-spritetext) y [three.js](https://threejs.org), todos bajo licencia MIT. El explorador de ontología está construido sobre [Cytoscape.js](https://js.cytoscape.org) (MIT). Los avisos de licencia de cada paquete incluido figuran al inicio de `main.js`.

## Licencia

Copyright (c) 2026 NamhyeonKo

Este proyecto está bajo la [Licencia MIT](../../LICENSE). Eres libre de usar, modificar y distribuir este software bajo los términos de la Licencia MIT.
