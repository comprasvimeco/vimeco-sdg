/* VIMECO S.A. — Sistema de Gestión — Cómputo de obra
   Listado totalmente libre. Los rubros son una entidad de la obra
   (/obras/{obraKey}/rubrosComputo/{rubroId}: { nombre, orden }) — se
   agregan con el botón "+ Agregar rubro" y se numeran solos (1., 2., …)
   según su orden. Cada línea (/obras/{obraKey}/computo/{lineaKey}) tiene
   Ítem + Unidad de texto libre (no dependen de la Biblioteca), Cantidad, y
   pertenece a un rubro (rubroId) — se numera "1.1", "1.2"… dentro de su
   rubro. El costo arranca en $0 hasta que se vincula a un ítem real vía
   "Análisis de Precio" (item.html?key=...&obra=... si ya está vinculada, o
   item.html?linea=...&obra=... para buscar/crear el ítem la primera vez).
   El costo, una vez vinculada, se calcula en vivo: si el ítem tiene una
   versión de Rendimientos propia para ESTA obra
   (/items/{key}/versionesObra/{obraKey}, ver item.js) se usa esa receta +
   rendimiento; si no, se usa la Teórica (calcCostoUnitarioItem,
   js/calcCostos.js). Es costo total de obra sin carga (sin %GG, beneficio,
   financiero ni IVA) — eso se aplica en el Presupuesto, etapa siguiente.

   Reordenar: flechas ↑/↓ mueven una línea dentro de su mismo rubro (o un
   rubro entre los demás rubros); arrastrar una línea y soltarla sobre otro
   rubro la mueve a ese rubro (al final). */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let rubros = [];   // [{ key, nombre, orden }] — ordenado por `orden`
let lineas = {};   // { lineaKey: { rubroId, nombre, unidad, cantidad, cantidadFormula, itemKey, orden } }
/* Análisis auxiliares (/obras/{obraKey}/auxiliares) — entidad aparte del
   Cómputo, con la misma forma de línea menos `rubroId`. No tienen costo de
   obra: son cálculos del dueño de la obra para costear algo suelto (un flete)
   y copiar el resultado a mano a Carga Fija o a otro AP. Viven en su propio
   nodo justamente para que nada los sume sin querer: los cuatro lugares que
   calculan el costo del Cómputo (que es el denominador del %GG, y por lo tanto
   de la Carga Fija) leen /computo y ahí no están. */
let auxiliares = {};
let items = [];
let materiales = [];
let equipos = [];
let roles = [];
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};   // { materialKey: {precioUSD,...} } — resuelto de los precios por obra de esta obra
let dolarObra = null;   // dólar propio de esta obra (/obras/{obraKey}/dolar)
let draggedLineaKey = null;

function versionDe(it) {
  const propia = it.versionesObra && it.versionesObra[obraKey];
  return propia || it;
}

function costoUnitarioDe(itemKey) {
  if (!itemKey) return 0;
  const it = items.find(i => i.key === itemKey);
  if (!it) return 0;
  const version = versionDe(it);
  if (!version.lineas || !Object.keys(version.lineas).length) return 0;
  const catalogos = { materiales, equipos, roles };
  const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra);
  return r.costoUnitario;
}

function totalLinea(linea) {
  const costo = costoUnitarioDe(linea.itemKey);
  const cantidad = linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : 0;
  return costo * cantidad;
}

function lineasDeRubro(rubroId) {
  return Object.entries(lineas)
    .filter(([, l]) => l.rubroId === rubroId)
    .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));
}

/* Las filas del Cómputo y las de los auxiliares son la misma fila con otro
   dueño: mismo alta/edición/orden/duplicar/eliminar, otro nodo de RTDB y otro
   prefijo de id para las fórmulas entre celdas (js/refs.js). En vez de
   duplicar todo el CRUD, cada función lleva un `aux` al final y pide acá dónde
   escribir. */
function tienda(aux) {
  return aux
    ? { datos: auxiliares, nodo: 'auxiliares', prefijo: 'computo:aux' }
    : { datos: lineas, nodo: 'computo', prefijo: 'computo:linea' };
}

// Las filas entre las que se mueve una: sus hermanas de rubro en el Cómputo,
// todas las demás en los auxiliares (no hay rubros ahí).
function grupoDe(lineaKey, aux) {
  if (!aux) return lineasDeRubro(lineas[lineaKey].rubroId);
  return Object.entries(auxiliares).sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));
}

// `rubros` se mantiene siempre ordenado por su campo `orden` como
// invariante — así todo lo que lo recorre (render, numeración, el
// selector del modal "Nueva línea") no tiene que ordenar por su cuenta.
// Llamar después de cargar y después de cualquier cambio de `orden`.
function ordenarRubros() {
  rubros.sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

function subtotalGrupo(grupoLineas) {
  return grupoLineas.reduce((acc, [, l]) => acc + totalLinea(l), 0);
}

/* La celda del número. Con la numeración personalizada apagada es el texto de
   siempre; prendida es un input donde se escribe el código del pliego, con el
   automático como placeholder para que se vea qué número va a salir si se lo
   deja vacío. */
function celdaNumero(clase, tipo, entidad, codigo, codigoAuto, sufijo) {
  if (!numeracionPersonalizada()) {
    return `<span class="${clase}">${escHtml(codigo)}${sufijo || ''}</span>`;
  }
  const aMano = entidad.codigo != null ? String(entidad.codigo) : '';
  return `<input type="text" class="${clase} computo-codigo-input" data-codigo-tipo="${tipo}" data-codigo-key="${escHtml(entidad.key)}" value="${escHtml(aMano)}" placeholder="${escHtml(codigoAuto)}" title="Código del pliego — vacío usa la numeración automática">`;
}

function numeracionPersonalizada() {
  return window.numeracionCfg(obra).personalizada;
}

// Obra "sin rubros" (ver js/numeracion.js y datos-obra.js): el Cómputo es una
// sola lista. Por dentro las líneas siguen colgando de un rubro único, que no
// se muestra ni se imprime.
function sinRubros() {
  return window.numeracionCfg(obra).sinRubros;
}

function renderRubroHeader(rubro, numero, numeroAuto, esPrimero, esUltimo) {
  const grupoLineas = lineasDeRubro(rubro.key);
  const vacio = !grupoLineas.length;
  return `
    <div class="computo-rubro-header" data-rubro-id="${escHtml(rubro.key)}">
      ${celdaNumero('computo-rubro-numero', 'rubro', rubro, numero, numeroAuto, '.')}
      <input type="text" class="form-control computo-rubro-nombre-input" data-rubro-id="${escHtml(rubro.key)}" value="${escHtml(rubro.nombre || '')}" placeholder="Nombre del rubro">
      <span class="computo-rubro-acciones">
        <button class="computo-rubro-add-linea" data-rubro-id="${escHtml(rubro.key)}" title="Agregar ítem en este rubro">${icSvg('plus')}</button>
        <button class="computo-rubro-mover" data-rubro-id="${escHtml(rubro.key)}" data-dir="-1" title="Subir rubro" ${esPrimero ? 'disabled' : ''}>${icSvg('arrowUp')}</button>
        <button class="computo-rubro-mover" data-rubro-id="${escHtml(rubro.key)}" data-dir="1" title="Bajar rubro" ${esUltimo ? 'disabled' : ''}>${icSvg('arrowDown')}</button>
        <button class="computo-rubro-del" data-rubro-id="${escHtml(rubro.key)}" title="${vacio ? 'Eliminar rubro' : 'Vaciá el rubro antes de eliminarlo'}" ${vacio ? '' : 'disabled'}>${icSvg('x')}</button>
      </span>
      <span class="computo-rubro-subtotal"${calcAttrs(subtotalGrupo(grupoLineas), `computo:rubro:${rubro.key}:subtotal`, `${numero}. ${rubro.nombre || 'Rubro'} · Subtotal`)}>${fmtARS(subtotalGrupo(grupoLineas))}</span>
    </div>
    <div class="computo-rubro-lineas" data-rubro-id="${escHtml(rubro.key)}"></div>`;
}

function renderLineaRow(lineaKey, linea, numero, numeroAuto, esPrimero, esUltimo, aux) {
  const costo = costoUnitarioDe(linea.itemKey);
  const total = totalLinea(linea);
  const paramNuevo = aux ? 'aux' : 'linea';
  const hrefAP = linea.itemKey
    ? `item.html?key=${encodeURIComponent(linea.itemKey)}&obra=${encodeURIComponent(obraKey)}`
    : `item.html?${paramNuevo}=${encodeURIComponent(lineaKey)}&obra=${encodeURIComponent(obraKey)}`;
  // Etiqueta con la que se va a leer una referencia a esta línea dentro de
  // una fórmula ("=[1.2 Desmonte · Total]"): la numeración la hace única.
  const etiqueta = `${numero} ${linea.nombre || 'Ítem'}`;
  const pre = tienda(aux).prefijo;
  // El auxiliar no está en ningún pliego: su número es "A1", fijo, sin campo
  // para escribirlo a mano ni estilo que lo cambie.
  const celda = aux
    ? `<span class="computo-linea-numero">${escHtml(numero)}</span>`
    : celdaNumero('computo-linea-numero', 'linea', { key: lineaKey, codigo: linea.codigo }, numero, numeroAuto);
  return `
    <div class="computo-linea" data-key="${escHtml(lineaKey)}" draggable="${aux || sinRubros() ? 'false' : 'true'}">
      ${celda}
      <input type="text" class="form-control linea-nombre" placeholder="Ítem" value="${escHtml(linea.nombre || '')}">
      <input type="text" class="form-control linea-unidad" placeholder="Unidad" value="${escHtml(linea.unidad || '')}">
      <input type="text" class="form-control linea-cantidad" placeholder="Cantidad" data-calc-id="${pre}:${escHtml(lineaKey)}:cantidad" data-calc-label="${escHtml(etiqueta + ' · Cantidad')}">
      <span class="computo-linea-costo"${calcAttrs(costo, `${pre}:${lineaKey}:costoUnit`, etiqueta + ' · Costo unit.')}>${fmtARS(costo)}</span>
      <span class="computo-linea-total"${calcAttrs(total, `${pre}:${lineaKey}:total`, etiqueta + ' · Total')}>${fmtARS(total)}</span>
      <span class="computo-linea-acciones">
        <button class="computo-linea-mover" data-dir="-1" title="Subir" ${esPrimero ? 'disabled' : ''}>${icSvg('arrowUp')}</button>
        <button class="computo-linea-mover" data-dir="1" title="Bajar" ${esUltimo ? 'disabled' : ''}>${icSvg('arrowDown')}</button>
        <button class="computo-linea-dup" title="Duplicar">${icSvg('copy')}</button>
        <a class="computo-linea-ap" href="${hrefAP}" title="Análisis de Precio">${icSvg('layers')}</a>
        <button class="computo-linea-del" title="Eliminar línea">${icSvg('x')}</button>
      </span>
    </div>`;
}

function renderLineas() {
  const container = $('lineas-computo');
  ordenarRubros();

  const plana = sinRubros();

  if (!rubros.length || (plana && !Object.keys(lineas).length)) {
    container.innerHTML = plana
      ? '<p class="text-muted" style="font-size:.85rem;">Todavía no hay ítems — empezá agregando uno.</p>'
      : '<p class="text-muted" style="font-size:.85rem;">Todavía no hay rubros — empezá agregando uno.</p>';
    return;
  }

  const header = `
    <div class="computo-linea computo-linea-header">
      <span></span><span>Ítem</span><span>Unidad</span><span>Cantidad</span><span>Costo unitario</span><span>Costo subtotal</span><span></span>
    </div>`;
  // La numeración sale de js/numeracion.js — la misma que ve el Presupuesto, el
  // AP y el papel.
  const num = window.numerarComputo(obra, rubros, lineas);
  // Los campos de código necesitan una primera columna más ancha que el texto.
  container.classList.toggle('con-codigo', num.cfg.personalizada);

  // Lista plana: una sola tira de líneas, sin cabeceras de rubro.
  if (plana) {
    const enOrden = num.lineasEnOrden;
    container.innerHTML = header + enOrden.map((l, i) =>
      renderLineaRow(l.key, lineas[l.key], num.codigoDeLinea[l.key], num.autoDeLinea[l.key],
        i === 0, i === enOrden.length - 1)
    ).join('');
    engancharCodigos(container);
    engancharLineas(container);
    return;
  }

  container.innerHTML = header + rubros.map((rubro, i) =>
    renderRubroHeader(rubro, num.codigoDeRubro[rubro.key], num.autoDeRubro[rubro.key],
      i === 0, i === rubros.length - 1)
  ).join('');

  rubros.forEach(rubro => {
    const lineasContainer = container.querySelector(`.computo-rubro-lineas[data-rubro-id="${CSS.escape(rubro.key)}"]`);
    const grupoLineas = lineasDeRubro(rubro.key);
    lineasContainer.innerHTML = grupoLineas.length
      ? grupoLineas.map(([k, l], i) => renderLineaRow(k, l, num.codigoDeLinea[k], num.autoDeLinea[k],
          i === 0, i === grupoLineas.length - 1)).join('')
      : '<p class="text-muted" style="font-size:.8rem;padding:.4rem 0;">Sin líneas en este rubro todavía.</p>';

    lineasContainer.addEventListener('dragover', e => { e.preventDefault(); lineasContainer.classList.add('drop-target'); });
    lineasContainer.addEventListener('dragleave', () => lineasContainer.classList.remove('drop-target'));
    lineasContainer.addEventListener('drop', e => {
      e.preventDefault();
      lineasContainer.classList.remove('drop-target');
      if (draggedLineaKey) moverLineaARubro(draggedLineaKey, rubro.key);
    });
  });

  container.querySelectorAll('.computo-rubro-nombre-input').forEach(input => {
    const rubroId = input.dataset.rubroId;
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      const rubro = rubros.find(r => r.key === rubroId);
      if (rubro && v && v !== rubro.nombre) { rubro.nombre = v; persistRubroCambios(rubroId, { nombre: v }); renderResumen(); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
  engancharCodigos(container);

  container.querySelectorAll('.computo-rubro-add-linea').forEach(btn => {
    btn.addEventListener('click', () => crearLineaEnRubro(btn.dataset.rubroId));
  });
  container.querySelectorAll('.computo-rubro-mover').forEach(btn => {
    btn.addEventListener('click', () => moverRubro(btn.dataset.rubroId, parseInt(btn.dataset.dir, 10)));
  });
  container.querySelectorAll('.computo-rubro-del').forEach(btn => {
    btn.addEventListener('click', () => { if (!btn.disabled) eliminarRubro(btn.dataset.rubroId); });
  });

  engancharLineas(container);
}

/* La card de los análisis auxiliares, debajo del Resumen: la misma tabla que
   el Cómputo pero sin rubros y sin total. Sumarlos no significaría nada — cada
   auxiliar es un cálculo independiente, y el número que se copia a mano es el
   de su fila. */
function renderAuxiliares() {
  const container = $('lineas-auxiliares');
  const enOrden = window.numerarAuxiliares(auxiliares);

  if (!enOrden.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no hay ninguno. Sirven para costear algo suelto —un flete, por ejemplo— y copiar el resultado a mano a Carga Fija o a otro Análisis de Precio.</p>';
    return;
  }

  const header = `
    <div class="computo-linea computo-linea-header">
      <span></span><span>Ítem</span><span>Unidad</span><span>Cantidad</span><span>Costo unitario</span><span>Costo subtotal</span><span></span>
    </div>`;
  container.innerHTML = header + enOrden.map((a, i) =>
    renderLineaRow(a.key, auxiliares[a.key], a.codigo, a.codigo, i === 0, i === enOrden.length - 1, true)
  ).join('');
  engancharLineas(container, true);
}

/* El código del pliego escrito a mano. Tiene que seguir siendo único en toda la
   obra: es la clave con la que el Excel exportado cruza las hojas CyP, A.P,
   Resumen y Plan (VLOOKUP / INDEX+MATCH), así que un repetido dejaría la
   planilla llena de #N/A. Se prueba la numeración completa con el código nuevo
   puesto y, si aparecieron repetidos que antes no estaban, no se guarda. */
function engancharCodigos(container) {
  container.querySelectorAll('.computo-codigo-input').forEach(input => {
    const tipo = input.dataset.codigoTipo;
    const key = input.dataset.codigoKey;
    const entidad = tipo === 'rubro' ? rubros.find(r => r.key === key) : lineas[key];
    if (!entidad) return;
    const anterior = entidad.codigo != null ? String(entidad.codigo) : '';

    input.addEventListener('blur', () => {
      const v = input.value.trim();
      if (v === anterior) return;

      const repetidosAntes = window.numerarComputo(obra, rubros, lineas).duplicados.length;
      entidad.codigo = v;
      if (window.numerarComputo(obra, rubros, lineas).duplicados.length > repetidosAntes) {
        entidad.codigo = anterior || null;
        input.value = anterior;
        showToast('Ese código ya está usado en el Cómputo.', 'error');
        return;
      }

      // null borra el campo en RTDB: es lo que devuelve la línea a la
      // numeración automática.
      const guardar = v || null;
      if (tipo === 'rubro') {
        entidad.codigo = guardar;
        persistRubroCambios(key, { codigo: guardar });
        renderTodo();   // las líneas del rubro se numeran a partir de su código
      } else {
        updateLinea(key, { codigo: guardar });
      }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
}

function engancharLineas(container, aux) {
  container.querySelectorAll('.computo-linea[data-key]').forEach(row => {
    const lineaKey = row.dataset.key;
    const linea = tienda(aux).datos[lineaKey];

    row.addEventListener('dragstart', () => { draggedLineaKey = lineaKey; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { draggedLineaKey = null; row.classList.remove('dragging'); });

    const nombreInput = row.querySelector('.linea-nombre');
    nombreInput.addEventListener('blur', () => {
      const v = nombreInput.value.trim();
      if (v !== (linea.nombre || '')) updateLinea(lineaKey, { nombre: v }, aux);
    });
    nombreInput.addEventListener('keydown', e => { if (e.key === 'Enter') nombreInput.blur(); });

    const unidadInput = row.querySelector('.linea-unidad');
    unidadInput.addEventListener('blur', () => {
      const v = unidadInput.value.trim();
      if (v !== (linea.unidad || '')) updateLinea(lineaKey, { unidad: v }, aux);
    });
    unidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') unidadInput.blur(); });

    const cantidadInput = row.querySelector('.linea-cantidad');
    cantidadInput.dataset.calcValor = linea.cantidad ?? 0;
    attachCalcInput(cantidadInput, linea.cantidadFormula);
    attachValorInput(cantidadInput, linea.cantidad ?? null);
    cantidadInput.addEventListener('blur', () => {
      const n = valorCampo(cantidadInput);
      const formula = getCalcFormula(cantidadInput);
      // Salir del campo sin haberlo tocado no tiene que escribir nada: sin
      // esto, cada paso por una celda dispara un PATCH y un re-render.
      if (n === (linea.cantidad ?? null) && formula === (linea.cantidadFormula || null)) return;
      updateLinea(lineaKey, { cantidad: n, cantidadFormula: formula }, aux);
    });
    cantidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') cantidadInput.blur(); });

    row.querySelectorAll('.computo-linea-mover').forEach(btn => {
      btn.addEventListener('click', () => moverLinea(lineaKey, parseInt(btn.dataset.dir, 10), aux));
    });
    row.querySelector('.computo-linea-dup').addEventListener('click', () => duplicarLinea(lineaKey, aux));
    row.querySelector('.computo-linea-del').addEventListener('click', () => deleteLinea(lineaKey, aux));
  });
}

function renderResumen() {
  const total = Object.values(lineas).reduce((acc, l) => acc + totalLinea(l), 0);
  $('resumen').innerHTML = `
    <div class="ap-resumen-row total"><span>Costo total del cómputo</span><span${calcAttrs(total, 'computo:total', 'Costo total del cómputo')}>${fmtARS(total)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">Costo sin Gastos Generales, beneficio ni IVA — eso se aplica en el Presupuesto de la obra.</p>`;
}

// El armado con IA sólo tiene sentido si el cómputo está completamente
// vacío (ver js/computo-ia.js): la extracción reemplaza la nada, nunca
// convive con líneas ya cargadas a mano.
function actualizarBotonComputoIA() {
  const btn = $('btn-computo-ia');
  if (!btn) return;
  btn.disabled = computoCargado();
  btn.title = computoCargado() ? 'Sólo disponible con el cómputo vacío' : '';
}

// En una obra sin rubros existe un rubro único invisible desde el primer ítem:
// lo que dice si el cómputo está vacío son las líneas, no los rubros.
function computoCargado() {
  return sinRubros() ? Object.keys(lineas).length > 0 : rubros.length > 0;
}

// El botón que agrega: rubros en una obra normal, ítems en una obra sin rubros.
function actualizarBotonAgregar() {
  const btn = $('btn-add-rubro');
  if (!btn) return;
  btn.textContent = sinRubros() ? '+ Agregar ítem' : '+ Agregar rubro';
}

// Recién renderizado, el DOM tiene los valores de hoy en cada celda: es el
// momento de recalcular las cantidades cuya fórmula apunta a otras celdas
// (ver js/refs.js). Si alguna cambió, se guarda y se vuelve a renderizar —
// con tope de pasadas, para cortar una referencia circular en vez de colgar
// la pantalla.
let pasadasVivas = 0;

function refrescarFormulasVivas() {
  if (!window.recalcularCeldasVivas) return;
  const camposDe = aux => Object.entries(tienda(aux).datos)
    .filter(([, l]) => window.formulaTieneRefs(l.cantidadFormula))
    .map(([lineaKey, l]) => ({
      formula: l.cantidadFormula,
      valor: l.cantidad ?? null,
      aplicar: valor => {
        tienda(aux).datos[lineaKey].cantidad = valor;
        persistLineaCambios(lineaKey, { cantidad: valor }, aux);
      },
    }));
  const campos = [...camposDe(false), ...camposDe(true)];
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
  renderResumen();
  renderAuxiliares();
  actualizarBotonAgregar();
  actualizarBotonComputoIA();
  refrescarFormulasVivas();
}

// Cada línea/rubro se guarda en su propio path (PUT al crear, PATCH al
// editar campos sueltos) en vez de reescribir el árbol completo — mismo
// criterio que carga-fija.js, evita perder líneas si se edita rápido (ver
// memoria feedback_firebase_patch_por_linea).
async function persistLineaNueva(lineaKey, aux) {
  const t = tienda(aux);
  try {
    await _fbPut(`/obras/${obraKey}/${t.nodo}/${lineaKey}.json`, t.datos[lineaKey]);
  } catch (_) {
    showToast('Error al guardar el cómputo.', 'error');
  }
}

async function persistLineaCambios(lineaKey, cambios, aux) {
  try {
    await _fbPatch(`/obras/${obraKey}/${tienda(aux).nodo}/${lineaKey}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar el cómputo.', 'error');
  }
}

async function persistRubroNuevo(rubroId) {
  try {
    const { nombre, orden } = rubros.find(r => r.key === rubroId);
    await _fbPut(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`, { nombre, orden });
  } catch (_) {
    showToast('Error al guardar el rubro.', 'error');
  }
}

async function persistRubroCambios(rubroId, cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar el rubro.', 'error');
  }
}

function updateLinea(lineaKey, cambios, aux) {
  const datos = tienda(aux).datos;
  datos[lineaKey] = { ...datos[lineaKey], ...cambios };
  renderTodo();
  persistLineaCambios(lineaKey, cambios, aux);
  // El AP de esta línea (item.html) se llama tal cual sale acá — si cambia
  // nombre/unidad, se propaga al ítem vinculado (best-effort, no bloquea).
  if ((cambios.nombre !== undefined || cambios.unidad !== undefined) && datos[lineaKey].itemKey) {
    persistNombreUnidadItem(datos[lineaKey].itemKey, { nombre: datos[lineaKey].nombre, unidad: datos[lineaKey].unidad });
  }
}

async function persistNombreUnidadItem(itemKey, cambios) {
  try {
    await _fbPatch(`/items/${itemKey}.json`, cambios);
  } catch (_) {
    showToast('Error al sincronizar el nombre con el Análisis de Precio.', 'error');
  }
}

function addRubro() {
  const rubroId = 'rubro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const orden = rubros.length ? Math.max(...rubros.map(r => r.orden || 0)) + 1 : 1;
  rubros.push({ key: rubroId, nombre: '', orden });
  renderTodo();
  persistRubroNuevo(rubroId);
  setTimeout(() => {
    const input = document.querySelector(`.computo-rubro-nombre-input[data-rubro-id="${CSS.escape(rubroId)}"]`);
    if (input) input.focus();
  }, 50);
}

/* En una obra sin rubros el botón agrega un ítem directamente. Las líneas
   necesitan un rubro que las contenga igual (el modelo no cambió), así que si
   todavía no hay ninguno se crea uno sin nombre, invisible en pantalla. */
async function addItemPlano() {
  let rubroId = rubros.length ? rubros[0].key : null;
  if (!rubroId) {
    rubroId = 'rubro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    rubros.push({ key: rubroId, nombre: '', orden: 1 });
    await persistRubroNuevo(rubroId);
  }
  crearLineaEnRubro(rubroId);
}

function moverRubro(rubroId, dir) {
  const ordenados = [...rubros].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const idx = ordenados.findIndex(r => r.key === rubroId);
  const otroIdx = idx + dir;
  if (idx < 0 || otroIdx < 0 || otroIdx >= ordenados.length) return;
  const a = ordenados[idx], b = ordenados[otroIdx];
  const ordenA = a.orden, ordenB = b.orden;
  a.orden = ordenB; b.orden = ordenA;
  renderTodo();
  persistRubroCambios(a.key, { orden: a.orden });
  persistRubroCambios(b.key, { orden: b.orden });
}

async function eliminarRubro(rubroId) {
  if (lineasDeRubro(rubroId).length) { showToast('Vaciá el rubro antes de eliminarlo.', 'error'); return; }
  const rubro = rubros.find(r => r.key === rubroId);
  const ok = await showConfirm('Eliminar rubro', `¿Eliminar "${rubro ? rubro.nombre || '(sin nombre)' : rubroId}"?`);
  if (!ok) return;
  rubros = rubros.filter(r => r.key !== rubroId);
  renderTodo();
  try {
    await _fbDel(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`);
  } catch (_) {
    showToast('Error al eliminar el rubro.', 'error');
  }
}

function crearLineaEnRubro(rubroId) {
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const grupo = lineasDeRubro(rubroId);
  const orden = grupo.length ? Math.max(...grupo.map(([, l]) => l.orden || 0)) + 1 : 1;
  lineas[lineaKey] = { rubroId, nombre: '', unidad: '', cantidad: null, itemKey: null, orden, creadoEn: Date.now() };
  renderTodo();
  persistLineaNueva(lineaKey);
  setTimeout(() => {
    const input = document.querySelector(`.computo-linea[data-key="${CSS.escape(lineaKey)}"] .linea-nombre`);
    if (input) input.focus();
  }, 50);
}

function moverLinea(lineaKey, dir, aux) {
  const grupo = grupoDe(lineaKey, aux);
  const idx = grupo.findIndex(([k]) => k === lineaKey);
  const otroIdx = idx + dir;
  if (idx < 0 || otroIdx < 0 || otroIdx >= grupo.length) return;
  const [, a] = grupo[idx], [, b] = grupo[otroIdx];
  const ordenA = a.orden, ordenB = b.orden;
  a.orden = ordenB; b.orden = ordenA;
  renderTodo();
  persistLineaCambios(grupo[idx][0], { orden: a.orden }, aux);
  persistLineaCambios(grupo[otroIdx][0], { orden: b.orden }, aux);
}

function moverLineaARubro(lineaKey, rubroIdDestino) {
  const linea = lineas[lineaKey];
  if (!linea || linea.rubroId === rubroIdDestino) return;
  const grupoDestino = lineasDeRubro(rubroIdDestino);
  const nuevoOrden = grupoDestino.length ? Math.max(...grupoDestino.map(([, l]) => l.orden || 0)) + 1 : 1;
  updateLinea(lineaKey, { rubroId: rubroIdDestino, orden: nuevoOrden });
}

// No copia el itemKey del original: cada línea tiene su propio AP (se llama
// tal cual sale la línea), así que la copia arranca sin vincular — el AP
// original se puede traer con "Usar como base" desde el AP de la nueva línea
// si hace falta la misma receta.
function duplicarLinea(lineaKey, aux) {
  const datos = tienda(aux).datos;
  const original = datos[lineaKey];
  const nuevaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const grupo = grupoDe(lineaKey, aux);
  const orden = grupo.length ? Math.max(...grupo.map(([, l]) => l.orden || 0)) + 1 : 1;
  datos[nuevaKey] = {
    rubroId: original.rubroId || null,
    nombre: (original.nombre || '') + ' (copia)',
    unidad: original.unidad || '',
    cantidad: original.cantidad ?? null,
    cantidadFormula: original.cantidadFormula || null,
    itemKey: null,
    orden,
    creadoEn: Date.now(),
  };
  renderTodo();
  persistLineaNueva(nuevaKey, aux);
}

async function deleteLinea(lineaKey, aux) {
  const t = tienda(aux);
  delete t.datos[lineaKey];
  renderTodo();
  try {
    await _fbDel(`/obras/${obraKey}/${t.nodo}/${lineaKey}.json`);
  } catch (_) {
    showToast('Error al eliminar la línea.', 'error');
  }
  showToast('Línea eliminada.');
}

/* Alta de un análisis auxiliar. Nace vacío y sin AP: el ícono de Análisis de
   Precio de la fila lo crea y lo vincula solo (item.html?aux=…), igual que una
   línea nueva del Cómputo. */
function crearAuxiliar() {
  const auxKey = 'aux_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const ordenes = Object.values(auxiliares).map(a => a.orden || 0);
  auxiliares[auxKey] = {
    nombre: '', unidad: '', cantidad: null, itemKey: null,
    orden: ordenes.length ? Math.max(...ordenes) + 1 : 1,
    creadoEn: Date.now(),
  };
  renderTodo();
  persistLineaNueva(auxKey, true);
  setTimeout(() => {
    const input = document.querySelector(`#lineas-auxiliares .computo-linea[data-key="${CSS.escape(auxKey)}"] .linea-nombre`);
    if (input) input.focus();
  }, 50);
}

// Líneas creadas antes de este esquema (rubro como texto libre por línea,
// o formato aún más viejo con itemKey obligatorio + nombreOverride +
// /computoRubros): se migran una sola vez, la primera vez que se carga
// esta obra con este código — se crea una entidad de rubro por cada texto
// distinto que ya tenían las líneas, se les asigna rubroId + orden, y
// quedan fijas de ahí en más. Si ya hay rubros creados en /rubrosComputo,
// se asume que la migración ya corrió y no se repite.
async function migrarARubrosEntidad(rubrosComputoData, computoRubrosViejo) {
  if (rubrosComputoData && Object.keys(rubrosComputoData).length) {
    rubros = Object.entries(rubrosComputoData).map(([key, r]) => ({ key, ...r }));
    return;
  }
  if (!Object.keys(lineas).length) { rubros = []; return; }

  const porTexto = {};
  const ordenTextos = [];
  Object.entries(lineas).forEach(([lineaKey, linea]) => {
    if (linea.rubroId) return; // ya tiene rubro-entidad, no debería pasar si no hay rubrosComputoData, pero por las dudas
    const it = linea.itemKey ? items.find(i => i.key === linea.itemKey) : null;
    const texto = linea.rubro || (it && (computoRubrosViejo[it.rubroKey] || rubrosMapBiblioteca[it.rubroKey])) || 'Sin rubro';
    if (!porTexto[texto]) { porTexto[texto] = []; ordenTextos.push(texto); }
    porTexto[texto].push([lineaKey, linea, it]);
  });

  const ordenados = ordenTextos.filter(t => t !== 'Sin rubro').sort((a, b) => a.localeCompare(b, 'es'));
  if (porTexto['Sin rubro']) ordenados.push('Sin rubro');

  rubros = [];
  const writes = [];
  ordenados.forEach((texto, i) => {
    const rubroId = 'rubro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + i;
    const rubroData = { nombre: texto, orden: i + 1 };
    rubros.push({ key: rubroId, ...rubroData });
    writes.push(_fbPut(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`, rubroData));
    porTexto[texto].forEach(([lineaKey, linea, it], j) => {
      const cambios = { rubroId, orden: j + 1, nombre: linea.nombre || linea.nombreOverride || (it ? it.nombre : '') || '', unidad: linea.unidad || (it ? it.unidad : '') || '' };
      lineas[lineaKey] = { ...linea, ...cambios };
      writes.push(persistLineaCambios(lineaKey, cambios));
    });
  });
  await Promise.all(writes);
}

let rubrosMapBiblioteca = {};

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, rubrosComputoData, computoRubrosViejo, auxiliaresData, itemsData, rubrosData, materialesData, equiposData, rolesData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet(`/obras/${obraKey}/rubrosComputo.json`),
    _fbGet(`/obras/${obraKey}/computoRubros.json`),
    _fbGet(`/obras/${obraKey}/auxiliares.json`),
    _fbGet('/items.json'),
    _fbGet('/rubros.json'),
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
  auxiliares = auxiliaresData || {};
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubrosMapBiblioteca = {};
  Object.entries(rubrosData || {}).forEach(([key, r]) => { rubrosMapBiblioteca[key] = r.nombre; });
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }));
  paramsEquipos = { ...paramsEquipos, ...(obra.paramsEquipos || {}) };
  paramsMO = { ...paramsMO, ...(obra.paramsMO || {}) };
  dolarObra = obra.dolar ? obra.dolar.valor : null;
  preciosObra = window.resolverPreciosObra(materiales, obraKey);

  await migrarARubrosEntidad(rubrosComputoData, computoRubrosViejo || {});

  $('header-obra-nombre').textContent = 'Cómputo — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'computo');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-rubro').addEventListener('click', () => (sinRubros() ? addItemPlano() : addRubro()));
  $('btn-add-auxiliar').addEventListener('click', crearAuxiliar);
  $('btn-computo-ia').addEventListener('click', () => {
    if (computoCargado()) return;
    window.openComputoIAModal();
  });

  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});

// Cambiar los decimales del header no vuelve a pedir datos: repinta lo que ya
// está cargado con el nuevo formato.
window.onDecimalesVista(() => { if (obra) renderTodo(); });
