// ============================================================
// PEDIDOS.JS — OLVISIÓN
// ============================================================

// ─── CONFIG CACHE ─────────────────────────────────────────────
let _cfg = { laboratorios: [], tratamientos: [], marcas: [], materiales: [] };
let _pedidosCache = [];
let _historialCache = [];
let _historialFecha = new Date();
let _historialEstado = 'todos';

// ─── ESTADO INTELIGENTE ───────────────────────────────────────
const LIMITES_LAB = {
  'Bichara':  { ok: 2, dem: 4 },
  'Sol':      { ok: 5, dem: 7 },
  'Vitolen':  { ok: 5, dem: 7 },
  'Cristian': { ok: 7, dem: 10 },
};

function calcDiasHabiles(desde, hasta) {
  let n = 0;
  const d = new Date(desde); d.setHours(0,0,0,0);
  const h = new Date(hasta);  h.setHours(0,0,0,0);
  while (d < h) { const dow = d.getDay(); if (dow !== 0 && dow !== 6) n++; d.setDate(d.getDate()+1); }
  return n;
}

function calcEstadoInteligente(p) {
  if (p.estado === 'Retirado') return 'retirado';
  const desde = new Date(p.fecha_pedido || p.fecha_carga);
  const hasta = p.fecha_retiro ? new Date(p.fecha_retiro) : new Date();
  const dias  = calcDiasHabiles(desde, hasta);
  const lim   = LIMITES_LAB[p.laboratorio];
  if (!lim) return 'ok';
  if (dias <= lim.ok)  return 'ok';
  if (dias <= lim.dem) return 'demorado';
  return 'critico';
}

function calcDias(p) {
  return calcDiasHabiles(
    new Date(p.fecha_pedido || p.fecha_carga),
    p.fecha_retiro ? new Date(p.fecha_retiro) : new Date()
  );
}

// ─── MÓDULO PEDIDOS (requerido por panel.js) ──────────────────
const Pedidos = (() => {
  function _enriquecer(p) {
    const est = calcEstadoInteligente(p);
    const dias = calcDias(p);
    const estObj = {
      'ok':       { valor:'ok',       texto:'✅ OK',          clase:'badge-ok',       color:'#15803D' },
      'demorado': { valor:'demorado', texto:'⚠️ Demorado',    clase:'badge-demorado', color:'#C2410C' },
      'critico':  { valor:'critico',  texto:'🔴 Crítico',     clase:'badge-critico',  color:'#DC2626' },
      'retirado': { valor:'retirado', texto:'✓ Retirado',     clase:'badge-retirado', color:'#7C3AED' },
    };
    return { ...p, _est: estObj[est] || estObj.ok, _dias: dias };
  }

  async function getTodosPedidos() {
    const { data, error } = await window.supabaseClient
      .from('pedidos').select('*')
      .order('fecha_carga', { ascending: false });
    if (error) throw error;
    return (data || []).map(_enriquecer);
  }

  return { getTodosPedidos, _enriquecer };
})();

// ─── CONFIG DINÁMICA ──────────────────────────────────────────
async function cargarConfiguracion() {
  const { data } = await window.supabaseClient
    .from('configuracion')
    .select('tipo, subtipo, valor, orden')
    .order('orden', { ascending: true });
  if (!data) return;
  _cfg.laboratorios = data.filter(d => d.tipo === 'laboratorio').map(d => d.valor);
  _cfg.marcas       = data.filter(d => d.tipo === 'marca').map(d => d.valor);
  _cfg.materiales   = data.filter(d => d.tipo === 'material').map(d => d.valor);
  _cfg.tratamientos = data.filter(d => d.tipo === 'tratamiento');
  _poblarBloqueFields('bloque1-fields', 1);
}

// ─── CARGA SEGUIMIENTO ────────────────────────────────────────
async function loadPedidos() {
  const { data } = await window.supabaseClient
    .from('pedidos').select('*')
    .not('estado', 'eq', 'Retirado')
    .order('fecha_carga', { ascending: false });

  _pedidosCache = (data || []).map(Pedidos._enriquecer);
  window._pedidosCache = _pedidosCache;
  _renderSeguimiento();
  if (typeof App !== 'undefined') App._actualizarBadge();
}

const ESTADO_COLOR = {
  'Cristales pedidos a lab':     { bg:'#FFF8E7', borde:'#F59E0B', txt:'#78350F' },
  'Armazón enviado p/calibrado': { bg:'#EEF2FF', borde:'#6366F1', txt:'#312E81' },
  'En laboratorio':              { bg:'#EFF6FF', borde:'#034291', txt:'#1E3A6E' },
  'Pendiente de retirar':        { bg:'#F0FDF4', borde:'#10B981', txt:'#064E3B' },
  'Retirado':                    { bg:'#F5F3FF', borde:'#7C3AED', txt:'#4C1D95' },
};
const INTEL_COLOR = {
  ok:       { bg:'#F0FDF4', txt:'#15803D', lbl:'OK' },
  demorado: { bg:'#FFF7ED', txt:'#C2410C', lbl:'Demorado' },
  critico:  { bg:'#FEF2F2', txt:'#DC2626', lbl:'⚠ Crítico' },
  retirado: { bg:'#F5F3FF', txt:'#7C3AED', lbl:'Retirado' },
};

function _renderSeguimiento() {
  const labEl  = document.getElementById('seg-content-lab');
  const retEl  = document.getElementById('seg-content-retirar');
  const cntLab = document.getElementById('seg-count-lab');
  const cntRet = document.getElementById('seg-count-retirar');
  if (!labEl) return;

  const enLab = _pedidosCache.filter(p => p.estado !== 'Pendiente de retirar');
  const pRet  = _pedidosCache.filter(p => p.estado === 'Pendiente de retirar');

  if (cntLab) cntLab.textContent = enLab.length;
  if (cntRet) cntRet.textContent = pRet.length;

  const prio = { critico:0, demorado:1, ok:2, retirado:3 };
  const sort = arr => [...arr].sort((a,b) => (prio[a._est.valor]??9) - (prio[b._est.valor]??9));

  labEl.innerHTML = _renderGrupo(sort(enLab), 'No hay pedidos activos en laboratorio.');
  if (retEl) retEl.innerHTML = _renderGrupo(sort(pRet), 'No hay pedidos pendientes de retiro.');
}

function _renderGrupo(lista, vacioMsg) {
  if (!lista.length) return `<div style="padding:32px 16px;text-align:center;color:var(--gris-texto);font-size:.9rem">${vacioMsg}</div>`;
  const vistos = new Set(), grupos = [];
  lista.forEach(p => {
    if (vistos.has(p.id)) return; vistos.add(p.id);
    if (p.sufijo === 'A') {
      const par = lista.find(q => q.orden === p.orden && q.sufijo === 'B');
      if (par) { vistos.add(par.id); grupos.push({ tipo:'par', a:p, b:par }); return; }
    }
    grupos.push({ tipo:'simple', p });
  });
  return '<div style="border-radius:12px;overflow:hidden;border:1.5px solid var(--gris-borde)">' +
    grupos.map((g,i) => {
      const sep = i > 0 ? 'border-top:1px solid var(--gris-borde);' : '';
      return g.tipo === 'par' ? _cardPar(g.a, g.b, sep) : _card(g.p, sep);
    }).join('') + '</div>';
}

function _card(p, sep='') {
  const ci  = INTEL_COLOR[p._est.valor] || INTEL_COLOR.ok;
  const ce  = ESTADO_COLOR[p.estado] || { borde:'#888', bg:'#F5F5F5', txt:'#555' };
  const crit = p._est.valor === 'critico';
  return `<div style="${sep}border-left:4px solid ${crit?'#DC2626':ce.borde};cursor:pointer;padding:12px 14px;background:#fff;display:flex;align-items:center;gap:10px" onclick="abrirDetalle(${p.id})">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="font-family:var(--font-mono);font-size:.82rem;font-weight:700;color:var(--azul)">${p.orden}${p.sufijo?'-'+p.sufijo:''}</span>
        ${p.urgente==='Si'?'<span style="font-size:.68rem;background:#FEF3C7;color:#92400E;border-radius:4px;padding:1px 5px;font-weight:700">URGENTE</span>':''}
        <span style="font-size:.72rem;background:${ci.bg};color:${ci.txt};border-radius:4px;padding:1px 6px;font-weight:600;margin-left:auto">${ci.lbl}</span>
      </div>
      <div style="font-size:.9rem;font-weight:600;color:var(--gris-dark);margin-bottom:4px">${p.cliente}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:.75rem;background:${ce.bg};color:${ce.txt};border-radius:6px;padding:2px 8px">${p.laboratorio||'—'}</span>
        <span style="font-size:.75rem;color:var(--gris-texto)">${p.tipo_lente||'—'}</span>
        <span style="font-size:.75rem;color:var(--gris-texto);margin-left:auto">${p._dias}d</span>
      </div>
    </div>
    <select onclick="event.stopPropagation()" onchange="cambiarEstado(${p.id},this.value,event)"
      style="font-size:.75rem;border:1.5px solid var(--gris-borde);border-radius:8px;padding:6px 4px;background:#fff;color:var(--gris-dark);cursor:pointer;flex-shrink:0;max-width:120px">
      ${_opcionesEstado(p.estado)}
    </select>
  </div>`;
}

function _cardPar(a, b, sep='') {
  const ciA = INTEL_COLOR[a._est.valor], ciB = INTEL_COLOR[b._est.valor];
  const crit = a._est.valor==='critico'||b._est.valor==='critico';
  const borde = crit ? '#DC2626' : (ESTADO_COLOR[a.estado]?.borde||'#888');
  return `<div style="${sep}border-left:4px solid ${borde};background:#fff;padding:12px 14px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span style="font-family:var(--font-mono);font-size:.82rem;font-weight:700;color:var(--azul)">${a.orden}</span>
      <span style="font-size:.72rem;background:var(--azul-light);color:var(--azul);border-radius:4px;padding:1px 6px">2 anteojos</span>
      ${a.urgente==='Si'?'<span style="font-size:.68rem;background:#FEF3C7;color:#92400E;border-radius:4px;padding:1px 5px;font-weight:700">URGENTE</span>':''}
    </div>
    <div style="font-size:.9rem;font-weight:600;color:var(--gris-dark);margin-bottom:6px">${a.cliente}</div>
    ${_filapar(a, ciA, 'A')}
    ${_filapar(b, ciB, 'B')}
  </div>`;
}

function _filapar(p, ci, suf) {
  return `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid var(--gris-bg);cursor:pointer" onclick="abrirDetalle(${p.id})">
    <span style="width:20px;height:20px;border-radius:50%;background:${suf==='A'?'#034291':'#0891B2'};color:#fff;font-size:.72rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${suf}</span>
    <span style="font-size:.8rem;color:var(--gris-texto);flex:1">${p.laboratorio||'—'} · ${p.tipo_lente||'—'} · ${p._dias}d</span>
    <span style="font-size:.72rem;background:${ci.bg};color:${ci.txt};border-radius:4px;padding:1px 6px">${ci.lbl}</span>
    <select onclick="event.stopPropagation()" onchange="cambiarEstado(${p.id},this.value,event)"
      style="font-size:.72rem;border:1.5px solid var(--gris-borde);border-radius:6px;padding:4px 4px;background:#fff;max-width:110px">
      ${_opcionesEstado(p.estado)}
    </select>
  </div>`;
}

const ESTADOS = ['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
function _opcionesEstado(actual) {
  return ESTADOS.map(e => `<option value="${e}" ${e===actual?'selected':''}>${e}</option>`).join('');
}

// ─── CAMBIAR ESTADO ───────────────────────────────────────────
async function cambiarEstado(id, nuevoEstado, event) {
  if (event) event.stopPropagation();
  const upd = { estado: nuevoEstado };
  if (nuevoEstado === 'Retirado') upd.fecha_retiro = new Date().toISOString();
  const { error } = await window.supabaseClient.from('pedidos').update(upd).eq('id', id);
  if (error) { showToast('Error al actualizar.', 'error'); return; }
  showToast('Estado actualizado.');
  await loadPedidos();
}

// ─── DETALLE ──────────────────────────────────────────────────
async function abrirDetalle(id) {
  const modal = document.getElementById('detalle-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const { data: p } = await window.supabaseClient.from('pedidos').select('*').eq('id', id).single();
  if (!p) return;
  const ep = Pedidos._enriquecer(p);
  const ci = INTEL_COLOR[ep._est.valor];

  document.getElementById('detalle-orden').textContent = `#${p.orden}${p.sufijo?'-'+p.sufijo:''}`;

  const fCarga  = new Date(p.fecha_carga).toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'});
  const fRetiro = p.fecha_retiro ? new Date(p.fecha_retiro).toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'}) : null;

  document.getElementById('detalle-body').innerHTML = `
    <div style="padding-top:14px">
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
        <span style="background:${ci.bg};color:${ci.txt};border-radius:6px;padding:4px 10px;font-size:.82rem;font-weight:600">${ep._est.texto} · ${ep._dias}d</span>
        ${p.urgente==='Si'?'<span style="background:#FEF3C7;color:#92400E;border-radius:6px;padding:4px 10px;font-size:.82rem;font-weight:600">URGENTE</span>':''}
      </div>
      <div class="detalle-seccion">
        <div class="detalle-seccion-title">Pedido</div>
        ${_dr('Cliente',     p.cliente)}
        ${_dr('Laboratorio', p.laboratorio)}
        ${_dr('Tipo lente',  p.tipo_lente)}
        ${p.tratamiento ? _dr('Tratamiento', p.tratamiento) : ''}
        ${_dr('Tipo',        p.tipo)}
        ${_dr('Estado',      p.estado)}
        ${p.dos_etapas==='Si'?_dr('2 etapas','Sí'):''}
        ${p.armazon?_dr('Armazón',p.armazon):''}
      </div>
      ${p.graduacion?`<div class="detalle-seccion"><div class="detalle-seccion-title">Graduación</div><div class="detalle-grad">${p.graduacion.replace(/\|/g,'<br>')}</div></div>`:''}
      <div class="detalle-seccion">
        <div class="detalle-seccion-title">Info</div>
        ${_dr('Cargado por', p.cargado_por)}
        ${_dr('Fecha carga', fCarga)}
        ${fRetiro?_dr('Fecha retiro',fRetiro):''}
      </div>
      <div style="margin-top:16px">
        <label style="font-size:.78rem;color:var(--gris-texto);font-weight:600;display:block;margin-bottom:6px">Cambiar estado</label>
        <select onchange="cambiarEstado(${p.id},this.value,event)" style="width:100%;padding:10px 12px;border:1.5px solid var(--gris-borde);border-radius:10px;font-size:.9rem">
          ${_opcionesEstado(p.estado)}
        </select>
      </div>
    </div>`;

  const esAdm = typeof Auth !== 'undefined' && Auth.isAdmin();
  const btnEdit = document.getElementById('btn-abrir-edicion');
  const btnDel  = document.getElementById('btn-eliminar-pedido');
  if (btnEdit) btnEdit.style.display = esAdm ? '' : 'none';
  if (btnDel)  btnDel.style.display  = esAdm ? '' : 'none';

  const newEdit = btnEdit?.cloneNode(true);
  if (newEdit) { btnEdit.parentNode.replaceChild(newEdit, btnEdit); newEdit.addEventListener('click', () => abrirEdicion(p)); }
  const newDel = btnDel?.cloneNode(true);
  if (newDel)  { btnDel.parentNode.replaceChild(newDel, btnDel); newDel.addEventListener('click', () => { if (confirm('¿Eliminar este pedido?')) eliminarPedido(p.id); }); }

  document.getElementById('btn-cerrar-detalle')?.addEventListener('click', cerrarDetalle, { once:true });
  modal.onclick = e => { if (e.target === modal) cerrarDetalle(); };
}

function _dr(label, valor) {
  return `<div class="detalle-row"><span class="detalle-label">${label}</span><span class="detalle-valor">${valor||'—'}</span></div>`;
}
function cerrarDetalle() { document.getElementById('detalle-modal')?.classList.add('hidden'); }

async function eliminarPedido(id) {
  const { error } = await window.supabaseClient.from('pedidos').delete().eq('id', id);
  if (error) { showToast('Error al eliminar.', 'error'); return; }
  showToast('Pedido eliminado.');
  cerrarDetalle();
  await loadPedidos();
}

// ─── EDICIÓN ──────────────────────────────────────────────────
function abrirEdicion(p) {
  const modal = document.getElementById('edit-modal');
  if (!modal) return;
  cerrarDetalle();
  modal.classList.remove('hidden');
  const labOpts  = _cfg.laboratorios.map(l => `<option value="${l}" ${p.laboratorio===l?'selected':''}>${l}</option>`).join('');
  const tratOpts = '<option value="">Sin tratamiento</option>' + _cfg.tratamientos.map(t => `<option value="${t.valor}" ${p.tratamiento===t.valor?'selected':''}>${t.valor}</option>`).join('');
  document.getElementById('edit-body').innerHTML = `
    <div class="form-group"><label class="form-label">Cliente</label><input class="form-control" id="edit-cliente" value="${p.cliente||''}"></div>
    <div class="form-group"><label class="form-label">N° Orden</label><input class="form-control" id="edit-orden" value="${p.orden||''}"></div>
    <div class="form-group"><label class="form-label">Laboratorio</label><select class="form-control" id="edit-lab"><option value="">—</option>${labOpts}</select></div>
    <div class="form-group"><label class="form-label">Tipo de lente</label>
      <select class="form-control" id="edit-lente"><option value="">—</option>
        ${['Monofocal','Bifocal','Ocupacional','Progresivo','Teñido'].map(l=>`<option value="${l}" ${p.tipo_lente===l?'selected':''}>${l}</option>`).join('')}
      </select></div>
    <div class="form-group"><label class="form-label">Tratamiento</label><select class="form-control" id="edit-trat">${tratOpts}</select></div>
    <div class="form-group"><label class="form-label">Estado</label><select class="form-control" id="edit-estado">${_opcionesEstado(p.estado)}</select></div>
    <div class="form-group"><label class="form-label">Urgente</label>
      <select class="form-control" id="edit-urgente">
        <option value="No" ${p.urgente==='No'?'selected':''}>No</option>
        <option value="Si" ${p.urgente==='Si'?'selected':''}>Sí</option>
      </select></div>
    <button class="edit-save-btn" onclick="guardarEdicion(${p.id})">Guardar cambios</button>`;
  document.getElementById('btn-cerrar-edit')?.addEventListener('click', () => modal.classList.add('hidden'), { once:true });
}

async function guardarEdicion(id) {
  const nuevoEstado = document.getElementById('edit-estado')?.value;
  const upd = {
    cliente:     document.getElementById('edit-cliente')?.value.trim(),
    orden:       document.getElementById('edit-orden')?.value.trim(),
    laboratorio: document.getElementById('edit-lab')?.value,
    tipo_lente:  document.getElementById('edit-lente')?.value,
    tratamiento: document.getElementById('edit-trat')?.value || null,
    estado:      nuevoEstado,
    urgente:     document.getElementById('edit-urgente')?.value,
  };
  if (nuevoEstado === 'Retirado') upd.fecha_retiro = new Date().toISOString();
  const { error } = await window.supabaseClient.from('pedidos').update(upd).eq('id', id);
  if (error) { showToast('Error al guardar.', 'error'); return; }
  showToast('Pedido actualizado.');
  document.getElementById('edit-modal')?.classList.add('hidden');
  await loadPedidos();
}

// ─── HISTORIAL ────────────────────────────────────────────────
function initHistorial() { _loadHistorial(); }

async function _loadHistorial() {
  const año = _historialFecha.getFullYear();
  const mes  = _historialFecha.getMonth();
  const mesNombre = _historialFecha.toLocaleString('es-AR', { month:'long', year:'numeric' });

  const navEl = document.getElementById('mes-nav-container');
  if (navEl) navEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <button onclick="historialMesAnterior()" style="width:32px;height:32px;border-radius:50%;border:1.5px solid var(--gris-borde);background:#fff;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center">‹</button>
      <span style="flex:1;text-align:center;font-size:.9rem;font-weight:600;color:var(--azul);text-transform:capitalize">${mesNombre}</span>
      <button onclick="historialMesSiguiente()" style="width:32px;height:32px;border-radius:50%;border:1.5px solid var(--gris-borde);background:#fff;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center">›</button>
    </div>`;

  const skeleton = document.getElementById('pedidos-skeleton');
  const listEl   = document.getElementById('pedidos-list-container');
  if (skeleton) skeleton.style.display = 'flex';
  if (listEl)   listEl.style.display   = 'none';

  const inicio = new Date(año, mes, 1).toISOString();
  const fin    = new Date(año, mes+1, 0, 23, 59, 59).toISOString();
  const { data } = await window.supabaseClient
    .from('pedidos').select('*')
    .gte('fecha_carga', inicio).lte('fecha_carga', fin)
    .order('fecha_carga', { ascending: false });

  _historialCache = (data || []).map(Pedidos._enriquecer);
  if (skeleton) skeleton.style.display = 'none';
  if (listEl)   listEl.style.display   = 'block';
  filtrarPorEstado(_historialEstado);
}

function filtrarPorEstado(estado) {
  _historialEstado = estado;
  const listEl = document.getElementById('pedidos-list-container');
  if (!listEl) return;
  let lista = estado === 'todos' ? _historialCache : _historialCache.filter(p => p.estado === estado);
  if (!lista.length) {
    listEl.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--gris-texto)">Sin pedidos en este período.</div>';
    return;
  }
  listEl.innerHTML = '<div style="border-radius:12px;overflow:hidden;border:1.5px solid var(--gris-borde)">' +
    lista.map((p,i) => _card(p, i > 0 ? 'border-top:1px solid var(--gris-borde);' : '')).join('') + '</div>';
}

function historialMesAnterior()  { _historialFecha.setMonth(_historialFecha.getMonth()-1); _loadHistorial(); }
function historialMesSiguiente() {
  const hoy = new Date();
  if (_historialFecha.getFullYear()===hoy.getFullYear() && _historialFecha.getMonth()===hoy.getMonth()) return;
  _historialFecha.setMonth(_historialFecha.getMonth()+1); _loadHistorial();
}

// ─── FORM NUEVO PEDIDO ────────────────────────────────────────
function _poblarBloqueFields(containerId, num) {
  const el = document.getElementById(containerId);
  if (!el || el.dataset.poblado === '1') return;
  el.dataset.poblado = '1';
  const suf = num === 1 ? 'a' : 'b';
  const labOpts   = _cfg.laboratorios.map(l => `<option value="${l}">${l}</option>`).join('');
  const marcaOpts = '<option value="">Sin marca</option>' + _cfg.marcas.map(m => `<option value="${m}">${m}</option>`).join('');
  const matOpts   = '<option value="">—</option>' + _cfg.materiales.map(m => `<option value="${m}">${m}</option>`).join('');

  el.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label required">Laboratorio</label>
        <select id="f-lab-${suf}" class="form-control"><option value="">— Seleccionar —</option>${labOpts}</select>
        <div class="form-error" id="err-lab-${suf}">Campo obligatorio</div>
      </div>
      <div class="form-group">
        <label class="form-label required">Tipo de lente</label>
        <select id="f-lente-${suf}" class="form-control" onchange="_onLenteChange('${suf}')">
          <option value="">— Seleccionar —</option>
          <option>Monofocal</option><option>Bifocal</option><option>Ocupacional</option><option>Progresivo</option><option>Teñido</option>
        </select>
        <div class="form-error" id="err-lente-${suf}">Campo obligatorio</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Tratamiento</label>
      <select id="f-trat-${suf}" class="form-control"><option value="">Sin tratamiento</option></select>
    </div>
    <div class="form-group">
      <label class="form-label">Graduación</label>
      <div class="grad-table">
        <div class="grad-header-row"><span></span><span>Esf</span><span>Cil</span><span>Eje</span><span>Add</span></div>
        <div class="grad-data-row">
          <span class="grad-ojo-label">OD</span>
          <input class="grad-input" id="${suf}-od-esf" readonly onclick="abrirNumpad(this)" data-bloque="${suf}" data-ojo="od" data-campo="esf" placeholder="±0.00">
          <input class="grad-input" id="${suf}-od-cil" readonly onclick="abrirNumpad(this)" data-bloque="${suf}" data-ojo="od" data-campo="cil" placeholder="±0.00">
          <input class="grad-input" id="${suf}-od-eje" inputmode="numeric" data-bloque="${suf}" data-ojo="od" data-campo="eje" placeholder="0°" oninput="this.value=this.value.replace(/[^0-9]/g,'');if(parseInt(this.value)>180)this.value='180'">
          <input class="grad-input" id="${suf}-od-add" readonly onclick="abrirNumpad(this)" data-bloque="${suf}" data-ojo="od" data-campo="add" placeholder="+0.00">
        </div>
        <div class="grad-data-row">
          <span class="grad-ojo-label">OI</span>
          <input class="grad-input" id="${suf}-oi-esf" readonly onclick="abrirNumpad(this)" data-bloque="${suf}" data-ojo="oi" data-campo="esf" placeholder="±0.00">
          <input class="grad-input" id="${suf}-oi-cil" readonly onclick="abrirNumpad(this)" data-bloque="${suf}" data-ojo="oi" data-campo="cil" placeholder="±0.00">
          <input class="grad-input" id="${suf}-oi-eje" inputmode="numeric" data-bloque="${suf}" data-ojo="oi" data-campo="eje" placeholder="0°" oninput="this.value=this.value.replace(/[^0-9]/g,'');if(parseInt(this.value)>180)this.value='180'">
          <input class="grad-input" id="${suf}-oi-add" readonly onclick="abrirNumpad(this)" data-bloque="${suf}" data-ojo="oi" data-campo="add" placeholder="+0.00">
        </div>
      </div>
    </div>
    <div class="toggle-group">
      <span class="toggle-label">Trabajo en 2 etapas</span>
      <label class="toggle-switch"><input type="checkbox" id="f-dos-etapas-${suf}"><span class="toggle-slider"></span></label>
    </div>
    <div class="form-section-title" style="margin-top:8px">Armazón</div>
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <button type="button" class="btn btn-secondary btn-sm" id="btn-arm-nuevo-${suf}" onclick="_setArm('nuevo','${suf}')">Nuevo</button>
      <button type="button" class="btn btn-sm" id="btn-arm-cliente-${suf}" onclick="_setArm('cliente','${suf}')" style="background:var(--gris-bg);color:var(--gris-dark);border:1.5px solid var(--gris-borde)">Del cliente</button>
    </div>
    <div id="arm-nuevo-${suf}">
      <div class="form-group"><label class="form-label">Marca</label><select id="f-marca-${suf}" class="form-control">${marcaOpts}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Código/Ref</label><input type="text" id="f-codigo-${suf}" class="form-control" placeholder="Ref…"></div>
        <div class="form-group"><label class="form-label">Material</label><select id="f-material-${suf}" class="form-control">${matOpts}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Color</label><input type="text" id="f-color-${suf}" class="form-control" placeholder="Color…"></div>
    </div>
    <div id="arm-cliente-${suf}" style="display:none">
      <div class="form-group"><label class="form-label">Marca</label><input type="text" id="f-marca-libre-${suf}" class="form-control" placeholder="Marca del cliente…"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Material</label><select id="f-mat-libre-${suf}" class="form-control">${matOpts}</select></div>
        <div class="form-group"><label class="form-label">Color</label><input type="text" id="f-color-libre-${suf}" class="form-control" placeholder="Color…"></div>
      </div>
    </div>`;
}

function _onLenteChange(suf) {
  const lente = document.getElementById(`f-lente-${suf}`)?.value;
  const sel   = document.getElementById(`f-trat-${suf}`);
  if (!sel) return;
  const opts = _cfg.tratamientos.filter(t => !t.subtipo || t.subtipo === lente);
  sel.innerHTML = '<option value="">Sin tratamiento</option>' + opts.map(t => `<option value="${t.valor}">${t.valor}</option>`).join('');
}

function _setArm(tipo, suf) {
  const divN = document.getElementById(`arm-nuevo-${suf}`);
  const divC = document.getElementById(`arm-cliente-${suf}`);
  const btnN = document.getElementById(`btn-arm-nuevo-${suf}`);
  const btnC = document.getElementById(`btn-arm-cliente-${suf}`);
  if (tipo === 'nuevo') {
    if (divN) divN.style.display = ''; if (divC) divC.style.display = 'none';
    btnN?.classList.add('btn-secondary');    btnC?.classList.remove('btn-secondary');
  } else {
    if (divC) divC.style.display = ''; if (divN) divN.style.display = 'none';
    btnC?.classList.add('btn-secondary');    btnN?.classList.remove('btn-secondary');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('toggle-dos-anteojos')?.addEventListener('change', function() {
    const bloque2 = document.getElementById('bloque-anteojo2');
    const titulo1 = document.getElementById('bloque1-title');
    if (this.checked) {
      bloque2?.classList.remove('hidden');
      if (titulo1) titulo1.textContent = 'Anteojo A';
      const b2 = document.getElementById('bloque2-fields');
      if (b2) { delete b2.dataset.poblado; }
      _poblarBloqueFields('bloque2-fields', 2);
    } else {
      bloque2?.classList.add('hidden');
      if (titulo1) titulo1.textContent = 'Anteojo';
    }
  });
  document.getElementById('form-nuevo-pedido')?.addEventListener('submit', _submitNuevoPedido);
});

async function _submitNuevoPedido(e) {
  e.preventDefault();
  const cliente   = document.getElementById('f-cliente')?.value.trim();
  const orden     = document.getElementById('f-orden')?.value.trim();
  const urgente   = document.getElementById('f-urgente')?.value;
  const tipo      = document.getElementById('f-tipo')?.value;
  const clienteId = document.getElementById('campo-cliente-id')?.value || null;
  const fechaInput = document.getElementById('f-fecha-carga')?.value;

  let ok = true;
  [['f-cliente','err-cliente'],['f-orden','err-orden'],['f-urgente','err-urgente'],['f-tipo','err-tipo'],['f-lab-a','err-lab-a'],['f-lente-a','err-lente-a']]
    .forEach(([fId,eId]) => {
      const val = document.getElementById(fId)?.value;
      const err = document.getElementById(eId);
      if (!val) { err?.classList.add('visible'); ok = false; }
      else err?.classList.remove('visible');
    });
  if (!ok) return;

  const dosAnteojos = document.getElementById('toggle-dos-anteojos')?.checked;
  const sufijos = dosAnteojos ? ['A','B'] : [null];
  for (const suf of sufijos) {
    let q = window.supabaseClient.from('pedidos').select('id').eq('orden', orden);
    suf ? q = q.eq('sufijo', suf) : q = q.is('sufijo', null);
    const { data: dup } = await q;
    if (dup?.length) { showToast(`Ya existe orden ${orden}${suf?' ('+suf+')':''}`, 'error'); return; }
  }

  const lab = document.getElementById('f-lab-a')?.value;
  const resumen = `
    <div class="modal-row"><span class="modal-label">Cliente</span><span class="modal-value">${cliente}</span></div>
    <div class="modal-row"><span class="modal-label">Orden</span><span class="modal-value">${orden}</span></div>
    <div class="modal-row"><span class="modal-label">Laboratorio</span><span class="modal-value">${lab}</span></div>
    <div class="modal-row"><span class="modal-label">Tipo</span><span class="modal-value">${tipo}</span></div>
    ${dosAnteojos?'<div class="modal-row"><span class="modal-label">Anteojos</span><span class="modal-value">2 (A y B)</span></div>':''}`;

  const modal     = document.getElementById('confirm-modal');
  const bodyEl    = document.getElementById('modal-body-content');
  const btnOk     = document.getElementById('modal-confirm-btn');
  const btnCancel = document.getElementById('modal-cancel-btn');
  const btnClose  = document.getElementById('modal-close-btn');
  if (!modal) return;
  if (bodyEl) bodyEl.innerHTML = resumen;
  modal.classList.remove('hidden');

  const cerrar = () => modal.classList.add('hidden');
  const okNew = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(okNew, btnOk);
  okNew.addEventListener('click', async () => {
    cerrar();
    await _insertarPedidos(cliente, clienteId, orden, urgente, tipo, dosAnteojos, fechaInput);
  });
  btnCancel?.addEventListener('click', cerrar, { once:true });
  btnClose?.addEventListener('click',  cerrar, { once:true });
}

async function _insertarPedidos(cliente, clienteId, orden, urgente, tipo, dosAnteojos, fechaInput) {
  const fecha = fechaInput ? new Date(fechaInput).toISOString() : new Date().toISOString();
  const base = {
    cliente, cliente_id: clienteId, orden, urgente, tipo,
    estado: 'Cristales pedidos a lab',
    cargado_por: typeof Auth !== 'undefined' ? Auth.getNombre() : 'Sistema',
    fecha_pedido: fecha, fecha_carga: fecha,
  };
  const pedidos = [];
  for (const suf of (dosAnteojos ? ['a','b'] : ['a'])) {
    pedidos.push({
      ...base,
      sufijo:      dosAnteojos ? suf.toUpperCase() : null,
      laboratorio: document.getElementById(`f-lab-${suf}`)?.value,
      tipo_lente:  document.getElementById(`f-lente-${suf}`)?.value,
      tratamiento: document.getElementById(`f-trat-${suf}`)?.value || null,
      graduacion:  _armarGrad(suf) || null,
      dos_etapas:  document.getElementById(`f-dos-etapas-${suf}`)?.checked ? 'Si' : 'No',
      armazon:     _armarArmazon(suf) || null,
    });
  }
  const { error } = await window.supabaseClient.from('pedidos').insert(pedidos);
  if (error) { showToast('Error al guardar.', 'error'); return; }
  showToast('Pedido guardado.');
  _limpiarForm();
  await loadPedidos();
  if (typeof App !== 'undefined') App.showScreen('seguimiento');
}

function _armarGrad(suf) {
  const g = ['od','oi'].map(ojo => {
    const esf = document.getElementById(`${suf}-${ojo}-esf`)?.value;
    const cil = document.getElementById(`${suf}-${ojo}-cil`)?.value;
    const eje = document.getElementById(`${suf}-${ojo}-eje`)?.value;
    const add = document.getElementById(`${suf}-${ojo}-add`)?.value;
    if (!esf&&!cil&&!eje&&!add) return null;
    return `${ojo.toUpperCase()}: ${esf||'±0.00'} / ${cil||'±0.00'} x ${eje||'0'}°${add?' Add '+add:''}`;
  }).filter(Boolean);
  return g.join(' | ');
}

function _armarArmazon(suf) {
  const divN = document.getElementById(`arm-nuevo-${suf}`);
  const esNuevo = divN && divN.style.display !== 'none';
  if (esNuevo) {
    return [document.getElementById(`f-marca-${suf}`)?.value, document.getElementById(`f-codigo-${suf}`)?.value, document.getElementById(`f-material-${suf}`)?.value, document.getElementById(`f-color-${suf}`)?.value].filter(Boolean).join(' / ');
  } else {
    return ['Del cliente:', document.getElementById(`f-marca-libre-${suf}`)?.value, document.getElementById(`f-mat-libre-${suf}`)?.value, document.getElementById(`f-color-libre-${suf}`)?.value].filter(Boolean).join(' / ');
  }
}

function _limpiarForm() {
  document.getElementById('form-nuevo-pedido')?.reset();
  document.getElementById('bloque-anteojo2')?.classList.add('hidden');
  const t = document.getElementById('bloque1-title'); if(t) t.textContent = 'Anteojo';
  document.querySelectorAll('.grad-input[readonly]').forEach(i => i.value = '');
  const b1 = document.getElementById('bloque1-fields'); if(b1) delete b1.dataset.poblado;
  _poblarBloqueFields('bloque1-fields', 1);
  if (typeof limpiarClienteSeleccionado === 'function') limpiarClienteSeleccionado();
}

// ─── NUMPAD ───────────────────────────────────────────────────
let _npInput = null, _npVal = '';

function abrirNumpad(input) {
  _npInput = input; _npVal = input.value || '';
  const overlay = document.getElementById('numpad-overlay');
  const label   = document.getElementById('numpad-label');
  const display = document.getElementById('numpad-display');
  const LABELS  = { esf:'Esfera', cil:'Cilindro', add:'Adición' };
  if (label) label.textContent = `${(input.dataset.ojo||'').toUpperCase()} · ${LABELS[input.dataset.campo]||input.dataset.campo}`;
  _npDisplay(display);
  overlay.style.display = 'flex';
  setTimeout(() => overlay.classList.add('np-visible'), 10);
  _bindNumpad(overlay, display);
}

function _npDisplay(display) {
  if (!display) return;
  if (!_npVal) { display.innerHTML = '<span class="np-placeholder">0.00</span><span class="np-cursor"></span>'; }
  else { display.innerHTML = `<span>${_npVal}</span><span class="np-cursor"></span>`; }
}

function _bindNumpad(overlay, display) {
  document.querySelectorAll('.numpad-key[data-val]').forEach(btn => {
    btn.onclick = () => { if (btn.dataset.val==='.'&&_npVal.includes('.')) return; _npVal+=btn.dataset.val; _npDisplay(display); };
  });
  document.getElementById('numpad-sign').onclick = () => {
    if (_npVal.startsWith('-')) _npVal='+'+_npVal.slice(1);
    else if (_npVal.startsWith('+')) _npVal='-'+_npVal.slice(1);
    else _npVal='-'+_npVal;
    _npDisplay(display);
  };
  document.getElementById('numpad-del').onclick   = () => { _npVal=_npVal.slice(0,-1); _npDisplay(display); };
  document.getElementById('numpad-clear').onclick = () => { _npVal=''; _npDisplay(display); };
  document.getElementById('numpad-dot').onclick   = () => { if(!_npVal.includes('.')){ _npVal+='.'; _npDisplay(display); } };
  document.getElementById('numpad-ok').onclick    = () => { if(_npInput) _npInput.value=_npVal; _cerrarNumpad(); };
  document.getElementById('numpad-close').onclick = _cerrarNumpad;
  overlay.onclick = e => { if(e.target===overlay) _cerrarNumpad(); };
  document.getElementById('numpad-step-minus').onclick = () => { const n=(parseFloat(_npVal)||0)-0.25; _npVal=(n>0?'+':'')+n.toFixed(2); _npDisplay(display); };
  document.getElementById('numpad-step-plus').onclick  = () => { const n=(parseFloat(_npVal)||0)+0.25; _npVal=(n>0?'+':'')+n.toFixed(2); _npDisplay(display); };
}

function _cerrarNumpad() {
  const overlay = document.getElementById('numpad-overlay');
  overlay.classList.remove('np-visible');
  setTimeout(() => { overlay.style.display = 'none'; }, 280);
}

// ─── AUTOCOMPLETE CLIENTE EN NUEVO PEDIDO ─────────────────────
function initClienteAutocompletePedido() {
  const input = document.getElementById('cliente-search-input');
  if (input) input.value = '';
  document.getElementById('cliente-seleccionado')?.classList.add('hidden');
  const idEl = document.getElementById('campo-cliente-id');
  if (idEl) idEl.value = '';
}

async function onClienteSearchInput(valor) {
  const sugEl = document.getElementById('cliente-suggestions');
  const fCliente = document.getElementById('f-cliente');
  if (fCliente) fCliente.value = valor;
  if (!sugEl) return;
  const q = valor.toLowerCase().trim();
  if (q.length < 2) { sugEl.classList.add('hidden'); return; }

  const { data } = await window.supabaseClient
    .from('clientes').select('id,nombre,apellido,telefono')
    .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,telefono.ilike.%${q}%`)
    .limit(6);

  if (!data?.length) { sugEl.classList.add('hidden'); return; }
  sugEl.innerHTML = data.map(c => `
    <div class="sug-item" onclick="seleccionarClientePedido('${c.id}','${c.nombre} ${c.apellido}')">
      <strong>${c.apellido}, ${c.nombre}</strong><span class="sug-tel">${c.telefono}</span>
    </div>`).join('') + `<div class="sug-item sug-nuevo" onclick="abrirFormCliente()">+ Crear cliente nuevo</div>`;
  sugEl.classList.remove('hidden');
}

function seleccionarClientePedido(id, nombre) {
  document.getElementById('f-cliente').value = nombre;
  document.getElementById('campo-cliente-id').value = id;
  document.getElementById('cliente-search-input').value = '';
  document.getElementById('cliente-chip-nombre').textContent = nombre;
  document.getElementById('cliente-seleccionado')?.classList.remove('hidden');
  document.getElementById('cliente-suggestions')?.classList.add('hidden');
}

function limpiarClienteSeleccionado() {
  document.getElementById('f-cliente') && (document.getElementById('f-cliente').value = '');
  document.getElementById('campo-cliente-id') && (document.getElementById('campo-cliente-id').value = '');
  document.getElementById('cliente-search-input') && (document.getElementById('cliente-search-input').value = '');
  document.getElementById('cliente-seleccionado')?.classList.add('hidden');
}
