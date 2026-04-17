// ============================================================
// AGENDA.JS — Gestión de clientes OLVISIÓN
// ============================================================

let agendaClientes = [];
let agendaObrasSociales = [];
let agendaMedicos = [];
let agendaInicializada = false;

// ─── INIT ────────────────────────────────────────────────────
async function initAgenda() {
  await Promise.all([loadObrasSocialesAgenda(), loadMedicosUnicos()]);
  await loadClientes();
  agendaInicializada = true;
}

// ─── DATA ─────────────────────────────────────────────────────
async function loadClientes(busqueda = '') {
  const listEl = document.getElementById('agenda-list');
  listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div>Cargando...</div>';

  let query = window.supabaseClient
    .from('clientes')
    .select('*')
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true });

  const { data, error } = await query;
  if (error) {
    listEl.innerHTML = '<div class="empty-state">Error al cargar clientes.</div>';
    return;
  }

  agendaClientes = data || [];

  if (busqueda.trim()) {
    const q = busqueda.toLowerCase();
    agendaClientes = agendaClientes.filter(c =>
      (c.nombre  || '').toLowerCase().includes(q) ||
      (c.apellido|| '').toLowerCase().includes(q) ||
      (c.telefono|| '').toLowerCase().includes(q) ||
      (c.dni     || '').toLowerCase().includes(q) ||
      (c.medico  || '').toLowerCase().includes(q)
    );
  }

  renderListaClientes(agendaClientes);
}

async function loadObrasSocialesAgenda() {
  const { data } = await window.supabaseClient
    .from('configuracion')
    .select('valor')
    .eq('tipo', 'obra_social')
    .order('orden', { ascending: true });
  agendaObrasSociales = data ? data.map(d => d.valor) : [];
}

async function loadMedicosUnicos() {
  const { data } = await window.supabaseClient
    .from('clientes')
    .select('medico')
    .not('medico', 'is', null)
    .neq('medico', '');

  if (data) {
    const set = new Set(data.map(d => d.medico.trim()).filter(Boolean));
    agendaMedicos = [...set].sort();
  }
}

async function getPedidosDeCliente(clienteId) {
  const { data } = await window.supabaseClient
    .from('pedidos')
    .select('id, orden, sufijo, estado, laboratorio, tipo_lente, fecha_carga, fecha_retiro')
    .eq('cliente_id', clienteId)
    .order('fecha_carga', { ascending: false })
    .limit(20);
  return data || [];
}

// ─── RENDER LISTA ─────────────────────────────────────────────
function renderListaClientes(clientes) {
  const listEl = document.getElementById('agenda-list');

  if (!clientes.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <p>No hay clientes cargados todavía.</p>
        <button class="btn-primary" onclick="abrirFormCliente()">Agregar primer cliente</button>
      </div>`;
    return;
  }

  // Agrupar por primera letra del apellido
  const grupos = {};
  clientes.forEach(c => {
    const letra = (c.apellido || '?')[0].toUpperCase();
    if (!grupos[letra]) grupos[letra] = [];
    grupos[letra].push(c);
  });

  let html = `<div class="agenda-contador">${clientes.length} cliente${clientes.length !== 1 ? 's' : ''}</div>`;

  Object.keys(grupos).sort().forEach(letra => {
    html += `<div class="agenda-letra-header">${letra}</div>`;
    grupos[letra].forEach(c => {
      const iniciales = `${(c.nombre||'')[0]||''}${(c.apellido||'')[0]||''}`.toUpperCase();
      const osBadge = c.obra_social
        ? `<span class="agenda-tag">${c.obra_social}</span>` : '';
      const medBadge = c.medico
        ? `<span class="agenda-tag tag-medico">Dr. ${c.medico}</span>` : '';

      html += `
        <div class="agenda-card" onclick="abrirFichaCliente('${c.id}')">
          <div class="agenda-avatar">${iniciales}</div>
          <div class="agenda-card-info">
            <div class="agenda-nombre">${c.apellido}, ${c.nombre}</div>
            <div class="agenda-telefono">${c.telefono}</div>
            <div class="agenda-tags">${osBadge}${medBadge}</div>
          </div>
          <div class="agenda-card-arrow">›</div>
        </div>`;
    });
  });

  listEl.innerHTML = html;
}

// ─── FILTRAR ──────────────────────────────────────────────────
function filtrarAgenda(valor) {
  loadClientes(valor);
}

// ─── FICHA CLIENTE ────────────────────────────────────────────
async function abrirFichaCliente(clienteId) {
  const overlay = document.getElementById('cliente-sheet-overlay');
  const sheet   = document.getElementById('cliente-sheet');
  const content = document.getElementById('cliente-sheet-content');

  content.innerHTML = '<div class="sheet-loading"><div class="spinner"></div></div>';
  overlay.classList.remove('hidden');
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => sheet.classList.add('sheet-open'));

  const cliente = agendaClientes.find(c => c.id === clienteId);
  if (!cliente) {
    content.innerHTML = '<p style="padding:1rem">Cliente no encontrado.</p>';
    return;
  }

  const pedidos = await getPedidosDeCliente(clienteId);
  content.innerHTML = renderFichaCliente(cliente, pedidos);
}

function renderFichaCliente(cliente, pedidos) {
  const iniciales = `${(cliente.nombre||'')[0]||''}${(cliente.apellido||'')[0]||''}`.toUpperCase();
  const fechaAlta = new Date(cliente.fecha_alta).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric' });

  const estadoColor = {
    'Cristales pedidos a lab':    '#F59E0B',
    'Armazón enviado p/calibrado':'#6366F1',
    'En laboratorio':             '#034291',
    'Pendiente de retirar':       '#10B981',
    'Retirado':                   '#7C3AED',
  };

  let pedidosHtml = '';
  if (pedidos.length === 0) {
    pedidosHtml = '<p class="ficha-sin-pedidos">Sin pedidos registrados.</p>';
  } else {
    pedidosHtml = pedidos.map(p => {
      const color  = estadoColor[p.estado] || '#888';
      const fecha  = new Date(p.fecha_carga).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric' });
      const sufijo = p.sufijo ? ` — ${p.sufijo}` : '';
      return `
        <div class="ficha-pedido-row">
          <div class="ficha-pedido-dot" style="background:${color}"></div>
          <div class="ficha-pedido-info">
            <span class="ficha-pedido-orden">Orden ${p.orden}${sufijo}</span>
            <span class="ficha-pedido-lab">${p.laboratorio || ''} · ${p.tipo_lente || ''}</span>
          </div>
          <div class="ficha-pedido-meta">
            <span class="ficha-pedido-estado" style="color:${color}">${p.estado}</span>
            <span class="ficha-pedido-fecha">${fecha}</span>
          </div>
        </div>`;
    }).join('');
  }

  const esAdmin = currentPerfil?.rol === 'admin';

  return `
    <div class="ficha-header">
      <div class="ficha-avatar">${iniciales}</div>
      <div class="ficha-header-info">
        <h2 class="ficha-nombre">${cliente.apellido}, ${cliente.nombre}</h2>
        <span class="ficha-fecha-alta">Cliente desde ${fechaAlta}</span>
      </div>
      <button class="ficha-close-btn" onclick="cerrarFichaCliente()">✕</button>
    </div>

    <div class="ficha-body">
      <div class="ficha-datos">
        ${filaInfo('📱', 'Celular', cliente.telefono)}
        ${cliente.email       ? filaInfo('✉️', 'Email', cliente.email) : ''}
        ${cliente.dni         ? filaInfo('🪪', 'DNI', cliente.dni) : ''}
        ${cliente.obra_social ? filaInfo('🏥', 'Obra social', cliente.obra_social) : ''}
        ${cliente.medico      ? filaInfo('👨‍⚕️', 'Médico', `Dr. ${cliente.medico}`) : ''}
        ${cliente.observaciones ? filaInfo('📝', 'Notas', cliente.observaciones) : ''}
      </div>

      <div class="ficha-actions">
        <button class="btn-secondary" onclick="abrirFormCliente('${cliente.id}')">✏️ Editar</button>
        <a href="tel:${cliente.telefono}" class="btn-secondary">📞 Llamar</a>
        <a href="https://wa.me/549${cliente.telefono.replace(/\D/g,'')}" target="_blank" class="btn-secondary">💬 WhatsApp</a>
        ${esAdmin ? `<button class="btn-danger-sm" onclick="confirmarEliminarCliente('${cliente.id}', '${cliente.nombre} ${cliente.apellido}')">🗑️ Eliminar</button>` : ''}
      </div>

      <div class="ficha-pedidos-section">
        <h3 class="ficha-section-title">Historial de pedidos (${pedidos.length})</h3>
        <div class="ficha-pedidos-list">${pedidosHtml}</div>
      </div>
    </div>`;
}

function filaInfo(icono, label, valor) {
  return `
    <div class="ficha-fila">
      <span class="ficha-fila-icono">${icono}</span>
      <div class="ficha-fila-texto">
        <span class="ficha-fila-label">${label}</span>
        <span class="ficha-fila-valor">${valor}</span>
      </div>
    </div>`;
}

function cerrarFichaCliente() {
  const sheet = document.getElementById('cliente-sheet');
  sheet.classList.remove('sheet-open');
  setTimeout(() => {
    sheet.classList.add('hidden');
    document.getElementById('cliente-sheet-overlay').classList.add('hidden');
  }, 280);
}

// ─── FORM CLIENTE ─────────────────────────────────────────────
async function abrirFormCliente(clienteId = null) {
  const overlay = document.getElementById('cliente-form-overlay');
  const sheet   = document.getElementById('cliente-form-sheet');
  const content = document.getElementById('cliente-form-content');

  let cliente = null;
  if (clienteId) {
    cliente = agendaClientes.find(c => c.id === clienteId) || null;
  }

  content.innerHTML = renderFormCliente(cliente);
  setupMedicoAutocomplete();

  overlay.classList.remove('hidden');
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => sheet.classList.add('sheet-open'));
}

function renderFormCliente(cliente = null) {
  const titulo = cliente ? 'Editar cliente' : 'Nuevo cliente';
  const v = (campo) => cliente ? (cliente[campo] || '') : '';

  const opcionesOS = agendaObrasSociales.map(os =>
    `<option value="${os}" ${v('obra_social') === os ? 'selected' : ''}>${os}</option>`
  ).join('');

  return `
    <div class="form-sheet-header">
      <h2 class="form-sheet-title">${titulo}</h2>
      <button class="ficha-close-btn" onclick="cerrarFormCliente()">✕</button>
    </div>

    <form id="form-cliente" onsubmit="guardarCliente(event)" autocomplete="off">
      ${cliente ? `<input type="hidden" id="fc-id" value="${cliente.id}">` : ''}

      <div class="form-section-label">Datos obligatorios</div>

      <div class="form-group">
        <label>Nombre *</label>
        <input type="text" id="fc-nombre" value="${v('nombre')}" required placeholder="Nombre">
      </div>
      <div class="form-group">
        <label>Apellido *</label>
        <input type="text" id="fc-apellido" value="${v('apellido')}" required placeholder="Apellido">
      </div>
      <div class="form-group">
        <label>Celular *</label>
        <input type="tel" id="fc-telefono" value="${v('telefono')}" required placeholder="381 123 4567" inputmode="tel">
      </div>

      <div class="form-section-label">Datos opcionales</div>

      <div class="form-group">
        <label>Email</label>
        <input type="email" id="fc-email" value="${v('email')}" placeholder="correo@ejemplo.com" inputmode="email">
      </div>
      <div class="form-group">
        <label>DNI</label>
        <input type="text" id="fc-dni" value="${v('dni')}" placeholder="00.000.000" inputmode="numeric">
      </div>
      <div class="form-group">
        <label>Obra social</label>
        <select id="fc-obra-social">
          <option value="">Sin obra social</option>
          ${opcionesOS}
        </select>
      </div>
      <div class="form-group">
        <label>Médico derivante</label>
        <div class="autocomplete-wrapper">
          <input type="text" id="fc-medico" value="${v('medico')}"
                 placeholder="Nombre del médico" autocomplete="off"
                 oninput="onMedicoInput(this.value)"
                 onfocus="onMedicoInput(this.value)">
          <div id="medico-suggestions" class="suggestions-dropdown hidden"></div>
        </div>
      </div>
      <div class="form-group">
        <label>Observaciones</label>
        <textarea id="fc-observaciones" rows="2" placeholder="Notas adicionales...">${v('observaciones')}</textarea>
      </div>

      <div class="form-actions">
        <button type="button" class="btn-secondary" onclick="cerrarFormCliente()">Cancelar</button>
        <button type="submit" class="btn-primary">
          ${cliente ? 'Guardar cambios' : 'Crear cliente'}
        </button>
      </div>
    </form>`;
}

function cerrarFormCliente() {
  const sheet = document.getElementById('cliente-form-sheet');
  sheet.classList.remove('sheet-open');
  setTimeout(() => {
    sheet.classList.add('hidden');
    document.getElementById('cliente-form-overlay').classList.add('hidden');
  }, 280);
}

// ─── AUTOCOMPLETE MÉDICO ──────────────────────────────────────
function setupMedicoAutocomplete() {
  document.addEventListener('click', (e) => {
    const sug = document.getElementById('medico-suggestions');
    if (sug && !e.target.closest('.autocomplete-wrapper')) {
      sug.classList.add('hidden');
    }
  }, { once: false });
}

function onMedicoInput(valor) {
  const sugEl = document.getElementById('medico-suggestions');
  if (!sugEl) return;

  const q = valor.toLowerCase().trim();
  if (!q) {
    // Mostrar todos cuando está vacío
    const lista = agendaMedicos.slice(0, 8);
    if (!lista.length) { sugEl.classList.add('hidden'); return; }
    renderMedicoSuggestions(lista, sugEl);
    return;
  }

  const filtrados = agendaMedicos.filter(m => m.toLowerCase().includes(q)).slice(0, 8);
  if (!filtrados.length) { sugEl.classList.add('hidden'); return; }
  renderMedicoSuggestions(filtrados, sugEl);
}

function renderMedicoSuggestions(lista, sugEl) {
  sugEl.innerHTML = lista.map(m =>
    `<div class="suggestion-item" onclick="seleccionarMedico('${m.replace(/'/g, "\\'")}')">Dr. ${m}</div>`
  ).join('');
  sugEl.classList.remove('hidden');
}

function seleccionarMedico(nombre) {
  const input = document.getElementById('fc-medico');
  if (input) input.value = nombre;
  const sugEl = document.getElementById('medico-suggestions');
  if (sugEl) sugEl.classList.add('hidden');
}

// ─── CRUD ─────────────────────────────────────────────────────
async function guardarCliente(e) {
  e.preventDefault();

  const idEl = document.getElementById('fc-id');
  const clienteId = idEl ? idEl.value : null;

  const datos = {
    nombre:       document.getElementById('fc-nombre').value.trim(),
    apellido:     document.getElementById('fc-apellido').value.trim(),
    telefono:     document.getElementById('fc-telefono').value.trim(),
    email:        document.getElementById('fc-email').value.trim() || null,
    dni:          document.getElementById('fc-dni').value.trim() || null,
    obra_social:  document.getElementById('fc-obra-social').value || null,
    medico:       document.getElementById('fc-medico').value.trim() || null,
    observaciones:document.getElementById('fc-observaciones').value.trim() || null,
  };

  const btn = document.querySelector('#form-cliente [type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  let error;
  if (clienteId) {
    ({ error } = await window.supabaseClient.from('clientes').update(datos).eq('id', clienteId));
  } else {
    ({ error } = await window.supabaseClient.from('clientes').insert([datos]));
  }

  if (error) {
    showToast('Error al guardar el cliente.', 'error');
    btn.disabled = false;
    btn.textContent = clienteId ? 'Guardar cambios' : 'Crear cliente';
    return;
  }

  showToast(clienteId ? 'Cliente actualizado.' : 'Cliente creado.', 'success');
  cerrarFormCliente();

  // Actualizar lista y médicos
  await Promise.all([loadClientes(), loadMedicosUnicos()]);

  // Si había ficha abierta, refrescarla
  if (clienteId) {
    const cliente = agendaClientes.find(c => c.id === clienteId);
    if (cliente) {
      const pedidos = await getPedidosDeCliente(clienteId);
      document.getElementById('cliente-sheet-content').innerHTML =
        renderFichaCliente(cliente, pedidos);
    }
  }
}

async function confirmarEliminarCliente(clienteId, nombreCompleto) {
  mostrarConfirm(
    'Eliminar cliente',
    `¿Eliminar a <strong>${nombreCompleto}</strong>? Los pedidos asociados quedarán sin cliente vinculado.`,
    () => eliminarCliente(clienteId)
  );
}

async function eliminarCliente(clienteId) {
  const { error } = await window.supabaseClient.from('clientes').delete().eq('id', clienteId);
  if (error) { showToast('Error al eliminar el cliente.', 'error'); return; }

  showToast('Cliente eliminado.', 'success');
  cerrarFichaCliente();
  await loadClientes();
}

// ─── AUTOCOMPLETE EN FORMULARIO DE NUEVO PEDIDO ───────────────
// Estas funciones son llamadas desde pedidos.js

let _clienteSeleccionadoId = null;

function initClienteAutocompletePedido() {
  _clienteSeleccionadoId = null;
  const input = document.getElementById('cliente-search-input');
  const chip  = document.getElementById('cliente-seleccionado');
  const campo = document.getElementById('campo-cliente');

  if (!input) return;

  input.value = '';
  if (chip) chip.classList.add('hidden');
  if (campo) campo.value = '';
  const _cid = document.getElementById('campo-cliente-id'); if (_cid) _cid.value = '';

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cliente-search-wrapper')) {
      ocultarSugerenciasCliente();
    }
  });
}

async function onClienteSearchInput(valor) {
  const sugEl = document.getElementById('cliente-suggestions');
  if (!sugEl) return;

  // Actualiza también el campo texto libre
  document.getElementById('campo-cliente').value = valor;

  const q = valor.toLowerCase().trim();
  if (q.length < 2) { sugEl.classList.add('hidden'); return; }

  const filtrados = agendaClientes.filter(c =>
    (c.nombre   || '').toLowerCase().includes(q) ||
    (c.apellido || '').toLowerCase().includes(q) ||
    (c.telefono || '').toLowerCase().includes(q)
  ).slice(0, 6);

  if (!filtrados.length) { sugEl.classList.add('hidden'); return; }

  sugEl.innerHTML = filtrados.map(c => `
    <div class="suggestion-item" onclick="seleccionarClientePedido('${c.id}')">
      <strong>${c.apellido}, ${c.nombre}</strong>
      <span class="sug-tel">${c.telefono}</span>
    </div>`).join('') +
    `<div class="suggestion-item suggestion-nuevo" onclick="abrirFormClienteDesdeNuevoPedido()">
      + Crear cliente nuevo
    </div>`;

  sugEl.classList.remove('hidden');
}

function seleccionarClientePedido(clienteId) {
  const cliente = agendaClientes.find(c => c.id === clienteId);
  if (!cliente) return;

  _clienteSeleccionadoId = clienteId;

  const nombreCompleto = `${cliente.nombre} ${cliente.apellido}`;
  const _csi = document.getElementById('cliente-search-input'); if (_csi) _csi.value = '';
  document.getElementById('campo-cliente').value = nombreCompleto;
  document.getElementById('campo-cliente-id').value = clienteId;

  const chip = document.getElementById('cliente-seleccionado');
  document.getElementById('cliente-chip-nombre').textContent = nombreCompleto;
  chip.classList.remove('hidden');

  ocultarSugerenciasCliente();
}

function limpiarClienteSeleccionado() {
  _clienteSeleccionadoId = null;
  const _cid = document.getElementById('campo-cliente-id'); if (_cid) _cid.value = '';
  document.getElementById('campo-cliente').value = '';
  const _csi = document.getElementById('cliente-search-input'); if (_csi) _csi.value = '';
  document.getElementById('cliente-seleccionado').classList.add('hidden');
}

function ocultarSugerenciasCliente() {
  const el = document.getElementById('cliente-suggestions');
  if (el) el.classList.add('hidden');
}

function abrirFormClienteDesdeNuevoPedido() {
  ocultarSugerenciasCliente();
  // Abre el form de cliente; al guardar, recarga la lista de sugerencias
  abrirFormCliente();
}

function getClienteSeleccionadoId() {
  return _clienteSeleccionadoId;
}
