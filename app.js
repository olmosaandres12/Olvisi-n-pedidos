// ============================================================
// APP.JS — Navegación, sesión, UI global — OLVISIÓN
// ============================================================

// Inicializar cliente Supabase (usa las credenciales de config.js)
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser   = null;
let currentPerfil = null;

// Flags para no reinicializar secciones ya cargadas
const _sectionInited = {};

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Registrar service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Verificar sesión
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  currentUser = session.user;

  // Cargar perfil
  const { data: perfil, error } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error || !perfil) {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
    return;
  }

  currentPerfil = perfil;

  // UI usuario
  setupUserUI(perfil);

  // Cargar datos base
  await Promise.all([
    cargarConfiguracion(),
    loadPedidos(),
  ]);

  // Sección inicial
  const seccionInicial = perfil.rol === 'admin' ? 'panel' : 'pedidos';
  showSection(seccionInicial);

  // Realtime
  setupRealtime();
});

// ─── UI USUARIO ───────────────────────────────────────────────
function setupUserUI(perfil) {
  const nombre = perfil.nombre || 'Usuario';

  // Nombre en header
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = nombre;

  // Avatar con color según usuario
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) {
    const colores = {
      'Andrés':   '#034291',
      'Sandra':   '#7C3AED',
      'Valentina':'#10B981',
    };
    avatarEl.style.background = colores[nombre] || '#034291';
    avatarEl.textContent = nombre[0].toUpperCase();
  }

  // Mostrar/ocultar elementos admin
  if (perfil.rol === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => {
      el.classList.remove('hidden');
    });
  }
}

// ─── NAVEGACIÓN ───────────────────────────────────────────────
function showSection(nombre) {
  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));

  // Desactivar todos los nav
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Mostrar sección target
  const section = document.getElementById(`section-${nombre}`);
  if (section) section.classList.remove('hidden');

  // Activar nav btn correspondiente
  const navBtn = document.getElementById(`nav-${nombre}`);
  if (navBtn) navBtn.classList.add('active');

  // Scroll al tope
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Inicializar sección si es la primera vez
  if (!_sectionInited[nombre]) {
    _sectionInited[nombre] = true;

    if (nombre === 'panel') {
      initPanel();
    } else if (nombre === 'historial') {
      initHistorial();
    } else if (nombre === 'agenda') {
      initAgenda();
    } else if (nombre === 'config') {
      initConfig();
    }
  } else {
    // Re-cargar datos frescos en secciones que los necesitan
    if (nombre === 'panel')   loadPanel();
    if (nombre === 'historial') { /* se recarga al cambiar mes */ }
    if (nombre === 'agenda')  { /* el search en tiempo real recarga */ }
  }

  // En la sección nuevo: inicializar autocomplete de cliente
  if (nombre === 'nuevo') {
    // Pequeño delay para asegurar que el DOM está listo
    setTimeout(() => initClienteAutocompletePedido(), 50);
  }
}

// ─── LOGOUT ───────────────────────────────────────────────────
async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// ─── REALTIME ─────────────────────────────────────────────────
function setupRealtime() {
  supabase.channel('olvision-changes')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'pedidos'
    }, () => {
      loadPedidos();
      actualizarBadgeCriticos();
    })
    .subscribe();
}

// ─── BADGE CRÍTICOS ───────────────────────────────────────────
function actualizarBadgeCriticos() {
  const badge = document.getElementById('badge-criticos');
  if (!badge) return;

  const criticos = (window._pedidosActivos || []).filter(p => {
    const est = calcEstadoInteligente(p);
    return est === 'critico';
  });

  if (criticos.length > 0) {
    badge.textContent = criticos.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ─── TOAST ────────────────────────────────────────────────────
function showToast(mensaje, tipo = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensaje;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
  });

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 320);
  }, 3200);
}

// ─── CONFIRM MODAL ────────────────────────────────────────────
function mostrarConfirm(titulo, cuerpo, onConfirm) {
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-title').textContent = titulo;
  document.getElementById('confirm-body').innerHTML   = cuerpo;
  overlay.classList.remove('hidden');

  const btnOk = document.getElementById('confirm-ok');
  // Clonar para limpiar listeners anteriores
  const btnOkNuevo = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(btnOkNuevo, btnOk);
  btnOkNuevo.addEventListener('click', () => {
    cerrarConfirm();
    onConfirm();
  });
}

function cerrarConfirm() {
  document.getElementById('confirm-overlay').classList.add('hidden');
}

// ─── HELPER: PERFIL ACTUAL ────────────────────────────────────
function getPerfil() {
  return currentPerfil;
}

function esAdmin() {
  return currentPerfil?.rol === 'admin';
}
