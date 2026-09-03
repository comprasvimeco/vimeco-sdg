/* VIMECO S.A. — Modelo del Presupuesto de una obra (carga + agregación).

   Trae de Firebase todo lo que hace falta para valorizar el Cómputo y arma el
   árbol rubro → línea con costo, precio unitario (costo × K), total e
   incidencia ya resueltos. Lo consumen la pantalla Presupuesto
   (presupuesto.js) y la exportación (exportar.js): antes cada una habría
   tenido que repetir la misma cadena de fetch + costeo, y cualquier
   diferencia entre las dos sería un presupuesto impreso distinto al de
   pantalla.

   Acá no vive ninguna fórmula: el costo unitario de un ítem, el Coeficiente K
   y el total de Carga Fija salen de calcCostos.js. Este módulo sólo junta y
   agrega. */

(function () {
  const DEFAULT_PARAMS_EQUIPOS = {
    tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50,
    combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0,
  };
  const DEFAULT_PARAMS_MO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };

  const num = n => (n != null && !isNaN(n) ? Number(n) : 0);

  // Un ítem de Biblioteca puede tener una versión propia de esta obra
  // (/items/{key}/versionesObra/{obraKey}); si no la tiene, vale el ítem tal
  // como está en la Biblioteca.
  function versionDe(item, obraKey) {
    const propia = item.versionesObra && item.versionesObra[obraKey];
    return propia || item;
  }

  /* Devuelve el modelo completo del presupuesto de una obra, o null si la obra
     no existe. Ver el final del archivo para la forma del objeto. */
  window.cargarPresupuestoObra = async function (obraKey) {
    const [obraData, computoData, rubrosData, auxiliaresData, itemsData, materialesData,
           equiposData, rolesData, cfLineasData, cfConfigData, encabezadoData] = await Promise.all([
      _fbGet(`/obras/${obraKey}.json`),
      _fbGet(`/obras/${obraKey}/computo.json`),
      _fbGet(`/obras/${obraKey}/rubrosComputo.json`),
      _fbGet(`/obras/${obraKey}/auxiliares.json`),
      _fbGet('/items.json'),
      _fbGet('/materiales.json'),
      _fbGet('/equipos.json'),
      _fbGet(`/obras/${obraKey}/roles.json`),
      _fbGet(`/obras/${obraKey}/cargaFija/lineas.json`),
      _fbGet(`/obras/${obraKey}/cargaFija/config.json`),
      _fbGet(`/obras/${obraKey}/encabezado.json`),
    ]);

    if (!obraData) return null;

    const obra = obraData;
    const lineas = computoData || {};
    const catalogos = {
      items:      Object.entries(itemsData      || {}).map(([key, i]) => ({ key, ...i })),
      materiales: Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m })),
      equipos:    Object.entries(equiposData    || {}).map(([key, e]) => ({ key, ...e })),
      roles:      window.rolesOrdenados(Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }))),
    };
    const paramsEquipos = { ...DEFAULT_PARAMS_EQUIPOS, ...(obra.paramsEquipos || {}) };
    const paramsMO      = { ...DEFAULT_PARAMS_MO,      ...(obra.paramsMO      || {}) };
    const dolarObra     = obra.dolar ? obra.dolar.valor : null;
    window.setCotizacionObra(dolarObra);
    const preciosObra   = window.resolverPreciosObra(catalogos.materiales, obraKey);
    const cargaFijaLineas = cfLineasData || {};
    const cargaFijaConfig = { beneficioPct: null, costoFinancieroPct: null, ...(cfConfigData || {}) };

    /* ---- Costeo ---- */

    const costoPorItem = {};   // memo: un mismo ítem puede repetirse en varias líneas
    function costoUnitarioDe(itemKey) {
      if (!itemKey) return 0;
      if (costoPorItem[itemKey] != null) return costoPorItem[itemKey];
      const it = catalogos.items.find(i => i.key === itemKey);
      if (!it) return (costoPorItem[itemKey] = 0);
      const version = versionDe(it, obraKey);
      if (!version.lineas || !Object.keys(version.lineas).length) return (costoPorItem[itemKey] = 0);
      const r = window.calcCostoUnitarioItem(
        version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra);
      return (costoPorItem[itemKey] = r.costoUnitario);
    }

    const costoComputo = Object.values(lineas)
      .reduce((acc, l) => acc + costoUnitarioDe(l.itemKey) * num(l.cantidad), 0);

    // calcCargaFija resuelve los gastos fijos y el K de una sola vez: los
    // conceptos calculados sobre el presupuesto propio necesitan el K, y el K
    // esos conceptos (ver el despeje en calcCostos.js). Trae además el monto ya
    // resuelto de cada línea, para que los exportadores no recalculen nada.
    const kDesglose = window.calcCargaFija(cargaFijaConfig, cargaFijaLineas, costoComputo,
      obra.presupuestoOficial != null ? obra.presupuestoOficial : null);
    const gastosFijos = kDesglose.gastosFijos;
    const k = kDesglose.k;
    // Referenciable como "k" en la calculadora flotante (ver calc.js) — no
    // existe en exportar.html, que también usa este módulo pero no la carga.
    if (window.setRefK) window.setRefK(k);

    // El total sale de TODAS las líneas del cómputo, incluidas las que
    // apuntan a un rubro que ya no existe: son plata cargada en la obra
    // aunque ninguna tabla las muestre.
    const total = k == null ? null : Object.values(lineas)
      .reduce((acc, l) => acc + costoUnitarioDe(l.itemKey) * k * num(l.cantidad), 0);

    /* ---- Árbol rubro → línea ---- */

    // El número de cada rubro y de cada línea sale de js/numeracion.js, que es
    // el mismo que usan el Cómputo, el AP y el Plan de Avance: si acá se
    // numerara distinto, el papel saldría con otra numeración que la pantalla.
    const numeracion = window.numerarComputo(obra, rubrosData, lineas);

    const rubrosModelo = numeracion.rubros.map(rubro => {
      const lineasModelo = rubro.lineas.map(l => {
        const cantidad = num(l.cantidad);
        const costoUnitario  = costoUnitarioDe(l.itemKey);
        const precioUnitario = k == null ? null : costoUnitario * k;
        const totalLinea     = precioUnitario == null ? null : precioUnitario * cantidad;
        return {
          key: l.key,
          numero: l.codigo,
          nombre: l.nombre || '',
          unidad: l.unidad || '',
          cantidad: l.cantidad != null && !isNaN(l.cantidad) ? Number(l.cantidad) : null,
          itemKey: l.itemKey || null,
          costoUnitario,
          costoTotal: costoUnitario * cantidad,
          precioUnitario,
          total: totalLinea,
          incidencia: total > 0 && totalLinea != null ? totalLinea / total : null,
        };
      });

      const subtotalCosto = lineasModelo.reduce((acc, l) => acc + l.costoTotal, 0);
      const subtotal = k == null ? null : lineasModelo.reduce((acc, l) => acc + (l.total || 0), 0);
      return {
        key: rubro.key,
        numero: rubro.codigo,
        nombre: rubro.nombre || '',
        lineas: lineasModelo,
        subtotalCosto,
        subtotal,
        incidencia: total > 0 && subtotal != null ? subtotal / total : null,
      };
    });

    /* ---- Análisis auxiliares ----
       No son parte de la obra: no entran al costo del Cómputo, ni al total, ni
       a las incidencias, ni al Plan. Y **no llevan Carga Fija**: el análisis
       termina en el Subtotal (A+B+C), que es el costo. Ese es el número que se
       copia a mano a Carga Fija, donde se cargan costos —el Coeficiente K se
       calcula después sobre ellos—, así que aplicarle K acá sería multiplicar
       dos veces. Por eso no tienen precioUnitario ni total. */
    const auxiliares = window.numerarAuxiliares(auxiliaresData).map(a => {
      const costoUnitario = costoUnitarioDe(a.itemKey);
      return {
        key: a.key,
        numero: a.codigo,
        nombre: a.nombre || '',
        unidad: a.unidad || '',
        cantidad: a.cantidad != null && !isNaN(a.cantidad) ? Number(a.cantidad) : null,
        itemKey: a.itemKey || null,
        costoUnitario,
        costoTotal: costoUnitario * num(a.cantidad),
      };
    });

    return {
      obraKey, obra,
      encabezado: encabezadoData || {},
      catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra,
      computo: lineas,
      cargaFija: {
        lineas: cargaFijaLineas, config: cargaFijaConfig, gastosFijos,
        totalPorLinea: kDesglose.totalPorLinea,
        precioSinIva: kDesglose.precioSinIva, precioConIva: kDesglose.precioConIva,
      },
      costoUnitarioDe,
      costoComputo, k, kDesglose, total,
      numeracion: numeracion.cfg,
      rubros: rubrosModelo,
      auxiliares,
    };
  };

  // Análisis de Precio de un ítem, con el detalle línea por línea listo para
  // mostrar: los mismos números y el mismo orden (A Equipos → B Mano de Obra →
  // C Materiales → Subtotal) que la pantalla del AP (js/item.js). Devuelve
  // null si la línea del cómputo no tiene ningún ítem vinculado, y un AP con
  // las tres listas vacías si el ítem existe pero no tiene receta cargada.
  window.analisisDePrecioDe = function (modelo, itemKey) {
    if (!itemKey) return null;
    const item = modelo.catalogos.items.find(i => i.key === itemKey);
    if (!item) return null;
    const version = versionDe(item, modelo.obraKey);
    const lineasItem = version.lineas || {};
    const r = window.calcCostoUnitarioItem(
      version, lineasItem, modelo.catalogos, modelo.paramsEquipos, modelo.paramsMO,
      modelo.preciosObra, modelo.dolarObra);

    // Nombre con el que se conoce cada insumo, igual que en la pantalla del AP.
    const nombreDe = (tipo, e) => tipo === 'equipo'
      ? `${e.tipo || ''} ${e.codigo || ''}`.trim()
      : (e.nombre || '');

    function filas(tipo) {
      return Object.entries(lineasItem)
        .filter(([, l]) => l.tipo === tipo)
        .map(([lineaKey, l]) => {
          const cat = tipo === 'material' ? modelo.catalogos.materiales
            : tipo === 'equipo' ? modelo.catalogos.equipos
            : modelo.catalogos.roles;
          const entidad = cat.find(c => c.key === l.refKey);
          const d = r.detallePorLinea[lineaKey];
          return {
            // refKey identifica al insumo, no sólo lo nombra: la exportación a
            // Excel lo necesita para escribir el nombre con el que quedó en la
            // hoja Materiales/Equipos (dos insumos que se llaman igual se
            // desambiguan allá) y que el VLOOKUP lo encuentre.
            refKey: entidad ? entidad.key : null,
            tipo,
            nombre: entidad ? nombreDe(tipo, entidad) : '(sin elegir)',
            unidad: tipo === 'material' && entidad ? (entidad.unidad || '') : '',
            cantidad: l.cantidad != null && !isNaN(l.cantidad) ? Number(l.cantidad) : null,
            costoUnitario: d ? d.costoUnitario : null,
            costoTotal: d ? d.costoTotal : null,
          };
        });
    }

    // Mano de Obra sale en el orden que el usuario les dio a los roles en la
    // pantalla de Mano de Obra de la obra — el mismo que se ve en el A.P.
    const ordenRol = {};
    modelo.catalogos.roles.forEach((rol, i) => { ordenRol[rol.nombre] = i; });
    const manoDeObra = filas('manoDeObra')
      .sort((a, b) => (ordenRol[a.nombre] ?? 99) - (ordenRol[b.nombre] ?? 99));

    return {
      itemKey,
      nombre: item.nombre || '',
      unidad: item.unidad || '',
      rendimiento: version.rendimiento || 1,
      equipos: filas('equipo'),
      manoDeObra,
      materiales: filas('material'),
      costoDiarioEquipos: r.costoDiarioEquipos,
      costoUnitarioEquipos: r.costoUnitarioEquipos,
      costoDiarioSeguridadCapataz: r.costoDiarioSeguridadCapataz,
      seguridadCapatazPctAplicado: r.seguridadCapatazPctAplicado,
      costoDiarioMO: r.costoDiarioMO,
      costoUnitarioMO: r.costoUnitarioMO,
      costoMateriales: r.costoMateriales,
      costoUnitario: r.costoUnitario,
      sinReceta: !Object.keys(lineasItem).length,
    };
  };

  // Equipos que efectivamente aparecen en algún análisis de precio de esta
  // obra —presupuesto o auxiliar—, con su desglose de costo diario. No es el
  // catálogo global de equipos: sólo los que un A.P de esta obra referencia,
  // que es el mismo criterio con el que la hoja A.P (y A.P auxiliares) del
  // Excel arma sus bloques. Usado para la sección "Amortización de equipos"
  // de la exportación (PDF y Excel), ver [[project_desglose_amortizacion_equipos]].
  window.equiposUsadosEnObra = function (modelo) {
    const itemKeys = new Set();
    modelo.rubros.forEach(r => r.lineas.forEach(l => { if (l.itemKey) itemKeys.add(l.itemKey); }));
    modelo.auxiliares.forEach(a => { if (a.itemKey) itemKeys.add(a.itemKey); });

    const refKeys = new Set();
    itemKeys.forEach(itemKey => {
      const ap = window.analisisDePrecioDe(modelo, itemKey);
      if (!ap) return;
      ap.equipos.forEach(e => { if (e.refKey) refKeys.add(e.refKey); });
    });

    return modelo.catalogos.equipos
      .filter(e => refKeys.has(e.key))
      .sort((a, b) => `${a.tipo || ''} ${a.codigo || ''}`.localeCompare(`${b.tipo || ''} ${b.codigo || ''}`, 'es'))
      .map(equipo => ({
        equipo,
        desglose: window.calcDesgloseCostoEquipo(equipo, modelo.paramsEquipos, modelo.paramsMO.jornadaHoras, modelo.dolarObra),
      }));
  };

})();
