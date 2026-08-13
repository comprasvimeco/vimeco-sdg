/* VIMECO S.A. — Sistema de Gestión — Carga Fija de obra
   Calcula el coeficiente K que en Presupuesto (presupuesto.js) convierte
   costo unitario en precio unitario:

     K = (1 + %GastosGenerales + %Beneficio) × (1 + %CostoFinanciero) × (1 + %IVA)

   %GastosGenerales NO se carga a mano: sale de
     (suma de gastos fijos de esta obra) / (costo total del Cómputo de esta obra)
   Beneficio, Costo Financiero e IVA sí son porcentajes directos por obra.
   Fórmula verificada contra la hoja "Carga fija" de CyP Taller Río Cuarto.xlsx.

   Cada línea de gasto fijo puede ser un monto fijo (cantidad×precioUnitario×
   meses) o un % de una base — Costo del Cómputo o Presupuesto oficial (campo
   manual en Datos de la obra) — ver totalLineaCargaFija en calcCostos.js. No
   existe "% de Presupuesto propio" porque ese valor sale de aplicar este
   mismo K: sería circular. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let lineas = {};     // { lineaKey: { concepto, tipo, cantidad, precioUnitario, meses, porcentaje } }
let config = { beneficioPct: null, costoFinancieroPct: null };
let costoComputo = 0;
let computoData = null;
let items = [];
let catalogos = { materiales: [], equipos: [], roles: [] };
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};   // { materialKey: {precioUSD,...} } — resuelto de los precios por obra de esta obra
let dolarObra = null;   // dólar propio de esta obra (/obras/{obraKey}/dolar)

function totalLinea(l) {
  return window.totalLineaCargaFija(l, costoComputo, obra ? obra.presupuestoOficial : null);
}

function totalGastosFijos() {
  return window.totalGastosFijosCargaFija(lineas, costoComputo, obra ? obra.presupuestoOficial : null);
}

const TIPO_BASE_LABEL = { pctComputo: 'del Costo del Cómputo', pctOficial: 'del Presupuesto oficial' };

function tipoSelectHtml(tipo) {
  const opciones = [
    ['monto', 'Monto fijo'],
    ['pctComputo', '% Costo Cómputo'],
    ['pctOficial', '% Presup. oficial'],
  ];
  return `<select class="form-control cf-tipo">${opciones.map(([v, label]) =>
    `<option value="${v}" ${v === tipo ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
}

// Los campos también llevan dirección: una fórmula de otra línea puede
// apuntar a ellos (ver js/refs.js).
function camposLineaHtml(lineaKey, l, tipo) {
  const et = l.concepto || 'Concepto';
  const ref = (campo, label) =>
    ` data-calc-id="cargafija:linea:${escHtml(lineaKey)}:${campo}" data-calc-label="${escHtml(et + ' · ' + label)}"`;
  if (tipo === 'pctComputo' || tipo === 'pctOficial') {
    return `
      <input type="text" class="form-control cf-porcentaje" value="${l.porcentaje ?? ''}" placeholder="0"${ref('porcentaje', '%')}>
      <span class="cf-base-label">${TIPO_BASE_LABEL[tipo]}</span>
      <span></span>`;
  }
  return `
    <input type="text" class="form-control cf-cantidad" value="${l.cantidad ?? ''}" placeholder="0"${ref('cantidad', 'Cantidad')}>
    <input type="text" class="form-control cf-precio" value="${escHtml(formatMoneyString(l.precioUnitario))}" placeholder="0"${ref('precioUnitario', 'Precio unit.')}>
    <input type="text" class="form-control cf-meses" value="${l.meses ?? ''}" placeholder="0"${ref('meses', 'Meses')}>`;
}

function renderLineas() {
  const container = $('lineas-carga-fija');
  const entradas = Object.entries(lineas);
  if (!entradas.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin conceptos todavía.</p>';
  } else {
    container.innerHTML = entradas.map(([lineaKey, l]) => {
      const tipo = l.tipo || 'monto';
      const total = totalLinea(l);
      return `
        <div class="cf-linea" data-key="${escHtml(lineaKey)}">
          <input type="text" class="form-control cf-concepto" value="${escHtml(l.concepto || '')}" placeholder="Ej: Jefe de obra">
          ${tipoSelectHtml(tipo)}
          ${camposLineaHtml(lineaKey, l, tipo)}
          <span class="cf-linea-total"${calcAttrs(total, `cargafija:linea:${lineaKey}:total`, `${l.concepto || 'Concepto'} · Total`)}>${total != null ? fmtARS(total) : '—'}</span>
          <button class="cf-linea-del" title="Eliminar concepto">${icSvg('x')}</button>
        </div>`;
    }).join('');
  }

  container.querySelectorAll('.cf-linea').forEach(row => {
    const lineaKey = row.dataset.key;
    const l = lineas[lineaKey];
    const tipo = l.tipo || 'monto';
    const concepto = row.querySelector('.cf-concepto');
    const tipoSelect = row.querySelector('.cf-tipo');

    concepto.addEventListener('blur', () => updateLinea(lineaKey, { concepto: concepto.value.trim() }));
    concepto.addEventListener('keydown', e => { if (e.key === 'Enter') concepto.blur(); });

    tipoSelect.addEventListener('change', () => updateLinea(lineaKey, { tipo: tipoSelect.value }));

    // Campo numérico de una línea: valor completo por dentro, redondeado en
    // pantalla (attachValorInput), y sin escribir si no se tocó nada.
    const numField = (input, key) => {
      attachValorInput(input, l[key] ?? null);
      input.addEventListener('blur', () => {
        const n = valorCampo(input);
        const formula = getCalcFormula(input);
        if (n === (l[key] ?? null) && formula === (l[key + 'Formula'] || null)) return;
        updateLinea(lineaKey, { [key]: n, [key + 'Formula']: formula });
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    };

    if (tipo === 'pctComputo' || tipo === 'pctOficial') {
      const porcentaje = row.querySelector('.cf-porcentaje');
      attachCalcInput(porcentaje, l.porcentajeFormula);
      numField(porcentaje, 'porcentaje');
    } else {
      const cantidad = row.querySelector('.cf-cantidad');
      const precio = row.querySelector('.cf-precio');
      const meses = row.querySelector('.cf-meses');
      attachCalcInput(cantidad, l.cantidadFormula);
      attachCalcInput(precio, l.precioUnitarioFormula);
      attachMoneyInput(precio);
      attachCalcInput(meses, l.mesesFormula);

      numField(cantidad, 'cantidad');
      numField(meses, 'meses');
      numField(precio, 'precioUnitario');
    }

    row.querySelector('.cf-linea-del').addEventListener('click', () => deleteLinea(lineaKey));
  });

  const totalFijos = totalGastosFijos();
  const totalEl = $('total-gastos-fijos');
  totalEl.textContent = fmtARS(totalFijos);
  totalEl.dataset.calcValor = totalFijos;
  totalEl.dataset.calcId = 'cargafija:totalGastosFijos';
  totalEl.dataset.calcLabel = 'Total de gastos fijos';
}

function calcularK() {
  return window.calcCoeficienteK(config, totalGastosFijos(), costoComputo);
}

// Fila del bloque: etiqueta, el campo/valor del medio y el aporte al K en la
// última columna — la misma lectura que la hoja "Carga fija" de la planilla,
// donde cada concepto muestra cuánto suma al coeficiente.
function filaK({ label, medio, aporte, clase, id, calcLabel }) {
  const attrs = aporte == null ? '' : calcAttrs(aporte, id, calcLabel);
  return `
    <div class="ap-resumen-row cf-fila-k ${clase || ''}">
      <span>${label}</span>
      <span class="cf-fila-k-medio">${medio || ''}</span>
      <span class="cf-fila-k-aporte"${attrs}>${aporte == null ? '' : fmtCoef(aporte)}</span>
    </div>`;
}

function pctInputHtml(id, valor, placeholder, calcId, calcLabel) {
  return `<input type="text" class="form-control cf-pct" id="${id}" value="${valor ?? ''}" placeholder="${placeholder}" data-calc-id="${calcId}" data-calc-label="${escHtml(calcLabel)}">`;
}

function renderCoeficienteK() {
  const r = calcularK();
  const el = $('coeficiente-k');

  if (r.ggFrac == null) {
    el.innerHTML = `<p class="form-hint">Esta obra todavía no tiene ítems cargados en el Cómputo — no se puede calcular el % de Gastos Generales hasta que haya un costo de obra sobre el cual prorratear los gastos fijos.</p>`;
    return;
  }

  // Gastos Generales: a la izquierda el calculado (gastos fijos / costo del
  // Cómputo) y al lado la celda editable, que arranca con ese mismo número
  // pero se puede pisar a mano. Vaciarla vuelve a seguir al calculado.
  const ggValorCelda = config.ggPct != null ? config.ggPct : window.roundLimpio(r.ggFracCalculado * 100);
  const ggCalculado = `<span class="cf-gg-calculado"${calcAttrs(r.ggFracCalculado * 100, 'cargafija:ggPctCalculado', '% Gastos Generales calculado')}>calculado ${fmtPct(r.ggFracCalculado)}</span>`;

  const filasImpuestos = r.impuestos.map(i => filaK({
    label: `<input type="text" class="form-control cf-impuesto-nombre" data-key="${escHtml(i.key)}" value="${escHtml(i.nombre)}" placeholder="Nombre del impuesto">`,
    medio: `${pctInputHtml('cf-imp-' + i.key, i.porcentaje, '0', `cargafija:impuesto:${i.key}`, i.nombre || 'Impuesto')}
            <button class="cf-impuesto-del" data-key="${escHtml(i.key)}" title="Eliminar impuesto">${icSvg('x')}</button>`,
    aporte: r.aportePorImpuesto[i.key],
    clase: 'cf-fila-impuesto',
    id: `cargafija:impuesto:${i.key}:aporte`,
    calcLabel: `${i.nombre || 'Impuesto'} · Aporte`,
  })).join('');

  el.innerHTML = `
    <div class="ap-resumen-row"><span>Costo total del Cómputo</span><span${calcAttrs(costoComputo, 'cargafija:costoComputo', 'Costo total del Cómputo')}>${fmtARS(costoComputo)}</span></div>
    ${filaK({
      label: 'Gastos Generales',
      medio: ggCalculado + pctInputHtml('cf-gg', ggValorCelda, '0', 'cargafija:ggPct', '% Gastos Generales'),
      aporte: r.ggFrac,
      clase: r.ggEsManual ? 'cf-gg-manual' : '',
      id: 'cargafija:ggAporte', calcLabel: 'Gastos Generales · Aporte',
    })}
    ${filaK({
      label: 'Beneficio',
      medio: pctInputHtml('cf-beneficio', config.beneficioPct, '0', 'cargafija:beneficioPct', '% Beneficio'),
      aporte: r.beneficioFrac,
      id: 'cargafija:beneficioAporte', calcLabel: 'Beneficio · Aporte',
    })}
    ${filaK({ label: 'Subtotal Costo', aporte: r.subtotalCosto, clase: 'cf-subtotal', id: 'cargafija:subtotalCosto', calcLabel: 'Subtotal Costo' })}
    ${filaK({
      label: 'Costo Financiero',
      medio: pctInputHtml('cf-financiero', config.costoFinancieroPct, '0', 'cargafija:costoFinancieroPct', '% Costo Financiero'),
      aporte: r.aporteFinanciero,
      id: 'cargafija:financieroAporte', calcLabel: 'Costo Financiero · Aporte',
    })}
    ${filaK({ label: 'Subtotal con gasto financiero', aporte: r.subtotalConFinanciero, clase: 'cf-subtotal', id: 'cargafija:subtotalConFinanciero', calcLabel: 'Subtotal con gasto financiero' })}
    <div class="cf-impuestos-titulo">Impuestos</div>
    ${filasImpuestos || '<p class="form-hint">Esta obra no tiene impuestos cargados.</p>'}
    <button type="button" class="btn btn-sm btn-outline cf-impuesto-add" id="cf-add-impuesto">+ Agregar impuesto</button>
    ${filaK({ label: 'Impuesto', aporte: r.impuestoFrac, clase: 'cf-subtotal', id: 'cargafija:impuestoTotal', calcLabel: 'Impuesto (total)' })}
    ${filaK({ label: 'TOTAL (K)', aporte: r.k, clase: 'total', id: 'cargafija:k', calcLabel: 'Coeficiente K' })}
    <p class="form-hint" style="margin-top:.5rem;">K se aplica al costo unitario de cada ítem en el Presupuesto de la obra para sacar el precio unitario. Cada impuesto se calcula sobre el subtotal con gasto financiero.</p>`;

  // El TOTAL (K) no sigue el selector de decimales del header: siempre 4 como
  // mínimo (ver fmtK en moneda.js). Es la única excepción de la app.
  const kEl = el.querySelector('.total .cf-fila-k-aporte');
  if (kEl) kEl.textContent = fmtK(r.k);

  engancharCamposK(r);
}

// Campo de % del bloque: mismo enganche que el resto de la app
// (attachCalcInput → attachValorInput → leer con valorCampo) y no escribe si
// no cambió nada.
function pctFieldK(input, valorActual, formulaActual, guardar) {
  attachCalcInput(input, formulaActual);
  attachValorInput(input, valorActual);
  input.addEventListener('blur', () => {
    const n = valorCampo(input);
    const formula = getCalcFormula(input);
    if (n === valorActual && formula === (formulaActual || null)) return;
    guardar(n, formula);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

function engancharCamposK(r) {
  const campoConfig = key => {
    const input = $(key === 'ggPct' ? 'cf-gg' : key === 'beneficioPct' ? 'cf-beneficio' : 'cf-financiero');
    if (!input) return;
    pctFieldK(input, config[key] ?? null, config[key + 'Formula'],
      (n, formula) => updateConfig({ [key]: n, [key + 'Formula']: formula }));
  };
  campoConfig('beneficioPct');
  campoConfig('costoFinancieroPct');

  // Gastos Generales: la celda muestra el calculado mientras no haya valor
  // propio, así que guardar "lo mismo que el calculado" no cuenta como pisarlo
  // a mano — si no, con sólo pasar por el campo la obra quedaría con el % del
  // momento congelado y dejaría de seguir al Cómputo.
  const ggInput = $('cf-gg');
  if (ggInput) {
    const calculado = window.roundLimpio(r.ggFracCalculado * 100);
    attachCalcInput(ggInput, config.ggPctFormula);
    attachValorInput(ggInput, config.ggPct != null ? config.ggPct : calculado);
    ggInput.addEventListener('blur', () => {
      const n = valorCampo(ggInput);
      const formula = getCalcFormula(ggInput);
      const nuevo = (n == null || isNaN(n) || (n === calculado && !formula)) ? null : n;
      if (nuevo === (config.ggPct ?? null) && formula === (config.ggPctFormula || null)) return;
      updateConfig({ ggPct: nuevo, ggPctFormula: nuevo == null ? null : formula });
    });
    ggInput.addEventListener('keydown', e => { if (e.key === 'Enter') ggInput.blur(); });
  }

  r.impuestos.forEach(i => {
    const input = $('cf-imp-' + i.key);
    if (input) {
      pctFieldK(input, i.porcentaje ?? null, (config.impuestos && config.impuestos[i.key] || {}).porcentajeFormula,
        (n, formula) => updateImpuesto(i.key, { porcentaje: n, porcentajeFormula: formula }));
    }
  });

  $('coeficiente-k').querySelectorAll('.cf-impuesto-nombre').forEach(input => {
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      const actual = (window.impuestosDeConfig(config).find(i => i.key === input.dataset.key) || {}).nombre;
      if (v === (actual || '')) return;
      updateImpuesto(input.dataset.key, { nombre: v });
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });

  $('coeficiente-k').querySelectorAll('.cf-impuesto-del').forEach(btn => {
    btn.addEventListener('click', () => eliminarImpuesto(btn.dataset.key));
  });
  const addBtn = $('cf-add-impuesto');
  if (addBtn) addBtn.addEventListener('click', agregarImpuesto);
}

// Igual que en el Cómputo: recién renderizado, cada celda del DOM tiene su
// valor de hoy, así que es el momento de recalcular los campos cuya fórmula
// apunta a otras celdas (ver js/refs.js). Tope de pasadas para cortar una
// referencia circular.
const CAMPOS_LINEA = ['cantidad', 'precioUnitario', 'meses', 'porcentaje'];
const CAMPOS_CONFIG = ['beneficioPct', 'costoFinancieroPct', 'ggPct'];
let pasadasVivas = 0;

function refrescarFormulasVivas() {
  if (!window.recalcularCeldasVivas) return;
  const campos = [];
  Object.entries(lineas).forEach(([lineaKey, l]) => {
    CAMPOS_LINEA.forEach(campo => {
      if (!window.formulaTieneRefs(l[campo + 'Formula'])) return;
      campos.push({
        formula: l[campo + 'Formula'],
        valor: l[campo] ?? null,
        aplicar: valor => {
          lineas[lineaKey][campo] = valor;
          persistLineaCambios(lineaKey, { [campo]: valor });
        },
      });
    });
  });
  CAMPOS_CONFIG.forEach(campo => {
    if (!window.formulaTieneRefs(config[campo + 'Formula'])) return;
    campos.push({
      formula: config[campo + 'Formula'],
      valor: config[campo] ?? null,
      aplicar: valor => { config[campo] = valor; persistConfigCambios({ [campo]: valor }); },
    });
  });
  Object.entries(config.impuestos || {}).forEach(([key, i]) => {
    if (!window.formulaTieneRefs(i.porcentajeFormula)) return;
    campos.push({
      formula: i.porcentajeFormula,
      valor: i.porcentaje ?? null,
      aplicar: valor => {
        config.impuestos[key].porcentaje = valor;
        persistImpuestoCambios(key, { porcentaje: valor });
      },
    });
  });
  if (!campos.length || !window.recalcularCeldasVivas(campos)) { pasadasVivas = 0; return; }
  if (++pasadasVivas > 10) {
    pasadasVivas = 0;
    showToast('Hay referencias circulares entre celdas — se detuvo el recálculo.', 'error');
    return;
  }
  renderTodo();
}

function renderTodo() {
  renderLineas();
  renderCoeficienteK();
  refrescarFormulasVivas();
}

// Cada línea/campo se guarda en su propio path con PATCH (merge), no
// reescribiendo el árbol completo de líneas: si dos ediciones seguidas
// (ej. cantidad y precio, tipeadas rápido en la misma línea) completan
// desordenadas por red, un PUT del árbol entero podía hacer que la más vieja
// pise a la más nueva y se perdiera una línea. Con PATCH por línea/campo,
// el orden de llegada no importa porque cada request sólo toca lo suyo.
async function persistLineaCambios(lineaKey, cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/cargaFija/lineas/${lineaKey}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar los gastos fijos.', 'error');
  }
}

async function persistLineaNueva(lineaKey) {
  try {
    await _fbPut(`/obras/${obraKey}/cargaFija/lineas/${lineaKey}.json`, lineas[lineaKey]);
  } catch (_) {
    showToast('Error al guardar los gastos fijos.', 'error');
  }
}

async function persistConfigCambios(cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/cargaFija/config.json`, cambios);
  } catch (_) {
    showToast('Error al guardar la configuración de carga fija.', 'error');
  }
}

async function persistImpuestoCambios(key, cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/cargaFija/config/impuestos/${key}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar el impuesto.', 'error');
  }
}

async function persistImpuestoNuevo(key, impuesto) {
  try {
    await _fbPut(`/obras/${obraKey}/cargaFija/config/impuestos/${key}.json`, impuesto);
  } catch (_) {
    showToast('Error al guardar el impuesto.', 'error');
  }
}

function updateLinea(lineaKey, cambios) {
  lineas[lineaKey] = { ...lineas[lineaKey], ...cambios };
  renderTodo();
  persistLineaCambios(lineaKey, cambios);
}

function updateConfig(cambios) {
  config = { ...config, ...cambios };
  renderCoeficienteK();
  persistConfigCambios(cambios);
}

/* ===== Impuestos =====
   Antes había un único `ivaPct`. Ahora es una lista, porque en la planilla
   conviven varios (IVA, Otros impuestos) que aportan al mismo coeficiente.
   Las obras viejas se siguen leyendo por compatibilidad (ver
   impuestosDeConfig en calcCostos.js); la lista se "materializa" en la
   primera edición: se escribe la lista completa, se marca la obra con
   `impuestosCargados` y recién ahí se anula el `ivaPct` viejo, para que no
   queden dos fuentes de verdad. */

// Devuelve la lista tal como debe quedar guardada, partiendo de lo que la
// obra tenga hoy (lista propia o el IVA legado).
function impuestosComoObjeto() {
  const obj = {};
  window.impuestosDeConfig(config).forEach((i, idx) => {
    obj[i.key] = {
      nombre: i.nombre || '',
      porcentaje: i.porcentaje ?? null,
      porcentajeFormula: (config.impuestos && config.impuestos[i.key] || {}).porcentajeFormula || null,
      orden: i.orden || idx,
    };
  });
  return obj;
}

// Deja la obra con la lista ya materializada en `config` (en memoria) y
// devuelve los cambios que hay que persistir junto con la edición.
function asegurarListaImpuestos() {
  if (config.impuestosCargados) return {};
  config.impuestos = impuestosComoObjeto();
  config.impuestosCargados = true;
  config.ivaPct = null;
  return { impuestos: config.impuestos, impuestosCargados: true, ivaPct: null };
}

function updateImpuesto(key, cambios) {
  const base = asegurarListaImpuestos();
  config.impuestos = { ...config.impuestos, [key]: { ...(config.impuestos || {})[key], ...cambios } };
  renderCoeficienteK();
  if (Object.keys(base).length) {
    // Primera edición de la obra: se escribe la lista completa junto con la
    // marca y el ivaPct anulado, en un solo PATCH.
    persistConfigCambios({ ...base, impuestos: config.impuestos });
  } else {
    // PATCH por impuesto: sólo toca ese nodo, no reescribe la lista entera
    // (mismo criterio que las líneas de gasto fijo).
    persistImpuestoCambios(key, cambios);
  }
}

function agregarImpuesto() {
  const base = asegurarListaImpuestos();
  const key = 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const orden = Object.values(config.impuestos || {}).reduce((max, i) => Math.max(max, i.orden || 0), -1) + 1;
  const nuevo = { nombre: '', porcentaje: null, porcentajeFormula: null, orden };
  config.impuestos = { ...config.impuestos, [key]: nuevo };
  renderCoeficienteK();
  if (Object.keys(base).length) persistConfigCambios({ ...base, impuestos: config.impuestos });
  else persistImpuestoNuevo(key, nuevo);
}

async function eliminarImpuesto(key) {
  const base = asegurarListaImpuestos();
  const impuestos = { ...config.impuestos };
  delete impuestos[key];
  config.impuestos = impuestos;
  renderCoeficienteK();
  if (Object.keys(base).length) {
    // Primera edición de la obra: se escribe la lista ya sin ese impuesto.
    persistConfigCambios({ ...base, impuestos });
    return;
  }
  try {
    // Path con la key incluida — sin ella se borraría la lista entera
    // (ver memoria feedback_firebase_delete_paths).
    await _fbDel(`/obras/${obraKey}/cargaFija/config/impuestos/${key}.json`);
  } catch (_) {
    showToast('Error al eliminar el impuesto.', 'error');
  }
}

function addLinea() {
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  lineas[lineaKey] = { concepto: '', tipo: 'monto', cantidad: null, precioUnitario: null, meses: null };
  renderTodo();
  persistLineaNueva(lineaKey);
}

async function deleteLinea(lineaKey) {
  delete lineas[lineaKey];
  renderTodo();
  try {
    await _fbDel(`/obras/${obraKey}/cargaFija/lineas/${lineaKey}.json`);
  } catch (_) {
    showToast('Error al eliminar el concepto.', 'error');
  }
  showToast('Concepto eliminado.');
}

// Importar de otra obra: siempre agrega los conceptos de la obra origen como
// líneas nuevas (no pisa ni borra lo que ya haya en la obra destino). No
// copia los % de Beneficio/Financiero/IVA — esos varían por obra/contrato.
let obrasParaImportar = null; // cache: [{key, nombre}] — todas menos la actual
let importarCfSelect = null;
let lineasOrigenImportar = null; // { lineaKey: linea } de la obra elegida, o null

async function abrirModalImportarCf() {
  $('importar-cf-confirmar').disabled = true;
  $('importar-cf-info').textContent = '';
  lineasOrigenImportar = null;

  if (!obrasParaImportar) {
    const data = await _fbGet('/obras.json');
    obrasParaImportar = Object.entries(data || {})
      .filter(([key]) => key !== obraKey)
      .map(([key, o]) => ({ key, nombre: o.nombre || key }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  importarCfSelect = createSearchableSelect($('importar-cf-select'), {
    options: obrasParaImportar.map(o => ({ value: o.key, label: o.nombre })),
    placeholder: 'Buscar obra…',
    onChange: onElegirObraOrigenImportar,
  });

  $('modal-importar-cf').classList.remove('hidden');
}

function cerrarModalImportarCf() {
  $('modal-importar-cf').classList.add('hidden');
}

async function onElegirObraOrigenImportar(obraOrigenKey) {
  $('importar-cf-confirmar').disabled = true;
  lineasOrigenImportar = null;
  $('importar-cf-info').textContent = 'Buscando…';

  const data = await _fbGet(`/obras/${obraOrigenKey}/cargaFija/lineas.json`);
  const cantidad = Object.keys(data || {}).length;
  if (!cantidad) {
    $('importar-cf-info').textContent = 'Esa obra no tiene conceptos cargados en Carga Fija.';
    return;
  }
  lineasOrigenImportar = data;
  $('importar-cf-info').textContent = `Se van a agregar ${cantidad} concepto${cantidad === 1 ? '' : 's'} a los que ya tiene esta obra.`;
  $('importar-cf-confirmar').disabled = false;
}

async function confirmarImportarCf() {
  if (!lineasOrigenImportar) return;
  const nuevas = {};
  Object.values(lineasOrigenImportar).forEach(l => {
    const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    nuevas[lineaKey] = {
      concepto: l.concepto, tipo: l.tipo || 'monto',
      cantidad: l.cantidad, precioUnitario: l.precioUnitario, meses: l.meses,
      porcentaje: l.porcentaje ?? null, porcentajeFormula: l.porcentajeFormula ?? null,
    };
  });

  Object.assign(lineas, nuevas);
  renderTodo();
  cerrarModalImportarCf();

  try {
    await _fbPatch(`/obras/${obraKey}/cargaFija/lineas.json`, nuevas);
    showToast(`${Object.keys(nuevas).length} conceptos importados.`);
  } catch (_) {
    showToast('Error al importar los conceptos.', 'error');
  }
}

function versionDe(it) {
  const propia = it.versionesObra && it.versionesObra[obraKey];
  return propia || it;
}

function calcularCostoComputo(computoLineas, itemsList) {
  const itemsMap = {};
  itemsList.forEach(it => { itemsMap[it.key] = it; });
  return Object.values(computoLineas || {}).reduce((acc, l) => {
    const it = itemsMap[l.itemKey];
    if (!it || l.cantidad == null || isNaN(l.cantidad)) return acc;
    const version = versionDe(it);
    if (!version.lineas || !Object.keys(version.lineas).length) return acc;
    const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra);
    return acc + r.costoUnitario * l.cantidad;
  }, 0);
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, configData, computoLineas, itemsData, materialesData, equiposData, rolesData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/lineas.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/config.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet(`/obras/${obraKey}/roles.json`),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  lineas = lineasData || {};
  if (configData) config = { ...config, ...configData };
  computoData = computoLineas;
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it }));
  catalogos = {
    materiales: Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m })),
    equipos: Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e })),
    roles: Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r })),
  };
  paramsEquipos = { ...paramsEquipos, ...(obra.paramsEquipos || {}) };
  paramsMO = { ...paramsMO, ...(obra.paramsMO || {}) };
  dolarObra = obra.dolar ? obra.dolar.valor : null;
  preciosObra = window.resolverPreciosObra(catalogos.materiales, obraKey);
  costoComputo = calcularCostoComputo(computoData, items);

  $('header-obra-nombre').textContent = 'Carga Fija — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'carga-fija');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-linea').addEventListener('click', addLinea);
  $('btn-importar-cf').addEventListener('click', abrirModalImportarCf);
  $('importar-cf-close').addEventListener('click', cerrarModalImportarCf);
  $('importar-cf-cancelar').addEventListener('click', cerrarModalImportarCf);
  $('importar-cf-confirmar').addEventListener('click', confirmarImportarCf);
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) {
    costoComputo = calcularCostoComputo(computoData, items);
    renderTodo();
  }
});

window.onDecimalesVista(() => { if (obra) renderTodo(); });
