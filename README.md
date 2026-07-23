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
- ★ **Alerta de mínimo histórico** — resalta en verde los libros que están en su
  precio más bajo registrado.
- ▼ **Detección de bajadas fuertes** — marca en azul los libros cuyo precio actual
  está ≥15% por debajo de su promedio.
- 🚫 **Manejo de disponibilidad** — los libros "No disponible actualmente" se
  detectan y se excluyen de las estadísticas (sus precios suelen ser poco fiables).
- 📚 **Panel de resumen** — arriba de la lista, con conteos y accesos directos a
  cada libro en mínimo histórico o con bajada fuerte (con destello al hacer clic).
- 💾 **Exportar / Importar historial** — respaldo en JSON, con fusión inteligente
  al importar (sin duplicar registros por fecha).
- 🔁 **Migración automática** desde el formato de almacenamiento de la v1.x.

## Instalación

1. Instala un gestor de userscripts en tu navegador:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox, Safari), o
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Edge).
2. Abre el archivo [`buscalibre-price-tracker.user.js`](./buscalibre-price-tracker.user.js)
   y haz clic en **Raw**. El gestor debería ofrecerte instalarlo automáticamente.
   - Alternativamente, copia el contenido del archivo y pégalo en un script nuevo
     desde el panel del gestor.
3. Confirma la instalación.

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

## Notas técnicas

- Sólo actúa en `https://www.buscalibre.com.mx/v2/u/dashboard*`.
- Depende de la estructura del DOM de Buscalibre (clases como `.productoLista`,
  `.precioAhora`, `.add-cart`). Si el sitio cambia su maquetado, es posible que
  haya que ajustar los selectores.
- Usa `GM_setValue` / `GM_getValue` para el almacenamiento y carga Chart.js 3.9.1
  vía `@require`.

## Privacidad

- No se envía ningún dato a servidores externos.
- El único acceso a la red es la descarga de la librería Chart.js desde jsDelivr.
- Todo tu historial permanece en el almacenamiento local del gestor de userscripts.

## Licencia

MIT
