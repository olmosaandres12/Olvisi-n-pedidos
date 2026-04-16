// ============================================================
// PEDIDOS.JS — CRUD, estado inteligente, lista — OLVISIÓN
// ============================================================

let _pedidosActivos  = [];
let _pedidosFiltrados = [];
let _tabActiva       = 'todos';
let _busqueda        = '';

// Config dinámica cacheada
let _config = { laboratorios: [], tratamientos: [], marcas: [], materiales: [] };

// Historial
let _historialFecha  = new Date();
let _historialPedidos = [];

// Numpad
let _numpadInput    = null;
let _numpadValor    = '';

// ─── CONFIG DINÁMICA ──────────────────────────────────────────
async function cargarConfiguracion() {
  const { data } = await window.supabaseClient
    .from('configuracion')
    .select('tipo, valor, orden')
    .order('orden', { ascending: true });

  if (!data) return;

  _config.laboratorios = data.filter(d => d.tipo === 'laboratorio').map(d => d.valor);
  _config.tratamientos = data.filter(d => d.tipo === 'tratamiento').map(d => d.valor);
  _config.marcas       = data.filter(d => d.tipo === 'marca').map(d => d.valor);
  _config.materiales   = data.filter(d => d.tipo === 'material').map(d => d.valor);

  // Poblar selects del formulario
  poblarSelectLabs();
  poblarSelectTratamientos();
  poblarSelectMarcas();
  poblarSelectMateriales();
}

function poblarSelectLabs() {
  ['a','b'].forEach(bloque => {
    const sel = document.getElementById(`campo-laboratorio-${bloque}`);
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">Seleccionar...</option>' +
      _config.laboratorios.map(l => `<option value="${l}">${l}</option>`).join('');
    if (val) sel.value = val;
  });
}

function poblarSelectTratamientos() {
  ['a','b'].forEach(bloque => {
    const sel = document.getElementById(`campo-tratamiento-${bloque}`);
    if (!sel) return;
    sel.innerHTML = '<option value="">Sin tratamiento</option>' +
      _config.tratamientos.map(t => `<option value="${t}">${t}</option>`).join('');
  });
}

function poblarSelectMarcas() {
  ['a','b'].forEach(bloque => {
    const sel = document.getElementById(`campo-marca-${bloque}`);
    if (!sel) return;
    sel.innerHTML = '<option value="">Sin marca</option>' +
      _config.marcas.map(m => `<option value="${m}">${m}</option>`).join('');
  });
}

function poblarSelectMateriales() {
  ['a','b','libre-a','libre-b'].forEach(sufijo => {
    const sel = document.getElementById(`campo-material-${sufijo}`);
    if (!sel) return;
    sel.innerHTML = '<option value="">-</option>' +
      _config.materiales.map(m => `<option value="${m}">${m}</option>`).join('');
  });
}

// ─── ESTADO INTELIGENTE ───────────────────────────────────────
const LIMITES = {
  'Bichara': { ok: 2, demorado: 4 },
  'Sol':     { ok: 5, demorado: 7 },
  'Vitolen': { ok: 5, demorado: 7 },
  'Cristian':{ ok: 7, demorado: 10 },
};

function calcDiasHabiles(desde, hasta) {
  let count = 0;
  const d = new Date(desde);
  d.setHours(0, 0, 0, 0);
  const fin = new Date(hasta);
  fin.setHours(0, 0, 0, 0);
  while (d < fin) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function calcEstadoInteligente(pedido) {
  if (pedido.estado === 'Retirado') return 'retirado';

  const desde = new Date(pedido.fecha_pedido || pedido.fecha_carga);
  const hasta = pedido.fecha_retiro ? new Date(pedido.fecha_retiro) : new Date();
  const dias  = calcDiasHabiles(desde, hasta);

  const lab    = pedido.laboratorio;
  const limites = LIMITES[lab];
  if (!limites) return 'ok';

  if (dias <= limites.ok)      return 'ok';
  if (dias <= limites.demorado) return 'demorado';
  return 'critico';
}

function calcDiasTotales(pedido) {
  const desde = new Date(pedido.fecha_pedido || pedido.fecha_carga);
  const hasta = pedido.fecha_retiro ? new Date(pedido.fecha_retiro) : new Date();
  return calcDiasHabiles(desde, hasta);
}

// ─── CARGA DE PEDIDOS ─────────────────────────────────────────
async function loadPedidos() {
  const { data, error } = await window.supabaseClient
    .from('pedidos')
    .select('*')
    .neq('estado', 'Retirado')
    .order('fecha_carga', { ascending: false });

  if (error) { console.error('Error cargando pedidos', error); return; }

  _pedidosActivos = data || [];
  window._pedidosActivos = _pedidosActivos;

  filtrarPedidos(_busqueda);
  if (typeof actualizarBadgeCriticos === 'function') actualizarBadgeCriticos();
}

// ─── FILTRAR Y RENDERIZAR ─────────────────────────────────────
function filtrarPedidos(busqueda = '') {
  _busqueda = busqueda;
  const q   = busqueda.toLowerCase().trim();

  let lista = q
    ? _pedidosActivos.filter(p =>
        (p.cliente || '').toLowerCase().includes(q) ||
        (p.orden   || '').toLowerCase().includes(q)
      )
    : [..._pedidosActivos];

  _pedidosFiltrados = lista;
  renderTabsPedidos(lista);
  renderListaPedidos(lista);
}

// ─── TABS DE ESTADO ───────────────────────────────────────────
const TABS = [
  { id: 'todos',             label: 'Todos' },
  { id: 'cristales-pedidos', label: 'Cristales' },
  { id: 'armazon-envio',     label: 'Armazón' },
  { id: 'en-laboratorio',    label: 'En lab' },
  { id: 'para-retirar',      label: 'Retirar' },
];

const ESTADO_A_TAB = {
  'Cristales pedidos a lab':     'cristales-pedidos',
  'Armazón enviado p/calibrado': 'armazon-envio',
  'En laboratorio':              'en-laboratorio',
  'Pendiente de retirar':        'para-retirar',
};

function renderTabsPedidos(lista) {
  const container = document.getElementById('pedidos-tabs');
  if (!container) return;

  const conteos = {};
  lista.forEach(p => {
    const tab = ESTADO_A_TAB[p.estado] || 'todos';
    conteos[tab] = (conteos[tab] || 0) + 1;
  });

  container.innerHTML = TABS.map(t => {
    const count = t.id === 'todos' ? lista.length : (conteos[t.id] || 0);
    const active = _tabActiva === t.id ? 'active' : '';
    return `<button class="tab-btn ${active}" onclick="cambiarTab('${t.id}')">
      ${t.label}${count > 0 ? `<span class="tab-count">${count}</span>` : ''}
    </button>`;
  }).join('');
}

function cambiarTab(tabId) {
  _tabActiva = tabId;
  renderTabsPedidos(_pedidosFiltrados);
  renderListaPedidos(_pedidosFiltrados);
}

// ─── RENDER LISTA ─────────────────────────────────────────────
const ESTADO_COLOR = {
  'Cristales pedidos a lab':     { bg: '#FFF8E7', borde: '#F59E0B', texto: '#78350F' },
  'Armazón enviado p/calibrado': { bg: '#EEF2FF', borde: '#6366F1', texto: '#312E81' },
  'En laboratorio':              { bg: '#EFF6FF', borde: '#034291', texto: '#1E3A5F' },
  'Pendiente de retirar':        { bg: '#F0FDF4', borde: '#10B981', texto: '#064E3B' },
};

const ESTADO_INTEL_COLOR = {
  ok:       { bg: '#F0FDF4', texto: '#15803D', label: 'OK' },
  demorado: { bg: '#FFF7ED', texto: '#C2410C', label: 'Demorado' },
  critico:  { bg: '#FEF2F2', texto: '#DC2626', label: 'Crítico' },
  retirado: { bg: '#F5F3FF', texto: '#7C3AED', label: 'Retirado' },
};

function renderListaPedidos(lista) {
  const container = document.getElementById('pedidos-list');
  if (!container) return;

  // Filtrar por tab activa
  let filtrada = lista;
  if (_tabActiva !== 'todos') {
    filtrada = lista.filter(p => ESTADO_A_TAB[p.estado] === _tabActiva);
  }

  if (!filtrada.length) {
    container.innerHTML = `<div class="empty-state">
      <p>${_busqueda ? 'No hay resultados para tu búsqueda.' : 'No hay pedidos activos.'}</p>
    </div>`;
    return;
  }

  // Ordenar: críticos primero, luego demorados, luego OK
  const prioOrder = { critico: 0, demorado: 1, ok: 2, retirado: 3 };
  filtrada = [...filtrada].sort((a, b) => {
    const pa = prioOrder[calcEstadoInteligente(a)] ?? 9;
    const pb = prioOrder[calcEstadoInteligente(b)] ?? 9;
    if (pa !== pb) return pa - pb;
    return new Date(b.fecha_carga) - new Date(a.fecha_carga);
  });

  // Agrupar pares A/B
  const vistos = new Set();
  const grupos = [];

  filtrada.forEach(p => {
    if (vistos.has(p.id)) return;
    vistos.add(p.id);

    if (p.sufijo === 'A') {
      const pareja = filtrada.find(q => q.orden === p.orden && q.sufijo === 'B');
      if (pareja) {
        vistos.add(pareja.id);
        grupos.push({ tipo: 'par', a: p, b: pareja });
        return;
      }
    }
    grupos.push({ tipo: 'simple', pedido: p });
  });

  container.innerHTML = grupos.map(g => {
    if (g.tipo === 'par') return renderParPedidos(g.a, g.b);
    return renderCardPedido(g.pedido);
  }).join('');
}

function renderCardPedido(p) {
  const estIntel  = calcEstadoInteligente(p);
  const dias      = calcDiasTotales(p);
  const colEst    = ESTADO_COLOR[p.estado] || { bg: '#F5F6FA', borde: '#888', texto: '#333' };
  const colIntel  = ESTADO_INTEL_COLOR[estIntel] || ESTADO_INTEL_COLOR.ok;
  const esCritico = estIntel === 'critico';
  const urgente   = p.urgente === 'Si';

  const borderColor = esCritico ? '#DC2626' : colEst.borde;
  const ringClass   = esCritico ? ' card-critico' : '';

  return `
    <div class="pedido-card${ringClass}" style="border-left-color:${borderColor}"
         onclick="abrirPedidoSheet(${p.id})">
      <div class="card-top">
        <div class="card-orden">
          <span class="orden-num">${p.orden}${p.sufijo ? ' — ' + p.sufijo : ''}</span>
          ${urgente ? '<span class="badge-urgente">URGENTE</span>' : ''}
        </div>
        <span class="badge-intel" style="background:${colIntel.bg};color:${colIntel.texto}">
          ${esCritico ? '⚠ ' : ''}${colIntel.label}
        </span>
      </div>
      <div class="card-cliente">${p.cliente}</div>
      <div class="card-meta">
        <span class="meta-lab" style="background:${colEst.bg};color:${colEst.texto}">
          ${p.laboratorio || '—'}
        </span>
        <span class="meta-lente">${p.tipo_lente || '—'}</span>
        <span class="meta-dias">${dias}d</span>
      </div>
      <div class="card-estado-row">
        <select class="estado-select" data-id="${p.id}"
                onclick="event.stopPropagation()"
                onchange="cambiarEstado(${p.id}, this.value, event)">
          ${renderOpcionesEstado(p.estado)}
        </select>
      </div>
    </div>`;
}

function renderParPedidos(a, b) {
  const diasA  = calcDiasTotales(a);
  const diasB  = calcDiasTotales(b);
  const estA   = calcEstadoInteligente(a);
  const estB   = calcEstadoInteligente(b);
  const colA   = ESTADO_INTEL_COLOR[estA];
  const colB   = ESTADO_INTEL_COLOR[estB];
  const critico = estA === 'critico' || estB === 'critico';
  const urgente = a.urgente === 'Si';

  return `
    <div class="pedido-card pedido-par${critico ? ' card-critico' : ''}">
      <div class="card-top">
        <div class="card-orden">
          <span class="orden-num">${a.orden}</span>
          <span class="badge-par">2 anteojos</span>
          ${urgente ? '<span class="badge-urgente">URGENTE</span>' : ''}
        </div>
      </div>
      <div class="card-cliente">${a.cliente}</div>

      <div class="par-fila par-fila-a" onclick="abrirPedidoSheet(${a.id})">
        <span class="par-sufijo par-a">A</span>
        <span class="par-lab">${a.laboratorio || '—'}</span>
        <span class="par-lente">${a.tipo_lente || '—'}</span>
        <span class="par-dias">${diasA}d</span>
        <span class="badge-intel-sm" style="background:${colA.bg};color:${colA.texto}">${colA.label}</span>
      </div>
      <div class="par-estado-row" onclick="event.stopPropagation()">
        <select class="estado-select estado-select-sm" data-id="${a.id}"
                onchange="cambiarEstado(${a.id}, this.value, event)">
          ${renderOpcionesEstado(a.estado)}
        </select>
      </div>

      <div class="par-fila par-fila-b" onclick="abrirPedidoSheet(${b.id})">
        <span class="par-sufijo par-b">B</span>
        <span class="par-lab">${b.laboratorio || '—'}</span>
        <span class="par-lente">${b.tipo_lente || '—'}</span>
        <span class="par-dias">${diasB}d</span>
        <span class="badge-intel-sm" style="background:${colB.bg};color:${colB.texto}">${colB.label}</span>
      </div>
      <div class="par-estado-row" onclick="event.stopPropagation()">
        <select class="estado-select estado-select-sm" data-id="${b.id}"
                onchange="cambiarEstado(${b.id}, this.value, event)">
          ${renderOpcionesEstado(b.estado)}
        </select>
      </div>
    </div>`;
}

const ESTADOS = [
  'Cristales pedidos a lab',
  'Armazón enviado p/calibrado',
  'En laboratorio',
  'Pendiente de retirar',
  'Retirado',
];

function renderOpcionesEstado(actual) {
  return ESTADOS.map(e =>
    `<option value="${e}" ${e === actual ? 'selected' : ''}>${e}</option>`
  ).join('');
}

// ─── CAMBIAR ESTADO ───────────────────────────────────────────
async function cambiarEstado(pedidoId, nuevoEstado, event) {
  if (event) event.stopPropagation();

  const update = { estado: nuevoEstado };
  if (nuevoEstado === 'Retirado') update.fecha_retiro = new Date().toISOString();

  const { error } = await window.supabaseClient
    .from('pedidos').update(update).eq('id', pedidoId);

  if (error) {
    showToast('Error al actualizar el estado.', 'error');
    return;
  }

  showToast('Estado actualizado.');
  await loadPedidos();
}

// ─── DETALLE PEDIDO (SHEET) ───────────────────────────────────
async function abrirPedidoSheet(pedidoId) {
  const overlay = document.getElementById('pedido-overlay');
  const sheet   = document.getElementById('pedido-sheet');
  const content = document.getElementById('pedido-sheet-content');

  content.innerHTML = '<div class="sheet-loading"><div class="spinner"></div></div>';
  overlay.classList.remove('hidden');
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => sheet.classList.add('sheet-open'));

  const { data: pedido, error } = await window.supabaseClient
    .from('pedidos').select('*').eq('id', pedidoId).single();

  if (error || !pedido) {
    content.innerHTML = '<p style="padding:1rem">Error al cargar el pedido.</p>';
    return;
  }

  content.innerHTML = renderDetallePedido(pedido);
}

function renderDetallePedido(p) {
  const dias     = calcDiasTotales(p);
  const estIntel = calcEstadoInteligente(p);
  const colIntel = ESTADO_INTEL_COLOR[estIntel];
  const admin    = esAdmin();

  const fechaCarga  = new Date(p.fecha_carga).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const fechaRetiro = p.fecha_retiro ? new Date(p.fecha_retiro).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric' }) : null;

  let gradHtml = '';
  if (p.graduacion) {
    gradHtml = `<div class="detalle-grad">${p.graduacion.replace(/\|/g, '<br>')}</div>`;
  }

  return `
    <div class="detalle-header">
      <div>
        <div class="detalle-orden">Orden ${p.orden}${p.sufijo ? ' — ' + p.sufijo : ''}</div>
        <div class="detalle-cliente">${p.cliente}</div>
      </div>
      <button class="ficha-close-btn" onclick="cerrarPedidoSheet()">✕</button>
    </div>

    <div class="detalle-body">
      <div class="detalle-badges">
        <span class="badge-intel" style="background:${colIntel.bg};color:${colIntel.texto}">
          ${colIntel.label} · ${dias}d
        </span>
        ${p.urgente === 'Si' ? '<span class="badge-urgente">URGENTE</span>' : ''}
      </div>

      <div class="detalle-grid">
        ${filaDetalle('Laboratorio',   p.laboratorio)}
        ${filaDetalle('Tipo de lente', p.tipo_lente)}
        ${p.tratamiento   ? filaDetalle('Tratamiento',   p.tratamiento) : ''}
        ${filaDetalle('Estado',        p.estado)}
        ${filaDetalle('Tipo',          p.tipo)}
        ${p.dos_etapas === 'Si' ? filaDetalle('2 etapas', 'Sí') : ''}
        ${p.armazon       ? filaDetalle('Armazón',        p.armazon) : ''}
        ${filaDetalle('Cargado por',   p.cargado_por)}
        ${filaDetalle('Fecha carga',   fechaCarga)}
        ${fechaRetiro ? filaDetalle('Fecha retiro', fechaRetiro) : ''}
      </div>

      ${gradHtml}

      <div class="detalle-estado-select">
        <label class="form-label">Cambiar estado</label>
        <select class="estado-select" onchange="cambiarEstado(${p.id}, this.value, event)">
          ${renderOpcionesEstado(p.estado)}
        </select>
      </div>

      ${admin ? `
      <div class="detalle-admin-actions">
        <button class="btn-secondary" onclick="cerrarPedidoSheet(); setTimeout(() => editarPedido(${p.id}), 300)">
          ✏️ Editar
        </button>
        <button class="btn-danger-sm" onclick="confirmarEliminarPedido(${p.id})">
          🗑️ Eliminar
        </button>
      </div>` : ''}
    </div>`;
}

function filaDetalle(label, valor) {
  if (!valor) return '';
  return `<div class="detalle-fila">
    <span class="detalle-label">${label}</span>
    <span class="detalle-valor">${valor}</span>
  </div>`;
}

function cerrarPedidoSheet() {
  const sheet = document.getElementById('pedido-sheet');
  sheet.classList.remove('sheet-open');
  setTimeout(() => {
    sheet.classList.add('hidden');
    document.getElementById('pedido-overlay').classList.add('hidden');
  }, 280);
}

// ─── ELIMINAR PEDIDO ──────────────────────────────────────────
function confirmarEliminarPedido(pedidoId) {
  mostrarConfirm(
    'Eliminar pedido',
    '¿Seguro que querés eliminar este pedido? Esta acción no se puede deshacer.',
    () => eliminarPedido(pedidoId)
  );
}

async function eliminarPedido(pedidoId) {
  const { error } = await window.supabaseClient.from('pedidos').delete().eq('id', pedidoId);
  if (error) { showToast('Error al eliminar.', 'error'); return; }
  showToast('Pedido eliminado.');
  cerrarPedidoSheet();
  await loadPedidos();
}

// ─── NUEVO PEDIDO — FORM ──────────────────────────────────────
function toggleDosAnteojos() {
  const checked = document.getElementById('toggle-dos-anteojos').checked;
  const bloqueB = document.getElementById('bloque-b');
  const labelA  = document.getElementById('label-anteojo-a');

  if (checked) {
    bloqueB.classList.remove('hidden');
    labelA.textContent = 'Anteojo A';
  } else {
    bloqueB.classList.add('hidden');
    labelA.textContent = 'Anteojo';
  }
}

function setArmazonTipo(tipo, bloque) {
  const btnNuevo   = document.getElementById(`btn-arm-nuevo-${bloque}`);
  const btnCliente = document.getElementById(`btn-arm-cliente-${bloque}`);
  const divNuevo   = document.getElementById(`armazon-nuevo-${bloque}`);
  const divCliente = document.getElementById(`armazon-cliente-${bloque}`);

  if (tipo === 'nuevo') {
    btnNuevo.classList.add('active');
    btnCliente.classList.remove('active');
    divNuevo.classList.remove('hidden');
    divCliente.classList.add('hidden');
  } else {
    btnCliente.classList.add('active');
    btnNuevo.classList.remove('active');
    divCliente.classList.remove('hidden');
    divNuevo.classList.add('hidden');
    // Copiar materiales al select libre
    const selMat = document.getElementById(`campo-material-libre-${bloque}`);
    if (selMat && selMat.options.length <= 1) {
      selMat.innerHTML = '<option value="">-</option>' +
        _config.materiales.map(m => `<option value="${m}">${m}</option>`).join('');
    }
  }
}

function formatEje(input) {
  input.value = input.value.replace(/[^0-9]/g, '');
  if (parseInt(input.value) > 180) input.value = '180';
}

// ─── SUBMIT NUEVO PEDIDO ──────────────────────────────────────
async function submitNuevoPedido(event) {
  event.preventDefault();

  const cliente  = document.getElementById('campo-cliente').value.trim();
  const orden    = document.getElementById('campo-orden').value.trim();
  const clienteId = document.getElementById('campo-cliente-id').value || null;

  if (!cliente) { showToast('El nombre del cliente es obligatorio.', 'error'); return; }
  if (!orden)   { showToast('El número de orden es obligatorio.', 'error'); return; }

  const tipoA    = document.getElementById('campo-tipo-a').value;
  const labA     = document.getElementById('campo-laboratorio-a').value;
  const lentA    = document.getElementById('campo-tipo-lente-a').value;
  if (!tipoA || !labA || !lentA) {
    showToast('Completá tipo, laboratorio y tipo de lente.', 'error'); return;
  }

  const dosAnteojos = document.getElementById('toggle-dos-anteojos').checked;
  const urgente     = document.getElementById('campo-urgente').checked ? 'Si' : 'No';

  // Verificar duplicado
  const sufijosABuscar = dosAnteojos ? ['A', 'B'] : [null];
  for (const sufijo of sufijosABuscar) {
    let q = window.supabaseClient.from('pedidos').select('id').eq('orden', orden);
    if (sufijo) q = q.eq('sufijo', sufijo);
    else q = q.is('sufijo', null);
    const { data: dup } = await q;
    if (dup && dup.length > 0) {
      const suf = sufijo ? ` (${sufijo})` : '';
      showToast(`Ya existe un pedido con orden ${orden}${suf}.`, 'error');
      return;
    }
  }

  // Armar datos
  const graduacionA = armarGraduacion('a');
  const armazonA    = armarArmazon('a');

  const baseA = {
    cliente,
    cliente_id:   clienteId,
    orden,
    urgente,
    tipo:         tipoA,
    laboratorio:  labA,
    tipo_lente:   lentA,
    tratamiento:  document.getElementById('campo-tratamiento-a').value || null,
    graduacion:   graduacionA || null,
    dos_etapas:   document.getElementById('campo-dos-etapas-a').checked ? 'Si' : 'No',
    armazon:      armazonA || null,
    estado:       'Cristales pedidos a lab',
    cargado_por:  currentPerfil?.nombre || 'Sistema',
    fecha_pedido: new Date().toISOString(),
  };

  const pedidosAInsertar = dosAnteojos
    ? [{ ...baseA, sufijo: 'A' }, { ...buildBloqueB(cliente, clienteId, orden, urgente), sufijo: 'B' }]
    : [baseA];

  const btn = document.getElementById('btn-guardar-pedido');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  // Mostrar confirmación
  mostrarConfirm(
    'Confirmar pedido',
    `<strong>${cliente}</strong><br>Orden: ${orden}<br>Lab: ${labA}${dosAnteojos ? '<br><em>(2 anteojos)</em>' : ''}`,
    async () => {
      const { error } = await window.supabaseClient.from('pedidos').insert(pedidosAInsertar);
      if (error) {
        showToast('Error al guardar el pedido.', 'error');
        btn.disabled = false;
        btn.textContent = 'Guardar pedido';
        return;
      }
      showToast('Pedido guardado.');
      limpiarFormNuevo();
      btn.disabled = false;
      btn.textContent = 'Guardar pedido';
      await loadPedidos();
      showSection('pedidos');
    }
  );

  // Si cancela el confirm, rehabilitar botón
  document.getElementById('confirm-cancel')?.addEventListener('click', () => {
    btn.disabled = false;
    btn.textContent = 'Guardar pedido';
  }, { once: true });
}

function buildBloqueB(cliente, clienteId, orden, urgente) {
  const labB   = document.getElementById('campo-laboratorio-b').value;
  const lentB  = document.getElementById('campo-tipo-lente-b').value;
  const gradB  = armarGraduacion('b');
  const armB   = armarArmazon('b');

  return {
    cliente,
    cliente_id:   clienteId,
    orden,
    urgente,
    tipo:         document.getElementById('campo-tipo-a').value, // mismo tipo que A
    laboratorio:  labB || document.getElementById('campo-laboratorio-a').value,
    tipo_lente:   lentB || document.getElementById('campo-tipo-lente-a').value,
    tratamiento:  document.getElementById('campo-tratamiento-b').value || null,
    graduacion:   gradB || null,
    dos_etapas:   document.getElementById('campo-dos-etapas-b').checked ? 'Si' : 'No',
    armazon:      armB || null,
    estado:       'Cristales pedidos a lab',
    cargado_por:  currentPerfil?.nombre || 'Sistema',
    fecha_pedido: new Date().toISOString(),
  };
}

function armarGraduacion(bloque) {
  const g = {
    odEsf: document.getElementById(`${bloque}-od-esf`)?.value,
    odCil: document.getElementById(`${bloque}-od-cil`)?.value,
    odEje: document.getElementById(`${bloque}-od-eje`)?.value,
    odAdd: document.getElementById(`${bloque}-od-add`)?.value,
    oiEsf: document.getElementById(`${bloque}-oi-esf`)?.value,
    oiCil: document.getElementById(`${bloque}-oi-cil`)?.value,
    oiEje: document.getElementById(`${bloque}-oi-eje`)?.value,
    oiAdd: document.getElementById(`${bloque}-oi-add`)?.value,
  };
  const tieneAlgo = Object.values(g).some(v => v && v !== '');
  if (!tieneAlgo) return '';

  const fmtOjo = (esf, cil, eje, add) => {
    let s = `${esf || '±0.00'} / ${cil || '±0.00'} x ${eje || '0'}°`;
    if (add) s += ` Add ${add}`;
    return s;
  };

  return `OD: ${fmtOjo(g.odEsf, g.odCil, g.odEje, g.odAdd)} | OI: ${fmtOjo(g.oiEsf, g.oiCil, g.oiEje, g.oiAdd)}`;
}

function armarArmazon(bloque) {
  const btnNuevo = document.getElementById(`btn-arm-nuevo-${bloque}`);
  const esNuevo  = btnNuevo?.classList.contains('active');

  if (esNuevo) {
    const marca   = document.getElementById(`campo-marca-${bloque}`)?.value || '';
    const codigo  = document.getElementById(`campo-codigo-${bloque}`)?.value || '';
    const material= document.getElementById(`campo-material-${bloque}`)?.value || '';
    const color   = document.getElementById(`campo-color-${bloque}`)?.value || '';
    if (!marca && !codigo && !material && !color) return '';
    return [marca, codigo, material, color].filter(Boolean).join(' / ');
  } else {
    const marca   = document.getElementById(`campo-marca-libre-${bloque}`)?.value || '';
    const material= document.getElementById(`campo-material-libre-${bloque}`)?.value || '';
    const color   = document.getElementById(`campo-color-libre-${bloque}`)?.value || '';
    if (!marca && !material && !color) return '';
    return ['Del cliente:', marca, material, color].filter(Boolean).join(' / ');
  }
}

function limpiarFormNuevo() {
  document.getElementById('form-nuevo-pedido')?.reset();
  document.getElementById('bloque-b')?.classList.add('hidden');
  const labelA = document.getElementById('label-anteojo-a');
  if (labelA) labelA.textContent = 'Anteojo';

  // Limpiar cliente seleccionado
  limpiarClienteSeleccionado();

  // Limpiar inputs de graduación (son readonly, no los resetea el form)
  document.querySelectorAll('.grad-input[readonly]').forEach(i => i.value = '');

  // Resetear armazón tipo a "Nuevo"
  ['a','b'].forEach(bl => setArmazonTipo('nuevo', bl));
}

// ─── NUMPAD ───────────────────────────────────────────────────
function abrirNumpad(input) {
  _numpadInput = input;
  _numpadValor = input.value || '';

  const bloque = input.dataset.bloque;
  const ojo    = input.dataset.ojo;
  const campo  = input.dataset.campo;

  const campos = ['esf', 'cil', 'add'].filter(c => c !== campo);

  const overlay = document.getElementById('numpad-overlay');
  const sheet   = document.getElementById('numpad-sheet');
  const content = document.getElementById('numpad-content');

  content.innerHTML = renderNumpad(campo, _numpadValor, bloque, ojo);
  overlay.classList.remove('hidden');
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => sheet.classList.add('sheet-open'));
}

function renderNumpad(campo, valorActual, bloque, ojo) {
  const esSigned = campo === 'esf' || campo === 'cil';
  const esAdd    = campo === 'add';

  // Indicador de campo
  const CAMPOS_LABEL = { esf: 'Esfera', cil: 'Cilindro', add: 'Adición' };
  const ojoLabel = ojo === 'od' ? 'OD' : 'OI';
  const bloqueLabel = bloque === 'a' ? 'A' : 'B';

  return `
    <div class="numpad-indicator">
      <span class="numpad-campo-label">${ojoLabel} · ${CAMPOS_LABEL[campo] || campo}</span>
      <div class="numpad-display">${valorActual || '0.00'}</div>
    </div>

    <div class="numpad-grid">
      <button class="numpad-btn numpad-sign" onclick="numpadSigno('+')">+</button>
      <button class="numpad-btn numpad-sign" onclick="numpadSigno('−')">−</button>
      <button class="numpad-btn numpad-del"  onclick="numpadBorrar()">⌫</button>

      <button class="numpad-btn" onclick="numpadDigito('1')">1</button>
      <button class="numpad-btn" onclick="numpadDigito('2')">2</button>
      <button class="numpad-btn" onclick="numpadDigito('3')">3</button>

      <button class="numpad-btn" onclick="numpadDigito('4')">4</button>
      <button class="numpad-btn" onclick="numpadDigito('5')">5</button>
      <button class="numpad-btn" onclick="numpadDigito('6')">6</button>

      <button class="numpad-btn" onclick="numpadDigito('7')">7</button>
      <button class="numpad-btn" onclick="numpadDigito('8')">8</button>
      <button class="numpad-btn" onclick="numpadDigito('9')">9</button>

      <button class="numpad-btn numpad-dot"  onclick="numpadDigito('.')">.</button>
      <button class="numpad-btn" onclick="numpadDigito('0')">0</button>
      <button class="numpad-btn numpad-clr"  onclick="numpadLimpiar()">CLR</button>
    </div>

    <div class="numpad-actions">
      <button class="btn-numpad-copiar" onclick="numpadCopiarOjo()">Copiar a ${ojo === 'od' ? 'OI' : 'OD'}</button>
      <button class="btn-numpad-ok"     onclick="numpadConfirmar()">OK</button>
    </div>`;
}

function numpadDigito(d) {
  if (d === '.' && _numpadValor.includes('.')) return;
  if (_numpadValor === '0' && d !== '.') _numpadValor = d;
  else _numpadValor += d;
  actualizarDisplayNumpad();
}

function numpadSigno(signo) {
  const s = signo === '−' ? '-' : '+';
  if (_numpadValor.startsWith('-') || _numpadValor.startsWith('+')) {
    _numpadValor = s + _numpadValor.slice(1);
  } else {
    _numpadValor = s + _numpadValor;
  }
  actualizarDisplayNumpad();
}

function numpadBorrar() {
  _numpadValor = _numpadValor.slice(0, -1) || '0';
  actualizarDisplayNumpad();
}

function numpadLimpiar() {
  _numpadValor = '';
  actualizarDisplayNumpad();
}

function actualizarDisplayNumpad() {
  const display = document.querySelector('.numpad-display');
  if (display) display.textContent = _numpadValor || '0.00';
}

function numpadConfirmar() {
  if (_numpadInput) {
    _numpadInput.value = _numpadValor;
  }
  cerrarNumpad();
}

function numpadCopiarOjo() {
  if (!_numpadInput) return;
  const bloque = _numpadInput.dataset.bloque;
  const ojo    = _numpadInput.dataset.ojo;
  const campo  = _numpadInput.dataset.campo;
  const ojoOpuesto = ojo === 'od' ? 'oi' : 'od';

  _numpadInput.value = _numpadValor;
  const inputOpuesto = document.getElementById(`${bloque}-${ojoOpuesto}-${campo}`);
  if (inputOpuesto) inputOpuesto.value = _numpadValor;

  cerrarNumpad();
}

function cerrarNumpad() {
  const sheet = document.getElementById('numpad-sheet');
  sheet.classList.remove('sheet-open');
  setTimeout(() => {
    sheet.classList.add('hidden');
    document.getElementById('numpad-overlay').classList.add('hidden');
  }, 280);
  _numpadInput = null;
}

// ─── HISTORIAL ────────────────────────────────────────────────
function initHistorial() {
  _historialFecha = new Date();
  loadHistorial();
}

async function loadHistorial() {
  const labelEl = document.getElementById('historial-mes-label');
  const listEl  = document.getElementById('historial-list');

  const año = _historialFecha.getFullYear();
  const mes  = _historialFecha.getMonth();

  if (labelEl) {
    const nombreMes = _historialFecha.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
    labelEl.textContent = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
  }

  if (listEl) listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Cargando...</div>';

  const inicio = new Date(año, mes, 1).toISOString();
  const fin    = new Date(año, mes + 1, 0, 23, 59, 59).toISOString();

  const { data, error } = await window.supabaseClient
    .from('pedidos')
    .select('*')
    .gte('fecha_carga', inicio)
    .lte('fecha_carga', fin)
    .order('fecha_carga', { ascending: false });

  if (error) { if (listEl) listEl.innerHTML = '<p>Error al cargar historial.</p>'; return; }

  _historialPedidos = data || [];
  renderHistorial(_historialPedidos);
}

function renderHistorial(pedidos) {
  const listEl = document.getElementById('historial-list');
  if (!listEl) return;

  if (!pedidos.length) {
    listEl.innerHTML = '<div class="empty-state"><p>Sin pedidos en este mes.</p></div>';
    return;
  }

  listEl.innerHTML = pedidos.map(p => {
    const fecha    = new Date(p.fecha_carga).toLocaleDateString('es-AR', { day:'2-digit', month:'short' });
    const dias     = calcDiasTotales(p);
    const estIntel = calcEstadoInteligente(p);
    const colIntel = ESTADO_INTEL_COLOR[estIntel];

    return `
      <div class="pedido-card pedido-card-compact" onclick="abrirPedidoSheet(${p.id})">
        <div class="card-top">
          <span class="orden-num">${p.orden}${p.sufijo ? '-'+p.sufijo : ''}</span>
          <span class="badge-intel" style="background:${colIntel.bg};color:${colIntel.texto}">${colIntel.label}</span>
        </div>
        <div class="card-cliente">${p.cliente}</div>
        <div class="card-meta">
          <span class="meta-lab">${p.laboratorio || '—'}</span>
          <span class="meta-estado">${p.estado}</span>
          <span class="meta-fecha">${fecha} · ${dias}d</span>
        </div>
      </div>`;
  }).join('');
}

function historialMesAnterior() {
  _historialFecha.setMonth(_historialFecha.getMonth() - 1);
  loadHistorial();
}

function historialMesSiguiente() {
  const hoy = new Date();
  if (_historialFecha.getFullYear() === hoy.getFullYear() &&
      _historialFecha.getMonth()    === hoy.getMonth()) return;
  _historialFecha.setMonth(_historialFecha.getMonth() + 1);
  loadHistorial();
}

// ─── CONFIG ───────────────────────────────────────────────────
function initConfig() {
  loadConfigPanel();
}

async function loadConfigPanel() {
  const container = document.getElementById('config-content');
  if (!container) return;

  const { data } = await window.supabaseClient
    .from('configuracion')
    .select('*')
    .order('tipo')
    .order('orden');

  if (!data) return;

  const tipos = {
    laboratorio: 'Laboratorios',
    tratamiento: 'Tratamientos',
    marca:       'Marcas',
    material:    'Materiales',
    obra_social: 'Obras sociales',
  };

  let html = '';
  Object.entries(tipos).forEach(([tipo, label]) => {
    const items = data.filter(d => d.tipo === tipo);
    html += `
      <div class="config-section">
        <div class="config-section-header">
          <h3 class="config-section-title">${label}</h3>
          <button class="btn-sm btn-primary" onclick="agregarConfigItem('${tipo}')">+ Agregar</button>
        </div>
        <div class="config-items" id="config-items-${tipo}">
          ${items.map(item => `
            <div class="config-item">
              <span>${item.valor}</span>
              <button class="btn-icon-danger" onclick="eliminarConfigItem(${item.id}, '${tipo}')">✕</button>
            </div>`).join('')}
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

async function agregarConfigItem(tipo) {
  const valor = prompt(`Nuevo valor para ${tipo}:`);
  if (!valor || !valor.trim()) return;

  const { data: existentes } = await window.supabaseClient
    .from('configuracion').select('orden').eq('tipo', tipo).order('orden', { ascending: false }).limit(1);
  const orden = existentes?.length ? existentes[0].orden + 1 : 1;

  const { error } = await window.supabaseClient.from('configuracion').insert([{ tipo, valor: valor.trim(), orden }]);
  if (error) { showToast('Error al agregar.', 'error'); return; }

  showToast('Agregado correctamente.');
  await cargarConfiguracion();
  loadConfigPanel();
}

async function eliminarConfigItem(id, tipo) {
  if (!confirm('¿Eliminar este elemento?')) return;
  const { error } = await window.supabaseClient.from('configuracion').delete().eq('id', id);
  if (error) { showToast('Error al eliminar.', 'error'); return; }
  showToast('Eliminado.');
  await cargarConfiguracion();
  loadConfigPanel();
}
