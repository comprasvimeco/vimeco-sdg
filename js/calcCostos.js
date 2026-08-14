/* VIMECO S.A. — Fórmulas de costo compartidas (Equipos y Mano de Obra).
   Usado por equipos.js, manoDeObra.js e items.js — una sola fuente de verdad
   para que el costo de un equipo/rol sea el mismo se mire desde donde se mire.
   Fórmulas verificadas centavo a centavo contra la planilla de referencia
   (CyP Taller Río Cuarto.xlsx, hoja A.P.). */

// rol: { basico, extraPct, noRemunerativoMensual }
// params: { asistenciaPct, cargasPct, diasMes, jornadaHoras, comidaActivo, comidaMonto }
// Comida es un monto fijo $/día de la obra (no por rol) que se suma parejo
// al jornal de cada categoría cuando está activo — a diferencia del
// "no remunerativo" (que es propio de cada rol y se prorratea por hora),
// éste va directo al jornal completo, sin prorratear.
window.calcCostoManoDeObra = function (rol, params) {
  const basicoEfectivo = rol.basico * (1 + (rol.extraPct || 0) / 100);
  const conAsistencia = basicoEfectivo * (1 + params.asistenciaPct / 100);
  const conCargas = conAsistencia * (1 + params.cargasPct / 100);
  const comidaPorHora = (rol.noRemunerativoMensual || 0) / (params.diasMes * params.jornadaHoras);
  const costoHorario = conCargas + comidaPorHora;
  const comidaDia = params.comidaActivo ? (params.comidaMonto || 0) : 0;
  return { costoHorario, costoJornal: costoHorario * params.jornadaHoras + comidaDia, comidaPorHora, comidaDia };
};

// equipo: { costoUSD, vidaUtil, usoAnual, potencia }
// params: { tasaInteresPct, reparacionesPct, lubricantesPct, combustibleLtsPorHp, precioCombustibleLitro }
// dolarValor: cotización a usar para convertir costoUSD — cada obra tiene la
// suya (/obras/{obraKey}/dolar), no se lee más el dólar en vivo acá adentro.
// Desglose del costo diario de un equipo, término por término (para mostrarlo
// en pantalla — ver planilla de referencia, hoja A.P., sección "A-Equipos").
// Devuelve null si falta algún dato necesario (costo, vida útil, uso anual, cotización
// del dólar) — pero un dólar en 0 (obra de referencia sin costo real) es una cotización
// válida, no un dato faltante, así que da costo 0 en vez de null.
window.calcDesgloseCostoEquipo = function (equipo, params, jornadaHoras, dolarValor) {
  const venta = dolarValor;
  if (!equipo.costoUSD || !equipo.vidaUtil || !equipo.usoAnual || venta == null) return null;
  const costoActual = equipo.costoUSD * venta;
  const amortizacionDia = costoActual * jornadaHoras / equipo.vidaUtil;
  const interesesDia = (costoActual * params.tasaInteresPct / 100 / 2) / equipo.usoAnual * jornadaHoras;
  const reparacionesDia = amortizacionDia * params.reparacionesPct / 100;
  const combustibleDia = (params.combustibleLtsPorHp * (equipo.potencia || 0) * jornadaHoras) * params.precioCombustibleLitro;
  const lubricantesDia = combustibleDia * params.lubricantesPct / 100;
  const costoDiarioTotal = amortizacionDia + interesesDia + reparacionesDia + combustibleDia + lubricantesDia;
  return { costoActual, venta, amortizacionDia, interesesDia, reparacionesDia, combustibleDia, lubricantesDia, costoDiarioTotal };
};

window.calcCostoDiarioEquipo = function (equipo, params, jornadaHoras, dolarValor) {
  const d = window.calcDesgloseCostoEquipo(equipo, params, jornadaHoras, dolarValor);
  return d ? d.costoDiarioTotal : null;
};

// Un material puede tener distinto precio/proveedor/fecha por obra
// (/materiales/{key}/precios/{obraKey}). Sin precio propio de una obra
// puntual, el "default" es el de fecha más reciente entre TODAS las obras
// que tengan un precio cargado para ese material — no hay precio global de
// respaldo, se calcula en vivo. Devuelve {obraKey, precio} o null si el
// material no tiene ningún precio cargado todavía.
window.precioDefaultDe = function (material) {
  const entries = Object.entries((material && material.precios) || {});
  if (!entries.length) return null;
  return entries.reduce((best, [obraKey, precio]) =>
    (!best || (precio.fecha || '') >= (best.precio.fecha || '')) ? { obraKey, precio } : best, null);
};

// Arma el mapa de precios "a usar" para una obra puntual: el precio propio
// de esa obra si lo tiene, si no el default (más reciente entre todas) —
// listo para pasarle a calcCostoUnitarioItem. materiales: array ya cargado
// por el consumidor (con `precios` anidado incluido).
window.resolverPreciosObra = function (materiales, obraKey) {
  const resultado = {};
  (materiales || []).forEach(m => {
    const propio = obraKey && m.precios ? m.precios[obraKey] : null;
    if (propio) { resultado[m.key] = propio; return; }
    const def = window.precioDefaultDe(m);
    if (def) resultado[m.key] = def.precio;
  });
  return resultado;
};

// Costo unitario de un ítem de Biblioteca a partir de su receta (líneas) y
// rendimiento, con precios generales (materiales/equipos/MO). Usado por
// computo.js y carga-fija.js para calcular en vivo — la Biblioteca ya no
// cachea ningún costo (ver item.js, que sólo edita la receta).
// catalogos: { materiales, equipos, roles }
// preciosObra: mapa {materialKey: {precioUSD,...}} ya resuelto con
// resolverPreciosObra — es la única fuente de precio de un material, no hay
// fallback a un campo propio del material (ya no existe).
// dolarValor: cotización propia de la obra (/obras/{obraKey}/dolar) — se usa
// para materiales y para equipos, en vez del dólar en vivo.
window.calcCostoUnitarioItem = function (item, lineasItem, catalogos, paramsEquipos, paramsMO, preciosObra, dolarValor) {
  preciosObra = preciosObra || {};
  function catalogoFor(tipo) {
    if (tipo === 'material') return catalogos.materiales;
    if (tipo === 'equipo') return catalogos.equipos;
    return catalogos.roles;
  }
  function precioUnitarioMaterial(mat) {
    if (!mat) return null;
    const precio = preciosObra[mat.key];
    if (!precio) return null;
    // El precio en pesos cargado es la fuente de verdad; el dólar es sólo
    // ayuda de cálculo. Se reconvierte desde USD sólo si el material no
    // tiene precioARS guardado (datos viejos, antes del campo dual).
    if (precio.precioARS != null) return precio.precioARS;
    const venta = dolarValor;
    if (!precio.precioUSD || venta == null) return null;
    return precio.precioUSD * venta;
  }
  // costoUnitario acá es el precio de LA UNIDAD del material/equipo/rol
  // (ej. $/kg, costo diario del equipo, costo del jornal) — no el costo
  // unitario del ítem (eso es el agregado, más abajo). costoTotal es
  // cantidad × ese precio, sin dividir por rendimiento — para mostrar en
  // la fila de cada línea, no para el agregado.
  function costoLineaDetalle(linea) {
    const cat = catalogoFor(linea.tipo);
    const entidad = cat.find(c => c.key === linea.refKey);
    if (!entidad || linea.cantidad == null || isNaN(linea.cantidad)) return null;
    let costoUnitario;
    if (linea.tipo === 'material') {
      costoUnitario = precioUnitarioMaterial(entidad);
    } else if (linea.tipo === 'equipo') {
      costoUnitario = window.calcCostoDiarioEquipo(entidad, paramsEquipos, paramsMO.jornadaHoras, dolarValor);
    } else {
      costoUnitario = window.calcCostoManoDeObra(entidad, paramsMO).costoJornal;
    }
    if (costoUnitario == null) return null;
    return { costoUnitario, costoTotal: linea.cantidad * costoUnitario };
  }

  const rendimiento = item.rendimiento || 1;
  let costoMateriales = 0;
  let costoDiarioEquipos = 0;
  let costoDiarioMORoles = 0;
  const detallePorLinea = {};   // { lineaKey: { costoUnitario, costoTotal } }
  Object.entries(lineasItem || {}).forEach(([lineaKey, l]) => {
    const d = costoLineaDetalle(l);
    if (!d) return;
    detallePorLinea[lineaKey] = d;
    if (l.tipo === 'material') costoMateriales += d.costoTotal;
    else if (l.tipo === 'equipo') costoDiarioEquipos += d.costoTotal;
    else costoDiarioMORoles += d.costoTotal;
  });
  // Seguridad y Capataz: adicional opcional (activo/% en paramsMO de la
  // obra), % sobre el costo diario de mano de obra de ESTE AP puntual. Se
  // puede excluir por ítem aunque esté activo en la obra (item.sinSeguridadCapataz,
  // ver /items/{key}/versionesObra/{obraKey}) — y no aplica si el AP no
  // tiene mano de obra cargada.
  const seguridadCapatazAplica = !!(paramsMO.seguridadCapatazActivo && !item.sinSeguridadCapataz && costoDiarioMORoles > 0);
  const seguridadCapatazPctAplicado = seguridadCapatazAplica ? (paramsMO.seguridadCapatazPct || 0) : 0;
  const costoDiarioSeguridadCapataz = costoDiarioMORoles * seguridadCapatazPctAplicado / 100;
  const costoDiarioMO = costoDiarioMORoles + costoDiarioSeguridadCapataz;
  // Equipos (A) y Mano de Obra (B) se dividen por rendimiento cada uno por
  // separado (no combinados) — mismo criterio que la planilla de
  // referencia, para poder mostrar el subtotal de cada área por separado.
  const costoUnitarioEquipos = costoDiarioEquipos / rendimiento;
  const costoUnitarioMO = costoDiarioMO / rendimiento;
  const costoUnitario = costoMateriales + costoUnitarioEquipos + costoUnitarioMO;
  return {
    costoMateriales,
    costoDiarioEquipos, costoUnitarioEquipos,
    costoDiarioMO, costoUnitarioMO,
    costoDiarioSeguridadCapataz, seguridadCapatazPctAplicado,
    costoUnitario,
    detallePorLinea,
  };
};

// Carga Fija — usado por carga-fija.js (edición) y presupuesto.js (sólo
// lectura, para el Coeficiente K): una sola fórmula para que las dos
// pantallas no se desincronicen.
// l.tipo: 'monto' (cantidad×precioUnitario×meses, default para líneas viejas
// sin el campo) | 'pctComputo' (% del costo del Cómputo) | 'pctOficial' (%
// del presupuesto oficial cargado a mano en Datos de la obra). No existe
// "% de Presupuesto propio" porque ese presupuesto sale de aplicar el
// Coeficiente K, que a su vez depende del total de Carga Fija — sería
// circular.
window.totalLineaCargaFija = function (l, costoComputo, presupuestoOficial) {
  const tipo = l.tipo || 'monto';
  if (tipo === 'pctComputo') {
    if (l.porcentaje == null || isNaN(l.porcentaje) || costoComputo == null) return null;
    return (l.porcentaje / 100) * costoComputo;
  }
  if (tipo === 'pctOficial') {
    if (l.porcentaje == null || isNaN(l.porcentaje) || presupuestoOficial == null) return null;
    return (l.porcentaje / 100) * presupuestoOficial;
  }
  if (l.cantidad == null || l.precioUnitario == null || l.meses == null) return null;
  if (isNaN(l.cantidad) || isNaN(l.precioUnitario) || isNaN(l.meses)) return null;
  return l.cantidad * l.precioUnitario * l.meses;
};

window.totalGastosFijosCargaFija = function (lineas, costoComputo, presupuestoOficial) {
  return Object.values(lineas || {}).reduce((acc, l) => {
    const t = window.totalLineaCargaFija(l, costoComputo, presupuestoOficial);
    return t == null ? acc : acc + t;
  }, 0);
};

// Líneas de gasto fijo como [[key, linea], …] en el orden en que se ven en
// pantalla: por el campo `orden` (flechas ↑/↓ de Carga Fija). Las líneas que
// todavía no lo tienen van al final ordenadas por su key, que empieza con el
// timestamp de creación — el mismo orden que RTDB devolvía antes de que
// existiera `orden`. Lo usan Carga Fija y la exportación, para que el
// documento salga en el orden que el usuario armó.
window.lineasCargaFijaOrdenadas = function (lineas) {
  return Object.entries(lineas || {}).sort(([ka, a], [kb, b]) => {
    const oa = a.orden, ob = b.orden;
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    if (oa != null && ob == null) return -1;
    if (oa == null && ob != null) return 1;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
};

// IVA por defecto de una obra que nunca tocó sus impuestos. Estaba repetido
// como `ivaPct: 21` en las cuatro pantallas que calculaban el K; vive acá
// porque sacarlo cambiaría de golpe el K de las obras que hoy no tienen
// ningún porcentaje guardado y lo reciben de ese default.
const IVA_POR_DEFECTO = 21;

// Impuestos de una obra, normalizados a [{ key, nombre, porcentaje, orden }].
//
// `impuestosCargados` marca que la obra ya usa la lista: sin esa marca se cae
// al `ivaPct` viejo (un único IVA). Hace falta el marcador y no alcanza con
// mirar si existe el nodo `impuestos`, porque RTDB borra el nodo entero
// cuando se elimina su último hijo — y "me quedé sin impuestos" volvería a
// leerse como "obra vieja, ponele 21%".
window.impuestosDeConfig = function (config) {
  config = config || {};
  if (config.impuestosCargados) {
    return Object.entries(config.impuestos || {})
      .map(([key, i]) => ({ key, nombre: i.nombre || '', porcentaje: i.porcentaje, orden: i.orden || 0 }))
      .sort((a, b) => a.orden - b.orden);
  }
  const pct = config.ivaPct != null ? config.ivaPct : IVA_POR_DEFECTO;
  return [{ key: 'iva', nombre: 'IVA', porcentaje: pct, orden: 0 }];
};

// Coeficiente K de una obra — UNA sola implementación, usada por Carga Fija
// (edición), Presupuesto, Plan de Avance y el AP. Antes estaba copiada en las
// cuatro pantallas y cualquier cambio había que hacerlo cuatro veces.
//
//   K = (1 + %GastosGenerales + %Beneficio) × (1 + %CostoFinanciero) × (1 + Σ%Impuestos)
//
// Verificada contra la hoja "Carga fija" de la planilla: cada impuesto se
// aplica sobre el Subtotal con gasto financiero y los aportes se suman
// (1,372 × 2,5% = 0,034 · 1,372 × 21% = 0,288 · Impuesto = 0,322 · K = 1,695).
//
// %GastosGenerales sale de (gastos fijos / costo del Cómputo), pero se puede
// pisar a mano por obra (config.ggPct): se devuelven los dos, el calculado y
// el que efectivamente se usó. Sin costo de Cómputo no hay % que prorratear y
// K da null — la pantalla que llama decide qué mostrar.
//
// Devuelve el desglose completo (no sólo el K) para que Carga Fija pueda
// pintar el aporte de cada fila sin recalcular nada por su cuenta.
window.calcCoeficienteK = function (config, gastosFijos, costoComputo) {
  config = config || {};
  const ggFracCalculado = costoComputo > 0 ? gastosFijos / costoComputo : null;
  const ggManual = config.ggPct != null && !isNaN(config.ggPct) ? config.ggPct / 100 : null;
  const ggFrac = ggManual != null ? ggManual : ggFracCalculado;

  const beneficioFrac = (config.beneficioPct || 0) / 100;
  const costoFinancieroFrac = (config.costoFinancieroPct || 0) / 100;
  const impuestos = window.impuestosDeConfig(config);

  if (ggFrac == null) {
    return {
      ggFracCalculado, ggFrac: null, ggEsManual: false, beneficioFrac,
      subtotalCosto: null, costoFinancieroFrac, subtotalConFinanciero: null,
      impuestos, aportePorImpuesto: {}, impuestoFrac: null, k: null,
    };
  }

  // Los totales se calculan multiplicando (1 + %), igual que antes de que esto
  // fuera una función compartida: sumar los aportes uno por uno daría lo mismo
  // en papel pero no bit a bit en punto flotante, y el K de las obras ya
  // cargadas se movería en el último decimal sin motivo. Los aportes de cada
  // fila salen por diferencia, sólo para mostrarlos.
  const subtotalCosto = 1 + ggFrac + beneficioFrac;
  const subtotalConFinanciero = subtotalCosto * (1 + costoFinancieroFrac);
  const impuestosFracTotal = impuestos.reduce((acc, i) => acc + (i.porcentaje || 0) / 100, 0);
  const k = subtotalConFinanciero * (1 + impuestosFracTotal);

  const aportePorImpuesto = {};
  impuestos.forEach(i => {
    aportePorImpuesto[i.key] = subtotalConFinanciero * ((i.porcentaje || 0) / 100);
  });

  return {
    ggFracCalculado, ggFrac, ggEsManual: ggManual != null,
    beneficioFrac, subtotalCosto,
    costoFinancieroFrac, aporteFinanciero: subtotalConFinanciero - subtotalCosto,
    subtotalConFinanciero,
    impuestos, aportePorImpuesto, impuestoFrac: k - subtotalConFinanciero,
    k,
  };
};
