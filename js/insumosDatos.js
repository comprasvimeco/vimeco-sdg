/* VIMECO S.A. — Modelo de Insumos de una obra (consolidación de materiales,
   equipos y mano de obra desde el Cómputo).

   Recorre cada línea del Cómputo (cantidad × ítem) y, dentro de la receta de
   ese ítem, sus líneas. Un mismo insumo usado en varias líneas de Cómputo (de
   cualquier rubro) se suma en una sola fila. Líneas de Cómputo sin ítem
   vinculado (texto libre, sin receta) no aportan insumos.

   Materiales: la cantidad de la receta es por unidad de ítem, no se divide
   por rendimiento (mismo criterio que calcCostoUnitarioItem en
   calcCostos.js).

   Equipos: la cantidad de la receta es "cuántas máquinas" y su costo es por
   día, dividido por el rendimiento — así que lo que se consolida son
   días-equipo: cantidad del Cómputo × cantidad de la receta ÷ rendimiento.

   Mano de obra: mismo criterio que Equipos pero por categoría (rol) — se
   consolidan días-hombre. No incluye el adicional de Seguridad y Capataz
   (ese es un ajuste por AP, no por categoría).

   Recibe un objeto con la misma forma que el `modelo` de presupuestoDatos.js
   (o un subconjunto equivalente): { obraKey, catalogos: { items, materiales,
   equipos, roles }, computo, preciosObra, paramsEquipos, paramsMO, dolarObra }.
   Lo usan la pantalla Insumos (js/insumos-obra.js) y la sección "Insumos" de
   la exportación (js/exportar.js), para que las dos salidas consoliden
   exactamente igual. */

(function () {

  function versionDe(item, obraKey) {
    const propia = item.versionesObra && item.versionesObra[obraKey];
    return propia || item;
  }

  function precioUnitarioMaterial(mat, preciosObra) {
    const precio = preciosObra[mat.key];
    if (!precio) return null;
    // El precio en pesos cargado es la fuente de verdad; el dólar es sólo
    // ayuda de cálculo. Se reconvierte desde USD sólo si el material no
    // tiene precioARS guardado (datos viejos, antes del campo dual).
    if (precio.precioARS != null) return precio.precioARS;
    const venta = window.dolarOficialVenta();
    if (!precio.precioUSD || !venta) return null;
    return precio.precioUSD * venta;
  }

  function nombreEquipo(e) {
    return [e.tipo || '', e.codigo || ''].filter(Boolean).join(' · ') || '(sin nombre)';
  }

  /* Recorre el Cómputo y consolida las líneas de receta de un tipo
     ('material' | 'equipo' | 'manoDeObra') sobre su catálogo. `cantidadDe`
     traduce una línea de receta a la magnitud que se consolida (unidades
     para materiales, días para equipos y mano de obra). Devuelve
     [{ entidad, cantidadTotal, usados: [{ nombre, cantidad }] }]. */
  function consolidar(modelo, tipo, catalogo, cantidadDe) {
    const mapa = {};
    Object.values(modelo.computo || {}).forEach(linea => {
      if (!linea.itemKey || linea.cantidad == null || isNaN(linea.cantidad)) return;
      const item = modelo.catalogos.items.find(i => i.key === linea.itemKey);
      if (!item) return;
      const version = versionDe(item, modelo.obraKey);
      if (!version.lineas) return;
      Object.values(version.lineas).forEach(rl => {
        if (rl.tipo !== tipo || rl.cantidad == null || isNaN(rl.cantidad)) return;
        const entidad = catalogo.find(c => c.key === rl.refKey);
        if (!entidad) return;
        const cantidadNecesaria = cantidadDe(linea, rl, version);
        if (!mapa[entidad.key]) mapa[entidad.key] = { entidad, cantidadTotal: 0, usados: [] };
        mapa[entidad.key].cantidadTotal += cantidadNecesaria;
        mapa[entidad.key].usados.push({ nombre: linea.nombre || '(sin nombre)', cantidad: cantidadNecesaria });
      });
    });
    return Object.values(mapa);
  }

  /* Aplica `datosDe` (nombre, unidad, costoUnitario) a cada grupo consolidado
     y arma las filas con costo total ya resuelto, más el total de la tabla y
     si falta algún precio. */
  function armarGrupo(grupos, datosDe) {
    let costoTotal = 0;
    let faltaPrecio = false;
    const filas = grupos.map(g => {
      const datos = datosDe(g);
      let costo = null;
      if (datos.costoUnitario != null) {
        costo = datos.costoUnitario * g.cantidadTotal;
        costoTotal += costo;
      } else {
        faltaPrecio = true;
      }
      return {
        key: g.entidad.key,
        nombre: datos.nombre,
        unidad: datos.unidad,
        cantidad: g.cantidadTotal,
        costoUnitario: datos.costoUnitario,
        costoTotal: costo,
        usados: g.usados,
      };
    });
    return { filas, costoTotal, faltaPrecio };
  }

  // Devuelve { materiales, equipos, manoDeObra }, cada uno
  // { filas: [{ key, nombre, unidad, cantidad, costoUnitario, costoTotal, usados }], costoTotal, faltaPrecio }.
  window.calcularInsumosObra = function (modelo) {
    const materiales = armarGrupo(
      consolidar(modelo, 'material', modelo.catalogos.materiales, (linea, rl) => linea.cantidad * rl.cantidad)
        .sort((a, b) => a.entidad.nombre.localeCompare(b.entidad.nombre, 'es')),
      g => ({
        nombre: g.entidad.nombre,
        unidad: g.entidad.unidad || '',
        costoUnitario: precioUnitarioMaterial(g.entidad, modelo.preciosObra),
      }));

    const equipos = armarGrupo(
      consolidar(modelo, 'equipo', modelo.catalogos.equipos, (linea, rl, version) =>
        linea.cantidad * rl.cantidad / (version.rendimiento || 1))
        .sort((a, b) => (a.entidad.codigo || '').localeCompare(b.entidad.codigo || '', 'es')),
      g => ({
        nombre: nombreEquipo(g.entidad),
        unidad: 'día',
        costoUnitario: window.calcCostoDiarioEquipo(g.entidad, modelo.paramsEquipos, modelo.paramsMO.jornadaHoras, modelo.dolarObra),
      }));

    const manoDeObra = armarGrupo(
      consolidar(modelo, 'manoDeObra', modelo.catalogos.roles, (linea, rl, version) =>
        linea.cantidad * rl.cantidad / (version.rendimiento || 1))
        .sort((a, b) => (a.entidad.orden || 0) - (b.entidad.orden || 0)),
      g => ({
        nombre: g.entidad.nombre,
        unidad: 'día',
        costoUnitario: g.entidad.basico ? window.calcCostoManoDeObra(g.entidad, modelo.paramsMO).costoJornal : null,
      }));

    return { materiales, equipos, manoDeObra };
  };

})();
