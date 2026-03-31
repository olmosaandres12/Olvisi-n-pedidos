// ===================================================
//  OLVISIÓN — app.js
//  Controlador principal de la SPA
// ===================================================

const App = (() => {

  let _pedidosCache   = [];
  let _configCache    = { laboratorios: [], tratamientos: {} };
  let _currentScreen  = 'inicio';
  let _estadoTab      = 'todos';
  let _segTab         = 'lab';
  let _pendingGuardar = null;
  let _detalleId      = null;

  // ── INIT ─────────────────────────────────────────
  async function init() {
    const session = await Auth.init();
    if (!session) return;

    document.getElementById('app-layout').style.display = 'flex';
    document.getElementById('header-user').textContent  = Auth.getNombre();

    document.getElementById('logo-home-btn').addEventListener('click', () => showScreen('inicio'));
    document.getElementById('btn-logout').addEventListener('click',    () => Auth.logout());

    if (Auth.isAdmin()) {
      document.getElementById('nav-panel').classList.remove('hidden');
      document.getElementById('nav-config').classList.remove('hidden');
    }

    document.getElementById('f-fecha-carga').value = todayStr();

    document.getElementById('toggle-dos-anteojos').addEventListener('change', (e) => {
      document.getElementById('bloque-anteojo2').classList.toggle('hidden', !e.target.checked);
      document.getElementById('bloque1-title').textContent = e.target.checked ? 'Anteojo A' : 'Anteojo';
    });

    const searchIn = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    searchIn.addEventListener('input', () => {
      clearBtn.classList.toggle('hidden', !searchIn.value);
      renderPedidosList();
    });
    clearBtn.addEventListener('click', () => {
      searchIn.value = ''; clearBtn.classList.add('hidden'); renderPedidosList();
    });
    ['filtro-lab','filtro-lente','filtro-fecha'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', renderPedidosList);
    });

    document.getElementById('form-nuevo-pedido').addEventListener('submit', handleFormSubmit);
    document.getElementById('modal-close-btn').addEventListener('click',   closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click',  closeModal);
    document.getElementById('modal-confirm-btn').addEventListener('click', handleConfirm);

    // Detalle modal
    document.getElementById('btn-cerrar-detalle').addEventListener('click', cerrarDetalle);
    document.getElementById('btn-abrir-edicion').addEventListener('click',  abrirEdicion);
    document.getElementById('detalle-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('detalle-modal')) cerrarDetalle();
    });

    // Edit modal
    document.getElementById('btn-cerrar-edit').addEventListener('click', cerrarEdicion);
    document.getElementById('edit-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('edit-modal')) cerrarEdicion();
    });

    await loadConfig();
    buildBloqueFields(1);
    buildBloqueFields(2);

    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 400);

    showScreen('inicio');
  }

  // ── CONFIG ────────────────────────────────────────
  async function loadConfig() {
    try {
      const { data, error } = await window.supabaseClient
        .from('configuracion').select('*').eq('activo', true).order('orden');
      if (error) throw error;
      _configCache.laboratorios = data.filter(r => r.tipo === 'laboratorio').map(r => r.valor);
      _configCache.tratamientos = {};
      data.filter(r => r.tipo === 'tratamiento').forEach(r => {
        if (!_configCache.tratamientos[r.categoria]) _configCache.tratamientos[r.categoria] = [];
        _configCache.tratamientos[r.categoria].push({ id: r.id, valor: r.valor });
      });
    } catch (e) {
      console.warn('Config fallback:', e);
      _configCache.laboratorios = ['Sol','Bichara','Cristian','Vitolen'];
    }
    const filtroLab = document.getElementById('filtro-lab');
    if (filtroLab) {
      filtroLab.innerHTML = '<option value="">Todos los labs</option>' +
        _configCache.laboratorios.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
    }
  }

  // ── BUILD BLOQUE FIELDS ───────────────────────────
  function buildBloqueFields(num) {
    const container = document.getElementById(`bloque${num}-fields`);
    if (!container) return;
    const labs = _configCache.laboratorios.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
    container.innerHTML = `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label required">Laboratorio</label>
          <select id="f-lab${num}" class="form-control">
            <option value="">— Seleccionar —</option>${labs}
          </select>
          <div class="form-error" id="err-lab${num}">Campo obligatorio</div>
        </div>
        <div class="form-group">
          <label class="form-label required">Tipo de lente</label>
          <select id="f-lente${num}" class="form-control" onchange="App.onLenteChange(${num})">
            <option value="">— Seleccionar —</option>
            <option value="Monofocal">Monofocal</option>
            <option value="Bifocal">Bifocal</option>
            <option value="Ocupacional">Ocupacional</option>
            <option value="Progresivo">Progresivo</option>
            <option value="Teñido">Teñido</option>
          </select>
          <div class="form-error" id="err-lente${num}">Campo obligatorio</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Tratamiento</label>
        <select id="f-tratamiento${num}" class="form-control">
          <option value="">— Primero elegí tipo de lente —</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Distancia</label>
        <div class="distancia-tabs" id="dist-tabs${num}">
          <button type="button" class="dist-tab active" data-dist="lejos"  onclick="App.setDistancia(${num},'lejos')">Lejos</button>
          <button type="button" class="dist-tab"        data-dist="cerca"  onclick="App.setDistancia(${num},'cerca')">Cerca</button>
          <button type="button" class="dist-tab"        data-dist="ambos"  onclick="App.setDistancia(${num},'ambos')">Ambos</button>
        </div>
      </div>
      <div class="grad-tabla" id="grad-lejos${num}">
        <div class="grad-tabla-title">👁️ Lejos</div>
        ${gradTablaHTML(num,'L')}
      </div>
      <div class="grad-tabla hidden" id="grad-cerca${num}">
        <div class="grad-tabla-title">📖 Cerca</div>
        ${gradTablaHTML(num,'C')}
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">2 etapas</label>
          <select id="f-etapas${num}" class="form-control">
            <option value="No">No</option>
            <option value="Si">Sí</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Armazón</label>
          <input type="text" id="f-armazon${num}" class="form-control" placeholder="Descripción">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Marca</label>
          <input type="text" id="f-marca${num}" class="form-control" placeholder="Ej: Ray-Ban">
        </div>
        <div class="form-group">
          <label class="form-label">Código / Ref</label>
          <input type="text" id="f-codigoref${num}" class="form-control" placeholder="RB3025">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Material</label>
          <input type="text" id="f-material${num}" class="form-control" placeholder="Metal, Acetato...">
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <input type="text" id="f-color${num}" class="form-control" placeholder="Negro, Dorado...">
        </div>
      </div>
    `;
  }

  function gradTablaHTML(num, dc) {
    const inp = (id) => `<input type="text" class="form-control grad-input" id="${id}" placeholder="—" inputmode="decimal">`;
    return `
      <div class="grad-grid">
        <div class="grad-header"></div>
        <div class="grad-header">Esf</div>
        <div class="grad-header">Cil</div>
        <div class="grad-header">Eje</div>
        <div class="grad-header">Ad.</div>
        <div class="grad-ojo">D</div>
        ${inp(`g-${dc}-esf-D-${num}`)}${inp(`g-${dc}-cil-D-${num}`)}${inp(`g-${dc}-eje-D-${num}`)}${inp(`g-${dc}-add-D-${num}`)}
        <div class="grad-ojo">I</div>
        ${inp(`g-${dc}-esf-I-${num}`)}${inp(`g-${dc}-cil-I-${num}`)}${inp(`g-${dc}-eje-I-${num}`)}${inp(`g-${dc}-add-I-${num}`)}
      </div>
    `;
  }

  function onLenteChange(num) {
    const lente = document.getElementById(`f-lente${num}`)?.value;
    const sel   = document.getElementById(`f-tratamiento${num}`);
    if (!sel) return;
    const opts = _configCache.tratamientos[lente] || [];
    sel.innerHTML = opts.length
      ? `<option value="">— Seleccionar —</option>` + opts.map(t => `<option value="${esc(t.valor)}">${esc(t.valor)}</option>`).join('')
      : `<option value="">Sin tratamientos para este tipo</option>`;
  }

  function setDistancia(num, dist) {
    document.querySelectorAll(`#dist-tabs${num} .dist-tab`).forEach(t =>
      t.classList.toggle('active', t.dataset.dist === dist)
    );
    document.getElementById(`grad-lejos${num}`).classList.toggle('hidden', dist === 'cerca');
    document.getElementById(`grad-cerca${num}`).classList.toggle('hidden', dist === 'lejos');
  }

  // ── NAVIGATION ───────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`screen-${name}`)?.classList.add('active');
    document.getElementById(`nav-${name}`)?.classList.add('active');
    _currentScreen = name;
    if (name === 'pedidos')     loadPedidos();
    if (name === 'seguimiento') loadSeguimiento();
    if (name === 'panel')       refreshPanel();
    if (name === 'config')      loadConfigScreen();
  }

  // ── SEGUIMIENTO ───────────────────────────────────
  async function loadSeguimiento() {
    try {
      const todos   = await Pedidos.getPedidosActivos();
      _pedidosCache = todos;
      const enLab   = todos.filter(p => p.estado === 'En laboratorio' || p.estado === 'Pedido a laboratorio');
      const retirar = todos.filter(p => p.estado === 'Pendiente de retirar');
      document.getElementById('seg-count-lab').textContent    = enLab.length;
      document.getElementById('seg-count-retirar').textContent = retirar.length;
      renderSegPanel('seg-content-lab',     enLab.sort(sortPorEstado));
      renderSegPanel('seg-content-retirar', retirar.sort(sortPorEstado));
      updateBadge();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  }

  function sortPorEstado(a, b) {
    const ord = { critico:0, demorado:1, ok:2 };
    return (ord[a._est.valor] ?? 2) - (ord[b._est.valor] ?? 2) || b._dias - a._dias;
  }

  function renderSegPanel(id, pedidos) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!pedidos.length) {
      el.innerHTML = `<div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <h3>Sin pedidos</h3><p>No hay pedidos en este estado</p></div>`;
      return;
    }
    el.innerHTML = `<div class="pedidos-list">${pedidos.map(renderCard).join('')}</div>`;
    attachSelects(el);
    attachCardTaps(el);
  }

  function switchSegTab(tab) {
    _segTab = tab;
    document.querySelectorAll('.seg-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('seg-content-lab').classList.toggle('hidden',    tab !== 'lab');
    document.getElementById('seg-content-retirar').classList.toggle('hidden', tab !== 'retirar');
  }

  // ── PEDIDOS ───────────────────────────────────────
  async function loadPedidos() {
    const skel = document.getElementById('pedidos-skeleton');
    const list = document.getElementById('pedidos-list-container');
    const sub  = document.getElementById('pedidos-subtitle');
    skel.style.display = 'flex'; skel.style.flexDirection = 'column';
    list.style.display = 'none'; sub.textContent = 'Cargando...';
    try {
      _pedidosCache = await Pedidos.getTodosPedidos();
      skel.style.display = 'none'; list.style.display = 'block';
      renderPedidosList(); updateBadge();
    } catch (e) {
      skel.style.display = 'none'; list.style.display = 'block';
      list.innerHTML = `<div class="empty-state"><p style="color:var(--rojo)">Error: ${esc(e.message)}</p></div>`;
    }
  }

  function switchEstadoTab(estado) {
    _estadoTab = estado;
    document.querySelectorAll('.estado-tab').forEach(t => t.classList.toggle('active', t.dataset.estado === estado));
    renderPedidosList();
  }

  function limpiarFiltros() {
    ['search-input','filtro-lab','filtro-lente','filtro-fecha'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('search-clear').classList.add('hidden');
    renderPedidosList();
  }

  function renderPedidosList() {
    const container = document.getElementById('pedidos-list-container');
    const sub       = document.getElementById('pedidos-subtitle');
    if (!container) return;

    const q      = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    const fLab   = document.getElementById('filtro-lab')?.value   || '';
    const fLente = document.getElementById('filtro-lente')?.value || '';
    const fFecha = document.getElementById('filtro-fecha')?.value || '';

    const filtered = _pedidosCache.filter(p => {
      if (_estadoTab !== 'todos' && p.estado !== _estadoTab) return false;
      if (q      && !p.cliente?.toLowerCase().includes(q) && !p.orden?.toLowerCase().includes(q)) return false;
      if (fLab   && p.laboratorio !== fLab)   return false;
      if (fLente && p.tipo_lente  !== fLente) return false;
      if (fFecha && (p.fecha_carga || '').slice(0,10) !== fFecha) return false;
      return true;
    });

    sub.textContent = `${filtered.length} pedido${filtered.length !== 1 ? 's' : ''}`;

    if (!filtered.length) {
      container.innerHTML = `<div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <h3>Sin resultados</h3><p>Probá cambiando los filtros</p></div>`;
      return;
    }

    const grupos = {};
    filtered.forEach(p => {
      const d     = new Date(p.fecha_carga);
      const clave = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('es-AR', { month:'long', year:'numeric' });
      if (!grupos[clave]) grupos[clave] = { label, items: [] };
      grupos[clave].items.push(p);
    });

    container.innerHTML = Object.keys(grupos).sort((a,b) => b.localeCompare(a)).map(k => {
      const g = grupos[k];
      const label = g.label.charAt(0).toUpperCase() + g.label.slice(1);
      return `<div class="mes-grupo">
        <div class="mes-label">${label}</div>
        <div class="pedidos-list">${g.items.map(renderCard).join('')}</div>
      </div>`;
    }).join('');

    attachSelects(container);
    attachCardTaps(container);
  }

  // ── RENDER CARD ───────────────────────────────────
  function renderCard(p) {
    const sufijo   = p.sufijo ? `-${p.sufijo}` : '';
    const estClase = p._est.valor === 'critico' ? 'critico' : p._est.valor === 'demorado' ? 'demorado' : '';
    const urgente  = p.urgente === 'Si' ? '<span class="pedido-urgente">URGENTE</span>' : '';
    const scls     = Pedidos.claseEstado(p.estado);
    const opts     = ['Pedido a laboratorio','En laboratorio','Pendiente de retirar','Retirado']
      .map(e => `<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');

    return `<div class="pedido-card ${estClase}" data-id="${p.id}">
      <div class="pedido-card-tap" data-id="${p.id}">
        <div class="pedido-card-header">
          <span class="pedido-orden">#${esc(p.orden)}${sufijo}</span>${urgente}
        </div>
        <div class="pedido-card-body">
          <div class="pedido-cliente">${esc(p.cliente)}</div>
          <div class="pedido-meta">
            ${p.laboratorio?`<span class="meta-chip lab">${esc(p.laboratorio)}</span>`:''}
            ${p.tipo_lente ?`<span class="meta-chip">${esc(p.tipo_lente)}</span>`:''}
            ${p.tratamiento?`<span class="meta-chip">${esc(p.tratamiento)}</span>`:''}
            ${p.tipo       ?`<span class="meta-chip">${esc(p.tipo)}</span>`:''}
            ${p.dos_etapas==='Si'?'<span class="meta-chip">2 etapas</span>':''}
          </div>
        </div>
      </div>
      <div class="pedido-card-footer">
        <div class="estado-info">
          <span class="est-inteligente ${p._est.clase}">${p._est.texto}</span>
          <span class="dias-badge">${p._dias}d</span>
        </div>
        <select class="estado-select ${scls}" data-id="${p.id}" data-prev="${esc(p.estado)}">${opts}</select>
      </div>
    </div>`;
  }

  function attachSelects(container) {
    container.querySelectorAll('.estado-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const id   = parseInt(e.target.dataset.id);
        const est  = e.target.value;
        const prev = e.target.dataset.prev;
        e.target.dataset.prev = est;
        e.target.className    = `estado-select ${Pedidos.claseEstado(est)}`;
        try {
          await Pedidos.actualizarEstado(id, est);
          toast(`Estado: ${est}`, 'success');
          _pedidosCache = await Pedidos.getTodosPedidos();
          if (_currentScreen === 'pedidos')     renderPedidosList();
          if (_currentScreen === 'seguimiento') loadSeguimiento();
          updateBadge();
        } catch (err) {
          toast(`Error: ${err.message}`, 'error');
          e.target.value     = prev;
          e.target.className = `estado-select ${Pedidos.claseEstado(prev)}`;
        }
      });
    });
  }

  function attachCardTaps(container) {
    container.querySelectorAll('.pedido-card-tap').forEach(tap => {
      tap.addEventListener('click', () => {
        const id = parseInt(tap.dataset.id);
        abrirDetalle(id);
      });
    });
  }

  // ── DETALLE PEDIDO ────────────────────────────────
  async function abrirDetalle(id) {
    _detalleId = id;
    const modal = document.getElementById('detalle-modal');
    const body  = document.getElementById('detalle-body');
    modal.classList.remove('hidden');
    body.innerHTML = '<div style="padding:32px;text-align:center;color:#888">Cargando...</div>';

    try {
      const p = await Pedidos.getPedidoById(id);
      const sufijo = p.sufijo ? `-${p.sufijo}` : '';
      document.getElementById('detalle-orden').textContent = `#${p.orden}${sufijo}`;

      const fechaCarga  = p.fecha_carga  ? new Date(p.fecha_carga).toLocaleDateString('es-AR')  : '—';
      const fechaRetiro = p.fecha_retiro ? new Date(p.fecha_retiro).toLocaleDateString('es-AR') : '—';

      // Solo admin ve el botón editar
      document.getElementById('btn-abrir-edicion').style.display = Auth.isAdmin() ? '' : 'none';

      body.innerHTML = `
        <div class="detalle-seccion">
          <div class="detalle-seccion-title">Cliente</div>
          <div class="detalle-row"><span class="detalle-label">Nombre</span><span class="detalle-valor">${esc(p.cliente)}</span></div>
          <div class="detalle-row"><span class="detalle-label">Orden</span><span class="detalle-valor">#${esc(p.orden)}${sufijo}</span></div>
          <div class="detalle-row"><span class="detalle-label">Tipo</span><span class="detalle-valor">${esc(p.tipo || '—')}</span></div>
          <div class="detalle-row"><span class="detalle-label">Urgente</span><span class="detalle-valor">${p.urgente === 'Si' ? '⚡ Sí' : 'No'}</span></div>
          <div class="detalle-row"><span class="detalle-label">Fecha carga</span><span class="detalle-valor">${fechaCarga}</span></div>
        </div>

        <div class="detalle-seccion">
          <div class="detalle-seccion-title">Lente</div>
          <div class="detalle-row"><span class="detalle-label">Laboratorio</span><span class="detalle-valor">${esc(p.laboratorio || '—')}</span></div>
          <div class="detalle-row"><span class="detalle-label">Tipo de lente</span><span class="detalle-valor">${esc(p.tipo_lente || '—')}</span></div>
          <div class="detalle-row"><span class="detalle-label">Tratamiento</span><span class="detalle-valor">${esc(p.tratamiento || '—')}</span></div>
          <div class="detalle-row"><span class="detalle-label">2 etapas</span><span class="detalle-valor">${p.dos_etapas || 'No'}</span></div>
          ${p.graduacion ? `
          <div class="detalle-row" style="flex-direction:column;align-items:flex-start">
            <span class="detalle-label">Graduación</span>
            <div class="detalle-grad">${esc(p.graduacion).replace(/\|/g,'<br>')}</div>
          </div>` : ''}
        </div>

        ${p.armazon ? `
        <div class="detalle-seccion">
          <div class="detalle-seccion-title">Armazón</div>
          <div class="detalle-row"><span class="detalle-label">Detalle</span><span class="detalle-valor">${esc(p.armazon)}</span></div>
        </div>` : ''}

        <div class="detalle-seccion">
          <div class="detalle-seccion-title">Estado</div>
          <div class="detalle-row"><span class="detalle-label">Estado actual</span><span class="detalle-valor">${esc(p.estado)}</span></div>
          <div class="detalle-row"><span class="detalle-label">Días en proceso</span><span class="detalle-valor">${p._dias}d</span></div>
          <div class="detalle-row"><span class="detalle-label">Est. inteligente</span><span class="detalle-valor">${p._est.texto}</span></div>
          ${p.fecha_retiro ? `<div class="detalle-row"><span class="detalle-label">Fecha retiro</span><span class="detalle-valor">${fechaRetiro}</span></div>` : ''}
          <div class="detalle-row"><span class="detalle-label">Cargado por</span><span class="detalle-valor">${esc(p.cargado_por || '—')}</span></div>
        </div>
      `;
    } catch (e) {
      body.innerHTML = `<p style="padding:16px;color:var(--rojo)">Error: ${e.message}</p>`;
    }
  }

  function cerrarDetalle() {
    document.getElementById('detalle-modal').classList.add('hidden');
    _detalleId = null;
  }

  // ── EDICIÓN PEDIDO ────────────────────────────────
  async function abrirEdicion() {
    if (!_detalleId) return;
    cerrarDetalle();

    const editModal = document.getElementById('edit-modal');
    const editBody  = document.getElementById('edit-body');
    editModal.classList.remove('hidden');
    editBody.innerHTML = '<div style="padding:32px;text-align:center;color:#888">Cargando...</div>';

    try {
      const p    = await Pedidos.getPedidoById(_detalleId);
      const labs = _configCache.laboratorios.map(l =>
        `<option value="${esc(l)}"${l===p.laboratorio?' selected':''}>${esc(l)}</option>`).join('');
      const lentes = ['Monofocal','Bifocal','Ocupacional','Progresivo','Teñido'].map(l =>
        `<option value="${l}"${l===p.tipo_lente?' selected':''}>${l}</option>`).join('');
      const tipos = ['Cristales','Armazón + Cristales','Armazón'].map(t =>
        `<option value="${t}"${t===p.tipo?' selected':''}>${t}</option>`).join('');
      const urgentes = ['Si','No'].map(u =>
        `<option value="${u}"${u===p.urgente?' selected':''}>${u==='Si'?'Sí':'No'}</option>`).join('');
      const etapas = ['No','Si'].map(u =>
        `<option value="${u}"${u===p.dos_etapas?' selected':''}>${u==='Si'?'Sí':'No'}</option>`).join('');

      editBody.innerHTML = `
        <div class="form-section">
          <div class="form-section-title">Cliente</div>
          <div class="form-group">
            <label class="form-label">Nombre</label>
            <input type="text" id="e-cliente" class="form-control" value="${esc(p.cliente || '')}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Nº de orden</label>
              <input type="text" id="e-orden" class="form-control" value="${esc(p.orden || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Urgente</label>
              <select id="e-urgente" class="form-control">${urgentes}</select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de pedido</label>
            <select id="e-tipo" class="form-control">${tipos}</select>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section-title">Lente</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Laboratorio</label>
              <select id="e-lab" class="form-control"><option value="">—</option>${labs}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Tipo de lente</label>
              <select id="e-lente" class="form-control"><option value="">—</option>${lentes}</select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Tratamiento</label>
            <input type="text" id="e-tratamiento" class="form-control" value="${esc(p.tratamiento || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Graduación</label>
            <textarea id="e-graduacion" class="form-control" rows="3" style="resize:vertical;font-family:var(--font-mono);font-size:.85rem">${esc(p.graduacion || '')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">2 etapas</label>
            <select id="e-etapas" class="form-control">${etapas}</select>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section-title">Armazón</div>
          <div class="form-group">
            <label class="form-label">Detalle</label>
            <input type="text" id="e-armazon" class="form-control" value="${esc(p.armazon || '')}">
          </div>
        </div>

        <button class="edit-save-btn" onclick="App.guardarEdicion(${p.id})">
          Guardar cambios
        </button>
      `;
    } catch (e) {
      editBody.innerHTML = `<p style="padding:16px;color:var(--rojo)">Error: ${e.message}</p>`;
    }
  }

  async function guardarEdicion(id) {
    const btn = document.querySelector('.edit-save-btn');
    if (btn) { btn.textContent = 'Guardando...'; btn.disabled = true; }

    try {
      const campos = {
        cliente:     document.getElementById('e-cliente')?.value.trim(),
        orden:       document.getElementById('e-orden')?.value.trim(),
        urgente:     document.getElementById('e-urgente')?.value,
        tipo:        document.getElementById('e-tipo')?.value,
        laboratorio: document.getElementById('e-lab')?.value,
        tipo_lente:  document.getElementById('e-lente')?.value,
        tratamiento: document.getElementById('e-tratamiento')?.value.trim() || null,
        graduacion:  document.getElementById('e-graduacion')?.value.trim() || null,
        dos_etapas:  document.getElementById('e-etapas')?.value,
        armazon:     document.getElementById('e-armazon')?.value.trim() || null,
      };

      await Pedidos.actualizarPedido(id, campos);
      cerrarEdicion();
      toast('Pedido actualizado ✓', 'success');
      _pedidosCache = await Pedidos.getTodosPedidos();
      if (_currentScreen === 'pedidos')     renderPedidosList();
      if (_currentScreen === 'seguimiento') loadSeguimiento();
    } catch (e) {
      toast(`Error: ${e.message}`, 'error');
      if (btn) { btn.textContent = 'Guardar cambios'; btn.disabled = false; }
    }
  }

  function cerrarEdicion() {
    document.getElementById('edit-modal').classList.add('hidden');
  }

  // ── PANEL ─────────────────────────────────────────
  async function refreshPanel() {
    if (!Auth.isAdmin()) return;
    await Panel.render();
    updateBadge();
  }

  async function updateBadge() {
    if (!Auth.isAdmin()) return;
    try {
      const todos = _pedidosCache.length ? _pedidosCache : await Pedidos.getPedidosActivos();
      const count = Panel.contarCriticos(todos);
      const badge = document.getElementById('criticos-badge');
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    } catch {}
  }

  // ── CONFIG SCREEN ─────────────────────────────────
  async function loadConfigScreen() {
    await loadConfig();
    renderConfigLabs();
    loadConfigTratamientos();
  }

  function renderConfigLabs() {
    const el = document.getElementById('config-labs-list');
    if (!el) return;
    el.innerHTML = _configCache.laboratorios.length
      ? _configCache.laboratorios.map(lab => `
          <div class="config-item">
            <span>${esc(lab)}</span>
            <button class="btn btn-danger btn-sm" onclick="App.deleteLab('${esc(lab)}')">Eliminar</button>
          </div>`).join('')
      : '<p style="color:var(--gris-texto);font-size:.85rem;padding:8px 0">Sin laboratorios</p>';
  }

  async function loadConfigTratamientos() {
    const lente = document.getElementById('config-lente-select')?.value;
    const el    = document.getElementById('config-trat-list');
    if (!el || !lente) return;
    const lista = _configCache.tratamientos[lente] || [];
    el.innerHTML = lista.length
      ? lista.map(t => `
          <div class="config-item">
            <span>${esc(t.valor)}</span>
            <button class="btn btn-danger btn-sm" onclick="App.deleteTratamiento(${t.id})">Eliminar</button>
          </div>`).join('')
      : '<p style="color:var(--gris-texto);font-size:.85rem;padding:8px 0">Sin tratamientos</p>';
  }

  async function addLab() {
    const input = document.getElementById('new-lab-input');
    const valor = input.value.trim();
    if (!valor) return;
    try {
      await window.supabaseClient.from('configuracion').insert({ tipo:'laboratorio', valor, orden:99 });
      input.value = '';
      await loadConfig(); renderConfigLabs();
      buildBloqueFields(1); buildBloqueFields(2);
      toast('Laboratorio agregado', 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  }

  async function deleteLab(valor) {
    if (!confirm(`¿Eliminar laboratorio "${valor}"?`)) return;
    try {
      await window.supabaseClient.from('configuracion').delete().eq('tipo','laboratorio').eq('valor',valor);
      await loadConfig(); renderConfigLabs();
      buildBloqueFields(1); buildBloqueFields(2);
      toast('Laboratorio eliminado', 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  }

  async function addTratamiento() {
    const lente = document.getElementById('config-lente-select')?.value;
    const input = document.getElementById('new-trat-input');
    const valor = input.value.trim();
    if (!valor || !lente) return;
    try {
      await window.supabaseClient.from('configuracion').insert({ tipo:'tratamiento', categoria:lente, valor, orden:99 });
      input.value = '';
      await loadConfig(); loadConfigTratamientos();
      toast('Tratamiento agregado', 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  }

  async function deleteTratamiento(id) {
    if (!confirm('¿Eliminar este tratamiento?')) return;
    try {
      await window.supabaseClient.from('configuracion').delete().eq('id', id);
      await loadConfig(); loadConfigTratamientos();
      toast('Tratamiento eliminado', 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  }

  // ── FORM NUEVO PEDIDO ─────────────────────────────
  function getGraduacion(num) {
    const dist = document.querySelector(`#dist-tabs${num} .dist-tab.active`)?.dataset.dist || 'lejos';
    const leer = (dc) => {
      const v = (campo, ojo) => document.getElementById(`g-${dc}-${campo}-${ojo}-${num}`)?.value.trim() || '';
      const partes = [];
      ['D','I'].forEach(ojo => {
        const esf = v('esf',ojo), cil = v('cil',ojo), eje = v('eje',ojo), add = v('add',ojo);
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

  function getFormData() {
    const g     = id => document.getElementById(id)?.value.trim() ?? '';
    const doble = document.getElementById('toggle-dos-anteojos').checked;
    const antData = (n) => ({
      laboratorio: g(`f-lab${n}`),
      tipo_lente:  g(`f-lente${n}`),
      tratamiento: g(`f-tratamiento${n}`),
      graduacion:  getGraduacion(n),
      dos_etapas:  g(`f-etapas${n}`),
      armazon:     g(`f-armazon${n}`),
      marca:       g(`f-marca${n}`),
      codigoref:   g(`f-codigoref${n}`),
      material:    g(`f-material${n}`),
      color:       g(`f-color${n}`),
    });
    return {
      doble,
      base: { cliente: g('f-cliente'), orden: g('f-orden'), urgente: g('f-urgente'), tipo: g('f-tipo'), fecha_carga: g('f-fecha-carga') || todayStr() },
      ant1: antData(1),
      ant2: doble ? antData(2) : null,
    };
  }

  function validateForm(data) {
    let valid = true;
    const check = (fId, eId, cond) => {
      const f = document.getElementById(fId), e = document.getElementById(eId);
      if (!f || !e) return;
      f.classList.toggle('error', cond); e.classList.toggle('visible', cond);
      if (cond) valid = false;
    };
    check('f-cliente','err-cliente', !data.base.cliente);
    check('f-orden',  'err-orden',   !data.base.orden);
    check('f-urgente','err-urgente', !data.base.urgente);
    check('f-tipo',   'err-tipo',    !data.base.tipo);
    check('f-lab1',   'err-lab1',    !data.ant1.laboratorio);
    check('f-lente1', 'err-lente1',  !data.ant1.tipo_lente);
    if (data.doble) {
      check('f-lab2',  'err-lab2',   !data.ant2.laboratorio);
      check('f-lente2','err-lente2', !data.ant2.tipo_lente);
    }
    return valid;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const data = getFormData();
    if (!validateForm(data)) { toast('Completá los campos obligatorios', 'warn'); return; }

    const rf = (label, val) => val ? `<div class="modal-row"><span class="modal-label">${label}</span><span class="modal-value">${esc(String(val))}</span></div>` : '';
    let html = rf('Cliente', data.base.cliente) + rf('Orden', data.doble ? `${data.base.orden}-A / -B` : data.base.orden)
             + rf('Tipo', data.base.tipo) + rf('Urgente', data.base.urgente) + rf('Fecha', data.base.fecha_carga);

    if (data.doble) {
      html += `<div style="margin:10px 0 4px;font-size:.78rem;font-weight:700;color:var(--azul)">ANTEOJO A</div>`;
      html += rf('Lab', data.ant1.laboratorio) + rf('Lente', data.ant1.tipo_lente) + rf('Tratamiento', data.ant1.tratamiento) + rf('Graduación', data.ant1.graduacion);
      html += `<div style="margin:10px 0 4px;font-size:.78rem;font-weight:700;color:var(--azul)">ANTEOJO B</div>`;
      html += rf('Lab', data.ant2.laboratorio) + rf('Lente', data.ant2.tipo_lente) + rf('Tratamiento', data.ant2.tratamiento) + rf('Graduación', data.ant2.graduacion);
    } else {
      html += rf('Laboratorio', data.ant1.laboratorio) + rf('Lente', data.ant1.tipo_lente)
            + rf('Tratamiento', data.ant1.tratamiento) + rf('Graduación', data.ant1.graduacion);
    }

    document.getElementById('modal-body-content').innerHTML = html;
    _pendingGuardar = data;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }

  async function handleConfirm() {
    if (!_pendingGuardar) return;
    const data = _pendingGuardar;
    const btn  = document.getElementById('modal-confirm-btn');
    btn.classList.add('btn-loading'); btn.disabled = true;

    try {
      const nombre   = Auth.getNombre();
      const fechaISO = new Date(data.base.fecha_carga + 'T12:00:00').toISOString();
      const buildRow = (ant, sufijo) => ({
        cliente:     data.base.cliente,
        orden:       data.base.orden,
        sufijo,
        tipo:        data.base.tipo,
        urgente:     data.base.urgente,
        laboratorio: ant.laboratorio,
        tipo_lente:  ant.tipo_lente,
        tratamiento: ant.tratamiento || null,
        graduacion:  ant.graduacion  || null,
        dos_etapas:  ant.dos_etapas  || 'No',
        armazon:     [ant.armazon, ant.marca && `Marca: ${ant.marca}`, ant.codigoref && `Ref: ${ant.codigoref}`, ant.material && `Mat: ${ant.material}`, ant.color && `Color: ${ant.color}`].filter(Boolean).join(' / ') || null,
        cargado_por: nombre,
        fecha_carga: fechaISO,
        fecha_pedido:fechaISO,
      });

      const rows = data.doble
        ? [buildRow(data.ant1, 'A'), buildRow(data.ant2, 'B')]
        : [buildRow(data.ant1, null)];

      await Pedidos.crearPedido(rows);
      closeModal();
      toast('Pedido guardado ✓', 'success');
      resetForm();
    } catch (err) {
      closeModal();
      toast(err.message, 'error');
    } finally {
      btn.classList.remove('btn-loading'); btn.disabled = false;
    }
  }

  function resetForm() {
    document.getElementById('form-nuevo-pedido').reset();
    document.getElementById('f-fecha-carga').value = todayStr();
    document.getElementById('bloque-anteojo2').classList.add('hidden');
    document.getElementById('bloque1-title').textContent = 'Anteojo';
    document.querySelectorAll('.form-control').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('.form-error').forEach(el => el.classList.remove('visible'));
    [1,2].forEach(n => { try { setDistancia(n,'lejos'); } catch {} });
    _pendingGuardar = null;
  }

  function closeModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
    _pendingGuardar = null;
  }

  // ── UTILS ─────────────────────────────────────────
  function todayStr() { return new Date().toISOString().slice(0,10); }

  function toast(msg, tipo = 'success') {
    const container = document.getElementById('toast-container');
    const div = document.createElement('div');
    div.className = `toast toast-${tipo}`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => div.remove(), 3100);
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.toast   = toast;
  window.escHtml = esc;

  return {
    init, showScreen,
    loadPedidos, loadSeguimiento, refreshPanel, resetForm,
    switchEstadoTab, switchSegTab, limpiarFiltros,
    onLenteChange, setDistancia,
    loadConfigScreen, loadConfigTratamientos,
    addLab, deleteLab, addTratamiento, deleteTratamiento,
    guardarEdicion,
  };
})();

App.init();
