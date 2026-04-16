// ============================================================
// APP.JS — Navegación, sesión, UI global — OLVISIÓN
// ============================================================

let currentPerfil = null;
const _sectionInited = {};

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  try {
    const session = await Auth.init();
    if (!session) return;

    currentPerfil = {
      nombre: Auth.getNombre(),
      rol:    Auth.getRol(),
      id:     Auth.getUserId(),
    };

    setupUserUI(currentPerfil);

    await Promise.all([
      cargarConfiguracion(),
      loadPedidos(),
    ]);

    showSection(Auth.isAdmin() ? 'panel' : 'pedidos');
    setupRealtime();
  } catch(err) {
    console.error('Error en init de app:', err);
  }
});

// ─── UI USUARIO ───────────────────────────────────────────────
function setupUserUI(perfil) {
  const nombre = perfil.nombre || 'Usuario';

  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = nombre;

  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) {
    const colores = { 'Andrés': '#034291', 'Sandra': '#7C3AED', 'Valentina': '#10B981' };
    avatarEl.style.background = colores[nombre] || '#034291';
    avatarEl.textContent = nombre[0].toUpperCase();
  }

  if (perfil.rol === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }
}

// ─── NAVEGACIÓN ───────────────────────────────────────────────
function showSection(nombre) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const section = document.getElementById('section-' + nombre);
  if (section) section.classList.remove('hidden');

  const navBtn = document.getElementById('nav-' + nombre);
  if (navBtn) navBtn.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'instant' });

  if (!_sectionInited[nombre]) {
    _sectionInited[nombre] = true;
    if (nombre === 'panel')     initPanel();
    if (nombre === 'historial') initHistorial();
    if (nombre === 'agenda')    initAgenda();
    if (nombre === 'config')    initConfig();
  } else {
    if (nombre === 'panel') loadPanel();
  }

  if (nombre === 'nuevo') {
    setTimeout(() => initClienteAutocompletePedido(), 50);
  }
}

// ─── LOGOUT ───────────────────────────────────────────────────
async function logout() {
  await Auth.logout();
}

// ─── REALTIME ─────────────────────────────────────────────────
function setupRealtime() {
  window.supabaseClient.channel('olvision-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
      loadPedidos();
      actualizarBadgeCriticos();
    })
    .subscribe();
}

// ─── BADGE CRÍTICOS ───────────────────────────────────────────
function actualizarBadgeCriticos() {
  const badge = document.getElementById('badge-criticos');
  if (!badge) return;
  const criticos = (window._pedidosActivos || []).filter(p => calcEstadoInteligente(p) === 'critico');
  if (criticos.length > 0) {
    badge.textContent = criticos.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ─── TOAST ────────────────────────────────────────────────────
function showToast(mensaje, tipo) {
  tipo = tipo || 'success';
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + tipo;
  toast.textContent = mensaje;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-visible')));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 320);
  }, 3200);
}

// ─── CONFIRM MODAL ────────────────────────────────────────────
function mostrarConfirm(titulo, cuerpo, onConfirm) {
  document.getElementById('confirm-title').textContent = titulo;
  document.getElementById('confirm-body').innerHTML   = cuerpo;
  document.getElementById('confirm-overlay').classList.remove('hidden');
  const btnOk = document.getElementById('confirm-ok');
  const btnOkNuevo = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(btnOkNuevo, btnOk);
  btnOkNuevo.addEventListener('click', () => { cerrarConfirm(); onConfirm(); });
}

function cerrarConfirm() {
  document.getElementById('confirm-overlay').classList.add('hidden');
}

function getPerfil() { return currentPerfil; }
function esAdmin()   { return currentPerfil?.rol === 'admin'; }
