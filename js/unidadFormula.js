/* VIMECO S.A. — Leer una misma fórmula en horas o en jornadas.

   El A.P. carga Equipos y Mano de Obra en jornadas o en horas según el switch
   (ver js/item.js), y el dato guardado son siempre jornadas. Una cantidad
   escrita con fórmula tiene que poder leerse en las dos unidades: la que se
   cargó en jornadas como "=2*3" se lee en horas como "=2*3*8", y la que se
   cargó en horas como "=4*4" se lee en jornadas como "=4*4/8".

   La conversión NO es multiplicar la fórmula entera por la jornada, porque hay
   términos que ya se convierten solos: una referencia a la cantidad de otra
   línea vale 2 en jornadas y 16 en horas sin que nadie la toque, así que
   multiplicarla otra vez daría 128. Se convierte término a término.

   Para saber qué término es qué, cada átomo lleva un GRADO DE TIEMPO: 0 si no
   depende de la unidad (un número, el rendimiento, un costo total), +1 si es
   una cantidad de tiempo (la cantidad de otra línea), -1 si es algo POR unidad
   de tiempo (un costo diario, que en horas pasa a costo por hora). "*" suma
   los grados y "/" los resta, igual que las unidades de la física. Un sumando
   que ya da grado 1 se deja como está; uno de grado 0 recibe el factor.

   Si algo no cierra —la fórmula no parsea, o un sumando da un grado que no es
   0 ni 1, como "=[A · Cantidad]*[B · Cantidad]"— se devuelve null y el
   llamador deja la celda anclada a su unidad original. Es preferible una celda
   que avisa que no se puede leer en la otra unidad a una que convierte mal.

   Trabaja sobre la forma CANÓNICA de la fórmula (la que se guarda, con las
   referencias como "@{id}"), que es la única en la que se puede saber a qué
   celda apunta cada referencia. Por eso tiene su propio parser en vez de usar
   evalFormula (js/calc.js), que no entiende "@{}" y está en el camino de las
   21 pantallas: acá se mira la misma gramática, pero para medir en vez de
   para calcular. */

(function () {
  /* ===== Medir: grado de tiempo y dónde corta cada sumando ===== */

  // Devuelve los sumandos del nivel superior —{ desde, hasta, grado }— o null
  // si la fórmula no parsea o mezcla unidades donde no puede. `gradoDeRef(id)`
  // es lo único que aporta el llamador: qué mide la celda a la que apunta
  // "@{id}".
  function analizar(expr, gradoDeRef) {
    let i = 0;

    function skipWs() { while (expr[i] === ' ') i++; }

    // Mismo número que acepta evalFormula: coma o punto decimal, miles con
    // punto, notación científica. Acá sólo hay que consumirlo bien — su valor
    // no importa, un número siempre es grado 0.
    function parseNumber() {
      skipWs();
      const start = i;
      while (i < expr.length && /[0-9.,]/.test(expr[i])) i++;
      if (start === i) throw new Error('Número inválido');
      if (/[eE]/.test(expr[i] || '')) {
        const m = expr.slice(i + 1).match(/^[+-]?\d+/);
        if (m) i += 1 + m[0].length;
      }
      return 0;
    }

    // Una subexpresión entre paréntesis (o adentro de raiz) tiene que tener un
    // grado solo: "=([A · Cantidad]+1)*2" no se sabe convertir, porque el
    // factor tendría que entrar adentro del paréntesis.
    function gradoCerrado(sub) {
      if (sub.grado == null) throw new Error('Suma de cantidades con distinta unidad');
      return sub.grado;
    }

    function parseAtom() {
      skipWs();
      // "@{id}": la referencia a otra celda, el único átomo que puede no ser
      // grado 0. El id se lee crudo hasta la llave de cierre, igual que en
      // js/refs.js.
      if (expr[i] === '@' && expr[i + 1] === '{') {
        const fin = expr.indexOf('}', i + 2);
        if (fin < 0) throw new Error('Referencia sin cerrar');
        const id = expr.slice(i + 2, fin);
        i = fin + 1;
        return gradoDeRef ? (gradoDeRef(id) || 0) : 0;
      }
      const dos = expr.slice(i, i + 2).toLowerCase();
      if ((dos === 'pi' || dos === 'us') && !/[a-zA-Z]/.test(expr[i + 2] || '')) { i += 2; return 0; }
      if (expr[i] && expr[i].toLowerCase() === 'k' && !/[a-zA-Z]/.test(expr[i + 1] || '')) { i += 1; return 0; }
      if (expr.slice(i, i + 4).toLowerCase() === 'raiz') {
        i += 4;
        skipWs();
        if (expr[i] !== '(') throw new Error('Falta "(" después de raiz');
        i++;
        const g = gradoCerrado(parseExpr());
        skipWs();
        if (expr[i] !== ')') throw new Error('Falta paréntesis de cierre');
        i++;
        // La raíz de algo con unidad daría media unidad, que acá no existe.
        if (g !== 0) throw new Error('Raíz de una cantidad con unidad');
        return 0;
      }
      if (expr[i] === '(') {
        i++;
        const g = gradoCerrado(parseExpr());
        skipWs();
        if (expr[i] !== ')') throw new Error('Falta paréntesis de cierre');
        i++;
        return g;
      }
      return parseNumber();
    }

    // "^": el grado de la base se multiplica por el exponente. Con base
    // adimensional da igual cuánto valga el exponente; con unidad, el
    // exponente tiene que ser un entero constante para que el grado siga
    // siendo un número entero.
    function parsePower() {
      const base = parseAtom();
      skipWs();
      if (expr[i] !== '^') return base;
      const desdeExp = ++i;
      parseUnary();
      if (base === 0) return 0;
      const crudo = expr.slice(desdeExp, i).trim();
      const n = parseFloat(crudo.includes(',') ? crudo.replace(/\./g, '').replace(',', '.') : crudo);
      if (isNaN(n) || !Number.isInteger(n)) throw new Error('Exponente no constante');
      return base * n;
    }

    // El signo no cambia la unidad de lo que viene atrás.
    function parseUnary() {
      skipWs();
      if (expr[i] === '-' || expr[i] === '+') { i++; return parseUnary(); }
      return parsePower();
    }

    // Producto: los grados se suman, y se restan al dividir.
    function parseTerm() {
      let g = parseUnary();
      skipWs();
      while (expr[i] === '*' || expr[i] === '/') {
        const op = expr[i]; i++;
        const rhs = parseUnary();
        g = op === '*' ? g + rhs : g - rhs;
        skipWs();
      }
      return g;
    }

    // Suma: además del grado devuelve dónde empieza y termina cada sumando,
    // que es lo que después se reescribe. `grado` es null cuando los sumandos
    // no coinciden: arriba de todo eso está permitido (se convierte cada uno
    // por su lado), adentro de un paréntesis no (ver gradoCerrado).
    function parseExpr() {
      const sumandos = [];
      let desde = i;
      let grado = parseTerm();
      sumandos.push({ desde, hasta: i, grado });
      skipWs();
      while (expr[i] === '+' || expr[i] === '-') {
        i++;
        desde = i;
        grado = parseTerm();
        sumandos.push({ desde, hasta: i, grado });
        skipWs();
      }
      const grados = sumandos.map(s => s.grado);
      const uniforme = grados.every(x => x === grados[0]);
      return { grado: uniforme ? grados[0] : null, sumandos };
    }

    let raiz;
    try {
      raiz = parseExpr();
    } catch (_) {
      return null;
    }
    skipWs();
    if (i !== expr.length) return null;
    return raiz.sumandos;
  }

  /* ===== Reescribir ===== */

  // Sumandos que sabemos convertir: el que ya quedó en la unidad de destino
  // (grado 1) y el que no depende de la unidad (grado 0). Cualquier otro grado
  // es una fórmula que no es una cantidad de tiempo, y no hay conversión que
  // la arregle.
  function convertible(sumandos) {
    return sumandos.every(s => s.grado === 0 || s.grado === 1);
  }

  // El factor va pegado al final del sumando ("2*3" -> "2*3*8"). Es seguro sin
  // paréntesis: "*" y "/" asocian a izquierda con la misma precedencia, y "^"
  // y el signo unario ya quedaron resueltos adentro del sumando.
  function conFactor(texto, op, factor) {
    return texto.replace(/\s+$/, '') + op + factor;
  }

  // formula: canónica ("=2*3", "=@{id}+1"). jornadaHoras: la jornada de la
  // obra. aHoras: true para leer una fórmula escrita en jornadas como horas,
  // false para la vuelta. Devuelve el texto convertido, o null si no se puede.
  window.convertirFormulaUnidad = function (formula, jornadaHoras, aHoras, gradoDeRef) {
    if (!formula || !String(formula).startsWith('=')) return null;
    if (!(jornadaHoras > 0)) return null;
    if (jornadaHoras === 1) return formula;

    const expr = String(formula).slice(1);
    const sumandos = analizar(expr, gradoDeRef);
    if (!sumandos || !sumandos.length || !convertible(sumandos)) return null;

    // Ida "*8", vuelta "/8" — y no "*0,125", para que la fórmula se siga
    // leyendo igual de clara en los dos sentidos.
    const op = aHoras ? '*' : '/';
    const texto = String(window.decimalString ? window.decimalString(jornadaHoras) : jornadaHoras).replace('.', ',');

    // Si hay que convertir todo, se convierte la expresión entera de una vez,
    // así "=2*3" queda "=2*3*8" y no "=2*8*3*8". Los paréntesis sólo hacen
    // falta con más de un sumando ("=2+3" -> "=(2+3)*8").
    if (sumandos.every(s => s.grado === 0)) {
      const cuerpo = sumandos.length > 1 ? '(' + expr + ')' : expr;
      return '=' + conFactor(cuerpo, op, texto);
    }

    // Mezcla: los sumandos de grado 1 ya están en la unidad de la vista y no
    // se tocan; los de grado 0 se leen como una cantidad de tiempo escrita en
    // la unidad de origen, y reciben el factor.
    let out = '';
    let cursor = 0;
    sumandos.forEach(s => {
      out += expr.slice(cursor, s.desde);
      const trozo = expr.slice(s.desde, s.hasta);
      out += s.grado === 0 ? conFactor(trozo, op, texto) : trozo;
      cursor = s.hasta;
    });
    return '=' + out + expr.slice(cursor);
  };
})();
