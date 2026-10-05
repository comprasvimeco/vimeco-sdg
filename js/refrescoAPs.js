/* VIMECO S.A. — Puesta al día de los A.P. con fórmulas vivas.

   Una cantidad (o el rendimiento) de A.P. con fórmula viva ("k", "us", o una celda del propio
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
      if (v && (window.formulaTieneRefs(v.rendimientoFormula) ||
                Object.values(v.lineas || {}).some(x => x && window.formulaTieneRefs(x.cantidadFormula)))) keys.add(l.itemKey);
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

  // Tarjeta animada en el lugar del cartel de carga de la pantalla
  // (#main-loading .list-loading, que todas tienen): anillo con el conteo,
  // barra, el A.P. en curso y un punto por cada uno. Más de 60 puntos ya no
  // se leen: ahí queda sólo la barra.
  function armarTarjeta(total) {
    const cartel = document.querySelector('#main-loading .list-loading');
    if (!cartel) return null;
    cartel.className = 'refresco-ap';
    cartel.innerHTML = `
      <div class="refresco-ap-anillo"><span>0/${total}</span></div>
      <div class="refresco-ap-titulo">Actualizando análisis de precio</div>
      <div class="refresco-ap-sub">Recalculando las fórmulas que usan el K, el dólar o celdas del A.P.</div>
      <div class="refresco-ap-barra"><div></div></div>
      <div class="refresco-ap-actual"></div>
      ${total <= 60 ? `<div class="refresco-ap-puntos">${'<i></i>'.repeat(total)}</div>` : ''}`;
    const q = s => cartel.querySelector(s);
    const puntos = [...cartel.querySelectorAll('.refresco-ap-puntos i')];
    return {
      ronda(n) {
        if (n === 1) return;
        q('.refresco-ap-sub').textContent = n === 2
          ? 'Segunda pasada: el K cambió con los valores nuevos'
          : 'Última pasada para que todo cierre';
        puntos.forEach(p => { p.className = ''; });
        q('.refresco-ap-barra > div').style.width = '0';
        q('.refresco-ap-anillo span').textContent = `0/${total}`;
      },
      empieza(i, nombre) {
        if (puntos[i]) puntos[i].className = 'en-curso';
        const actual = q('.refresco-ap-actual');
        actual.innerHTML = '<span></span>';
        actual.firstChild.textContent = nombre;
      },
      termina(i, hechos) {
        if (puntos[i]) puntos[i].className = 'hecho';
        q('.refresco-ap-barra > div').style.width = (100 * hechos / total) + '%';
        q('.refresco-ap-anillo span').textContent = `${hechos}/${total}`;
      },
    };
  }

  /* Cada A.P. oculto es una página entera que, sola, volvería a bajar todas
     las obras, materiales, equipos e ítems: con decenas de A.P. eso era casi
     todo el tiempo de espera. Mientras dura una pasada, sus lecturas pasan por
     acá (ver modoRefrescar en item.js) y cada nodo se pide una sola vez.
     No cambia el resultado: dentro de una pasada los A.P. ya trabajaban en
     paralelo sin ver lo que guardaban los otros, cada pasada nueva vuelve a
     leer todo, y se termina recién con una pasada que no cambió nada. */
  let lecturas = null;   // Map path → Promise<texto JSON>, sólo durante el refresco
  window.__refrescoLeer = function (path) {
    if (!lecturas) return _fbGet(path).then(v => JSON.stringify(v ?? null));
    if (!lecturas.has(path)) {
      const p = _fbGet(path).then(v => JSON.stringify(v ?? null));
      p.catch(() => { if (lecturas && lecturas.get(path) === p) lecturas.delete(path); });
      lecturas.set(path, p);
    }
    return lecturas.get(path);
  };

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
    const tarjeta = armarTarjeta(keys.length);
    // La primera pasada arranca con lo que se acaba de leer; las siguientes
    // vuelven a pedir todo, para ver lo que escribió la anterior.
    lecturas = new Map([
      [`/obras/${obraKey}/computo.json`, Promise.resolve(JSON.stringify(computo))],
      [`/obras/${obraKey}/auxiliares.json`, Promise.resolve(JSON.stringify(auxiliares))],
      ['/items.json', Promise.resolve(JSON.stringify(items))],
    ]);
    for (let ronda = 1; ronda <= 3; ronda++) {
      if (ronda > 1) lecturas = new Map();
      if (tarjeta) tarjeta.ronda(ronda);
      let hechos = 0;
      let cambio = false;
      let siguiente = 0;
      const trabajar = async () => {
        while (siguiente < keys.length) {
          const i = siguiente++;
          if (tarjeta) tarjeta.empieza(i, (items[keys[i]] || {}).nombre || '');
          if (await refrescarAP(obraKey, keys[i])) cambio = true;
          hechos++;
          if (tarjeta) tarjeta.termina(i, hechos);
        }
      };
      await Promise.all([trabajar(), trabajar(), trabajar()]);
      if (!cambio) break;
    }
    lecturas = null;
  };
})();
