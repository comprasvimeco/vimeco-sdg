/* VIMECO S.A. — Sistema de Gestión — Insumos de la obra (materiales, equipos y mano de obra)
   Pantalla de sólo lectura: consolida, para toda la obra, qué insumos hacen
   falta — recorriendo cada línea del Cómputo (cantidad × ítem) y, dentro de
   la receta de ese ítem, sus líneas. Un mismo insumo usado en varias líneas
   de Cómputo (de cualquier rubro) se suma en una sola fila. Líneas de
   Cómputo sin ítem vinculado (texto libre, sin receta) no aportan insumos y
   no aparecen acá.

   La consolidación en sí (materiales, equipos, mano de obra) vive en
   js/insumosDatos.js — la comparte con la sección "Insumos" de la
   exportación (js/exportar.js), para que pantalla y PDF salgan iguales. Acá
   sólo se junta lo que necesita ese módulo y se pinta. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let modeloIns = null;   // forma de presupuestoDatos.js: ver js/insumosDatos.js
let ordenPorCosto = false;   // false: orden natural de cada tabla (nombre/código/orden); true: costo estimado, mayor a menor
let modoFicha = false;   // false: cantidad/usado en (consumo); true: datos propios de la card (precio, parámetros, básico)
let obrasMap = {};   // { obraKey: nombre } — para el desplegable "Fuente (obra)" del precio de Material

const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/* Catálogo de cada tabla, para resolver la entidad real al tocar el nombre
   de una fila (abrirCardInsumo) — 'materiales'/'equipos' van directo al
   catálogo global, 'manoDeObra' son los roles propios de esta obra. La fila
   de Capatacía (key 'capataz') no tiene entidad real, así que no matchea. */
function catalogoDe(calcNs) {
  if (!modeloIns) return [];
  if (calcNs === 'materiales') return modeloIns.catalogos.materiales;
  if (calcNs === 'equipos') return modeloIns.catalogos.equipos;
  if (calcNs === 'manoDeObra') return modeloIns.catalogos.roles;
  return [];
}

/* Pinta una de las tres tablas. `resultado` viene de calcularInsumosObra
   (js/insumosDatos.js): { filas: [{ key, nombre, unidad, cantidad,
   costoUnitario, costoTotal, usados }], costoTotal, faltaPrecio }. */
function renderTabla(containerId, resumenId, resultado, opts) {
  const container = $(containerId);
  const resumen = $(resumenId);
  container.className = '';

  if (!resultado.filas.length) {
    container.innerHTML = `<p class="text-muted" style="font-size:.85rem;">${opts.vacio}</p>`;
    resumen.innerHTML = '';
    return;
  }

  const header = `
    <div class="materiales-linea materiales-linea-header">
      <span>${opts.colNombre}</span><span>Unidad</span><span>${opts.colCantidad}</span><span>Usado en</span><span>Costo estimado</span>
    </div>`;

  const filas = ordenPorCosto
    ? [...resultado.filas].sort((a, b) => (b.costoTotal || 0) - (a.costoTotal || 0))
    : resultado.filas;

  const filasHtml = filas.map(f => {
    const costoStr = f.costoTotal != null ? fmtARS(f.costoTotal) : '—';
    const usadosTexto = f.usados.map(u => u.nombre).join(', ');
    const usadosTitle = f.usados
      .map(u => f.usadosMoneda ? `${u.nombre}: ${fmtARS(u.cantidad)}` : `${u.nombre}: ${fmtNum(u.cantidad)} ${f.unidad}`)
      .join('\n');
    const entidad = catalogoDe(opts.calcNs).find(c => c.key === f.key);
    const nombreHtml = entidad
      ? `<button type="button" class="insumo-nombre-btn" data-calc-ns="${opts.calcNs}" data-key="${escHtml(f.key)}" title="${escHtml(titulosCard[opts.calcNs] || '')}">${escHtml(f.nombre)}</button>`
      : `<span>${escHtml(f.nombre)}</span>`;
    const marcaHtml = opts.calcNs === 'materiales' ? marcaPrecioMaterial(entidad) : '';
    return `
      <div class="materiales-linea">
        <span class="insumo-nombre-cell">${nombreHtml}${marcaHtml}</span>
        <span>${escHtml(f.unidad)}</span>
        <span class="materiales-cantidad"${calcAttrs(f.cantidad, `${opts.calcNs}:${f.key}:cantidad`, `${f.nombre} · ${opts.colCantidad}`)}>${fmtNum(f.cantidad)}</span>
        <span class="materiales-usados" title="${escHtml(usadosTitle)}">${escHtml(usadosTexto)}</span>
        <span class="materiales-costo"${f.costoTotal != null ? calcAttrs(f.costoTotal, `${opts.calcNs}:${f.key}:costo`, `${f.nombre} · Costo`) : ''}>${costoStr}</span>
      </div>`;
  }).join('');

  container.innerHTML = header + filasHtml;

  container.querySelectorAll('.insumo-nombre-btn').forEach(btn => {
    btn.addEventListener('click', () => abrirCardInsumo(btn.dataset.calcNs, btn.dataset.key));
  });

  resumen.innerHTML = `
    <div class="ap-resumen-row total"><span>${opts.labelTotal}</span><span${calcAttrs(resultado.costoTotal, `${opts.calcNs}:total`, opts.labelTotal)}>${fmtARS(resultado.costoTotal)}</span></div>
    ${resultado.faltaPrecio ? `<p class="form-hint" style="margin-top:.5rem;">${opts.avisoSinPrecio}</p>` : ''}`;
}

const DIAS_PRECIO_VENCIDO = 30;

/* Marca (⚠, con tooltip) para un material cuyo precio usado en el costo no
   es confiable a simple vista: no es el propio de esta obra (viene de
   fallback de otra obra, ver resolverPreciosObra en calcCostos.js) y/o tiene
   más de DIAS_PRECIO_VENCIDO días de cargado. Sin motivo, no se marca nada —
   la falta total de precio ya se ve en el costo en "—". */
function marcaPrecioMaterial(entidad) {
  if (!entidad) return '';
  const precioPropio = entidad.precios && entidad.precios[obraKey];
  const precioUsado = modeloIns.preciosObra[entidad.key];
  const motivos = [];
  if (!precioUsado) {
    motivos.push('sin precio cargado en ninguna obra');
  } else {
    if (!precioPropio) {
      const def = window.precioDefaultDe(entidad);
      const fuente = def ? (obrasMap[def.obraKey] || def.obraKey) : 'otra obra';
      motivos.push(`sin precio propio de esta obra — usando el de ${fuente}`);
    }
    if (precioUsado.fecha) {
      const dias = Math.floor((Date.now() - new Date(precioUsado.fecha + 'T00:00:00').getTime()) / 86400000);
      if (dias > DIAS_PRECIO_VENCIDO) motivos.push(`precio cargado hace ${dias} días`);
    }
  }
  if (!motivos.length) return '';
  return ` <span class="precio-alerta" title="${escHtml(motivos.join(' · '))}">⚠</span>`;
}

const titulosCard = {
  materiales: 'Clic para ver/editar el precio de este material en esta obra',
  equipos: 'Clic para ver el detalle del costo diario de este equipo',
  manoDeObra: 'Clic para ver el cálculo del costo de esta categoría en esta obra',
};

/* Columnas propias de cada card, para el modo ficha técnica (ver
   renderTablaFicha). `entidad` es la fila del catálogo (materiales/equipos/
   roles) — puede faltar en la fila de Capatacía, que no es una entidad real. */
function fichaColumnasMateriales(f, entidad) {
  const precio = entidad ? modeloIns.preciosObra[entidad.key] : null;
  return [
    { label: 'Unidad', html: escHtml(f.unidad) },
    { label: 'Precio (USD)', numeric: true, html: precio && precio.precioUSD != null ? fmtUSD(precio.precioUSD) : '—' },
    { label: 'Precio ($)', numeric: true, html: precio && precio.precioARS != null ? fmtARSFijo(precio.precioARS) : '—' },
    { label: 'Proveedor', html: precio && precio.proveedor ? escHtml(precio.proveedor) : '—' },
    { label: 'Fecha', html: precio && precio.fecha ? fmtFecha(precio.fecha) : '—' },
  ];
}

function fichaColumnasEquipos(f, entidad) {
  return [
    { label: 'HP', numeric: true, html: entidad && entidad.potencia != null ? fmtNum(entidad.potencia) : '—' },
    { label: 'Consumo (l/HP·h)', numeric: true, html: entidad && entidad.consumoCombustibleLtsPorHp != null ? fmtNum(entidad.consumoCombustibleLtsPorHp) : '—' },
    { label: 'Uso anual (hs)', numeric: true, html: entidad && entidad.usoAnual != null ? fmtNum(entidad.usoAnual) : '—' },
    { label: 'Vida útil (hs)', numeric: true, html: entidad && entidad.vidaUtil != null ? fmtNum(entidad.vidaUtil) : '—' },
    { label: 'Costo (USD)', numeric: true, html: entidad && entidad.costoUSD != null ? fmtUSD(entidad.costoUSD) : '—' },
  ];
}

function fichaColumnasManoDeObra(f, entidad) {
  return [
    { label: 'Básico ($/hs)', numeric: true, html: entidad && entidad.basico != null ? fmtARSFijo(entidad.basico) : '—' },
    { label: 'Extra (%)', numeric: true, html: entidad && entidad.extraPct != null ? `${fmtNum(entidad.extraPct)}%` : '—' },
    { label: 'No remunerativo ($/mes)', numeric: true, html: entidad && entidad.noRemunerativoMensual != null ? fmtARSFijo(entidad.noRemunerativoMensual) : '—' },
    { label: 'Fecha', html: entidad && entidad.fecha ? fmtFecha(entidad.fecha) : '—' },
  ];
}

/* Asistencia/Cargas/Comida no son de cada rol sino parámetros de la obra
   entera (paramsMO) — repetirlos en cada fila de la tabla sería redundante,
   así que en modo ficha se muestran una sola vez arriba de la tabla de Mano
   de Obra. */
function notaParamsMO() {
  const p = modeloIns.paramsMO;
  const partes = [`Asistencia perfecta ${fmtNum(p.asistenciaPct)}%`, `Cargas Sociales + ART ${fmtNum(p.cargasPct)}%`];
  if (p.comidaActivo) partes.push(`Comida ${fmtARSFijo(p.comidaMonto)}/día`);
  return `<p class="form-hint" style="margin-bottom:.6rem;">Parámetros de esta obra, iguales para todos los roles: ${partes.join(' · ')}.</p>`;
}

/* Mismo criterio que notaParamsMO: tasa de interés, % de Reparaciones y
   Repuestos, % de Lubricantes y precio del combustible son de la obra
   (paramsEquipos, ver equipos-obra.js) — no de cada equipo — así que en modo
   ficha se muestran una sola vez arriba de la tabla de Equipos en vez de
   repetidos en cada fila. */
function notaParamsEquipos() {
  const p = modeloIns.paramsEquipos;
  const partes = [
    `Tasa de interés ${fmtNum(p.tasaInteresPct)}%`,
    `Reparaciones y Repuestos ${fmtNum(p.reparacionesPct)}% de Amortización`,
    `Lubricantes ${fmtNum(p.lubricantesPct)}% de Combustibles`,
    `Combustible ${fmtARSFijo(p.precioCombustibleLitro)}/lt`,
  ];
  return `<p class="form-hint" style="margin-bottom:.6rem;">Parámetros de esta obra, iguales para todos los equipos: ${partes.join(' · ')}.</p>`;
}

/* Pinta una tabla en modo ficha técnica: misma fila por insumo que
   renderTabla, pero con las columnas de `opts.columnas(f, entidad)` en vez
   de cantidad/usado en. */
function renderTablaFicha(containerId, resumenId, resultado, opts) {
  const container = $(containerId);
  const resumen = $(resumenId);
  container.className = opts.claseFicha;

  if (!resultado.filas.length) {
    container.innerHTML = `<p class="text-muted" style="font-size:.85rem;">${opts.vacio}</p>`;
    resumen.innerHTML = '';
    return;
  }

  const filas = ordenPorCosto
    ? [...resultado.filas].sort((a, b) => (b.costoTotal || 0) - (a.costoTotal || 0))
    : resultado.filas;

  const filasConCols = filas.map(f => {
    const entidad = catalogoDe(opts.calcNs).find(c => c.key === f.key);
    return { f, entidad, cols: opts.columnas(f, entidad) };
  });

  const headerCols = filasConCols[0].cols.map(c => `<span${c.numeric ? ' class="num"' : ''}>${escHtml(c.label)}</span>`).join('');
  const header = `<div class="ficha-linea ficha-linea-header"><span>${escHtml(opts.colNombre)}</span>${headerCols}<span class="num">Costo estimado</span></div>`;

  const filasHtml = filasConCols.map(({ f, entidad, cols }) => {
    const nombreHtml = entidad
      ? `<button type="button" class="insumo-nombre-btn" data-calc-ns="${opts.calcNs}" data-key="${escHtml(f.key)}" title="${escHtml(titulosCard[opts.calcNs] || '')}">${escHtml(f.nombre)}</button>`
      : `<span>${escHtml(f.nombre)}</span>`;
    const marcaHtml = opts.calcNs === 'materiales' ? marcaPrecioMaterial(entidad) : '';
    const costoStr = f.costoTotal != null ? fmtARS(f.costoTotal) : '—';
    const colsHtml = cols.map(c => `<span${c.numeric ? ' class="num"' : ''} data-label="${escHtml(c.label)}">${c.html}</span>`).join('');
    return `
      <div class="ficha-linea">
        <span class="insumo-nombre-cell">${nombreHtml}${marcaHtml}</span>
        ${colsHtml}
        <span class="num" data-label="Costo estimado"${f.costoTotal != null ? calcAttrs(f.costoTotal, `${opts.calcNs}:${f.key}:costo`, `${f.nombre} · Costo`) : ''}>${costoStr}</span>
      </div>`;
  }).join('');

  container.innerHTML = (opts.notaExtra || '') + header + filasHtml;

  container.querySelectorAll('.insumo-nombre-btn').forEach(btn => {
    btn.addEventListener('click', () => abrirCardInsumo(btn.dataset.calcNs, btn.dataset.key));
  });

  resumen.innerHTML = `
    <div class="ap-resumen-row total"><span>${opts.labelTotal}</span><span${calcAttrs(resultado.costoTotal, `${opts.calcNs}:total`, opts.labelTotal)}>${fmtARS(resultado.costoTotal)}</span></div>
    ${resultado.faltaPrecio ? `<p class="form-hint" style="margin-top:.5rem;">${opts.avisoSinPrecio}</p>` : ''}`;
}

function abrirCardInsumo(calcNs, key) {
  const entidad = catalogoDe(calcNs).find(c => c.key === key);
  if (!entidad) return;
  if (calcNs === 'materiales') openEditarPrecioModal(entidad);
  else if (calcNs === 'equipos') openDetalleEquipoModal(entidad);
  else if (calcNs === 'manoDeObra') openDetalleRolModal(entidad);
}

function renderTodo() {
  const insumos = window.calcularInsumosObra(modeloIns);
  const render = modoFicha ? renderTablaFicha : renderTabla;

  render('lineas-materiales', 'resumen', insumos.materiales, {
    calcNs: 'materiales',
    colNombre: 'Material',
    colCantidad: 'Cantidad necesaria',
    columnas: fichaColumnasMateriales,
    claseFicha: 'ficha-materiales',
    labelTotal: 'Costo total estimado de materiales',
    vacio: 'Todavía no hay materiales para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con receta de materiales.',
    avisoSinPrecio: 'Algunos materiales no tienen precio cargado para esta obra — no se incluyen en el costo total.',
  });

  render('lineas-equipos', 'resumen-equipos', insumos.equipos, {
    calcNs: 'equipos',
    colNombre: 'Equipo',
    colCantidad: 'Días de uso',
    columnas: fichaColumnasEquipos,
    claseFicha: 'ficha-equipos',
    notaExtra: modoFicha ? notaParamsEquipos() : '',
    labelTotal: 'Costo total estimado de equipos',
    vacio: 'Todavía no hay equipos para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con equipos en su receta.',
    avisoSinPrecio: 'Algunos equipos no tienen costo calculable en esta obra (falta costo, vida útil, uso anual o el dólar de la obra) — no se incluyen en el costo total.',
  });

  render('lineas-mano-de-obra', 'resumen-mano-de-obra', insumos.manoDeObra, {
    calcNs: 'manoDeObra',
    colNombre: 'Categoría',
    colCantidad: 'Días necesarios',
    columnas: fichaColumnasManoDeObra,
    claseFicha: 'ficha-mo',
    notaExtra: modoFicha ? notaParamsMO() : '',
    labelTotal: 'Costo total estimado de mano de obra',
    vacio: 'Todavía no hay mano de obra para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con mano de obra en su receta.',
    avisoSinPrecio: 'Algunas categorías no tienen básico cargado en Mano de Obra de esta obra — no se incluyen en el costo total.',
  });
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, itemsData, materialesData, equiposData, rolesData, todasObrasData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet(`/obras/${obraKey}/roles.json`),
    _fbGet('/obras.json'),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  obrasMap = {};
  Object.entries(todasObrasData || {}).forEach(([k, o]) => { obrasMap[k] = o.nombre || k; });
  const materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  const paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, precioCombustibleLitro: 0, ...(obra.paramsEquipos || {}) };
  const paramsMO = {
    asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8,
    seguridadCapatazActivo: false, seguridadCapatazPct: 0,
    comidaActivo: false, comidaMonto: 0,
    ...(obra.paramsMO || {}),
  };
  const dolarObra = obra.dolar ? obra.dolar.valor : null;
  window.setCotizacionObra(dolarObra);

  modeloIns = {
    obraKey,
    catalogos: {
      items: Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it })),
      materiales,
      equipos: Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e })),
      roles: Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r })),
    },
    computo: lineasData || {},
    preciosObra: window.resolverPreciosObra(materiales, obraKey),
    paramsEquipos,
    paramsMO,
    dolarObra,
  };

  $('header-obra-nombre').textContent = 'Insumos — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'insumos');
  setModoObra(obraKey, obra, renderTodo);
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

/* ===== Card de Material: precio por obra-fuente =====
   Mismo modal y misma lógica que el editor inline de item.js (AP) — ver
   [[project_rediseno_fuentes_precios]]: el precio es por obra-fuente, sin
   historial. Acá la obra activa es siempre la de esta pantalla (obraKey);
   el desplegable "Fuente" sólo sirve para consultar el precio de otra obra,
   guardar siempre pisa el precio de ESTA obra. */
let editingPrecioMaterialKey = null;
let mepFuenteSelect = null;

function loadMepPrecioFields(mat, fuenteObraKey) {
  const p = (mat.precios || {})[fuenteObraKey];
  $('mep-precio-usd').value = p ? formatMoneyString(p.precioUSD) : '';
  $('mep-precio-ars').value = p ? formatMoneyString(p.precioARS) : '';
  setCalcFormula($('mep-precio-usd'), p && p.precioFormulaMoneda === 'USD' ? p.precioFormula : null);
  setCalcFormula($('mep-precio-ars'), p && p.precioFormulaMoneda === 'ARS' ? p.precioFormula : null);
  $('mep-proveedor').value = p ? (p.proveedor || '') : '';
  $('mep-fecha').value = p ? (p.fecha || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
  $('mep-precio-nota').textContent = p && p.cotizacionUsada ? `Cotización usada: USD = ${fmtARSFijo(p.cotizacionUsada)}` : '';
}

function openEditarPrecioModal(mat) {
  editingPrecioMaterialKey = mat.key;
  $('mep-nombre').value = mat.nombre || '';
  $('mep-unidad').value = mat.unidad || '';

  const obraActivaNombre = obrasMap[obraKey] || obraKey;
  $('mep-fuente-hint').textContent = `Guardar siempre actualiza el precio de esta obra (${obraActivaNombre}) — elegí otra obra acá sólo para consultar su precio.`;

  const obraKeysConPrecio = Object.keys(mat.precios || {});
  const options = obraKeysConPrecio.map(k => ({
    value: k, label: obrasMap[k] || k,
    sublabel: k === obraKey ? 'esta obra' : undefined,
  }));
  if (!options.find(o => o.value === obraKey)) {
    options.unshift({ value: obraKey, label: obraActivaNombre, sublabel: 'esta obra · sin precio todavía' });
  }
  mepFuenteSelect = createSearchableSelect($('mep-fuente-container'), {
    options,
    value: obraKey,
    placeholder: 'Buscar obra…',
    onChange: v => loadMepPrecioFields(mat, v),
  });
  loadMepPrecioFields(mat, obraKey);
  const ro = !!window._soloLectura;
  ['mep-nombre', 'mep-unidad', 'mep-precio-usd', 'mep-precio-ars', 'mep-proveedor', 'mep-fecha'].forEach(id => { $(id).disabled = ro; });
  $('modal-mep-save').disabled = ro;
  $('modal-mep-error').classList.add('hidden');
  $('modal-material-editar-precio').classList.remove('hidden');
}

async function saveEditarPrecioModal() {
  if (guardBloqueoObra()) return;
  const nombre = $('mep-nombre').value.trim();
  const unidad = $('mep-unidad').value.trim();
  const proveedor = $('mep-proveedor').value.trim();
  const fecha = $('mep-fecha').value || new Date().toISOString().slice(0, 10);
  const errEl = $('modal-mep-error');

  const usdInput = $('mep-precio-usd');
  const arsInput = $('mep-precio-ars');
  if (usdInput.value.trim().startsWith('=')) usdInput.blur();
  if (arsInput.value.trim().startsWith('=')) arsInput.blur();
  const precioUSD = parseMoneyString(usdInput.value);
  const precioARS = parseMoneyString(arsInput.value);

  if (!nombre || !unidad) {
    errEl.textContent = 'Nombre y unidad son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(precioUSD) || precioUSD < 0 || isNaN(precioARS) || precioARS < 0) {
    errEl.textContent = 'El precio no es válido.';
    errEl.classList.remove('hidden');
    return;
  }
  const cotizacionUsada = window.dolarOficialVenta();
  if (!cotizacionUsada) {
    errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
    errEl.classList.remove('hidden');
    return;
  }

  const fc = getCalcFormulaConMoneda(usdInput, arsInput);
  const precioData = { precioUSD, precioARS, precioFormula: fc.formula, precioFormulaMoneda: fc.moneda, proveedor, fecha, cotizacionUsada };

  try {
    await Promise.all([
      _fbPatch(`/materiales/${editingPrecioMaterialKey}.json`, { nombre, unidad }),
      _fbPut(`/materiales/${editingPrecioMaterialKey}/precios/${obraKey}.json`, precioData),
    ]);
    const mat = modeloIns.catalogos.materiales.find(m => m.key === editingPrecioMaterialKey);
    mat.nombre = nombre;
    mat.unidad = unidad;
    mat.precios = { ...(mat.precios || {}), [obraKey]: precioData };
    modeloIns.preciosObra = window.resolverPreciosObra(modeloIns.catalogos.materiales, obraKey);
    $('modal-material-editar-precio').classList.add('hidden');
    showToast('Precio actualizado.');
    renderTodo();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  }
}

/* ===== Card de Equipo: desglose del costo diario (sólo lectura) =====
   Mismo desglose que el modal de detalle de equipo en item.js — para editar
   potencia, vida útil, uso anual o costo hay que ir a Equipos (catálogo
   global); para editar la tasa/reparaciones/lubricantes/combustible de ESTA
   obra hay que ir a Equipos de la obra (paramsEquipos, por obra). */
function filaDesglose(label, formula, cuenta, valor, unidad = '/día') {
  return `<div class="ap-resumen-row"><span>${escHtml(label)}<br><span class="text-muted" style="font-size:.75rem;">${escHtml(formula)}</span><br><span class="text-muted" style="font-size:.7rem;">${escHtml(cuenta)}</span></span><span>${fmtARS(valor)}${unidad}</span></div>`;
}

function openDetalleEquipoModal(equipo) {
  $('ed-equipo-nombre').textContent = `${equipo.tipo || ''}${equipo.potencia ? ` ${equipo.potencia} HP` : ''}`.trim();
  $('ed-link-params').href = `equipos-obra.html?obra=${encodeURIComponent(obraKey)}`;
  const d = window.calcDesgloseCostoEquipo(equipo, modeloIns.paramsEquipos, modeloIns.paramsMO.jornadaHoras, modeloIns.dolarObra);
  const cont = $('ed-desglose');
  if (!d) {
    cont.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Faltan datos de costo para este equipo (costo, vida útil o uso anual), o no se pudo obtener la cotización del dólar.</p>';
  } else {
    const jornada = modeloIns.paramsMO.jornadaHoras;
    const paramsEquipos = modeloIns.paramsEquipos;
    cont.innerHTML = [
      filaDesglose('Amortización', `Costo actual × jornada ÷ vida útil`,
        `${fmtARS(d.costoActual)} × ${fmtNum(jornada)} ÷ ${fmtNum(equipo.vidaUtil)}`, d.amortizacionDia),
      filaDesglose('Intereses', `Costo actual × tasa ÷ 2 ÷ uso anual × jornada`,
        `${fmtARS(d.costoActual)} × ${paramsEquipos.tasaInteresPct}% ÷ 2 ÷ ${fmtNum(equipo.usoAnual)} × ${fmtNum(jornada)}`, d.interesesDia),
      filaDesglose('Reparaciones y Repuestos', `${paramsEquipos.reparacionesPct}% de Amortización`,
        `${paramsEquipos.reparacionesPct}% de ${fmtARS(d.amortizacionDia)}`, d.reparacionesDia),
      filaDesglose('Combustibles', `Consumo × potencia × jornada × precio`,
        `${fmtNum(equipo.consumoCombustibleLtsPorHp)} × ${fmtNum(equipo.potencia)} × ${fmtNum(jornada)} × ${fmtARS(paramsEquipos.precioCombustibleLitro)}`, d.combustibleDia),
      filaDesglose('Lubricantes', `${paramsEquipos.lubricantesPct}% de Combustibles`,
        `${paramsEquipos.lubricantesPct}% de ${fmtARS(d.combustibleDia)}`, d.lubricantesDia),
      `<div class="ap-resumen-row total"><span>Costo diario del equipo</span><span>${fmtARS(d.costoDiarioTotal)}/día</span></div>`,
    ].join('');
  }
  $('modal-equipo-detalle').classList.remove('hidden');
}

/* ===== Card de Mano de Obra: desglose del costo (sólo lectura) =====
   No existía en ningún AP (ahí sólo se carga cantidad). Mismo criterio que
   el detalle de Equipo: se muestra el cálculo término a término (fórmula +
   cuenta con los números usados), no un formulario editable — para tocar el
   básico, el extra, el no remunerativo o la fecha hay que ir a Mano de Obra
   de la obra (mano-de-obra-obra.js, roles por obra). */
function openDetalleRolModal(rol) {
  $('mor-nombre').textContent = rol.nombre;
  $('mor-link-editar').href = `mano-de-obra-obra.html?obra=${encodeURIComponent(obraKey)}`;
  const cont = $('mor-desglose');
  if (!rol.basico) {
    cont.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Esta categoría no tiene básico cargado en Mano de Obra de esta obra.</p>';
  } else {
    const paramsMO = modeloIns.paramsMO;
    const c = window.calcCostoManoDeObra(rol, paramsMO);
    const filas = [
      filaDesglose('Básico efectivo', `Básico × (1 + Extra%)`,
        `${fmtARS(rol.basico)} × (1 + ${rol.extraPct || 0}%)`, c.basicoEfectivo, '/hs'),
      filaDesglose('Con Asistencia', `Básico efectivo × (1 + Asistencia%)`,
        `${fmtARS(c.basicoEfectivo)} × (1 + ${paramsMO.asistenciaPct}%)`, c.conAsistencia, '/hs'),
      filaDesglose('Con Cargas Sociales', `Con Asistencia × (1 + Cargas%)`,
        `${fmtARS(c.conAsistencia)} × (1 + ${paramsMO.cargasPct}%)`, c.conCargas, '/hs'),
    ];
    if (rol.noRemunerativoMensual) {
      filas.push(filaDesglose('No remunerativo (prorrateado)', `No remunerativo ÷ (días/mes × jornada)`,
        `${fmtARS(rol.noRemunerativoMensual)} ÷ (${fmtNum(paramsMO.diasMes)} × ${fmtNum(paramsMO.jornadaHoras)})`, c.comidaPorHora, '/hs'));
    }
    filas.push(`<div class="ap-resumen-row total"><span>Costo horario</span><span>${fmtARS(c.costoHorario)}/hs</span></div>`);
    if (paramsMO.comidaActivo) {
      filas.push(filaDesglose(`Costo horario × jornada`, `Costo horario × jornada`,
        `${fmtARS(c.costoHorario)} × ${fmtNum(paramsMO.jornadaHoras)}`, c.costoHorario * paramsMO.jornadaHoras, '/día'));
      filas.push(filaDesglose('Comida (fija por día)', 'Monto fijo de la obra', fmtARS(c.comidaDia), c.comidaDia, '/día'));
    }
    filas.push(`<div class="ap-resumen-row total"><span>Jornal (${fmtNum(paramsMO.jornadaHoras)}hs)</span><span>${fmtARS(c.costoJornal)}/día</span></div>`);
    cont.innerHTML = filas.join('');
  }
  $('modal-mano-de-obra-editar').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
  $('chk-orden-costo').addEventListener('change', e => {
    ordenPorCosto = e.target.checked;
    if (modeloIns) renderTodo();
  });

  $('chk-modo-ficha').addEventListener('change', e => {
    modoFicha = e.target.checked;
    if (modeloIns) renderTodo();
  });

  attachCalcInput($('mep-precio-usd'));
  attachMoneyInput($('mep-precio-usd'));
  attachCalcInput($('mep-precio-ars'));
  attachMoneyInput($('mep-precio-ars'));
  attachDualPrecioInputs({ usdInput: $('mep-precio-usd'), arsInput: $('mep-precio-ars'), notaEl: $('mep-precio-nota') });
  $('modal-mep-close').addEventListener('click', () => $('modal-material-editar-precio').classList.add('hidden'));
  $('modal-mep-cancel').addEventListener('click', () => $('modal-material-editar-precio').classList.add('hidden'));
  $('modal-mep-save').addEventListener('click', saveEditarPrecioModal);

  $('modal-ed-close').addEventListener('click', () => $('modal-equipo-detalle').classList.add('hidden'));
  $('modal-ed-cerrar').addEventListener('click', () => $('modal-equipo-detalle').classList.add('hidden'));

  $('modal-mor-close').addEventListener('click', () => $('modal-mano-de-obra-editar').classList.add('hidden'));
  $('modal-mor-cerrar').addEventListener('click', () => $('modal-mano-de-obra-editar').classList.add('hidden'));

  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (modeloIns) renderTodo();
});

window.onDecimalesVista(() => { if (modeloIns) renderTodo(); });
