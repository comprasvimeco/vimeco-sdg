/* VIMECO S.A. — Navegación entre celdas con el teclado.

   Mismo gesto que en Plan de Avance (js/plan-avance.js): moverse por la tabla
   con las flechas sin soltar el teclado. Acá está sacado a un módulo porque lo
   usan dos pantallas con tablas distintas —el Cómputo, que es una grilla de
   varias columnas, y el Análisis de Precio, donde la única celda editable de
   cada fila es la cantidad y las filas están repartidas en tres secciones.

   Lo que la pantalla declara son dos selectores: cuáles son sus celdas y cuáles
   son sus filas. De ahí sale todo lo demás:

   - ←/→ pasan a la celda vecina en orden de pantalla (cruzan de fila al llegar
     al extremo), pero SÓLO si el cursor ya está en el borde del texto o está
     todo seleccionado. Adentro de "Excavación manual" las flechas siguen
     moviendo el cursor, como en cualquier campo de texto.
   - ↑/↓ van a la MISMA columna de la fila de arriba/abajo. La columna es la
     posición de la celda dentro de su fila, así que una fila que no llega a esa
     posición (la cabecera de un rubro, que tiene número y nombre pero no
     cantidad) se saltea sola y se sigue buscando más arriba/abajo.
   - Tab/Shift+Tab hacen lo mismo que ←/→ pero sin la condición del borde, y
     sobre su propia lista de celdas (`tab`) — así saltean los botones de la
     fila, que es lo que hacía inservible al Tab nativo.

   Dos cuidados que no son obvios:

   1. Guardar re-renderiza. El blur de la celda escribe y la pantalla vuelve a
      pintar su tabla entera, así que el <input> destino que se resolvió ANTES
      del blur queda huérfano. Por eso se anota la coordenada del destino (qué
      fila, qué columna), se hace blur, y recién después se busca la celda ya
      re-renderizada. Es el mismo problema y la misma solución que en
      plan-avance.js.
   2. La identidad de la fila son sus data-*. Sobreviven al re-render, el nodo
      no. */

(function () {
  function usable(el) {
    return !el.disabled && el.offsetParent !== null;
  }

  function celdasDe(raiz, sel) {
    return Array.from(raiz.querySelectorAll(sel)).filter(usable);
  }

  // Los data-* de la fila son lo único que sobrevive a un re-render: el nodo se
  // reemplaza entero. Sirven para volver a encontrarla después de guardar.
  function firmaFila(fila) {
    return Object.entries(fila.dataset).map(([k, v]) => k + '=' + v).sort().join('&');
  }

  /* Una celda con fórmula guardada se abre mostrándola ("=15*3", ver
     attachCalcInput), así que ver un "=" no alcanza para saber si el usuario
     está escribiendo: de paso por la celda tiene que poder seguir navegando.
     Lo que distingue un caso del otro es si el texto cambió desde que entró —
     `textoAlEnfocar`, que deja attachValorInput. Mientras la está escribiendo
     las flechas son para moverse dentro de la fórmula; se sale con Enter o Tab,
     como en la planilla.
     Para corregir una fórmula guardada sin tipear nada todavía, se entra en
     modo edición igual que en Excel: F2, o clickear adentro de la celda que ya
     tiene el foco (el primer click la selecciona entera). Ver `editando`. */
  function editandoFormula(inp) {
    if (inp.dataset.calc !== '1') return false;        // campo que no admite fórmulas
    if (!inp.value.trim().startsWith('=')) return false;
    return inp.dataset.editando === '1' || inp.value !== inp.dataset.textoAlEnfocar;
  }

  function colapsadoEn(inp, pos) {
    return inp.selectionStart === inp.selectionEnd && inp.selectionStart === pos;
  }

  // Entrar a una celda de cantidad la selecciona entera (attachValorInput), y
  // eso cuenta como estar en los dos bordes: se puede salir para cualquier lado
  // sin tener que colapsar el cursor primero.
  function todoSeleccionado(inp) {
    return inp.value !== '' && inp.selectionStart === 0 && inp.selectionEnd === inp.value.length;
  }

  function enBorde(inp, dir) {
    if (inp.selectionStart == null) return true;   // input sin cursor (no debería pasar acá)
    if (todoSeleccionado(inp)) return true;
    return colapsadoEn(inp, dir > 0 ? inp.value.length : 0);
  }

  function vecinoLineal(wrap, el, sel, dir) {
    const lista = celdasDe(wrap, sel);
    const i = lista.indexOf(el);
    return i < 0 ? null : (lista[i + dir] || null);
  }

  function vecinoVertical(wrap, el, selCeldas, selFilas, dir) {
    const fila = el.closest(selFilas);
    if (!fila) return null;
    const col = celdasDe(fila, selCeldas).indexOf(el);
    if (col < 0) return null;
    // Sólo las filas que tienen alguna celda editable: las cabeceras de tabla y
    // los renglones de subtotal no son paradas del recorrido.
    const filas = Array.from(wrap.querySelectorAll(selFilas)).filter(f => celdasDe(f, selCeldas).length);
    let j = filas.indexOf(fila) + dir;
    while (j >= 0 && j < filas.length) {
      const c = celdasDe(filas[j], selCeldas)[col];
      if (c) return c;
      j += dir;   // esa fila no llega a esta columna: se saltea
    }
    return null;
  }

  function coordDe(destino, selFilas, sel) {
    const fila = destino.closest(selFilas);
    if (!fila) return null;
    return { fila: firmaFila(fila), col: celdasDe(fila, sel).indexOf(destino), sel };
  }

  function recuperar(wrap, coord, selFilas) {
    const fila = Array.from(wrap.querySelectorAll(selFilas)).find(f => firmaFila(f) === coord.fila);
    if (!fila) return null;
    return celdasDe(fila, coord.sel)[coord.col] || null;
  }

  /* Dónde queda el cursor al aterrizar. Las celdas de cantidad ya se
     seleccionan enteras solas al recibir el foco y se las deja así. En los
     campos de texto NO se selecciona todo a propósito: llegar al nombre de un
     ítem y tipear no tiene que borrarlo.
     Moviéndose de costado el cursor se pone del lado por el que se entró, así
     que volver sobre los pasos con la flecha contraria funciona. Moviéndose de
     arriba abajo no hay un lado de entrada: queda al final, que es desde donde
     se sigue escribiendo. */
  function aterrizar(inp, eje, dir) {
    inp.focus();
    if (inp.selectionStart == null) return;
    if (todoSeleccionado(inp)) return;
    const pos = eje === 'h' && dir > 0 ? 0 : inp.value.length;
    inp.setSelectionRange(pos, pos);
  }

  /* wrap  — contenedor estable (sobrevive a los re-render de la tabla)
     opts.celdas — selector de las celdas que recorren las flechas
     opts.filas  — selector de las filas
     opts.tab    — selector de las celdas que recorre el Tab (default: celdas) */
  window.engancharNavCeldas = function (wrap, opts) {
    if (!wrap || wrap.dataset.navCeldas) return;   // idempotente: se llama en cada render
    wrap.dataset.navCeldas = '1';

    const selCeldas = opts.celdas;
    const selFilas = opts.filas;
    const selTab = opts.tab || opts.celdas;

    // Modo edición: la marca vive en la celda mientras tenga el foco. Se entra
    // clickeando una celda que YA estaba enfocada (el click que la enfoca no
    // cuenta: ése es el de seleccionarla), con doble click o con F2.
    const editar = el => { if (el.matches && el.matches(selCeldas)) el.dataset.editando = '1'; };
    wrap.addEventListener('mousedown', e => {
      if (e.target === document.activeElement) editar(e.target);
    });
    wrap.addEventListener('dblclick', e => editar(e.target));
    wrap.addEventListener('focusout', e => {
      if (e.target.dataset) delete e.target.dataset.editando;
    });

    wrap.addEventListener('keydown', e => {
      const el = e.target;
      if (!el.matches || !el.matches(selTab)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'F2' && el.matches(selCeldas)) {
        e.preventDefault();
        editar(el);
        const fin = el.value.length;
        el.setSelectionRange(fin, fin);
        return;
      }

      let destino = null;
      let sel = selCeldas;
      let eje = 'h';
      let dir = 1;

      if (e.key === 'Tab') {
        sel = selTab;
        dir = e.shiftKey ? -1 : 1;
        destino = vecinoLineal(wrap, el, sel, dir);
      } else if (e.shiftKey || !el.matches(selCeldas) || editandoFormula(el)) {
        return;
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        dir = e.key === 'ArrowRight' ? 1 : -1;
        if (!enBorde(el, dir)) return;
        destino = vecinoLineal(wrap, el, selCeldas, dir);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        eje = 'v';
        dir = e.key === 'ArrowDown' ? 1 : -1;
        destino = vecinoVertical(wrap, el, selCeldas, selFilas, dir);
      } else {
        return;
      }

      if (!destino) return;
      const coord = coordDe(destino, selFilas, sel);
      if (!coord) return;
      e.preventDefault();
      // Guardar primero (blur) y recién después buscar el destino por su
      // coordenada: el re-render que dispara el guardado reemplaza los <input>.
      el.blur();
      const vivo = recuperar(wrap, coord, selFilas);
      if (vivo) aterrizar(vivo, eje, dir);
    });
  };
})();
