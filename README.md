# Buscalibre Wishlist Price Tracker

Userscript (Tampermonkey / Violentmonkey) que rastrea el **historial de precios**
de tu lista de deseos en [Buscalibre México](https://www.buscalibre.com.mx),
directamente desde tu navegador. Cada vez que abres tu panel, registra el precio
de cada libro y te muestra una gráfica, insignias y alertas visuales cuando algo
baja de precio o llega a su mínimo histórico.

Todo el historial se guarda **localmente** en tu navegador. No hay servidores,
ni cuentas, ni telemetría: los datos nunca salen de tu equipo (salvo que tú
mismo los exportes).

## Características

- 📈 **Gráfica de precios por libro** — evolución del precio con Chart.js,
  marcando el punto mínimo y los días en que el libro no estuvo disponible.
- 🔎 **Gráfica en la página de cada libro** — cuando abres la página de un libro
  que ya estás rastreando (guardado en tu lista de deseos), aparece su historial
  de precios en una tarjeta debajo del bloque de compra, al estilo Keepa. La
  visita también suma un punto al historial.
- ★ **Alerta de mínimo histórico** — resalta en verde los libros que están en su
  precio más bajo registrado.
- ▼ **Detección de bajadas fuertes** — marca en azul los libros cuyo precio actual
  está ≥15% por debajo de su promedio.
- 🚫 **Manejo de disponibilidad** — los libros "No disponible actualmente" se
  detectan y se excluyen de las estadísticas (sus precios suelen ser poco fiables).
- 📚 **Panel de resumen** — arriba de la lista, con conteos y accesos directos a
  cada libro en mínimo histórico o con bajada fuerte (con destello al hacer clic).
- ↕️ **Ordenar la lista de deseos** — botones en el panel para reordenar las
  tarjetas completas (con su gráfica e insignias) por precio ascendente o
  descendente, por mayor bajada respecto al promedio, o por mayor caída desde su
  máximo histórico. Al ordenar, cada tarjeta se numera (1., 2., 3. …), así que
  los 10 o 20 más baratos quedan arriba. El criterio se recuerda entre visitas.
- 💾 **Exportar / Importar historial** — respaldo en JSON, con fusión inteligente
  al importar (sin duplicar registros por fecha).
- 🔁 **Migración automática** desde el formato de almacenamiento de la v1.x.

## Instalación

**👉 La forma fácil: [jesarx.github.io/BuscalibreTracker](https://jesarx.github.io/BuscalibreTracker/)**

Esa página detecta tu navegador, te enlaza al gestor correcto y te dice si ya
tienes el script instalado (y si hay una versión más nueva).

### A mano

1. Instala un gestor de userscripts en tu navegador:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox, Safari), o
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Edge).
2. Abre el [enlace de instalación directa][instalar]. El gestor mostrará su
   pantalla de instalación.
   - Si en vez de eso ves puro código, es que falta el paso 1.
   - Alternativamente, copia el contenido del archivo y pégalo en un script nuevo
     desde el panel del gestor.
3. Confirma la instalación.

El script declara `@updateURL`, así que tu gestor **busca actualizaciones solo**.

[instalar]: https://raw.githubusercontent.com/jesarx/BuscalibreTracker/main/buscalibre-price-tracker.user.js

## Uso

1. Entra a tu cuenta de Buscalibre y abre tu **panel / lista de deseos**
   (`https://www.buscalibre.com.mx/v2/u/dashboard`).
2. El script se ejecuta solo: registra el precio de cada libro visible y añade
   las gráficas, insignias y el panel de resumen.
3. Vuelve cada cierto tiempo. Con cada visita se añade un nuevo punto al historial,
   así que entre más lo uses, más completa será la gráfica de cada libro.

> El historial se construye **con tus visitas**. El script no consulta precios en
> segundo plano; sólo guarda lo que se muestra cuando abres tu lista de deseos.

### Respaldo de tu historial

Como los datos viven en el almacenamiento del userscript, conviene respaldarlos
de vez en cuando:

- **Exportar historial** — descarga un `.json` con todo tu historial.
- **Importar** — carga un respaldo previo. Los registros se **fusionan** con los
  actuales, sin duplicar fechas, así que puedes combinar historiales de varios
  equipos.

## Configuración

Los parámetros están al inicio del script, en el objeto `CONFIG`:

| Opción                | Por defecto | Descripción                                                        |
| --------------------- | ----------- | ------------------------------------------------------------------ |
| `maxHistoryDays`      | `365`       | Días de historial que se conservan.                                |
| `dropThreshold`       | `0.15`      | Umbral de "bajada fuerte" (fracción por debajo del promedio).      |
| `minEntriesForBadges` | `3`         | Registros mínimos antes de mostrar insignias.                      |
| `unseenGraceDays`     | `45`        | Días sin ver un libro antes de borrar su historial.                |
| `debug`               | `false`     | Activa logs detallados en la consola.                              |

### Ordenar la lista

En el panel de resumen, la barra **«Ordenar por»** reordena las tarjetas reales
de la lista de deseos:

| Criterio            | Qué hace                                                          |
| ------------------- | ----------------------------------------------------------------- |
| **Original**        | Deja la lista tal como la entrega Buscalibre.                     |
| **💲 Precio ↑**      | De menor a mayor precio: los más baratos arriba.                  |
| **💲 Precio ↓**      | De mayor a menor precio.                                          |
| **▼ Mayor bajada**  | Los que más bajaron respecto a su precio promedio.                |
| **📉 Vs. su máximo** | Los que más cayeron desde su máximo histórico (descuento real).   |

Los libros **no disponibles** y los que aún no tienen historial se envían al
final en cualquier orden (su precio no es comparable), y no se numeran.

## Notas técnicas

- Actúa en el panel/lista de deseos (`https://www.buscalibre.com.mx/v2/u/dashboard*`)
  y en la página de cada libro (`https://www.buscalibre.com.mx/*/p/*`).
- En la página del libro identifica el producto por su ID (el `/p/<id>` de la URL,
  que coincide con el `data-id_producto` de la lista de deseos) y sólo muestra la
  gráfica si ese libro ya está en tu historial.
- Depende de la estructura del DOM de Buscalibre (clases como `.productoLista`,
  `.precioAhora`, `.add-cart`, `.opcionPrecio`, `#producto`). Si el sitio cambia
  su maquetado, es posible que haya que ajustar los selectores.
- Usa `GM_setValue` / `GM_getValue` para el almacenamiento y carga Chart.js 3.9.1
  vía `@require`.

## Publicar la página de instalación

La landing vive en [`docs/index.html`](./docs/index.html) y se publica con GitHub
Pages. Para activarla:

1. El repositorio debe ser **público**. GitHub Pages en repos privados requiere
   un plan de pago, y `raw.githubusercontent.com` responde 404 a quien no tenga
   acceso, así que el botón de instalar no funcionaría para nadie más.
2. **Settings → Pages → Source: _Deploy from a branch_ → Branch: `main`,
   carpeta `/docs`.** En un par de minutos queda en
   `https://jesarx.github.io/BuscalibreTracker/`.

La página no necesita build ni dependencias: es un solo HTML con su CSS y JS
embebidos.

### Cómo sabe la página si ya lo tienes instalado

El userscript incluye `@match` para la propia landing. Cuando corre ahí, marca
`<html data-bpt-installed="2.7">` y la página lo lee. Se usa un atributo del DOM
y no `window.*` porque, al declarar `@grant`, el gestor ejecuta el script en un
sandbox cuyo `window` **no** es el de la página; el DOM sí es compartido.

Con eso se detecta con certeza **nuestro script**. Detectar si hay un *gestor*
instalado (sin el script) no es posible de forma fiable en los navegadores
actuales, así que la página simplemente presenta los dos pasos y deja que quien
ya tenga gestor salte el primero.

> Si algún día mueves la página a un dominio propio, agrega ese dominio al
> `@match` del script para que la detección siga funcionando.

## Privacidad

- No se envía ningún dato a servidores externos.
- El único acceso a la red es la descarga de la librería Chart.js desde jsDelivr.
- Todo tu historial permanece en el almacenamiento local del gestor de userscripts.

## Licencia

MIT
