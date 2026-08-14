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
    const [obraData, computoData, rubrosData, itemsData, materialesData,
           equiposData, rolesData, cfLineasData, cfConfigData, datosExtraData] = await Promise.all([
      _fbGet(`/obras/${obraKey}.json`),
      _fbGet(`/obras/${obraKey}/computo.json`),
      _fbGet(`/obras/${obraKey}/rubrosComputo.json`),
      _fbGet('/items.json'),
      _fbGet('/materiales.json'),
      _fbGet('/equipos.json'),
      _fbGet(`/obras/${obraKey}/roles.json`),
      _fbGet(`/obras/${obraKey}/cargaFija/lineas.json`),
      _fbGet(`/obras/${obraKey}/cargaFija/config.json`),
      _fbGet(`/obras/${obraKey}/datosExtra.json`),
    ]);

    if (!obraData) return null;

    const obra = obraData;
    const lineas = computoData || {};
    const rubros = Object.entries(rubrosData || {})
      .map(([key, r]) => ({ key, ...r }))
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));
    const catalogos = {
      items:      Object.entries(itemsData      || {}).map(([key, i]) => ({ key, ...i })),
      materiales: Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m })),
      equipos:    Object.entries(equiposData    || {}).map(([key, e]) => ({ key, ...e })),
      roles:      Object.entries(rolesData      || {}).map(([key, r]) => ({ key, ...r })),
    };
    const paramsEquipos = { ...DEFAULT_PARAMS_EQUIPOS, ...(obra.paramsEquipos || {}) };
    const paramsMO      = { ...DEFAULT_PARAMS_MO,      ...(obra.paramsMO      || {}) };
    const dolarObra     = obra.dolar ? obra.dolar.valor : null;
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

    const gastosFijos = window.totalGastosFijosCargaFija(
      cargaFijaLineas, costoComputo, obra.presupuestoOficial != null ? obra.presupuestoOficial : null);
    const kDesglose = window.calcCoeficienteK(cargaFijaConfig, gastosFijos, costoComputo);
    const k = kDesglose.k;

    // El total sale de TODAS las líneas del cómputo, incluidas las que
    // apuntan a un rubro que ya no existe: son plata cargada en la obra
    // aunque ninguna tabla las muestre.
    const total = k == null ? null : Object.values(lineas)
      .reduce((acc, l) => acc + costoUnitarioDe(l.itemKey) * k * num(l.cantidad), 0);

    /* ---- Árbol rubro → línea ---- */

    const rubrosModelo = rubros.map((rubro, ri) => {
      const propias = Object.entries(lineas)
        .filter(([, l]) => l.rubroId === rubro.key)
        .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));

      const lineasModelo = propias.map(([lineaKey, l], li) => {
        const cantidad = num(l.cantidad);
        const costoUnitario  = costoUnitarioDe(l.itemKey);
        const precioUnitario = k == null ? null : costoUnitario * k;
        const totalLinea     = precioUnitario == null ? null : precioUnitario * cantidad;
        return {
          key: lineaKey,
          numero: `${ri + 1}.${li + 1}`,
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
        numero: String(ri + 1),
        nombre: rubro.nombre || '',
        lineas: lineasModelo,
        subtotalCosto,
        subtotal,
        incidencia: total > 0 && subtotal != null ? subtotal / total : null,
      };
    });

    return {
      obraKey, obra,
      datosExtra: datosExtraData || {},
      catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra,
      computo: lineas,
      cargaFija: { lineas: cargaFijaLineas, config: cargaFijaConfig, gastosFijos },
      costoUnitarioDe,
      costoComputo, k, kDesglose, total,
      rubros: rubrosModelo,
    };
  };

  // Datos de cabecera de la obra listos para un documento: nombre, comitente y
  // ubicación son campos propios, y todo lo demás (expediente, número de
  // licitación, etc.) son los "datos adicionales" libres que se cargan en
  // Datos de obra, en el orden en que se crearon.
  window.membreteDeObra = function (modelo) {
    const filas = [];
    if (modelo.obra.nombre) filas.push({ etiqueta: 'OBRA', valor: modelo.obra.nombre });
    if (modelo.obra.comitente) filas.push({ etiqueta: 'COMITENTE', valor: modelo.obra.comitente });
    if (modelo.obra.ubicacion) filas.push({ etiqueta: 'UBICACIÓN', valor: modelo.obra.ubicacion });
    Object.values(modelo.datosExtra || {})
      .sort((a, b) => (a.creadoEn || 0) - (b.creadoEn || 0))
      .forEach(d => {
        if (!d.etiqueta && !d.valor) return;
        filas.push({ etiqueta: (d.etiqueta || '').toUpperCase(), valor: d.valor || '' });
      });
    return filas;
  };
})();
