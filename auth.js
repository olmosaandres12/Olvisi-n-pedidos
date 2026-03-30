// ===================================================
//  OLVISIÓN — auth.js
//  Autenticación y manejo de sesión via Supabase Auth
// ===================================================

// Se accede via window.supabaseClient (inicializado en index.html / app.html)

const Auth = (() => {

  // ── Estado de sesión ──────────────────────────────
  let _session  = null;
  let _perfil   = null;

  // ── Init (llamar al cargar app.html) ─────────────
  async function init() {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    _session = session;
    await _cargarPerfil(session.user.id);
    return _session;
  }

  // ── Login ─────────────────────────────────────────
  async function login(email, password) {
    const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    _session = data.session;
    await _cargarPerfil(data.user.id);
    return data;
  }

  // ── Logout ────────────────────────────────────────
  async function logout() {
    await window.supabaseClient.auth.signOut();
    _session = null;
    _perfil  = null;
    window.location.href = 'index.html';
  }

  // ── Perfil ────────────────────────────────────────
  async function _cargarPerfil(userId) {
    const { data, error } = await window.supabaseClient
      .from('perfiles')
      .select('nombre, rol')
      .eq('id', userId)
      .single();
    if (error) {
      console.warn('Perfil no encontrado para', userId);
      _perfil = { nombre: 'Usuario', rol: 'operadora' };
    } else {
      _perfil = data;
    }
  }

  function getNombre()  { return _perfil?.nombre  ?? 'Usuario'; }
  function getRol()     { return _perfil?.rol      ?? 'operadora'; }
  function isAdmin()    { return getRol() === 'admin'; }
  function getUserId()  { return _session?.user?.id ?? null; }

  // ── Listener de cambios de auth ───────────────────
  function onAuthChange(callback) {
    return window.supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        window.location.href = 'index.html';
      }
      callback(event, session);
    });
  }

  return { init, login, logout, getNombre, getRol, isAdmin, getUserId, onAuthChange };
})();
