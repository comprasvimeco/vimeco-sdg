/* VIMECO S.A. — Combobox buscador (reemplaza <select> planos cuando el
   catálogo es grande). Vanilla, sin dependencias, mismo criterio de "helper
   que se engancha a un contenedor" que ya usa attachCalcInput (calc.js). */

window.createSearchableSelect = function (container, opts) {
  const {
    options = [],           // [{ value, label, sublabel }]
    value = null,
    placeholder = 'Buscar…',
    onChange = () => {},
    onCreateNew = null,     // (texto) => void — si se pasa, agrega "+ Crear ..."
  } = opts;

  container.innerHTML = `
    <div class="ss-wrap">
      <input type="text" class="form-control ss-input" placeholder="${escHtml(placeholder)}" autocomplete="off">
      <div class="ss-dropdown hidden"></div>
    </div>`;

  const input = container.querySelector('.ss-input');
  const dropdown = container.querySelector('.ss-dropdown');

  let currentValue = value;

  function labelFor(v) {
    const opt = options.find(o => o.value === v);
    return opt ? opt.label : '';
  }

  function renderList(query) {
    const q = query.trim().toLowerCase();
    const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;

    let html = filtered.map(o => `
      <div class="ss-option" data-value="${escHtml(o.value)}">
        <span>${escHtml(o.label)}</span>
        ${o.sublabel ? `<span class="ss-option-sub">${escHtml(o.sublabel)}</span>` : ''}
      </div>`).join('');

    if (!filtered.length) html += '<div class="ss-empty">Sin resultados.</div>';

    if (onCreateNew) {
      html += `<div class="ss-create ${query.trim() ? '' : 'disabled'}">+ Crear "${escHtml(query.trim())}"</div>`;
    }

    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.ss-option').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        currentValue = el.dataset.value;
        input.value = labelFor(currentValue);
        dropdown.classList.add('hidden');
        onChange(currentValue);
      });
    });

    const createEl = dropdown.querySelector('.ss-create:not(.disabled)');
    if (createEl) {
      createEl.addEventListener('mousedown', e => {
        e.preventDefault();
        const texto = input.value.trim();
        dropdown.classList.add('hidden');
        onCreateNew(texto);
      });
    }
  }

  input.value = labelFor(currentValue);
  input.addEventListener('focus', () => renderList(''));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown.classList.add('hidden');
      input.value = labelFor(currentValue);
    }, 150);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') input.blur(); });

  return {
    setValue(v) { currentValue = v; input.value = labelFor(v); },
    getValue() { return currentValue; },
  };
};
