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
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};   // { materialKey: {precioUSD,...} } — resuelto de los precios por obra de esta obra
let dolarObra = null;   // dólar propio de esta obra (/obras/{obraKey}/dolar)
let draggedLineaKey = null;
let draggedRubroId = null;

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
  // Para que un ítem que use un auxiliar como insumo cueste lo mismo acá que
  // en su A.P., Carga Fija, Presupuesto y Plan de Avance (ver
  // calcCostoUnitarioItem, calcCostos.js).
  const auxiliaresArr = Object.entries(auxiliares || {}).map(([key, a]) => ({ key, ...a }));
  const catalogos = { materiales, equipos, roles, auxiliares: auxiliaresArr, items, obraKey };
  const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra);
  return r.costoUnitario;
}

/* Costo cargado a mano (ver js/apDirecto.js). La celda de costo de una línea
   es editable mientras el ítem no tenga un análisis armado: sin ítem todavía,
   con el A.P. vacío, o con un precio directo ya cargado (que se reescribe).
   Con materiales/equipos/mano de obra adentro, el costo lo manda el A.P. y la
   celda vuelve a ser de sólo lectura — un ítem tiene una cosa o la otra. */
function versionDeItemKey(itemKey) {
  const it = itemKey && items.find(i => i.key === itemKey);
  return it ? versionDe(it) : null;
}

function costoDirectoEditable(linea) {
  if (window._soloLectura) return false;
  const version = versionDeItemKey(linea.itemKey);
  return !version || window.apAceptaPrecioDirecto(version.lineas);
}

function lineaDirectaDeLinea(linea) {
  const version = versionDeItemKey(linea.itemKey);
  const entrada = version ? window.lineaDirectaDe(version.lineas) : null;
  return entrada ? entrada[1] : null;
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

/* Subrubros (ver js/numeracion.js): un rubro con `padreId` cuelga de ese
   rubro principal. Un solo nivel: si el padre no existe o es a su vez un
   subrubro, el rubro vale como principal — la misma regla que la numeración. */
function padreDe(rubro) {
  const p = rubro.padreId && rubros.find(r => r.key === rubro.padreId);
  return p && !p.padreId ? p.key : null;
}
function subrubrosDe(rubroId) {
  return rubros.filter(r => padreDe(r) === rubroId);
}
// Principales entre sí, o los subrubros de un mismo rubro — en orden.
function hermanosDe(rubro) {
  const p = padreDe(rubro);
  return rubros.filter(r => padreDe(r) === p);
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
  return `<input type="text" class="${clase} computo-codigo-input" data-codigo-tipo="${tipo}" data-codigo-key="${escHtml(entidad.key)}" value="${escHtml(aMano)}" placeholder="${escHtml(codigoAuto)}" title="Código del pliego — vacío usa la numeración automática" ${window._soloLectura ? 'disabled' : ''}>`;
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

/* `esPrimero` / `esUltimo` son entre hermanos: un principal sube y baja entre
   principales, un subrubro entre los subrubros de su rubro. Un principal con
   subrubros no lleva ítems propios: no tiene "+" ni lugar donde soltar líneas,
   y su subtotal es la suma de los de sus subrubros. */
function renderRubroHeader(rubro, numero, numeroAuto, esPrimero, esUltimo) {
  const sub = !!padreDe(rubro);
  const hijos = subrubrosDe(rubro.key);
  const grupoLineas = [rubro, ...hijos].flatMap(r => lineasDeRubro(r.key));
  const vacio = !grupoLineas.length && !hijos.length;
  const ro = !!window._soloLectura;
  const tituloDel = vacio ? 'Eliminar rubro'
    : hijos.length ? 'Sacá o eliminá sus subrubros antes de eliminarlo' : 'Vaciá el rubro antes de eliminarlo';
  // ⇥ cuelga el rubro del principal de arriba; ⇤ lo devuelve a principal.
  const botonNivel = sub
    ? `<button class="computo-rubro-nivel" data-rubro-id="${escHtml(rubro.key)}" data-accion="sacar" title="Volver a rubro principal" ${ro ? 'disabled' : ''}>${icSvg('outdent')}</button>`
    : `<button class="computo-rubro-nivel" data-rubro-id="${escHtml(rubro.key)}" data-accion="meter" title="${hijos.length ? 'Un rubro con subrubros no puede pasar a subrubro' : 'Pasar a subrubro del rubro de arriba'}" ${esPrimero || hijos.length || ro ? 'disabled' : ''}>${icSvg('indent')}</button>`;
  const botonAgregar = hijos.length ? '' :
    `<button class="computo-rubro-add-linea" data-rubro-id="${escHtml(rubro.key)}" title="Agregar ítem en este ${sub ? 'subrubro' : 'rubro'}" ${ro ? 'disabled' : ''}>${icSvg('plus')}</button>`;
  // Las líneas sueltas de un principal con subrubros sólo pueden venir de un
  // dato viejo: se muestran igual, pero no se ofrece soltar más ahí.
  const conLineas = !hijos.length || lineasDeRubro(rubro.key).length;
  return `
    <div class="computo-rubro-header${sub ? ' computo-subrubro' : ''}" data-rubro-id="${escHtml(rubro.key)}" draggable="${ro ? 'false' : 'true'}">
      ${celdaNumero('computo-rubro-numero', 'rubro', rubro, numero, numeroAuto, '.')}
      <input type="text" class="form-control computo-rubro-nombre-input" data-rubro-id="${escHtml(rubro.key)}" value="${escHtml(rubro.nombre || '')}" placeholder="${sub ? 'Nombre del subrubro' : 'Nombre del rubro'}" ${ro ? 'disabled' : ''}>
      <span class="computo-rubro-acciones">
        ${botonAgregar}
        ${botonNivel}
        <button class="computo-rubro-mover" data-rubro-id="${escHtml(rubro.key)}" data-dir="-1" title="Subir ${sub ? 'subrubro' : 'rubro'}" ${esPrimero || ro ? 'disabled' : ''}>${icSvg('arrowUp')}</button>
        <button class="computo-rubro-mover" data-rubro-id="${escHtml(rubro.key)}" data-dir="1" title="Bajar ${sub ? 'subrubro' : 'rubro'}" ${esUltimo || ro ? 'disabled' : ''}>${icSvg('arrowDown')}</button>
        <button class="computo-rubro-del" data-rubro-id="${escHtml(rubro.key)}" title="${tituloDel}" ${vacio && !ro ? '' : 'disabled'}>${icSvg('x')}</button>
      </span>
      <span class="computo-rubro-subtotal"${calcAttrs(subtotalGrupo(grupoLineas), `computo:rubro:${rubro.key}:subtotal`, `${numero}. ${rubro.nombre || 'Rubro'} · Subtotal`)}>${fmtARS(subtotalGrupo(grupoLineas))}</span>
    </div>
    ${conLineas ? `<div class="computo-rubro-lineas${sub ? ' computo-subrubro-lineas' : ''}" data-rubro-id="${escHtml(rubro.key)}"></div>` : ''}`;
}

/* La celda de costo unitario: campo de plata cuando se puede cargar a mano,
   texto cuando el costo lo manda el A.P. del ítem.

   En vista US$ vuelve a ser texto aunque se pueda editar: todo se guarda y se
   calcula en pesos, y los campos editables quedaron deliberadamente afuera del
   toggle para que no haya conversiones de ida y vuelta sobre un dato real (ver
   js/moneda.js). El title lo explica en vez de dejar la celda muda. */
function celdaCosto(lineaKey, linea, costo, pre, etiqueta) {
  const attrs = calcAttrs(costo, `${pre}:${lineaKey}:costoUnit`, etiqueta + ' · Costo unit.');
  if (!costoDirectoEditable(linea)) {
    const conAP = !!linea.itemKey;
    const title = conAP ? 'El costo sale del Análisis de Precio de este ítem' : '';
    return `<span class="computo-linea-costo"${attrs}${title ? ` title="${escHtml(title)}"` : ''}>${fmtARS(costo)}</span>`;
  }
  if (window.monedaVista() === 'USD') {
    return `<span class="computo-linea-costo"${attrs} title="Pasá la vista a $ para cargar el costo">${fmtARS(costo)}</span>`;
  }
  return `<input type="text" class="form-control linea-costo" placeholder="Costo" data-calc-id="${pre}:${escHtml(lineaKey)}:costoUnit" data-calc-label="${escHtml(etiqueta + ' · Costo unit.')}" title="Costo del ítem cargado a mano — queda guardado en su Análisis de Precio">`;
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
  const ro = !!window._soloLectura;
  return `
    <div class="computo-linea" data-key="${escHtml(lineaKey)}" draggable="${aux || sinRubros() || ro ? 'false' : 'true'}">
      ${celda}
      <input type="text" class="form-control linea-nombre" placeholder="Ítem" value="${escHtml(linea.nombre || '')}" ${ro ? 'disabled' : ''}>
      <input type="text" class="form-control linea-unidad" placeholder="Unidad" value="${escHtml(linea.unidad || '')}" ${ro ? 'disabled' : ''}>
      <input type="text" class="form-control linea-cantidad" placeholder="Cantidad" data-calc-id="${pre}:${escHtml(lineaKey)}:cantidad" data-calc-label="${escHtml(etiqueta + ' · Cantidad')}" ${ro ? 'disabled' : ''}>
      ${celdaCosto(lineaKey, linea, costo, pre, etiqueta)}
      <span class="computo-linea-total"${calcAttrs(total, `${pre}:${lineaKey}:total`, etiqueta + ' · Total')}>${fmtARS(total)}</span>
      <span class="computo-linea-acciones">
        <button class="computo-linea-mover" data-dir="-1" title="Subir" ${esPrimero || ro ? 'disabled' : ''}>${icSvg('arrowUp')}</button>
        <button class="computo-linea-mover" data-dir="1" title="Bajar" ${esUltimo || ro ? 'disabled' : ''}>${icSvg('arrowDown')}</button>
        <button class="computo-linea-dup" title="Duplicar" ${ro ? 'disabled' : ''}>${icSvg('copy')}</button>
        <a class="computo-linea-ap" href="${hrefAP}" title="Análisis de Precio">${icSvg('layers')}</a>
        <button class="computo-linea-del" title="Eliminar línea" ${ro ? 'disabled' : ''}>${icSvg('x')}</button>
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

  // Los códigos de subrubro ("5.1.1") necesitan una primera columna más ancha.
  container.classList.toggle('con-subrubros', num.rubros.some(r => r.nivel === 2));
  // En orden de lectura: cada principal seguido de sus subrubros.
  const enLectura = num.rubros.map(m => rubros.find(r => r.key === m.key));
  container.innerHTML = header + enLectura.map(rubro => {
    const hermanos = hermanosDe(rubro);
    return renderRubroHeader(rubro, num.codigoDeRubro[rubro.key], num.autoDeRubro[rubro.key],
      hermanos[0] === rubro, hermanos[hermanos.length - 1] === rubro);
  }).join('');

  enLectura.forEach(rubro => {
    const lineasContainer = container.querySelector(`.computo-rubro-lineas[data-rubro-id="${CSS.escape(rubro.key)}"]`);
    if (!lineasContainer) return;
    const grupoLineas = lineasDeRubro(rubro.key);
    lineasContainer.innerHTML = grupoLineas.length
      ? grupoLineas.map(([k, l], i) => renderLineaRow(k, l, num.codigoDeLinea[k], num.autoDeLinea[k],
          i === 0, i === grupoLineas.length - 1)).join('')
      : '<p class="text-muted" style="font-size:.8rem;padding:.4rem 0;">Sin líneas en este rubro todavía.</p>';

    // Sólo líneas: un rubro arrastrado se suelta sobre otra cabecera.
    lineasContainer.addEventListener('dragover', e => { if (!draggedLineaKey) return; e.preventDefault(); lineasContainer.classList.add('drop-target'); });
    lineasContainer.addEventListener('dragleave', () => lineasContainer.classList.remove('drop-target'));
    lineasContainer.addEventListener('drop', e => {
      e.preventDefault();
      lineasContainer.classList.remove('drop-target');
      if (draggedLineaKey) moverLineaARubro(draggedLineaKey, rubro.key);
    });
  });

  engancharArrastreRubros(container);

  container.querySelectorAll('.computo-rubro-nombre-input').forEach(input => {
    const rubroId = input.dataset.rubroId;
    input.addEventListener('blur', () => {
      if (guardBloqueoObra()) return;
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
  container.querySelectorAll('.computo-rubro-nivel').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (btn.dataset.accion === 'meter') pasarASubrubro(btn.dataset.rubroId);
      else volverARubroPrincipal(btn.dataset.rubroId);
    });
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
      if (guardBloqueoObra()) return;
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

    // Costo cargado a mano: sólo existe el campo si el ítem no tiene análisis
    // armado (ver celdaCosto). Lo que se escribe acá termina en la receta del
    // ítem, no en esta línea — ver guardarCostoDirecto.
    const costoInput = row.querySelector('.linea-costo');
    if (costoInput) {
      const directa = lineaDirectaDeLinea(linea);
      const precio = directa && directa.precio != null && !isNaN(directa.precio) ? Number(directa.precio) : null;
      const formulaPrevia = (directa && directa.precioFormula) || null;
      costoInput.dataset.calcValor = precio ?? 0;
      attachCalcInput(costoInput, formulaPrevia);
      attachMoneyInput(costoInput);
      attachValorInput(costoInput, precio);
      costoInput.addEventListener('blur', () => {
        const n = valorCampo(costoInput);
        const formula = getCalcFormula(costoInput);
        if (n === precio && formula === formulaPrevia) return;
        guardarCostoDirecto(lineaKey, n, formula, aux);
      });
      costoInput.addEventListener('keydown', e => { if (e.key === 'Enter') costoInput.blur(); });
    }

    row.querySelectorAll('.computo-linea-mover').forEach(btn => {
      btn.addEventListener('click', () => moverLinea(lineaKey, parseInt(btn.dataset.dir, 10), aux));
    });
    row.querySelector('.computo-linea-dup').addEventListener('click', () => duplicarLinea(lineaKey, aux));
    row.querySelector('.computo-linea-del').addEventListener('click', () => deleteLinea(lineaKey, aux));
  });
}

/* Guarda el costo escrito en la celda. Lo que se toca es la receta del ítem
   (/items/…/versionesObra/{obra}/lineas/directo, ver js/apDirecto.js), no esta
   línea: por eso el número aparece igual en el A.P., en el Presupuesto y en
   todo lo que cuelga del costo del Cómputo.

   Las escrituras van agrupadas: cargar un costo en una línea que todavía no
   tiene ítem son tres (el ítem, su versión, el vínculo) más la del precio, y
   es un solo gesto del usuario — un solo Ctrl+Z. Las raíces van en null
   porque /items es un nodo compartido entre obras: reponer su foto borraría lo
   que otro haya agregado ahí mientras tanto (ver CLAUDE.md). */
async function guardarCostoDirecto(lineaKey, precio, formula, aux) {
  if (guardBloqueoObra()) return;
  const t = tienda(aux);
  const linea = t.datos[lineaKey];
  if (!linea) return;
  // Vaciar la celda de una línea que nunca tuvo ítem no crea nada.
  if (precio == null && !linea.itemKey) return;
  try {
    await window.undoAgrupar('Costo del ítem', null, async () => {
      let itemKey = linea.itemKey;
      if (!itemKey) {
        itemKey = await window.asegurarItemDeLinea(obraKey, t.nodo, lineaKey);
        if (!itemKey) return;
        linea.itemKey = itemKey;
      }
      if (precio == null) await window.borrarPrecioDirecto(itemKey, obraKey);
      else await window.guardarPrecioDirecto(itemKey, obraKey, { precio, precioFormula: formula });
      aplicarDirectaEnMemoria(itemKey, linea, precio, formula);
    });
  } catch (_) {
    showToast('Error al guardar el costo del ítem.', 'error');
  }
  renderTodo();
}

// El ítem local, para que la pantalla repinte con el costo nuevo sin volver a
// leer /items entero. Un ítem recién creado todavía no está en la lista.
function aplicarDirectaEnMemoria(itemKey, linea, precio, formula) {
  let it = items.find(i => i.key === itemKey);
  if (!it) {
    it = { key: itemKey, nombre: linea.nombre || '', unidad: linea.unidad || '', versionesObra: {} };
    items.push(it);
  }
  it.versionesObra = it.versionesObra || {};
  const version = it.versionesObra[obraKey] || (it.versionesObra[obraKey] = { rendimiento: 1 });
  version.lineas = version.lineas || {};
  if (precio == null) delete version.lineas[window.LINEA_DIRECTA_KEY];
  else version.lineas[window.LINEA_DIRECTA_KEY] = window.lineaDirectaNueva(precio, formula);
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
  btn.disabled = computoCargado() || !!window._soloLectura;
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
  // El costo cargado a mano también puede ser una fórmula que apunta a otra
  // celda. Vive en la receta del ítem, así que se reescribe allá (y en el
  // objeto en memoria, que es el mismo que lee el render).
  const camposDirectosDe = aux => Object.entries(tienda(aux).datos)
    .map(([lineaKey, l]) => [l, lineaDirectaDeLinea(l)])
    .filter(([l, d]) => l.itemKey && d && window.formulaTieneRefs(d.precioFormula))
    .map(([l, d]) => ({
      formula: d.precioFormula,
      valor: d.precio ?? null,
      aplicar: valor => {
        d.precio = valor;
        window.guardarPrecioDirecto(l.itemKey, obraKey, { precio: valor, precioFormula: d.precioFormula })
          .catch(() => showToast('Error al guardar el costo del ítem.', 'error'));
      },
    }));
  const campos = [...camposDe(false), ...camposDe(true), ...camposDirectosDe(false), ...camposDirectosDe(true)];
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
  if (guardBloqueoObra()) return;
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
  if (guardBloqueoObra()) return;
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
  if (guardBloqueoObra()) return;
  let rubroId = rubros.length ? rubros[0].key : null;
  if (!rubroId) {
    rubroId = 'rubro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    rubros.push({ key: rubroId, nombre: '', orden: 1 });
    await persistRubroNuevo(rubroId);
  }
  crearLineaEnRubro(rubroId);
}

// Se cambia de lugar con su vecino entre hermanos (ver hermanosDe): un
// principal se lleva a sus subrubros sin tocarlos, porque ellos se ordenan
// entre sí y no contra los principales.
function moverRubro(rubroId, dir) {
  if (guardBloqueoObra()) return;
  const rubro = rubros.find(r => r.key === rubroId);
  if (!rubro) return;
  const ordenados = hermanosDe(rubro);
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
  if (guardBloqueoObra()) return;
  if (lineasDeRubro(rubroId).length) { showToast('Vaciá el rubro antes de eliminarlo.', 'error'); return; }
  if (subrubrosDe(rubroId).length) { showToast('Sacá o eliminá sus subrubros antes de eliminarlo.', 'error'); return; }
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

/* ⇥ — el rubro pasa a colgar del principal de arriba, como su último
   subrubro. Un rubro con subrubros no lleva ítems sueltos, así que si ese
   principal tenía ítems se ofrece pasarlos a este subrubro (delante de los
   que ya tenga); si no se acepta, no cambia nada.

   Todo va por PATCH con rutas profundas, campo por campo, y en un solo gesto
   de deshacer. Las raíces van en null: el undo anota cada escritura. */
async function pasarASubrubro(rubroId) {
  if (guardBloqueoObra()) return;
  const rubro = rubros.find(r => r.key === rubroId);
  if (!rubro || padreDe(rubro) || subrubrosDe(rubroId).length) return;
  const principales = hermanosDe(rubro);
  const idx = principales.findIndex(r => r.key === rubroId);
  if (idx <= 0) return;
  const padre = principales[idx - 1];

  const sueltas = subrubrosDe(padre.key).length ? [] : lineasDeRubro(padre.key);
  if (sueltas.length) {
    const cod = window.numerarComputo(obra, rubros, lineas).codigoDeRubro[padre.key];
    const ok = await showConfirm('Pasar a subrubro',
      `"${cod}. ${padre.nombre || '(sin nombre)'}" tiene ${sueltas.length} ${sueltas.length === 1 ? 'ítem' : 'ítems'}, ` +
      `y un rubro con subrubros no puede tener ítems sueltos. ¿Pasarlos a "${rubro.nombre || '(sin nombre)'}"?`);
    if (!ok) return;
  }

  const orden = Math.max(...rubros.map(r => r.orden || 0)) + 1;
  const cambiosLineas = {};
  [...sueltas, ...lineasDeRubro(rubroId)].forEach(([key, l], i) => {
    if (l.rubroId !== rubroId) { l.rubroId = rubroId; cambiosLineas[`${key}/rubroId`] = rubroId; }
    if (l.orden !== i + 1) { l.orden = i + 1; cambiosLineas[`${key}/orden`] = i + 1; }
  });
  rubro.padreId = padre.key;
  rubro.orden = orden;
  ordenarRubros();
  renderTodo();
  try {
    await window.undoAgrupar('Pasar a subrubro', null, async () => {
      await _fbPatch(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`, { padreId: padre.key, orden });
      if (Object.keys(cambiosLineas).length) await _fbPatch(`/obras/${obraKey}/computo.json`, cambiosLineas);
    });
  } catch (_) {
    showToast('Error al guardar el rubro.', 'error');
  }
}

/* ⇤ — el subrubro vuelve a ser principal y queda justo después del bloque de
   su rubro (el rubro y todos sus subrubros). Para meterlo ahí se renumera el
   `orden` de todos en el orden en que se leen, y sólo se escriben los que
   cambiaron. */
async function volverARubroPrincipal(rubroId) {
  if (guardBloqueoObra()) return;
  const rubro = rubros.find(r => r.key === rubroId);
  const padreKey = rubro && padreDe(rubro);
  if (!padreKey) return;

  const lectura = [];
  rubros.filter(r => !padreDe(r)).forEach(p => {
    lectura.push(p, ...subrubrosDe(p.key).filter(s => s !== rubro));
    if (p.key === padreKey) lectura.push(rubro);
  });
  const cambios = { [`${rubroId}/padreId`]: null };
  lectura.forEach((r, i) => {
    if (r.orden !== i + 1) { r.orden = i + 1; cambios[`${r.key}/orden`] = i + 1; }
  });
  delete rubro.padreId;
  ordenarRubros();
  renderTodo();
  try {
    await window.undoAgrupar('Volver a rubro principal', null, async () => {
      await _fbPatch(`/obras/${obraKey}/rubrosComputo.json`, cambios);
    });
  } catch (_) {
    showToast('Error al guardar el rubro.', 'error');
  }
}

/* Arrastrar una cabecera de rubro. Se suelta sobre otra del mismo nivel: un
   principal entre principales (se lleva sus subrubros), un subrubro entre
   subrubros — de su rubro o de otro, y en ese caso pasa a ese rubro. La mitad
   de la cabecera donde se suelta decide si queda antes o después. */
function puedeSoltarRubro(origenId, destinoId) {
  if (!origenId || origenId === destinoId) return false;
  const o = rubros.find(r => r.key === origenId), d = rubros.find(r => r.key === destinoId);
  return !!(o && d) && !padreDe(o) === !padreDe(d);
}

function engancharArrastreRubros(container) {
  const limpiar = h => h.classList.remove('drop-antes', 'drop-despues');
  container.querySelectorAll('.computo-rubro-header[data-rubro-id]').forEach(h => {
    const rubroId = h.dataset.rubroId;
    h.addEventListener('dragstart', e => {
      // El arrastre empieza en la cabecera, no en un campo de texto de adentro.
      if (e.target !== h) return;
      draggedRubroId = rubroId;
      h.classList.add('dragging');
    });
    h.addEventListener('dragend', () => {
      draggedRubroId = null;
      h.classList.remove('dragging');
      container.querySelectorAll('.drop-antes, .drop-despues').forEach(limpiar);
    });
    h.addEventListener('dragover', e => {
      if (!puedeSoltarRubro(draggedRubroId, rubroId)) return;
      e.preventDefault();
      const r = h.getBoundingClientRect();
      const despues = e.clientY > r.top + r.height / 2;
      h.classList.toggle('drop-antes', !despues);
      h.classList.toggle('drop-despues', despues);
    });
    h.addEventListener('dragleave', () => limpiar(h));
    h.addEventListener('drop', e => {
      if (!puedeSoltarRubro(draggedRubroId, rubroId)) return;
      e.preventDefault();
      const despues = h.classList.contains('drop-despues');
      limpiar(h);
      soltarRubro(draggedRubroId, rubroId, despues);
    });
  });

  /* Un subrubro soltado entre los ítems de otro subrubro corta la lista ahí:
     queda justo después de ese subrubro y se lleva los ítems de abajo del
     corte, delante de los suyos. Sólo entre subrubros: cortar los ítems de un
     rubro sin subrubros dejaría sueltos los de arriba. */
  const subrubroDeLinea = row => {
    const l = lineas[row.dataset.key];
    const r = l && rubros.find(x => x.key === l.rubroId);
    return r && padreDe(r) ? r : null;
  };
  const puedeCortar = row => {
    const o = draggedRubroId && rubros.find(r => r.key === draggedRubroId);
    const t = subrubroDeLinea(row);
    return !!(o && t && padreDe(o) && t.key !== o.key);
  };
  container.querySelectorAll('.computo-rubro-lineas .computo-linea[data-key]').forEach(row => {
    row.addEventListener('dragover', e => {
      if (!puedeCortar(row)) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const despues = e.clientY > r.top + r.height / 2;
      row.classList.toggle('drop-antes', !despues);
      row.classList.toggle('drop-despues', despues);
    });
    row.addEventListener('dragleave', () => limpiar(row));
    row.addEventListener('drop', e => {
      if (!puedeCortar(row)) return;
      e.preventDefault();
      const despues = row.classList.contains('drop-despues');
      limpiar(row);
      soltarSubrubroEntreItems(draggedRubroId, row.dataset.key, despues);
    });
  });
}

function soltarSubrubroEntreItems(subrubroId, lineaKey, despues) {
  const destinoId = lineas[lineaKey].rubroId;
  const grupo = lineasDeRubro(destinoId);
  const corte = grupo.findIndex(([k]) => k === lineaKey) + (despues ? 1 : 0);
  soltarRubro(subrubroId, destinoId, true, grupo.slice(corte));
}

// Arma el orden de lectura nuevo con el rubro ya en su lugar y renumera el
// `orden` de todos; sólo se escriben los que cambiaron, en un solo gesto.
// `movidas`: líneas que pasan al rubro soltado, delante de las suyas (ver
// soltarSubrubroEntreItems).
async function soltarRubro(origenId, destinoId, despues, movidas) {
  if (guardBloqueoObra()) return;
  const origen = rubros.find(r => r.key === origenId);
  const destino = rubros.find(r => r.key === destinoId);
  if (!origen || !destino) return;
  const esSub = !!padreDe(origen);
  const padreNuevo = esSub ? padreDe(destino) : null;

  const ubicar = lista => {
    const sin = lista.filter(r => r !== origen);
    const i = sin.indexOf(destino);
    sin.splice(despues ? i + 1 : i, 0, origen);
    return sin;
  };
  const principales = rubros.filter(r => !padreDe(r));
  const lectura = [];
  (esSub ? principales : ubicar(principales)).forEach(p => {
    const hijos = subrubrosDe(p.key).filter(s => s !== origen);
    lectura.push(p, ...(esSub && p.key === padreNuevo ? ubicar([...hijos, origen]) : hijos));
  });

  const cambios = {};
  if (esSub && origen.padreId !== padreNuevo) {
    origen.padreId = padreNuevo;
    cambios[`${origenId}/padreId`] = padreNuevo;
  }
  lectura.forEach((r, i) => {
    if (r.orden !== i + 1) { r.orden = i + 1; cambios[`${r.key}/orden`] = i + 1; }
  });
  const cambiosLineas = {};
  if (movidas && movidas.length) {
    [...movidas, ...lineasDeRubro(origenId)].forEach(([key, l], i) => {
      if (l.rubroId !== origenId) { l.rubroId = origenId; cambiosLineas[`${key}/rubroId`] = origenId; }
      if (l.orden !== i + 1) { l.orden = i + 1; cambiosLineas[`${key}/orden`] = i + 1; }
    });
  }
  if (!Object.keys(cambios).length && !Object.keys(cambiosLineas).length) return;
  ordenarRubros();
  renderTodo();
  try {
    await window.undoAgrupar('Mover rubro', null, async () => {
      if (Object.keys(cambios).length) await _fbPatch(`/obras/${obraKey}/rubrosComputo.json`, cambios);
      if (Object.keys(cambiosLineas).length) await _fbPatch(`/obras/${obraKey}/computo.json`, cambiosLineas);
    });
  } catch (_) {
    showToast('Error al guardar el rubro.', 'error');
  }
}

function crearLineaEnRubro(rubroId) {
  if (guardBloqueoObra()) return;
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
  if (guardBloqueoObra()) return;
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
  if (guardBloqueoObra()) return;
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
  if (guardBloqueoObra()) return;
  const t = tienda(aux);
  const linea = t.datos[lineaKey];
  const ok = await showConfirm('Eliminar ítem', `¿Eliminar "${linea && linea.nombre || '(sin nombre)'}"?`);
  if (!ok) return;
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
  if (guardBloqueoObra()) return;
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

// -- Tiempo real ------------------------------------------------------------
// Cada escritura ya es PATCH/PUT/DELETE por línea o por rubro (ver
// persistLineaCambios/persistRubroCambios/etc. arriba) — no hay ningún PUT del
// árbol completo acá. Falta la otra mitad: enterarse solo de un cambio ajeno.
// #lineas-computo mezcla cabeceras de rubro y líneas en un solo innerHTML, y
// #lineas-auxiliares es aparte: son las dos unidades naturales para pausar el
// render sin romper el input que se está escribiendo en este momento — el
// dato igual se mezcla en memoria y se termina de pintar solo en el próximo
// blur de ese mismo campo (que ya dispara su propio render).
function focoDentroDeComputo() {
  const el = document.activeElement;
  return !!(el && el.closest && el.closest('#lineas-computo'));
}
function focoDentroDeAuxiliares() {
  const el = document.activeElement;
  return !!(el && el.closest && el.closest('#lineas-auxiliares'));
}
function lineaKeyEnFocoDentroDe(selectorContenedor) {
  const el = document.activeElement;
  if (!el || !el.closest || !el.closest(selectorContenedor)) return null;
  const row = el.closest('.computo-linea[data-key]');
  return row ? row.dataset.key : null;
}
function rubroIdEnFoco() {
  const el = document.activeElement;
  if (!el || !el.classList) return null;
  if (el.classList.contains('computo-rubro-nombre-input')) return el.dataset.rubroId;
  if (el.classList.contains('computo-codigo-input') && el.dataset.codigoTipo === 'rubro') return el.dataset.codigoKey;
  return null;
}

/* Un cambio que entra por acá puede ser de otro usuario o del propio Ctrl+Z
   (js/undo.js escribe en la base y se entera por este mismo listener). Si es el
   undo, hay que pintarlo sí o sí: ni se preserva la celda en foco ni se pausa el
   render, porque justamente lo que hay que mostrar es el valor que volvió. */
function esUndoPropio() {
  return !!(window.undoRecienAplicado && window.undoRecienAplicado());
}

function aplicarLineasRemotas(dataCruda) {
  const remoto = dataCruda || {};
  const undo = esUndoPropio();
  const key = undo ? null : lineaKeyEnFocoDentroDe('#lineas-computo');
  const anterior = JSON.stringify(lineas);
  lineas = (key && lineas[key]) ? { ...remoto, [key]: lineas[key] } : remoto;
  if (JSON.stringify(lineas) === anterior) return;
  if (!undo && focoDentroDeComputo()) return;
  renderTodo();
}

function aplicarRubrosRemotos(dataCruda) {
  const remoto = dataCruda || {};
  const undo = esUndoPropio();
  const rubroIdFoco = undo ? null : rubroIdEnFoco();
  const anterior = JSON.stringify(rubros);
  const mapaActual = Object.fromEntries(rubros.map(r => [r.key, r]));
  const mapaNuevo = Object.fromEntries(Object.entries(remoto).map(([key, r]) => [key, { key, ...r }]));
  const mapaFinal = (rubroIdFoco && mapaActual[rubroIdFoco]) ? { ...mapaNuevo, [rubroIdFoco]: mapaActual[rubroIdFoco] } : mapaNuevo;
  rubros = Object.values(mapaFinal);
  ordenarRubros();
  if (JSON.stringify(rubros) === anterior) return;
  if (!undo && focoDentroDeComputo()) return;
  renderTodo();
}

function aplicarAuxiliaresRemotos(dataCruda) {
  const remoto = dataCruda || {};
  const undo = esUndoPropio();
  const key = undo ? null : lineaKeyEnFocoDentroDe('#lineas-auxiliares');
  const anterior = JSON.stringify(auxiliares);
  auxiliares = (key && auxiliares[key]) ? { ...remoto, [key]: auxiliares[key] } : remoto;
  if (JSON.stringify(auxiliares) === anterior) return;
  if (!undo && focoDentroDeAuxiliares()) return;
  renderAuxiliares();
}

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
  window.setCotizacionObra(dolarObra);
  preciosObra = window.resolverPreciosObra(materiales, obraKey);

  // La migración corre sola al abrir la pantalla: no es un cambio del usuario,
  // así que no tiene que quedar como primer paso deshacible (js/undo.js).
  await window.undoOmitir(() => migrarARubrosEntidad(rubrosComputoData, computoRubrosViejo || {}));

  $('header-obra-nombre').textContent = 'Cómputo — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'computo');
  setModoObra(obraKey, obra, renderTodo);
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';

  window._fbListen(`/obras/${obraKey}/computo`, aplicarLineasRemotas);
  window._fbListen(`/obras/${obraKey}/rubrosComputo`, aplicarRubrosRemotos);
  window._fbListen(`/obras/${obraKey}/auxiliares`, aplicarAuxiliaresRemotos);
}

/* Moverse por la tabla con el teclado (js/navCeldas.js). Se engancha sobre los
   dos card-body, que sobreviven a cada render — adentro se reemplaza todo.
   La columna de una celda es su posición en la fila, y eso hace que las
   cabeceras de rubro entren solas en el recorrido: tienen número y nombre en
   las mismas posiciones que la línea, y no tienen unidad ni cantidad, así que
   bajando por esas dos columnas se saltean. Las dos tablas se enganchan por
   separado: un auxiliar no es parte del cómputo, no se pasa de una a la otra. */
const NAV_CELDAS_COMPUTO = '.computo-codigo-input, .computo-rubro-nombre-input, .linea-nombre, .linea-unidad, .linea-cantidad, .linea-costo';
const NAV_FILAS_COMPUTO = '.computo-rubro-header, .computo-linea[data-key]';

function engancharNavegacion() {
  window.engancharNavCeldas($('lineas-computo'), { celdas: NAV_CELDAS_COMPUTO, filas: NAV_FILAS_COMPUTO });
  window.engancharNavCeldas($('lineas-auxiliares'), { celdas: NAV_CELDAS_COMPUTO, filas: NAV_FILAS_COMPUTO });
}

document.addEventListener('DOMContentLoaded', async () => {
  engancharNavegacion();
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
