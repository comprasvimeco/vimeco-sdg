/* VIMECO S.A. — Precio directo de un ítem: escrituras compartidas.

   El costo unitario de un ítem se puede cargar a mano, sin analizarlo, desde
   dos lugares: la celda de costo del Cómputo y la sección Materiales de su
   Análisis de Precio. Son la misma celda vista desde dos lados. Acá está lo
   que el Cómputo necesita para escribir en una receta que no es suya (el
   path, el alta del ítem y la forma de la línea); el A.P. guarda por su propio
   camino de siempre (persistLineas en js/item.js), y comparte la forma con
   lineaDirectaNueva. La regla de cuándo se puede cargar está en
   window.apAceptaPrecioDirecto (js/calcCostos.js).

   El dato vive en la receta del ítem, no en la línea del Cómputo:
   /items/{itemKey}/versionesObra/{obraKey}/lineas/directo. Por eso el número
   lo ven el Presupuesto, la Carga Fija, el Coeficiente K, el Plan de Avance,
   los cierres y la exportación sin que ninguno sepa de dónde salió. */

(function () {

  function pathLinea(itemKey, obraKey) {
    return `/items/${itemKey}/versionesObra/${obraKey}/lineas/${window.LINEA_DIRECTA_KEY}`;
  }

  /* La key de un ítem nuevo: el nombre normalizado + el timestamp, para que
     sea legible en la consola de Firebase y única igual. Misma forma que
     tenían los ítems creados desde el A.P. antes de que esto estuviera acá. */
  function keyDeItem(nombre) {
    return (nombre || 'item').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
      + '_' + Date.now();
  }

  /* El ítem de una línea del Cómputo (o de un análisis auxiliar), creándolo si
     todavía no lo tiene: la línea es texto libre hasta que alguien le pide un
     costo, y recién ahí nace el ítem de Biblioteca con su nombre y su unidad.
     Devuelve el itemKey, o null si la línea ya no existe.

     `nodo` es 'computo' o 'auxiliares'. Lee la línea de la base en vez de
     confiar en el estado de la pantalla: dos personas pueden estar en el mismo
     Cómputo, y crear un segundo ítem para una línea que ya tiene uno dejaría la
     receta anterior huérfana. */
  window.asegurarItemDeLinea = async function (obraKey, nodo, lineaKey) {
    const linea = await window._fbGet(`/obras/${obraKey}/${nodo}/${lineaKey}.json`);
    if (!linea) return null;
    if (linea.itemKey) return linea.itemKey;
    const key = keyDeItem(linea.nombre);
    await window._fbPut(`/items/${key}.json`, {
      nombre: linea.nombre || '',
      unidad: linea.unidad || '',
      creadoEn: Date.now(),
    });
    await window._fbPut(`/items/${key}/versionesObra/${obraKey}.json`, { rendimiento: 1 });
    await window._fbPatch(`/obras/${obraKey}/${nodo}/${lineaKey}.json`, { itemKey: key });
    return key;
  };

  /* Guarda el costo cargado a mano. PATCH sobre la línea y no PUT del nodo de
     líneas entero: si alguien está editando el mismo A.P. en otra pestaña, un
     PUT le borraría lo suyo (ver memoria feedback_firebase_patch_por_linea).
     `precioFormula` va siempre, en null cuando el número se escribió a mano,
     para que no quede viva una fórmula vieja. */
  window.guardarPrecioDirecto = async function (itemKey, obraKey, datos) {
    await window._fbPatch(pathLinea(itemKey, obraKey) + '.json', {
      tipo: 'directo',
      precio: datos.precio,
      precioFormula: datos.precioFormula || null,
      cantidad: 1,
      orden: 1,
    });
  };

  // Borrar el precio directo deja el A.P. vacío y listo para armarlo en
  // detalle — es el camino de vuelta de la exclusividad entre los dos modos.
  window.borrarPrecioDirecto = async function (itemKey, obraKey) {
    await window._fbDel(pathLinea(itemKey, obraKey) + '.json');
  };

  // La línea tal como queda en memoria después de guardarla, para que la
  // pantalla repinte sin volver a leer la base.
  window.lineaDirectaNueva = function (precio, precioFormula) {
    return { tipo: 'directo', precio, precioFormula: precioFormula || null, cantidad: 1, orden: 1 };
  };

})();
