/* VIMECO S.A. — Sistema de Gestión — Mano de Obra UOCRA
   Tabla general con los básicos UOCRA de cada mes, una sola zona, en
   /config/uocra/{YYYY-MM}: { oficial_especializado|oficial|ayudante:
   { basico ($/hs), noRemunerativoMensual ($/mes, o null si ese mes no hubo) },
   cargadoEn }. Las categorías son window.CATEGORIAS_UOCRA (calcCostos.js).

   Es sólo referencia: cada obra elige su mes base en Mano de Obra
   (mano-de-obra-obra.js) y ahí se COPIAN los valores a sus roles fijos. Cargar
   o corregir un mes acá no mueve ninguna obra.

   (Esta pantalla antes era la Mano de Obra global, de cuando los roles no eran
   por obra. Esos datos viejos — /manoDeObra y /config/manoDeObra — quedan en la
   base sin tocar; equipos-obra.js sigue leyendo la jornada de /config/manoDeObra.) */

const $ = id => document.getElementById(id);
const CATS = window.CATEGORIAS_UOCRA;

// [{ mes: 'YYYY-MM', ...nodo }] del más nuevo al más viejo.
let meses = [];
let editingMes = null;
let compararDesde = null;

const vacio = n => n == null || isNaN(n);
const variacion = (actual, previo) =>
  (vacio(actual) || vacio(previo) || !previo) ? null : actual / previo - 1;

function celdaVar(v) {
  if (v == null) return '';
  const cls = v > 0 ? 'cmp-sube' : v < 0 ? 'cmp-baja' : '';
  return `<div class="${cls}" style="font-size:.68rem;">${v > 0 ? '+' : ''}${fmtPct(v)}</div>`;
}

function renderTabla() {
  const cont = $('uocra-tabla');
  if (!meses.length) {
    cont.innerHTML = '<div class="list-empty">No hay meses cargados todavía.</div>';
    $('uocra-comparar-wrap').classList.add('hidden');
    return;
  }
  // La columna del no remunerativo aparece sólo si algún mes lo tiene.
  const hayNoRem = meses.some(m => CATS.some(c => !vacio(m[c.key] && m[c.key].noRemunerativoMensual)));

  const head = CATS.map(c => `<th class="num">${escHtml(c.nombre)}<br><span style="font-weight:400;">Básico $/hs</span></th>`
    + (hayNoRem ? `<th class="num">${escHtml(c.nombre)}<br><span style="font-weight:400;">No rem. $/mes</span></th>` : '')).join('');

  const filas = meses.map((m, i) => {
    const previo = meses[i + 1];
    const celdas = CATS.map(c => {
      const v = m[c.key] || {};
      const p = (previo && previo[c.key]) || {};
      return `<td class="num">${vacio(v.basico) ? '—' : fmtARS(v.basico)}${celdaVar(variacion(v.basico, p.basico))}</td>`
        + (hayNoRem ? `<td class="num">${vacio(v.noRemunerativoMensual) ? '—' : fmtARS(v.noRemunerativoMensual)}${celdaVar(variacion(v.noRemunerativoMensual, p.noRemunerativoMensual))}</td>` : '');
    }).join('');
    return `<tr data-mes="${escHtml(m.mes)}" title="Clic para editar"><td>${escHtml(window.fmtMesUocra(m.mes))}</td>${celdas}</tr>`;
  }).join('');

  // Acumulado del mes elegido al último cargado.
  let pie = '';
  const desde = meses.find(m => m.mes === compararDesde);
  if (desde && meses.length > 1 && desde !== meses[0]) {
    const ultimo = meses[0];
    const celdas = CATS.map(c => {
      const a = ultimo[c.key] || {};
      const d = desde[c.key] || {};
      return `<td class="num">${celdaVar(variacion(a.basico, d.basico)) || '—'}</td>`
        + (hayNoRem ? `<td class="num">${celdaVar(variacion(a.noRemunerativoMensual, d.noRemunerativoMensual)) || '—'}</td>` : '');
    }).join('');
    pie = `<tfoot><tr><td><strong>Acumulado</strong><div class="form-hint" style="margin:0;">${escHtml(window.fmtMesUocra(desde.mes))} → ${escHtml(window.fmtMesUocra(ultimo.mes))}</div></td>${celdas}</tr></tfoot>`;
  }

  cont.innerHTML = `<div class="cmp-wrap"><table class="cmp-tabla">
    <thead><tr><th>Mes</th>${head}</tr></thead>
    <tbody>${filas}</tbody>${pie}
  </table></div>`;
  cont.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => openModal(meses.find(m => m.mes === tr.dataset.mes)));
  });
}

function renderComparar() {
  const wrap = $('uocra-comparar-wrap');
  const viejos = meses.slice(1);
  wrap.classList.toggle('hidden', !viejos.length);
  if (!viejos.length) { compararDesde = null; return; }
  // Por defecto, desde el más viejo cargado.
  if (!viejos.some(m => m.mes === compararDesde)) compararDesde = viejos[viejos.length - 1].mes;
  $('uocra-comparar').innerHTML = viejos.map(m =>
    `<option value="${escHtml(m.mes)}"${m.mes === compararDesde ? ' selected' : ''}>${escHtml(window.fmtMesUocra(m.mes))}</option>`).join('');
}

async function loadAll() {
  try {
    const data = await _fbGet('/config/uocra.json');
    meses = Object.entries(data || {}).map(([mes, m]) => ({ mes, ...m }))
      .sort((a, b) => b.mes.localeCompare(a.mes));
    renderComparar();
    renderTabla();
  } catch (_) {
    $('uocra-tabla').innerHTML = '<div class="list-empty">Error al cargar los meses.</div>';
  }
}

function openModal(m) {
  editingMes = m ? m.mes : null;
  $('modal-mes-title').textContent = m ? 'Editar ' + window.fmtMesUocra(m.mes) : 'Cargar mes';
  $('modal-mes-error').classList.add('hidden');
  $('modal-mes-del').classList.toggle('hidden', !m);
  $('mes-mes').disabled = !!m;
  if (m) {
    $('mes-mes').value = m.mes;
  } else {
    // Sugerencia: el mes siguiente al último cargado, o el actual.
    let sug = new Date().toISOString().slice(0, 7);
    if (meses.length) {
      const [y, mm] = meses[0].mes.split('-').map(Number);
      sug = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
    }
    $('mes-mes').value = sug;
  }
  // Un mes nuevo arranca con los valores del último, que suelen cambiar poco.
  const base = m || meses[0] || {};
  CATS.forEach(c => {
    const v = base[c.key] || {};
    $(`mes-${c.key}-basico`).value = formatMoneyString(v.basico);
    $(`mes-${c.key}-norem`).value = m ? formatMoneyString(v.noRemunerativoMensual) : '';
  });
  $('modal-mes').classList.remove('hidden');
  setTimeout(() => $(`mes-${CATS[0].key}-basico`).focus(), 50);
}

function cerrarModal() {
  $('modal-mes').classList.add('hidden');
}

async function saveModal() {
  const errEl = $('modal-mes-error');
  const error = msg => { errEl.textContent = msg; errEl.classList.remove('hidden'); };
  const mes = $('mes-mes').value;
  if (!/^\d{4}-\d{2}$/.test(mes)) return error('Elegí el mes.');
  if (!editingMes && meses.some(m => m.mes === mes)) {
    return error(`${window.fmtMesUocra(mes)} ya está cargado: editalo desde la tabla.`);
  }

  const nodo = { cargadoEn: Date.now() };
  for (const c of CATS) {
    const bIn = $(`mes-${c.key}-basico`);
    const nIn = $(`mes-${c.key}-norem`);
    [bIn, nIn].forEach(el => { if (el.value.trim().startsWith('=')) el.blur(); });
    const basico = parseMoneyString(bIn.value);
    if (isNaN(basico) || basico <= 0) return error(`Falta el básico de ${c.nombre}.`);
    const noRemStr = nIn.value.trim();
    const noRem = noRemStr ? parseMoneyString(noRemStr) : null;
    if (noRem != null && (isNaN(noRem) || noRem < 0)) return error(`El no remunerativo de ${c.nombre} no es válido.`);
    nodo[c.key] = { basico, noRemunerativoMensual: noRem };
  }

  const btn = $('modal-mes-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    // PUT del nodo del mes entero: no tiene hijos que lleguen por otro lado.
    await _fbPut(`/config/uocra/${mes}.json`, nodo);
    cerrarModal();
    showToast(`${window.fmtMesUocra(mes)} guardado.`);
    await loadAll();
  } catch (_) {
    error('Error al guardar. Intentá de nuevo.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

async function deleteMes() {
  const mes = editingMes;
  if (!mes) return;
  const ok = await showConfirm('Eliminar mes',
    `¿Eliminar ${window.fmtMesUocra(mes)}? Las obras que lo usaron como base no cambian: ya tienen los valores copiados.`);
  if (!ok) return;
  try {
    await _fbDel(`/config/uocra/${mes}.json`);
    cerrarModal();
    showToast(`${window.fmtMesUocra(mes)} eliminado.`);
    await loadAll();
  } catch (_) {
    showToast('Error al eliminar el mes.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('mes-categorias').innerHTML = CATS.map(c => `
    <div class="form-row">
      <div class="form-group">
        <label for="mes-${c.key}-basico">${escHtml(c.nombre)} · Básico ($/hs) *</label>
        <input type="text" id="mes-${c.key}-basico" class="form-control">
      </div>
      <div class="form-group">
        <label for="mes-${c.key}-norem">No remunerativo ($/mes)</label>
        <input type="text" id="mes-${c.key}-norem" class="form-control">
      </div>
    </div>`).join('');
  CATS.forEach(c => ['basico', 'norem'].forEach(campo => {
    attachCalcInput($(`mes-${c.key}-${campo}`));
    attachMoneyInput($(`mes-${c.key}-${campo}`));
  }));

  $('btn-add-mes').addEventListener('click', () => openModal(null));
  $('modal-mes-close').addEventListener('click', cerrarModal);
  $('modal-mes-cancel').addEventListener('click', cerrarModal);
  $('modal-mes-save').addEventListener('click', saveModal);
  $('modal-mes-del').addEventListener('click', deleteMes);
  $('uocra-comparar').addEventListener('change', e => { compararDesde = e.target.value; renderTabla(); });

  loadAll();
});

window.onDecimalesVista(() => renderTabla());

/* Esta pantalla no escucha la base en tiempo real: después de un Ctrl+Z
   (js/undo.js) vuelve a pedir los datos y se repinta. */
window.registrarRecargaUndo(loadAll);
