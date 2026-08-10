/* VIMECO S.A. — Sistema de Gestión — Cómputo de obra
   Cantidad de cada ítem de la Biblioteca que compone la obra. El costo
   unitario se lee en vivo de items/{key}.costoUnitarioCache (no se copia a la
   línea), así si se recalcula el Análisis de Precio del ítem el cómputo se
   actualiza solo. Es costo total de obra sin carga (sin %GG, beneficio,
   financiero ni IVA) — eso se aplica en el Presupuesto, etapa siguiente. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let lineas = {};   // { lineaKey: { itemKey, cantidad } }
let items = [];
let rubros = [];
let rubrosMap = {};

function costoUnitarioDe(itemKey) {
  const it = items.find(i => i.key === itemKey);
  return it && it.costoUnitarioCache != null ? it.costoUnitarioCache : null;
}

function totalLinea(linea) {
  const costo = costoUnitarioDe(linea.itemKey);
  if (costo == null || linea.cantidad == null || isNaN(linea.cantidad)) return null;
  return costo * linea.cantidad;
}

function itemOptions(selectedKey) {
  return rubros.map(r => {
    const opts = items.filter(it => it.rubroKey === r.key)
      .map(it => `<option value="${escHtml(it.key)}" ${it.key === selectedKey ? 'selected' : ''}>${escHtml(it.nombre)}</option>`).join('');
    return opts ? `<optgroup label="${escHtml(r.nombre)}">${opts}</optgroup>` : '';
  }).join('') + (() => {
    const sinRubro = items.filter(it => !it.rubroKey || !rubrosMap[it.rubroKey])
      .map(it => `<option value="${escHtml(it.key)}" ${it.key === selectedKey ? 'selected' : ''}>${escHtml(it.nombre)}</option>`).join('');
    return sinRubro ? `<optgroup label="Sin rubro">${sinRubro}</optgroup>` : '';
  })();
}

function renderLineas() {
  const container = $('lineas-computo');
  const entradas = Object.entries(lineas);

  if (!items.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">No hay ítems cargados en la Biblioteca todavía.</p>';
    return;
  }
  if (!entradas.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin ítems todavía.</p>';
  } else {
    container.innerHTML = entradas.map(([lineaKey, linea]) => {
      const it = items.find(i => i.key === linea.itemKey);
      const costo = costoUnitarioDe(linea.itemKey);
      const total = totalLinea(linea);
      return `
        <div class="computo-linea" data-key="${escHtml(lineaKey)}">
          <select class="form-control linea-select">${itemOptions(linea.itemKey)}</select>
          <input type="text" class="form-control linea-cantidad" value="${linea.cantidad ?? ''}" placeholder="Cantidad ${it ? escHtml(it.unidad) : ''}">
          <span class="computo-linea-costo">${costo != null ? fmtARS(costo) : '—'}</span>
          <span class="computo-linea-total">${total != null ? fmtARS(total) : '—'}</span>
          <button class="computo-linea-del" title="Eliminar línea">${icSvg('x')}</button>
        </div>`;
    }).join('');
  }

  container.querySelectorAll('.computo-linea').forEach(row => {
    const lineaKey = row.dataset.key;
    const select = row.querySelector('.linea-select');
    const cantidadInput = row.querySelector('.linea-cantidad');
    attachCalcInput(cantidadInput);
    select.addEventListener('change', () => updateLinea(lineaKey, { itemKey: select.value }));
    cantidadInput.addEventListener('blur', () => {
      const n = parseFloat(cantidadInput.value.replace(',', '.'));
      updateLinea(lineaKey, { cantidad: isNaN(n) ? null : n });
    });
    cantidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') cantidadInput.blur(); });
    row.querySelector('.computo-linea-del').addEventListener('click', () => deleteLinea(lineaKey));
  });
}

function renderResumen() {
  const total = Object.values(lineas).reduce((acc, l) => {
    const t = totalLinea(l);
    return t == null ? acc : acc + t;
  }, 0);
  $('resumen').innerHTML = `
    <div class="ap-resumen-row total"><span>Costo total del cómputo</span><span>${fmtARS(total)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">Costo sin Gastos Generales, beneficio ni IVA — eso se aplica en el Presupuesto de la obra.</p>`;
}

function renderTodo() {
  renderLineas();
  renderResumen();
}

async function persistLineas() {
  try {
    await _fbPut(`/obras/${obraKey}/computo.json`, lineas);
  } catch (_) {
    showToast('Error al guardar el cómputo.', 'error');
  }
}

function updateLinea(lineaKey, cambios) {
  lineas[lineaKey] = { ...lineas[lineaKey], ...cambios };
  renderTodo();
  persistLineas();
}

function addLinea() {
  if (!items.length) {
    showToast('No hay ítems cargados en la Biblioteca todavía.', 'error');
    return;
  }
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  lineas[lineaKey] = { itemKey: items[0].key, cantidad: null };
  renderTodo();
  persistLineas();
}

async function deleteLinea(lineaKey) {
  delete lineas[lineaKey];
  renderTodo();
  await persistLineas();
  showToast('Línea eliminada.');
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, itemsData, rubrosData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet('/items.json'),
    _fbGet('/rubros.json'),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  lineas = lineasData || {};
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubros = Object.entries(rubrosData || {}).map(([key, r]) => ({ key, ...r })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubrosMap = {};
  rubros.forEach(r => { rubrosMap[r.key] = r.nombre; });

  $('header-obra-nombre').textContent = 'Cómputo — ' + obra.nombre;
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-linea').addEventListener('click', addLinea);
  await loadAll();
});
