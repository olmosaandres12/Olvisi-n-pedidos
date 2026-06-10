// ============================================================
// AGENDA.JS — Gestión de clientes OLVISIÓN
// ============================================================

let agendaClientes = [];
let agendaObrasSociales = [];
let agendaMedicos = [];
let agendaInicializada = false;

// ─── INIT ────────────────────────────────────────────────────
async function initAgenda() {
  await Promise.all([loadObrasSocialesAgenda(), loadMedicosUnicos(), loadLabsAgenda()]);
  await loadClientes();
  agendaInicializada = true;
}

async function loadLabsAgenda() {
  const { data } = await window.supabaseClient
    .from('configuracion').select('valor')
    .eq('tipo', 'laboratorio').order('orden');
  window._agendaLabs = data ? data.map(d => d.valor) : [];
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
    .select('id, orden, sufijo, estado, laboratorio, tipo_lente, urgente, fecha_carga, fecha_pedido, fecha_prometida, fecha_retiro')
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

// ─── ESTADO INTELIGENTE PARA FICHA ───────────────────────────
function _estInteligenteFicha(p) {
  if (p.fecha_prometida) {
    const ref  = p.fecha_retiro ? new Date(p.fecha_retiro) : new Date();
    ref.setHours(0,0,0,0);
    const prom   = new Date(p.fecha_prometida + 'T00:00:00');
    const atraso = Math.floor((ref - prom) / (1000*60*60*24));
    if (atraso <= 0) return null;
    if (atraso <= 1) return { texto: '⚠️ Demorado', bgColor: '#FEF3C7', textColor: '#92400E' };
    return                  { texto: '🔴 Crítico',  bgColor: '#FEE2E2', textColor: '#991B1B' };
  }
  const LIMITES = {
    'Bichara': { ok:2, dem:4 }, 'Sol':     { ok:5, dem:7 },
    'Vitolen': { ok:5, dem:7 }, 'Cristian':{ ok:7, dem:10 },
  };
  const limite = LIMITES[p.laboratorio];
  if (!limite) return null;
  const desde = new Date(p.fecha_pedido || p.fecha_carga);
  const hasta = p.fecha_retiro ? new Date(p.fecha_retiro) : new Date();
  const dias  = Math.max(0, Math.floor((hasta - desde) / (1000*60*60*24)));
  if (dias <= limite.ok)  return null;
  if (dias <= limite.dem) return { texto: '⚠️ Demorado', bgColor: '#FEF3C7', textColor: '#92400E' };
  return                         { texto: '🔴 Crítico',  bgColor: '#FEE2E2', textColor: '#991B1B' };
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
      const urgenteBadge = p.urgente === 'Si'
        ? `<span style="font-size:.6rem;font-weight:700;background:#DC2626;color:#fff;padding:2px 6px;border-radius:8px;margin-left:5px;vertical-align:middle;letter-spacing:.02em">⚡ URGENTE</span>`
        : '';
      const estHist  = _estInteligenteFicha(p);
      const demBadge = estHist
        ? `<span style="font-size:.6rem;font-weight:700;background:${estHist.bgColor};color:${estHist.textColor};padding:2px 6px;border-radius:8px;margin-left:5px;vertical-align:middle">${estHist.texto}</span>`
        : '';
      return `
        <div class="ficha-pedido-row">
          <div class="ficha-pedido-dot" style="background:${color}"></div>
          <div class="ficha-pedido-info">
            <span class="ficha-pedido-orden">Orden ${p.orden}${sufijo}${urgenteBadge}${demBadge}</span>
            <span class="ficha-pedido-lab">${p.laboratorio || ''} · ${p.tipo_lente || ''}</span>
          </div>
          <div class="ficha-pedido-meta">
            <span class="ficha-pedido-estado" style="color:${color}">${p.estado}</span>
            <span class="ficha-pedido-fecha">${fecha}</span>
          </div>
        </div>`;
    }).join('');
  }

  const esAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();

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
        ${cliente.medico      ? filaInfo('👨‍⚕️', 'Médico', 'Dr. ' + cliente.medico) : ''}
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

// ─── GRADUACIÓN HISTÓRICA ─────────────────────────────────────
function _gradTablaHistHTML(dc) {
  const id = (campo, ojo) => `g-${dc}-${campo}-${ojo}-h`;
  return `<div class="grad-grid">
    <div class="grad-header"></div>
    <div class="grad-header">Esf</div>
    <div class="grad-header">Cil</div>
    <div class="grad-header">Eje</div>
    <div class="grad-header">Ad.</div>
    <div class="grad-ojo">D</div>
    <input type="text" class="form-control grad-input grad-esf" id="${id('esf','D')}" placeholder="-1.25" readonly autocomplete="off">
    <input type="text" class="form-control grad-input grad-cil" id="${id('cil','D')}" placeholder="-0.50" readonly autocomplete="off">
    <input type="text" class="form-control grad-input grad-eje" id="${id('eje','D')}" placeholder="°" inputmode="numeric" autocomplete="off">
    <input type="text" class="form-control grad-input grad-add" id="${id('add','D')}" placeholder="+2.00" readonly autocomplete="off">
    <div class="grad-ojo">I</div>
    <input type="text" class="form-control grad-input grad-esf" id="${id('esf','I')}" placeholder="-1.25" readonly autocomplete="off">
    <input type="text" class="form-control grad-input grad-cil" id="${id('cil','I')}" placeholder="-0.50" readonly autocomplete="off">
    <input type="text" class="form-control grad-input grad-eje" id="${id('eje','I')}" placeholder="°" inputmode="numeric" autocomplete="off">
    <input type="text" class="form-control grad-input grad-add" id="${id('add','I')}" placeholder="+2.00" readonly autocomplete="off">
  </div>`;
}

function setDistanciaHist(dist) {
  document.querySelectorAll('#dist-tabs-h .dist-tab')
    .forEach(t => t.classList.toggle('active', t.dataset.dist === dist));
  document.getElementById('grad-lejos-h')?.classList.toggle('hidden', dist === 'cerca');
  document.getElementById('grad-cerca-h')?.classList.toggle('hidden', dist === 'lejos');
}

function getGraduacionHist() {
  const dist = document.querySelector('#dist-tabs-h .dist-tab.active')?.dataset.dist || 'lejos';
  const leer = (dc) => {
    const v = (campo, ojo) => document.getElementById(`g-${dc}-${campo}-${ojo}-h`)?.value.trim() || '';
    const partes = [];
    ['D', 'I'].forEach(ojo => {
      const esf = v('esf', ojo), cil = v('cil', ojo), eje = v('eje', ojo), add = v('add', ojo);
      if (esf || cil) {
        let s = `O${ojo}: ${esf}`;
        if (cil) s += ` ${cil}`;
        if (eje) s += ` x${eje}`;
        if (add) s += ` ADD:${add}`;
        partes.push(s.trim());
      }
    });
    return partes.join(' | ');
  };
  if (dist === 'lejos') return leer('L');
  if (dist === 'cerca') return leer('C');
  const l = leer('L'), c = leer('C');
  return [l && `Lejos: ${l}`, c && `Cerca: ${c}`].filter(Boolean).join(' — ');
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

  if (!cliente && typeof App !== 'undefined' && App.attachNumpadListeners) {
    const form = document.getElementById('form-cliente');
    if (form) App.attachNumpadListeners(form);
  }

  overlay.classList.remove('hidden');
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => sheet.classList.add('sheet-open'));
}

function renderFormCliente(cliente = null) {
  const esEdicion = !!cliente;
  const esc2 = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const v = (campo) => esc2(cliente?.[campo] || '');

  const nombreCompleto = cliente
    ? esc2([cliente.nombre, cliente.apellido].filter(Boolean).join(' '))
    : '';

  const opcionesOS = agendaObrasSociales.map(os =>
    `<option value="${esc2(os)}" ${(cliente?.obra_social === os) ? 'selected' : ''}>${esc2(os)}</option>`
  ).join('');

  const labsCache = window._agendaLabs || [];
  const labOpts = labsCache.map(l => `<option value="${esc2(l)}">${esc2(l)}</option>`).join('');

  return `
    <div class="detalle-header" style="padding:16px 18px 14px">
      <span class="detalle-orden" style="font-size:1rem">
        ${esEdicion ? '✏️ Editar cliente' : '👤 Nuevo cliente'}
      </span>
      <button class="btn-cerrar-x" onclick="cerrarFormCliente()">✕</button>
    </div>

    <form id="form-cliente" onsubmit="guardarCliente(event)" autocomplete="off"
          style="padding:0 18px 32px">

      ${esEdicion ? `<input type="hidden" id="fc-id" value="${cliente.id}">` : ''}

      <div class="detalle-seccion">
        <div class="detalle-seccion-title">Datos del cliente</div>

        <div class="form-group">
          <label class="form-label required">Nombre completo</label>
          <input type="text" id="fc-nombre-completo" class="form-control"
                 value="${nombreCompleto}" required
                 placeholder="Ej: Juan García">
          <div class="form-error" id="err-fc-nombre">Campo obligatorio</div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label required">Celular</label>
            <input type="tel" id="fc-telefono" class="form-control" value="${v('telefono')}"
                   required placeholder="381 123 4567" inputmode="tel">
            <div class="form-error" id="err-fc-telefono">Campo obligatorio</div>
          </div>
          <div class="form-group">
            <label class="form-label">DNI</label>
            <input type="text" id="fc-dni" class="form-control" value="${v('dni')}"
                   placeholder="00.000.000" inputmode="numeric">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Obra social</label>
            <select id="fc-obra-social" class="form-control">
              <option value="">— Particular —</option>
              ${opcionesOS}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" id="fc-email" class="form-control" value="${v('email')}"
                   placeholder="correo@ejemplo.com" inputmode="email">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Médico derivante</label>
          <div style="position:relative">
            <input type="text" id="fc-medico" class="form-control" value="${v('medico')}"
                   placeholder="Nombre del médico" autocomplete="off"
                   oninput="onMedicoInput(this.value)"
                   onfocus="onMedicoInput(this.value)">
            <div id="medico-suggestions" class="sugerencias-dropdown hidden"></div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Observaciones</label>
          <textarea id="fc-observaciones" class="form-control" rows="2"
                    placeholder="Alergias, preferencias, notas..."
                    style="resize:vertical;font-size:1rem">${v('observaciones')}</textarea>
        </div>
      </div>

      ${!esEdicion ? `
      <div class="detalle-seccion">
        <div class="detalle-seccion-title" style="cursor:pointer;user-select:none"
             onclick="toggleBloquePedido(this)">
          Agregar pedido histórico
          <span id="pedido-toggle-icon" style="float:right;font-size:.8rem;opacity:.5">▼ opcional</span>
        </div>

        <div id="bloque-pedido-historico" class="hidden">
          <div class="form-row" style="margin-top:12px">
            <div class="form-group">
              <label class="form-label">N° de orden</label>
              <input type="text" id="fc-ped-orden" class="form-control" placeholder="12345" inputmode="numeric">
            </div>
            <div class="form-group">
              <label class="form-label">Fecha</label>
              <input type="date" id="fc-ped-fecha" class="form-control">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Tipo de pedido</label>
              <select id="fc-ped-tipo" class="form-control">
                <option value="">— Seleccionar —</option>
                <option>Cristales</option>
                <option>Armazón + Cristales</option>
                <option>Armazón</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Laboratorio</label>
              <select id="fc-ped-lab" class="form-control">
                <option value="">— Seleccionar —</option>
                ${labOpts}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Tipo de lente</label>
              <select id="fc-ped-lente" class="form-control">
                <option value="">— Seleccionar —</option>
                <option>Monofocal</option><option>Bifocal</option>
                <option>Ocupacional</option><option>Progresivo</option><option>Teñido</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tratamiento</label>
              <input type="text" id="fc-ped-trat" class="form-control" placeholder="AR, Blue, etc.">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Fecha prometida <span class="form-label-hint">(cuándo iba a estar listo)</span></label>
            <input type="date" id="fc-ped-fecha-prom" class="form-control">
          </div>
          <div class="form-group">
            <label class="form-label">Distancia</label>
            <div class="distancia-tabs" id="dist-tabs-h">
              <button type="button" class="dist-tab active" data-dist="lejos" onclick="setDistanciaHist('lejos')">Lejos</button>
              <button type="button" class="dist-tab" data-dist="cerca" onclick="setDistanciaHist('cerca')">Cerca</button>
              <button type="button" class="dist-tab" data-dist="ambos" onclick="setDistanciaHist('ambos')">Ambos</button>
            </div>
          </div>
          <div class="grad-tabla" id="grad-lejos-h">
            <div class="grad-tabla-title">👁️ Lejos</div>
            ${_gradTablaHistHTML('L')}
          </div>
          <div class="grad-tabla hidden" id="grad-cerca-h">
            <div class="grad-tabla-title">📖 Cerca</div>
            ${_gradTablaHistHTML('C')}
          </div>
          <div class="form-group" style="margin-top:12px">
            <label class="form-label">Armazón</label>
            <input type="text" id="fc-ped-armazon" class="form-control" placeholder="Marca, material, color...">
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select id="fc-ped-estado" class="form-control">
              <option value="Retirado">Retirado</option>
              <option value="Pendiente de retirar">Pendiente de retirar</option>
              <option value="En laboratorio">En laboratorio</option>
              <option value="Cristales pedidos a lab">Cristales pedidos a lab</option>
            </select>
          </div>
        </div>
      </div>
      ` : ''}

      <div style="display:flex;gap:10px;margin-top:8px">
        <button type="button" class="btn btn-secondary" style="flex:1" onclick="cerrarFormCliente()">Cancelar</button>
        <button type="submit" class="btn btn-primary" style="flex:2" id="btn-guardar-cliente">
          ${esEdicion ? 'Guardar cambios' : '+ Crear cliente'}
        </button>
      </div>

    </form>`;
}

function toggleBloquePedido(headerEl) {
  const bloque = document.getElementById('bloque-pedido-historico');
  const icon   = document.getElementById('pedido-toggle-icon');
  if (!bloque) return;
  const abierto = !bloque.classList.contains('hidden');
  bloque.classList.toggle('hidden', abierto);
  if (icon) icon.textContent = abierto ? '▼ opcional' : '▲ abierto';
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
    `<div class="sug-item" onclick="seleccionarMedico('${m.replace(/'/g, "\\'")}')">Dr. ${m}</div>`
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

  const nombreCompleto = document.getElementById('fc-nombre-completo')?.value.trim() || '';
  let nombre = nombreCompleto, apellido = '';
  if (nombreCompleto.includes(',')) {
    const partes = nombreCompleto.split(',');
    apellido = partes[0].trim();
    nombre   = partes.slice(1).join(',').trim();
  } else if (nombreCompleto.includes(' ')) {
    const partes = nombreCompleto.split(' ');
    apellido = partes[partes.length - 1];
    nombre   = partes.slice(0, -1).join(' ');
  }

  const datos = {
    nombre,
    apellido,
    telefono:     document.getElementById('fc-telefono')?.value.trim() || '',
    email:        document.getElementById('fc-email')?.value.trim() || null,
    dni:          document.getElementById('fc-dni')?.value.trim() || null,
    obra_social:  document.getElementById('fc-obra-social')?.value || null,
    medico:       document.getElementById('fc-medico')?.value.trim() || null,
    observaciones:document.getElementById('fc-observaciones')?.value.trim() || null,
  };

  const btn = document.getElementById('btn-guardar-cliente');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  if (!clienteId && datos.telefono) {
    const { data: existente } = await window.supabaseClient
      .from('clientes')
      .select('id, nombre, apellido')
      .eq('telefono', datos.telefono)
      .maybeSingle();

    if (existente) {
      const nombreExistente = [existente.nombre, existente.apellido].filter(Boolean).join(' ');
      toast(`Ya existe "${nombreExistente}" con ese número de celular.`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '+ Crear cliente'; }
      return;
    }
  }

  let nuevoClienteId = clienteId;
  let error;

  if (clienteId) {
    ({ error } = await window.supabaseClient.from('clientes').update(datos).eq('id', clienteId));
  } else {
    const { data: creado, error: err } = await window.supabaseClient
      .from('clientes').insert([datos]).select('id').single();
    error = err;
    if (creado) nuevoClienteId = creado.id;
  }

  if (error) {
    const msg = error.code === '23505'
      ? 'Ya existe un cliente con ese número de celular.'
      : 'Error al guardar el cliente.';
    toast(msg, 'error');
    if (btn) { btn.disabled = false; btn.textContent = clienteId ? 'Guardar cambios' : '+ Crear cliente'; }
    return;
  }

  if (!clienteId && nuevoClienteId) {
    const orden = document.getElementById('fc-ped-orden')?.value.trim();
    const lab   = document.getElementById('fc-ped-lab')?.value;
    const lente = document.getElementById('fc-ped-lente')?.value;
    if (orden && lab && lente) {
      const fechaInput = document.getElementById('fc-ped-fecha')?.value;
      const fechaISO   = fechaInput
        ? new Date(fechaInput + 'T12:00:00').toISOString()
        : new Date().toISOString();
      const estadoPed  = document.getElementById('fc-ped-estado')?.value || 'Retirado';
      const graduacion = getGraduacionHist() || null;
      await window.supabaseClient.from('pedidos').insert([{
        cliente:      nombreCompleto,
        cliente_id:   nuevoClienteId,
        orden,
        tipo:         document.getElementById('fc-ped-tipo')?.value || null,
        laboratorio:  lab,
        tipo_lente:   lente,
        tratamiento:  document.getElementById('fc-ped-trat')?.value.trim() || null,
        graduacion,
        armazon:      document.getElementById('fc-ped-armazon')?.value.trim() || null,
        fecha_prometida: document.getElementById('fc-ped-fecha-prom')?.value || null,
        estado:       estadoPed,
        urgente:      'No',
        cargado_por:  typeof Auth !== 'undefined' ? Auth.getNombre() : 'Agenda',
        fecha_carga:  fechaISO,
        fecha_pedido: fechaISO,
        fecha_retiro: estadoPed === 'Retirado' ? fechaISO : null,
      }]);
      toast('Cliente y pedido guardados.', 'success');
    } else {
      toast('Cliente creado.', 'success');
    }
  } else {
    toast(clienteId ? 'Cliente actualizado.' : 'Cliente creado.', 'success');
  }

  cerrarFormCliente();
  await Promise.all([loadClientes(), loadMedicosUnicos()]);

  if (clienteId) {
    const cliente = agendaClientes.find(c => c.id === clienteId);
    if (cliente) {
      const pedidos = await getPedidosDeCliente(clienteId);
      const el = document.getElementById('cliente-sheet-content');
      if (el) el.innerHTML = renderFichaCliente(cliente, pedidos);
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
  if (error) { toast('Error al eliminar el cliente.', 'error'); return; }
  toast('Cliente eliminado.', 'success');
  cerrarFichaCliente();
  await loadClientes();
}

// ─── AUTOCOMPLETE EN FORMULARIO DE NUEVO PEDIDO ───────────────
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
    if (!e.target.closest('.cliente-search-wrapper')) ocultarSugerenciasCliente();
  });
}

async function onClienteSearchInput(valor) {
  const sugEl = document.getElementById('cliente-suggestions');
  if (!sugEl) return;
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
    `<div class="suggestion-item suggestion-nuevo" onclick="abrirFormClienteDesdeNuevoPedido()">+ Crear cliente nuevo</div>`;
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
  abrirFormCliente();
}

function getClienteSeleccionadoId() {
  return _clienteSeleccionadoId;
}
