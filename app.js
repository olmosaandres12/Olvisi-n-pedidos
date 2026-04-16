// ============================================================
// APP.JS — OLVISIÓN (compatible con app.html original)
// ============================================================

const App = (() => {

  let _screenActual = 'seguimiento';

  // ─── INIT ───────────────────────────────────────────────────
  async function init() {
    const session = await Auth.init();
    if (!session) return;

    const nombre = Auth.getNombre();
    const rol    = Auth.getRol();

    // Header usuario
    const headerUser = document.getElementById('header-user');
    if (headerUser) headerUser.textContent = nombre;

    // Mostrar botones admin
    if (rol === 'admin') {
      document.querySelectorAll('#nav-panel, #nav-config').forEach(el => el.classList.remove('hidden'));
    }

    // Logo vuelve a inicio
    document.getElementById('logo-home-btn')?.addEventListener('click', () => {
      showScreen(rol === 'admin' ? 'panel' : 'seguimiento');
    });

    // Logout
    document.getElementById('btn-logout')?.addEventListener('click', () => Auth.logout());

    // Ocultar loading, mostrar app
    document.getElementById('loading-overlay').style.display = 'none';
    const layout = document.getElementById('app-layout');
    layout.style.display = 'flex';

    // Cargar datos
    await Promise.all([
      typeof cargarConfiguracion === 'function' ? cargarConfiguracion() : Promise.resolve(),
      typeof loadPedidos         === 'function' ? loadPedidos()         : Promise.resolve(),
    ]);

    // Pantalla inicial
    showScreen(rol === 'admin' ? 'panel' : 'seguimiento');

    // Realtime
    window.supabaseClient.channel('olvision-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        if (typeof loadPedidos === 'function') loadPedidos();
        _actualizarBadge();
      })
      .subscribe();

    // Agenda
    if (typeof initAgenda === 'function') initAgenda();
  }

  // ─── NAVEGACIÓN ─────────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

    const screen = document.getElementById('screen-' + name);
    if (screen) screen.classList.add('active');

    const navBtn = document.getElementById('nav-' + name);
    if (navBtn) navBtn.classList.add('active');

    _screenActual = name;
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Ocultar FAB en agenda (tiene su propio)
    const fab = document.getElementById('fab-nuevo-pedido');
    if (fab) fab.style.display = name === 'agenda' ? 'none' : 'flex';

    // Inicializar autocomplete de cliente en nuevo pedido
    if (name === 'inicio' && typeof initClienteAutocompletePedido === 'function') {
      setTimeout(initClienteAutocompletePedido, 50);
    }
  }

  // ─── TABS SEGUIMIENTO ────────────────────────────────────────
  function switchSegTab(tab) {
    document.querySelectorAll('.seg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('seg-content-lab')?.classList.toggle('hidden', tab !== 'lab');
    document.getElementById('seg-content-retirar')?.classList.toggle('hidden', tab !== 'retirar');
  }

  // ─── TABS ESTADO HISTORIAL ───────────────────────────────────
  function switchEstadoTab(estado) {
    document.querySelectorAll('.estado-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.estado === estado);
    });
    if (typeof filtrarPorEstado === 'function') filtrarPorEstado(estado);
  }

  // ─── CONFIG ──────────────────────────────────────────────────
  async function _addConfigItem(tipo, inputId) {
    const input = document.getElementById(inputId);
    const valor = input?.value?.trim();
    if (!valor) return;
    const { data: max } = await window.supabaseClient.from('configuracion').select('orden').eq('tipo', tipo).order('orden', { ascending: false }).limit(1);
    const orden = max?.length ? max[0].orden + 1 : 1;
    const { error } = await window.supabaseClient.from('configuracion').insert([{ tipo, valor, orden }]);
    if (error) { showToast('Error al agregar.', 'error'); return; }
    input.value = '';
    showToast('Agregado correctamente.');
    if (typeof cargarConfiguracion === 'function') await cargarConfiguracion();
    loadConfigScreen();
  }

  function addLab()        { _addConfigItem('laboratorio', 'new-lab-input'); }
  function addMarca()      { _addConfigItem('marca', 'new-marca-input'); }
  function addMaterial()   { _addConfigItem('material', 'new-material-input'); }
  function addObraSocial() { _addConfigItem('obra_social', 'new-os-input'); }

  async function addTratamiento() {
    const lente = document.getElementById('config-lente-select')?.value;
    if (!lente) { showToast('Seleccioná un tipo de lente primero.', 'error'); return; }
    const input = document.getElementById('new-trat-input');
    const valor = input?.value?.trim();
    if (!valor) return;
    const { data: max } = await window.supabaseClient.from('configuracion').select('orden').eq('tipo', 'tratamiento').eq('subtipo', lente).order('orden', { ascending: false }).limit(1);
    const orden = max?.length ? max[0].orden + 1 : 1;
    const { error } = await window.supabaseClient.from('configuracion').insert([{ tipo: 'tratamiento', subtipo: lente, valor, orden }]);
    if (error) { showToast('Error al agregar.', 'error'); return; }
    input.value = '';
    showToast('Tratamiento agregado.');
    loadConfigTratamientos();
  }

  async function loadConfigTratamientos() {
    const lente = document.getElementById('config-lente-select')?.value;
    const list  = document.getElementById('config-trat-list');
    if (!list) return;
    if (!lente) { list.innerHTML = ''; return; }
    const { data } = await window.supabaseClient.from('configuracion').select('*').eq('tipo', 'tratamiento').eq('subtipo', lente).order('orden');
    list.innerHTML = (data || []).map(item => `
      <div class="config-item">
        <span>${item.valor}</span>
        <button class="config-item-del" onclick="App._delConfigItem(${item.id})">✕</button>
      </div>`).join('');
  }

  async function _delConfigItem(id) {
    if (!confirm('¿Eliminar este elemento?')) return;
    await window.supabaseClient.from('configuracion').delete().eq('id', id);
    showToast('Eliminado.');
    if (typeof cargarConfiguracion === 'function') await cargarConfiguracion();
    loadConfigScreen();
  }

  async function loadConfigScreen() {
    const tipos = [
      { tipo: 'laboratorio', listId: 'config-labs-list' },
      { tipo: 'marca',       listId: 'config-marcas-list' },
      { tipo: 'material',    listId: 'config-materiales-list' },
      { tipo: 'obra_social', listId: 'config-os-list' },
    ];
    for (const { tipo, listId } of tipos) {
      const { data } = await window.supabaseClient.from('configuracion').select('*').eq('tipo', tipo).order('orden');
      const el = document.getElementById(listId);
      if (!el) continue;
      el.innerHTML = (data || []).map(item => `
        <div class="config-item">
          <span>${item.valor}</span>
          <button class="config-item-del" onclick="App._delConfigItem(${item.id})">✕</button>
        </div>`).join('');
    }
    loadConfigTratamientos();
  }

  async function activarNotificaciones() {
    const statusEl = document.getElementById('notif-status');
    if (!('Notification' in window)) { if (statusEl) statusEl.textContent = 'Este navegador no soporta notificaciones.'; return; }
    const perm = await Notification.requestPermission();
    if (statusEl) statusEl.textContent = perm === 'granted' ? '✅ Notificaciones activadas.' : '❌ Permiso denegado.';
  }

  // ─── BADGE CRÍTICOS ──────────────────────────────────────────
  function _actualizarBadge() {
    const badge = document.getElementById('criticos-badge');
    if (!badge || typeof calcEstadoInteligente !== 'function') return;
    const n = (window._pedidosCache || []).filter(p => calcEstadoInteligente(p) === 'critico').length;
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  }

  // ─── TOAST ───────────────────────────────────────────────────
  function showToast(msg, tipo) {
    tipo = tipo || 'success';
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast toast-' + tipo;
    t.textContent = msg;
    c.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('toast-visible')));
    setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 320); }, 3200);
  }

  // ─── INIT ON DOM READY ───────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  return {
    showScreen, switchSegTab, switchEstadoTab,
    addLab, addMarca, addMaterial, addTratamiento, addObraSocial,
    loadConfigTratamientos, loadConfigScreen, activarNotificaciones,
    _delConfigItem, showToast, _actualizarBadge,
  };

})();

// Alias global para que pedidos.js, panel.js, agenda.js puedan llamar showToast
function showToast(msg, tipo) { App.showToast(msg, tipo); }
function mostrarConfirm(titulo, cuerpo, onConfirm) {
  document.getElementById('confirm-modal')?.classList.remove('hidden');
  const titleEl = document.getElementById('modal-body-content')?.previousElementSibling;
  const bodyEl  = document.getElementById('modal-body-content');
  const okBtn   = document.getElementById('modal-confirm-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const closeBtn  = document.getElementById('modal-close-btn');
  if (bodyEl) bodyEl.innerHTML = cuerpo;
  const cerrar = () => document.getElementById('confirm-modal')?.classList.add('hidden');
  const okNuevo = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(okNuevo, okBtn);
  okNuevo.addEventListener('click', () => { cerrar(); onConfirm(); });
  cancelBtn?.addEventListener('click', cerrar, { once: true });
  closeBtn?.addEventListener('click', cerrar,  { once: true });
}
function esAdmin() { return Auth.isAdmin(); }
