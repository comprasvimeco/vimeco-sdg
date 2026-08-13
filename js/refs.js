/* VIMECO S.A. — Referencias vivas entre celdas.

   Una fórmula "=" de un campo puede apuntar a otra celda de la pantalla en vez
   de a un número congelado: se clickea la celda mientras se escribe la fórmula
   y queda la referencia. Si después cambia la celda de origen, el campo se
   recalcula solo — igual que Excel.

   Tres formas del mismo texto:
     guardada  =@{computo:linea:-Nabc:total}+1200     ← va a Firebase
     visible   =[1.2 Desmonte · Total]+1200           ← lo que se ve al editar
     evaluable =(26059.96)+1200                       ← lo que come evalFormula

   Las direcciones (data-calc-id) salen de las claves de los datos, no de la
   posición en pantalla: reordenar o filtrar no rompe una fórmula. El registro
   se arma leyendo el DOM ya renderizado, así que una pantalla sólo tiene que
   emitir los atributos en sus celdas (ver calcAttrs) y no llevar ningún
   índice aparte.

   Sólo se puede referenciar lo que está en la misma pantalla, que es también
   lo único que se puede clickear. */

(function () {
  const RE_REF_CANONICA = /@\{([^}]+)\}/g;
  const RE_REF_VISIBLE  = /\[([^\]]+)\]/g;

  /* ===== Emisión de celdas referenciables ===== */

  // Atributos para una celda que se puede referenciar. Se usa en los
  // templates de cada pantalla, al lado del valor que ya se mostraba.
  // valor: número real (no el texto formateado); id: dirección estable;
  // label: cómo se va a leer la referencia dentro de la fórmula.
  window.calcAttrs = function (valor, id, label) {
    if (valor == null || isNaN(valor)) return '';
    return ` data-calc-valor="${valor}" data-calc-id="${escHtml(id)}" data-calc-label="${escHtml(label)}"`;
  };

  /* ===== Registro (se arma del DOM, después de cada render) ===== */

  // { id: { valor, label } } + índice inverso por label. Los labels repetidos
  // se desambiguan con " #2", " #3" en orden de aparición.
  function registro() {
    const porId = {};
    const porLabel = {};
    const vistos = {};
    document.querySelectorAll('[data-calc-id]').forEach(el => {
      const id = el.dataset.calcId;
      if (porId[id]) return;
      let label = el.dataset.calcLabel || id;
      vistos[label] = (vistos[label] || 0) + 1;
      if (vistos[label] > 1) label += ' #' + vistos[label];
      const valor = parseFloat(el.dataset.calcValor);
      porId[id] = { valor: isNaN(valor) ? null : valor, label };
      porLabel[label.toLowerCase()] = id;
    });
    return { porId, porLabel };
  }

  window.refsRegistro = registro;

  window.formulaTieneRefs = f => !!f && /@\{/.test(f);

  /* ===== Las tres formas del texto ===== */

  window.refsAVisible = function (formula) {
    if (!formula) return formula;
    const { porId } = registro();
    return formula.replace(RE_REF_CANONICA, (_, id) =>
      '[' + (porId[id] ? porId[id].label : '#REF!') + ']');
  };

  window.refsACanonica = function (texto) {
    if (!texto || !texto.includes('[')) return texto;
    const { porLabel } = registro();
    return texto.replace(RE_REF_VISIBLE, (todo, label) => {
      const id = porLabel[label.trim().toLowerCase()];
      return id ? '@{' + id + '}' : todo;   // label desconocido: se deja, la fórmula no valida
    });
  };

  // Reemplaza cada referencia por su valor de hoy. Va entre paréntesis para
  // que un valor negativo no se coma el operador de al lado.
  window.refsResolver = function (expr) {
    if (!expr || !expr.includes('@{')) return expr;
    const { porId } = registro();
    return expr.replace(RE_REF_CANONICA, (_, id) => {
      const celda = porId[id];
      if (!celda || celda.valor == null) throw new Error('#REF!');
      return '(' + celda.valor + ')';
    });
  };

  /* ===== Recálculo ===== */

  // campos: [{ formula, valor, aplicar(nuevoValor) }] — una pantalla le pasa
  // todos sus campos con fórmula después de renderizar. Devuelve true si algún
  // valor cambió (el llamador re-renderiza y vuelve a llamar, con tope de
  // pasadas para cortar las referencias circulares).
  window.recalcularCeldasVivas = function (campos) {
    let cambios = 0;
    (campos || []).forEach(c => {
      if (!window.formulaTieneRefs(c.formula)) return;
      let nuevo;
      try {
        nuevo = window.roundLimpio(window.evalFormula(window.refsResolver(c.formula.slice(1))));
      } catch (_) {
        return;   // #REF! (celda borrada): se conserva el último valor calculado
      }
      if (nuevo === c.valor) return;
      cambios++;
      c.aplicar(nuevo);
    });
    return cambios > 0;
  };

  /* ===== Selección por click ===== */

  // Campo con fórmula que se está editando ahora mismo.
  function campoEnEdicion() {
    const el = document.activeElement;
    return el && el.dataset && el.dataset.calc === '1' ? el : null;
  }

  // …y sólo si además está en modo fórmula: ahí es cuando clickear una celda
  // inserta una referencia en vez de mover el foco.
  function campoActivo() {
    const el = campoEnEdicion();
    return el && el.value.trim().startsWith('=') ? el : null;
  }

  // esValor: lo que se inserta es un operando (una celda, pi, raiz) y no un
  // operador. Sólo en ese caso se antepone un "+" cuando justo antes del
  // cursor ya terminaba otro operando — si no, clickear "÷" escribía "+/".
  function insertarEnCursor(input, texto, esValor) {
    const start = input.selectionStart != null ? input.selectionStart : input.value.length;
    const end   = input.selectionEnd   != null ? input.selectionEnd   : input.value.length;
    const antes = input.value.slice(0, start);
    const despues = input.value.slice(end);
    const necesitaOperador = esValor && antes.length > 1 && !/[+\-*/^(=]$/.test(antes);
    const insercion = (necesitaOperador ? '+' : '') + texto;
    input.value = antes + insercion + despues;
    const pos = start + insercion.length;
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function marcarSeleccionadas(input) {
    document.querySelectorAll('.celda-ref-usada').forEach(el => el.classList.remove('celda-ref-usada'));
    if (!input) return;
    const texto = input.value;
    document.querySelectorAll('[data-calc-label]').forEach(el => {
      const label = el.dataset.calcLabel;
      if (label && texto.includes('[' + label)) el.classList.add('celda-ref-usada');
    });
  }

  document.addEventListener('mousedown', e => {
    const input = campoActivo();
    if (!input) return;
    if (e.target.closest('.barra-formula')) { e.preventDefault(); return; }
    if (e.target.closest('[data-calc-id]')) e.preventDefault();   // no le saca el foco al campo
  }, true);

  document.addEventListener('click', e => {
    const input = campoActivo();
    if (!input) return;
    const celda = e.target.closest('[data-calc-id]');
    if (!celda || celda === input) return;
    const entrada = registro().porId[celda.dataset.calcId];
    if (!entrada || entrada.valor == null) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    insertarEnCursor(input, '[' + entrada.label + ']', true);
    celda.classList.add('celda-ref-flash');
    setTimeout(() => celda.classList.remove('celda-ref-flash'), 350);
    actualizarBarra(input);
  }, true);

  /* ===== Mini-barra de fórmula ===== */

  // Barra fija en una esquina (abajo a la derecha; abajo a lo ancho en el
  // celular) mientras se edita una fórmula: muestra el resultado en vivo y
  // los mismos átomos que la calculadora (π, √, ^…), que en el celular no hay
  // forma cómoda de tipear. NO se pega al campo a propósito: pegada tapaba
  // justo las celdas de al lado, que son las que hay que poder clickear.
  // Además, salvo los botones, no recibe clicks (ver pointer-events en el
  // CSS): lo que quede abajo se puede seguir clickeando.
  // [texto a insertar, texto del botón, es operando]
  const BOTONES = [
    ['+', '+', false], ['-', '−', false], ['*', '×', false], ['/', '÷', false], ['^', '^', false],
    ['(', '(', false], [')', ')', false], ['pi', 'π', true], ['raiz(', '√', true],
  ];

  let barraEl = null;

  function crearBarra() {
    barraEl = document.createElement('div');
    barraEl.className = 'barra-formula';
    barraEl.innerHTML = `
      <div class="barra-formula-texto"></div>
      <div class="barra-formula-resultado"></div>
      <div class="barra-formula-ops">${BOTONES.map(([valor, texto, esValor]) =>
        `<button type="button" data-ins="${escHtml(valor)}"${esValor ? ' data-operando="1"' : ''}>${escHtml(texto)}</button>`).join('')}</div>
      <div class="barra-formula-hint">Clickeá una celda para usar su valor. Enter confirma, Esc cancela.</div>`;
    document.body.appendChild(barraEl);
    barraEl.querySelectorAll('[data-ins]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = campoActivo();
        if (input) { insertarEnCursor(input, btn.dataset.ins, btn.dataset.operando === '1'); actualizarBarra(input); }
      });
    });
    return barraEl;
  }

  function ocultarBarra() {
    if (barraEl) barraEl.classList.add('hidden');
    document.body.classList.remove('formula-modo');
    marcarSeleccionadas(null);
  }

  function actualizarBarra(input) {
    if (!input) { ocultarBarra(); return; }
    const barra = barraEl || crearBarra();
    barra.classList.remove('hidden');
    document.body.classList.add('formula-modo');

    // La celda es angosta y una fórmula con nombres de celdas no entra: acá se
    // lee entera, como en la barra de fórmulas de Excel.
    barra.querySelector('.barra-formula-texto').textContent = input.value;

    const res = barra.querySelector('.barra-formula-resultado');
    try {
      const canonica = window.refsACanonica(input.value.trim());
      const valor = window.evalFormula(window.refsResolver(canonica.slice(1)));
      res.textContent = '= ' + window.fmtNum(window.roundLimpio(valor));
      res.classList.remove('barra-formula-error');
    } catch (_) {
      res.textContent = '= …';
      res.classList.add('barra-formula-error');
    }

    marcarSeleccionadas(input);
  }

  document.addEventListener('focusin', () => actualizarBarra(campoActivo()));
  document.addEventListener('input', e => {
    if (e.target && e.target.dataset && e.target.dataset.calc === '1') actualizarBarra(campoActivo());
  });
  document.addEventListener('focusout', e => {
    if (e.target && e.target.dataset && e.target.dataset.calc === '1') setTimeout(() => actualizarBarra(campoActivo()), 0);
  });
  // Esc cancela la edición en curso, sea una fórmula o un número tipeado a
  // mano — como en Excel. (No alcanza con mirar si el texto arranca con "=":
  // borrar la fórmula y tipear otra cosa también es una edición en curso.)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const input = campoEnEdicion();
    if (!input) return;
    e.preventDefault();
    window.cancelarEdicionCampo(input);
    ocultarBarra();
  });
})();
