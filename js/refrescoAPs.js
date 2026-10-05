/* VIMECO S.A. — Puesta al día de los A.P. con fórmulas vivas.

   Una cantidad de A.P. con fórmula viva ("k", "us", o una celda del propio
   A.P.) se recalcula y se guarda sólo con ese A.P. abierto: sin esto, las
   pantallas que leen la receta guardada (Presupuesto, Exportar, Insumos, Plan de
   Avance) mostraban el número viejo hasta que alguien entraba a cada uno.
   Antes de armar sus números, esas pantallas abren los A.P. afectados en
   iframes ocultos (item.html?refrescar=1, ver refrescarParaPresupuesto en
   item.js), que hacen exactamente lo mismo que abrirlos a mano. Como el K
   depende del costo de todos y algunas fórmulas dependen del K, se repite
   mientras algo cambie (con tope).

   Una vez por carga de página: la recarga de un Ctrl+Z no lo vuelve a correr. */

(function () {
  let hecho = false;

  function apsConFormulasVivas(obraKey, computo, auxiliares, items) {
    const keys = new Set();
    [...Object.values(auxiliares || {}), ...Object.values(computo || {})].forEach(l => {
      const it = l && l.itemKey && (items || {})[l.itemKey];
      const v = it && (it.versionesObra || {})[obraKey];
      if (v && Object.values(v.lineas || {}).some(x => x && window.formulaTieneRefs(x.cantidadFormula))) keys.add(l.itemKey);
    });
    return [...keys];
  }

  function refrescarAP(obraKey, itemKey) {
    return new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      let timer;
      const fin = cambio => {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        frame.remove();
        resolve(cambio);
      };
      const onMsg = e => {
        if (e.source === frame.contentWindow && e.data && e.data.tipo === 'ap-refrescado') fin(!!e.data.cambio);
      };
      window.addEventListener('message', onMsg);
      timer = setTimeout(() => fin(false), 30000);
      frame.src = `item.html?key=${encodeURIComponent(itemKey)}&obra=${encodeURIComponent(obraKey)}&refrescar=1`;
      document.body.appendChild(frame);
    });
  }

  // El progreso se escribe en el cartel de carga de la pantalla
  // (#main-loading .list-loading), que todas tienen.
  window.refrescarAPsConFormulasVivas = async function (obraKey) {
    if (hecho) return;
    hecho = true;
    const [computo, auxiliares, items] = await Promise.all([
      _fbGet(`/obras/${obraKey}/computo.json`),
      _fbGet(`/obras/${obraKey}/auxiliares.json`),
      _fbGet('/items.json'),
    ]);
    const keys = apsConFormulasVivas(obraKey, computo, auxiliares, items);
    if (!keys.length) return;
    const cartel = document.querySelector('#main-loading .list-loading');
    for (let ronda = 1; ronda <= 3; ronda++) {
      let hechos = 0;
      let cambio = false;
      const pendientes = [...keys];
      const trabajar = async () => {
        while (pendientes.length) {
          if (await refrescarAP(obraKey, pendientes.shift())) cambio = true;
          hechos++;
          if (cartel) cartel.textContent = `Actualizando análisis de precio con fórmulas (${hechos} de ${keys.length})…`;
        }
      };
      await Promise.all([trabajar(), trabajar(), trabajar()]);
      if (!cambio) break;
    }
  };
})();
