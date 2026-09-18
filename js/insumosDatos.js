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
   consolidan días-hombre. El adicional de Seguridad y Capataz (paramsMO) se
   agrega como una fila más de Mano de Obra, ver calcularCapataz más abajo.

   Un auxiliar usado como insumo (línea tipo 'auxiliar', ver calcCostos.js) se
   EXPANDE: no es un insumo en sí mismo, es un cálculo que a su vez consume
   materiales/equipos/mano de obra — se baja recursivamente a la receta de su
   ítem fantasma (multiplicando cantidades en cadena) y esos insumos base son
   los que se consolidan acá. `auxVisitados` corta un ciclo entre auxiliares
   (no debería poder armarse desde item.js, pero es una red de seguridad).

   Recibe un objeto con la misma forma que el `modelo` de presupuestoDatos.js
   (o un subconjunto equivalente): { obraKey, catalogos: { items, materiales,
   equipos, roles, auxiliares }, computo, preciosObra, paramsEquipos, paramsMO,
   dolarObra }. Lo usan la pantalla Insumos (js/insumos-obra.js) y la sección
   "Insumos" de la exportación (js/exportar.js), para que las dos salidas
   consoliden exactamente igual. */

(function () {

  // Las líneas de Mano de Obra de la familia que el A.P. no está usando quedan
  // afuera acá, de entrada: la pantalla del A.P. no las muestra, así que
  // consolidarlas o listarlas sería inventar un insumo que nadie puede ver ni
  // corregir (ver lineasSinMOAjena, calcCostos.js).
  function versionDe(item, obraKey, roles) {
    const propia = item.versionesObra && item.versionesObra[obraKey];
    const version = propia || item;
    const lineas = window.lineasSinMOAjena(version, version.lineas, roles);
    if (lineas === version.lineas || Object.keys(lineas).length === Object.keys(version.lineas || {}).length) return version;
    return { ...version, lineas };
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

  // Ítem fantasma de un auxiliar (ver calcCostos.js) — null si no se puede
  // resolver (auxiliar borrado, itemKey inconsistente, etc.), caso en el que
  // simplemente no aporta nada, igual que un insumo sin elegir.
  function versionDeAuxiliar(modelo, auxKey) {
    const aux = (modelo.catalogos.auxiliares || []).find(a => a.key === auxKey);
    const it = aux && modelo.catalogos.items.find(i => i.key === aux.itemKey);
    return it ? versionDe(it, modelo.obraKey, modelo.catalogos.roles) : null;
  }

  // Cantidad de `tipo` que aporta UNA línea de receta, en la unidad que se
  // consolida — todavía sin multiplicar por cuántas veces se repite el nivel
  // que la contiene (eso lo hace `expandirNivel` con `multiplicador`).
  function cantidadPropia(tipo, rl, version) {
    return tipo === 'material' ? rl.cantidad : rl.cantidad / (version.rendimiento || 1);
  }

  /* Recorre la receta de UN nivel (un ítem del Cómputo o, recursivamente, el
     ítem fantasma de un auxiliar usado como insumo) y acumula en `mapa` las
     líneas de `tipo`. `multiplicador` es cuántas veces se repite este nivel
     para la línea de Cómputo que se está expandiendo: arranca en la cantidad
     de esa línea y se multiplica por la cantidad de cada auxiliar
     intermedio (que se comporta como un material — fija por unidad del nivel
     que lo contiene, ver calcCostoUnitarioItem en calcCostos.js). */
  function expandirNivel(modelo, version, multiplicador, tipo, catalogo, mapa, nombreLineaTop, auxVisitados) {
    Object.values(version.lineas || {}).forEach(rl => {
      if (rl.cantidad == null || isNaN(rl.cantidad)) return;
      if (rl.tipo === tipo) {
        const entidad = catalogo.find(c => c.key === rl.refKey);
        if (!entidad) return;
        const cantidadNecesaria = multiplicador * cantidadPropia(tipo, rl, version);
        if (!mapa[entidad.key]) mapa[entidad.key] = { entidad, cantidadTotal: 0, usados: [] };
        mapa[entidad.key].cantidadTotal += cantidadNecesaria;
        mapa[entidad.key].usados.push({ nombre: nombreLineaTop, cantidad: cantidadNecesaria });
      } else if (rl.tipo === 'auxiliar' && rl.refKey && !auxVisitados.has(rl.refKey)) {
        const auxVersion = versionDeAuxiliar(modelo, rl.refKey);
        if (!auxVersion) return;
        expandirNivel(modelo, auxVersion, multiplicador * rl.cantidad, tipo, catalogo, mapa,
          nombreLineaTop, new Set(auxVisitados).add(rl.refKey));
      }
    });
  }

  /* Recorre el Cómputo y consolida las líneas de receta de un tipo
     ('material' | 'equipo' | 'manoDeObra') sobre su catálogo, expandiendo
     cualquier auxiliar usado como insumo en el camino. Devuelve
     [{ entidad, cantidadTotal, usados: [{ nombre, cantidad }] }]. */
  function consolidar(modelo, tipo, catalogo) {
    const mapa = {};
    Object.values(modelo.computo || {}).forEach(linea => {
      if (!linea.itemKey || linea.cantidad == null || isNaN(linea.cantidad)) return;
      const item = modelo.catalogos.items.find(i => i.key === linea.itemKey);
      if (!item) return;
      const version = versionDe(item, modelo.obraKey, modelo.catalogos.roles);
      if (!version.lineas) return;
      expandirNivel(modelo, version, linea.cantidad, tipo, catalogo, mapa,
        linea.nombre || '(sin nombre)', new Set());
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

  /* Capatacía (adicional "Seguridad y Capataz" de paramsMO): a diferencia de
     Materiales/Equipos, no es una entidad de la receta — es un % sobre el
     costo diario de mano de obra de CADA NIVEL (el ítem del Cómputo, y
     recursivamente cada auxiliar usado como insumo: cada uno aplica el
     adicional sobre SU PROPIA mano de obra, con su propio
     `sinSeguridadCapataz` — ese monto queda "adentro" del costo del
     auxiliar tal como lo ve quien lo usa, mismo criterio que
     calcCostoUnitarioItem en calcCostos.js). Se muestra como una fila más de
     Mano de Obra (misma tabla, mismo desglose por ítem al hover/toggle — no
     una categoría aparte). No tiene una cantidad física (kg, día): la fila
     usa unidad '%' con la cantidad = el % aplicado, y el desglose por ítem
     (`usados`) guarda directamente el monto en pesos que aporta cada uno en
     vez de una cantidad × costoUnitario — por eso `usadosMoneda: true`, para
     que quien pinte la tabla (web y PDF) sepa que ese desglose es plata y no
     cantidad×unidad como el resto de las filas.
     Devuelve null si el adicional no está activo en la obra, o si está
     activo pero ningún nivel lo termina aplicando (no tiene sentido una fila
     en $0 siempre). */
  function capatazDeNivel(modelo, version, multiplicador, nombreLineaTop, auxVisitados, acc) {
    const paramsMO = modelo.paramsMO;
    let costoDiarioMORoles = 0;
    Object.values(version.lineas || {}).forEach(rl => {
      if (rl.tipo !== 'manoDeObra' || rl.cantidad == null || isNaN(rl.cantidad)) return;
      const rol = modelo.catalogos.roles.find(r => r.key === rl.refKey);
      if (!rol || !rol.basico) return;
      costoDiarioMORoles += rl.cantidad * window.calcCostoManoDeObra(rol, paramsMO).costoJornal;
    });
    if (costoDiarioMORoles > 0 && !version.sinSeguridadCapataz) {
      const monto = multiplicador * costoDiarioMORoles * (paramsMO.seguridadCapatazPct || 0) / 100 / (version.rendimiento || 1);
      if (monto) {
        acc.costoTotal += monto;
        acc.usados.push({ nombre: nombreLineaTop, cantidad: monto });
      }
    }
    Object.values(version.lineas || {}).forEach(rl => {
      if (rl.tipo !== 'auxiliar' || !rl.refKey || rl.cantidad == null || isNaN(rl.cantidad) || auxVisitados.has(rl.refKey)) return;
      const auxVersion = versionDeAuxiliar(modelo, rl.refKey);
      if (!auxVersion) return;
      capatazDeNivel(modelo, auxVersion, multiplicador * rl.cantidad, nombreLineaTop,
        new Set(auxVisitados).add(rl.refKey), acc);
    });
  }

  function calcularCapataz(modelo) {
    const paramsMO = modelo.paramsMO;
    if (!paramsMO.seguridadCapatazActivo) return null;

    const acc = { costoTotal: 0, usados: [] };
    Object.values(modelo.computo || {}).forEach(linea => {
      if (!linea.itemKey || linea.cantidad == null || isNaN(linea.cantidad)) return;
      const item = modelo.catalogos.items.find(i => i.key === linea.itemKey);
      if (!item) return;
      const version = versionDe(item, modelo.obraKey, modelo.catalogos.roles);
      if (!version.lineas) return;
      capatazDeNivel(modelo, version, linea.cantidad, linea.nombre || '(sin nombre)', new Set(), acc);
    });
    if (!acc.costoTotal) return null;

    return {
      key: 'capataz',
      nombre: 'Capatacía (Seguridad y Capataz)',
      unidad: '%',
      cantidad: paramsMO.seguridadCapatazPct || 0,
      costoUnitario: null,
      costoTotal: acc.costoTotal,
      usados: acc.usados,
      usadosMoneda: true,
    };
  }

  // Devuelve { materiales, equipos, manoDeObra }, cada uno
  // { filas: [{ key, nombre, unidad, cantidad, costoUnitario, costoTotal, usados }], costoTotal, faltaPrecio }.
  // manoDeObra.filas incluye, al final, la fila de Capatacía si el adicional
  // está activo en la obra y algún AP la termina aplicando (ver calcularCapataz).
  window.calcularInsumosObra = function (modelo) {
    const materiales = armarGrupo(
      consolidar(modelo, 'material', modelo.catalogos.materiales)
        .sort((a, b) => a.entidad.nombre.localeCompare(b.entidad.nombre, 'es')),
      g => ({
        nombre: g.entidad.nombre,
        unidad: g.entidad.unidad || '',
        costoUnitario: precioUnitarioMaterial(g.entidad, modelo.preciosObra),
      }));

    const equipos = armarGrupo(
      consolidar(modelo, 'equipo', modelo.catalogos.equipos)
        .sort((a, b) => (a.entidad.codigo || '').localeCompare(b.entidad.codigo || '', 'es')),
      g => ({
        nombre: nombreEquipo(g.entidad),
        unidad: 'día',
        costoUnitario: window.calcCostoDiarioEquipo(g.entidad, modelo.paramsEquipos, modelo.paramsMO.jornadaHoras, modelo.dolarObra),
      }));

    const manoDeObra = armarGrupo(
      consolidar(modelo, 'manoDeObra', modelo.catalogos.roles)
        .sort((a, b) => (a.entidad.orden || 0) - (b.entidad.orden || 0)),
      g => ({
        nombre: g.entidad.nombre,
        unidad: 'día',
        costoUnitario: g.entidad.basico ? window.calcCostoManoDeObra(g.entidad, modelo.paramsMO).costoJornal : null,
      }));

    const capataz = calcularCapataz(modelo);
    if (capataz) {
      manoDeObra.filas.push(capataz);
      manoDeObra.costoTotal += capataz.costoTotal;
    }

    return { materiales, equipos, manoDeObra };
  };

})();
