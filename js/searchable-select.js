/* VIMECO S.A. — Combobox buscador (reemplaza <select> planos cuando el
   catálogo es grande). Vanilla, sin dependencias, mismo criterio de "helper
   que se engancha a un contenedor" que ya usa attachCalcInput (calc.js).

   El dropdown se monta en <body> con position:fixed (no como hijo del
   contenedor): las tarjetas de la app (.card) usan overflow:hidden para
   recortar sus bordes redondeados, y eso también recortaba un dropdown
   absolute anidado adentro — con fixed + body se dibuja por encima de todo
   sin que ningún contenedor lo pueda clipear. */

window.createSearchableSelect = function (container, opts) {
  const {
    options = [],           // [{ value, label, sublabel }]
    value = null,
    placeholder = 'Buscar…',
    onChange = () => {},
    onCreateNew = null,     // (texto) => void — si se pasa, agrega "+ Crear ..."
  } = opts;

  container.innerHTML = `<div class="ss-wrap"><input type="text" class="form-control ss-input" placeholder="${escHtml(placeholder)}" autocomplete="off"></div>`;

  const wrap = container.querySelector('.ss-wrap');
  const input = wrap.querySelector('.ss-input');
  let dropdown = null; // se crea al abrir y se saca del DOM al cerrar (evita huérfanos en body)

  let currentValue = value;
  // Las opciones viven en una variable propia (no se usa el parámetro directo)
  // porque el catálogo puede crecer con el combobox ya montado — p. ej. al dar
  // de alta un material desde el propio dropdown. Sin esto el widget se
  // quedaba con la lista vieja: setValue(keyNueva) no encontraba el label y el
  // input se veía vacío, como si no se hubiera asignado nada.
  let currentOptions = options;

  function labelFor(v) {
    const opt = currentOptions.find(o => o.value === v);
    return opt ? opt.label : '';
  }

  function positionDropdown() {
    if (!dropdown) return;
    const r = input.getBoundingClientRect();
    const width = Math.max(r.width, 280);
    dropdown.style.left = Math.min(r.left, window.innerWidth - width - 8) + 'px';
    dropdown.style.top = (r.bottom + 4) + 'px';
    dropdown.style.width = width + 'px';
  }

  function closeDropdown() {
    if (!dropdown) return;
    dropdown.remove();
    dropdown = null;
    window.removeEventListener('scroll', positionDropdown, true);
    window.removeEventListener('resize', positionDropdown);
  }

  function renderList(query) {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'ss-dropdown';
      document.body.appendChild(dropdown);
      window.addEventListener('scroll', positionDropdown, true);
      window.addEventListener('resize', positionDropdown);
    }

    const q = query.trim().toLowerCase();
    const filtered = q ? currentOptions.filter(o => o.label.toLowerCase().includes(q)) : currentOptions;

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
    positionDropdown();

    dropdown.querySelectorAll('.ss-option').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        currentValue = el.dataset.value;
        input.value = labelFor(currentValue);
        closeDropdown();
        onChange(currentValue);
      });
    });

    const createEl = dropdown.querySelector('.ss-create:not(.disabled)');
    if (createEl) {
      createEl.addEventListener('mousedown', e => {
        e.preventDefault();
        const texto = input.value.trim();
        closeDropdown();
        onCreateNew(texto);
      });
    }
  }

  input.value = labelFor(currentValue);
  input.addEventListener('focus', () => renderList(''));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('blur', () => {
    setTimeout(() => {
      closeDropdown();
      input.value = labelFor(currentValue);
    }, 150);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') input.blur(); });

  return {
    setValue(v) { currentValue = v; input.value = labelFor(v); },
    getValue() { return currentValue; },
    // Refresca el catálogo sin remontar el widget (y con él, el label del
    // valor actual, que puede haber aparecido recién en la lista).
    setOptions(nuevas) {
      currentOptions = nuevas || [];
      input.value = labelFor(currentValue);
    },
  };
};
