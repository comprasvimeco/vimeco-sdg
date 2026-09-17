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
    // 'inline' (default): label a la izquierda y sublabel a la derecha, para
    // catálogos de nombres cortos (materiales, equipos). 'stacked': sublabel
    // debajo del label, en dos líneas — para nombres largos, donde el layout
    // inline aplasta el label en una columna angosta e ilegible.
    optionLayout = 'inline',
    minWidth = 280,
    disabled = false,       // sólo lectura: no abre el dropdown ni acepta tipeo
  } = opts;

  container.innerHTML = `<div class="ss-wrap"><input type="text" class="form-control ss-input" placeholder="${escHtml(placeholder)}" autocomplete="off" ${disabled ? 'disabled' : ''}></div>`;

  const wrap = container.querySelector('.ss-wrap');
  const input = wrap.querySelector('.ss-input');
  let dropdown = null; // se crea al abrir y se saca del DOM al cerrar (evita huérfanos en body)

  let currentValue = value;
  let activeIndex = -1; // índice resaltado por teclado dentro de items(); -1 = ninguno
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
    // El ancho mínimo nunca puede pasarse de la pantalla: en mobile, un
    // minWidth pensado para desktop dejaba el dropdown colgando fuera del
    // viewport (left negativo).
    const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - 16);
    dropdown.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + 'px';
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
      dropdown.className = 'ss-dropdown' + (optionLayout === 'stacked' ? ' ss-dropdown--stacked' : '');
      document.body.appendChild(dropdown);
      window.addEventListener('scroll', positionDropdown, true);
      window.addEventListener('resize', positionDropdown);
    }

    const q = query.trim().toLowerCase();
    // Se busca también en el sublabel: en la lista de APs de otras obras es
    // el nombre de la obra, y buscar "Rivera Indarte" es tan natural como
    // buscar por el nombre del análisis.
    const filtered = q
      ? currentOptions.filter(o => `${o.label} ${o.sublabel || ''}`.toLowerCase().includes(q))
      : currentOptions;

    // Los ya usados (o.usado) van arriba de todo, para elegirlos rápido —
    // p. ej. equipos que ya están en otras líneas de la obra. sort() es
    // estable: si nadie manda "usado", el orden queda intacto.
    const ordenados = filtered.slice().sort((a, b) => (b.usado ? 1 : 0) - (a.usado ? 1 : 0));

    let html = ordenados.map(o => `
      <div class="ss-option${o.usado ? ' ss-option--usado' : ''}" data-value="${escHtml(o.value)}">
        <span>${o.usado ? window.icSvg('checkSm', 'ss-option-check') : ''}${escHtml(o.label)}</span>
        ${o.sublabel ? `<span class="ss-option-sub">${escHtml(o.sublabel)}</span>` : ''}
      </div>`).join('');

    if (!filtered.length) html += '<div class="ss-empty">Sin resultados.</div>';

    if (onCreateNew) {
      html += `<div class="ss-create ${query.trim() ? '' : 'disabled'}">+ Crear "${escHtml(query.trim())}"</div>`;
    }

    dropdown.innerHTML = html;
    activeIndex = -1; // cada render (tipeo) arranca sin resaltado; se activa recién al usar flechas
    positionDropdown();

    dropdown.querySelectorAll('.ss-option').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); selectItem(el); });
    });

    const createEl = dropdown.querySelector('.ss-create:not(.disabled)');
    if (createEl) {
      createEl.addEventListener('mousedown', e => { e.preventDefault(); selectItem(createEl); });
    }
  }

  // Opciones navegables con flechas: las .ss-option más, al final, el
  // "+ Crear ..." si está habilitado (mismo orden en que se ven en pantalla).
  function navItems() {
    return dropdown ? Array.from(dropdown.querySelectorAll('.ss-option, .ss-create:not(.disabled)')) : [];
  }

  function setActive(idx) {
    const els = navItems();
    els.forEach(el => el.classList.remove('ss-option--active', 'ss-create--active'));
    if (idx < 0 || idx >= els.length) { activeIndex = -1; return; }
    activeIndex = idx;
    const el = els[idx];
    el.classList.add(el.classList.contains('ss-create') ? 'ss-create--active' : 'ss-option--active');
    el.scrollIntoView({ block: 'nearest' });
  }

  function selectItem(el) {
    if (el.classList.contains('ss-create')) {
      const texto = input.value.trim();
      closeDropdown();
      onCreateNew(texto);
    } else {
      currentValue = el.dataset.value;
      input.value = labelFor(currentValue);
      closeDropdown();
      onChange(currentValue);
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
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.blur(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // Si el dropdown está cerrado con el input igual enfocado (p. ej. recién
      // se eligió una opción con Enter, sin blur de por medio), reabrir con
      // la lista completa — el input ya tiene el label elegido como texto, y
      // filtrar por eso mostraría un solo resultado en vez de dejar navegar.
      if (!dropdown) { renderList(''); return; }
      const n = navItems().length;
      if (!n) return;
      const next = e.key === 'ArrowDown'
        ? (activeIndex < n - 1 ? activeIndex + 1 : 0)
        : (activeIndex > 0 ? activeIndex - 1 : n - 1);
      setActive(next);
      return;
    }
    if (e.key === 'Enter' && dropdown && activeIndex >= 0) {
      e.preventDefault();
      selectItem(navItems()[activeIndex]);
    }
  });

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
