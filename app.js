// ===================================================
//  OLVISIÓN — app.js
// ===================================================

const App = (() => {

  let _pedidosCache   = [];
  let _configCache    = { laboratorios: [], tratamientos: {}, marcas: [], materiales: [] };
  let _currentScreen  = 'seguimiento';
  let _estadoTab      = 'todos';
  let _segTab         = 'lab';
  let _pendingGuardar = null;
  let _detalleId      = null;
  let _expandedId     = null;
  let _editingConfig  = null;

  // ── Duplicados ────────────────────────────────────
  let _pendingDuplicadoWarning = null;

  // ── Detección en tiempo real de orden ────────────
  let _ordenCheckTimer   = null;   // debounce timer
  let _ordenChecking     = false;  // flag para evitar solicitudes solapadas
  let _ordenUltimaQuery  = '';     // última orden consultada (evita repetir)

  // Seguimiento filters
  let _labFilter  = null;
  let _segSearch  = '';
  let _collapsedSections = {};

  let _fotoFiles        = {};
  let _fotoUploadTarget = null;

  const hoy = new Date();
  let _mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  // ── Lab colors ────────────────────────────────────
  const LAB_COLORS = { Sol:'#2563EB', Bichara:'#DC2626', Cristian:'#16A34A', Vitolen:'#7C3AED' };
  function getLabColor(lab) { return LAB_COLORS[lab] || '#6B7280'; }

  function getSegCatKey(p) {
    if (p.urgente === 'Si') return 'urgentes';
    if (p._est?.valor === 'critico' || p._est?.valor === 'demorado') return 'atencion';
    return 'lab';
  }

  // ── Numpad ───────────────────────────────────────
  let _numpadTarget = null, _numpadSign = '+', _numpadRaw = '', _numpadNext = null;
  let _numpadRepeatTimer = null, _numpadRepeatInterval = null;

  function initNumpad() {
    const overlay = document.getElementById('numpad-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeNumpad(); });
    const sheet = document.getElementById('numpad-sheet');
    if (sheet) {
      let sy = 0;
      sheet.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
      sheet.addEventListener('touchend',   (e) => { if (e.changedTouches[0].clientY - sy > 72) closeNumpad(); }, { passive: true });
      if (!document.getElementById('np-field-indicator')) {
        const ind = document.createElement('div');
        ind.id = 'np-field-indicator';
        ind.className = 'np-field-indicator hidden';
        const npHeader = sheet.querySelector('.np-header');
        if (npHeader) npHeader.insertAdjacentElement('afterend', ind);
      }
    }
    document.getElementById('numpad-close')?.addEventListener('click', closeNumpad);
    document.getElementById('numpad-ok')?.addEventListener('click', confirmNumpad);
    const ok = document.getElementById('numpad-ok');
    if (ok && !document.getElementById('numpad-siguiente')) {
      const sig = document.createElement('button');
      sig.id = 'numpad-siguiente'; sig.type = 'button';
      sig.className = 'numpad-siguiente-btn hidden';
      sig.innerHTML = 'Siguiente <span class="np-sig-arrow">›</span>';
      ok.parentNode.insertBefore(sig, ok);
      sig.addEventListener('click', siguienteNumpad);
    }
    if (ok && !document.getElementById('numpad-ambos')) {
      const amb = document.createElement('button');
      amb.id = 'numpad-ambos'; amb.type = 'button';
      amb.className = 'numpad-ambos-btn hidden';
      amb.innerHTML = '👁️ Copiar a ambos ojos';
      ok.parentNode.insertBefore(amb, ok);
      amb.addEventListener('click', copiarAmbosOjos);
    }
    const bm = document.getElementById('numpad-step-minus');
    const bp = document.getElementById('numpad-step-plus');
    if (bm) { bm.addEventListener('pointerdown', () => _numpadStartRepeat(-0.25)); bm.addEventListener('pointerup', _numpadStopRepeat); bm.addEventListener('pointerleave', _numpadStopRepeat); }
    if (bp) { bp.addEventListener('pointerdown', () => _numpadStartRepeat(+0.25)); bp.addEventListener('pointerup', _numpadStopRepeat); bp.addEventListener('pointerleave', _numpadStopRepeat); }
    document.getElementById('numpad-sign')?.addEventListener('click', () => { _numpadSign = _numpadSign === '+' ? '-' : '+'; _numpadRenderDisplay(); });
    document.getElementById('numpad-dot')?.addEventListener('click', () => {
      if (_numpadRaw.includes('.')) { _numpadShake(); return; }
      if (!_numpadRaw) _numpadRaw = '0';
      _numpadRaw += '.'; _numpadRenderDisplay();
    });
    document.getElementById('numpad-del')?.addEventListener('click', () => { _numpadRaw = _numpadRaw.slice(0,-1); _numpadRenderDisplay(); });
    document.getElementById('numpad-clear')?.addEventListener('click', () => { _numpadRaw = ''; _numpadSign = '+'; _numpadRenderDisplay(); });
    overlay.querySelectorAll('.numpad-key[data-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_numpadRaw.length >= 6) return;
        const parts = _numpadRaw.split('.');
        if (parts.length === 2 && parts[1].length >= 2) { _numpadShake(); return; }
        _numpadRaw += btn.dataset.val; _numpadRenderDisplay();
      });
    });
  }

  function getNextField(inputEl) {
    const id = inputEl.id;
    if (!id || !id.startsWith('g-')) return null;
    const parts = id.split('-');
    if (parts.length < 5) return null;
    const [, dc, type, ojo, num] = parts;
    if (type === 'esf') return document.getElementById(`g-${dc}-cil-${ojo}-${num}`);
    if (type === 'cil') return document.getElementById(`g-${dc}-eje-${ojo}-${num}`);
    return null;
  }

  function getOppositeField(inputEl) {
    const id = inputEl.id;
    if (!id || !id.startsWith('g-')) return null;
    const parts = id.split('-');
    if (parts.length < 5) return null;
    const [, dc, type, ojo, num] = parts;
    const ojoOpuesto = ojo === 'D' ? 'I' : 'D';
    return document.getElementById(`g-${dc}-${type}-${ojoOpuesto}-${num}`);
  }

  function copiarAmbosOjos() {
    if (!_numpadTarget || !_numpadRaw) return;
    const valor = (_numpadSign === '-' ? '-' : '+') + _numpadRaw;
    _numpadTarget.value = valor;
    _numpadTarget.dispatchEvent(new Event('input', { bubbles: true }));
    _numpadTarget.dispatchEvent(new Event('change', { bubbles: true }));
    const opposite = getOppositeField(_numpadTarget);
    if (opposite) {
      opposite.value = valor;
      opposite.dispatchEvent(new Event('input', { bubbles: true }));
      opposite.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const d = document.getElementById('numpad-display');
    if (d) { d.classList.add('np-confirmed'); setTimeout(() => { d.classList.remove('np-confirmed'); closeNumpad(); }, 400); }
    else closeNumpad();
  }

  function updateFieldIndicator(inputEl) {
    const indicator = document.getElementById('np-field-indicator');
    if (!indicator) return;
    const isEsf = inputEl.classList.contains('grad-esf');
    const isCil = inputEl.classList.contains('grad-cil');
    if (!isEsf && !isCil) { indicator.classList.add('hidden'); return; }
    const id = inputEl.id || '';
    const parts = id.split('-');
    const ojo = parts.length >= 4 ? parts[3] : '';
    const ojoLabel = ojo === 'D' ? 'OD' : ojo === 'I' ? 'OI' : '';
    const activeKey = isEsf ? 'esf' : 'cil';
    const steps = [{k:'esf',l:'Esf'},{k:'cil',l:'Cil'},{k:'eje',l:'Eje'}];
    indicator.innerHTML =
      (ojoLabel ? `<span class="np-fi-ojo">${ojoLabel}</span>` : '') +
      steps.map((s, i) =>
        `<span class="np-fi-step ${s.k === activeKey ? 'np-fi-step--active' : ''}">${s.l}</span>` +
        (i < 2 ? '<span class="np-fi-sep">›</span>' : '')
      ).join('');
    indicator.classList.remove('hidden');
  }

  function siguienteNumpad() {
    const next = _numpadNext;
    if (_numpadTarget && _numpadRaw) {
      _numpadTarget.value = (_numpadSign==='-'?'-':'+')+_numpadRaw;
      _numpadTarget.dispatchEvent(new Event('input',{bubbles:true}));
      _numpadTarget.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const ov = document.getElementById('numpad-overlay');
    ov.classList.remove('np-visible');
    const vp = document.querySelector('meta[name=viewport]');
    if (vp) vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    _numpadTarget = null; _numpadRaw = ''; _numpadSign = '+'; _numpadNext = null; _numpadStopRepeat();
    setTimeout(() => {
      ov.classList.add('hidden'); ov.style.display = '';
      if (!next) return;
      if (next.classList.contains('grad-eje')) { next.focus(); setTimeout(() => next.select(), 50); }
      else { const label = next.classList.contains('grad-esf') ? 'Esfera' : 'Cilindro'; openNumpad(next, label); }
    }, 160);
  }

  function _numpadStepBy(delta) {
    const cur = _numpadRaw === '' ? 0 : parseFloat((_numpadSign==='-'?'-':'')+_numpadRaw);
    const next = Math.round((cur + delta) * 100) / 100;
    if (next === 0) { _numpadRaw = '0.00'; _numpadSign = '+'; }
    else if (next < 0) { _numpadSign = '-'; _numpadRaw = Math.abs(next).toFixed(2); }
    else { _numpadSign = '+'; _numpadRaw = next.toFixed(2); }
    _numpadRenderDisplay();
  }
  function _numpadStartRepeat(d) { _numpadStepBy(d); _numpadRepeatTimer = setTimeout(() => { _numpadRepeatInterval = setInterval(() => _numpadStepBy(d), 80); }, 350); }
  function _numpadStopRepeat() { clearTimeout(_numpadRepeatTimer); clearInterval(_numpadRepeatInterval); _numpadRepeatTimer = null; _numpadRepeatInterval = null; }

  function _numpadRenderDisplay() {
    const disp = document.getElementById('numpad-display'), ok = document.getElementById('numpad-ok');
    if (!disp) return;
    if (!_numpadRaw) {
      disp.innerHTML = '<span class="np-placeholder">0.00</span><span class="np-cursor"></span>';
      ok?.classList.add('np-btn-disabled');
    } else {
      const color = _numpadSign==='-' ? 'var(--np-minus-color)' : 'var(--np-plus-color)';
      disp.innerHTML = `<span class="np-sign" style="color:${color}">${_numpadSign==='-'?'−':'+'}</span>${_numpadRaw}<span class="np-cursor"></span>`;
      ok?.classList.remove('np-btn-disabled');
    }
  }
  function _numpadShake() {
    const d = document.getElementById('numpad-display'); if (!d) return;
    d.classList.remove('np-shake'); void d.offsetWidth; d.classList.add('np-shake');
    setTimeout(() => d.classList.remove('np-shake'), 380);
  }

  function openNumpad(inputEl, label) {
    _numpadTarget = inputEl;
    _numpadNext   = getNextField(inputEl);
    _numpadRaw    = ''; _numpadSign = '+';
    const ex = (inputEl.value||'').trim();
    if (ex) { if (ex.startsWith('-')) { _numpadSign='-'; _numpadRaw=ex.slice(1).replace(/^\+/,''); } else { _numpadSign='+'; _numpadRaw=ex.replace(/^\+/,''); } }
    const lbl = document.getElementById('numpad-label'); if (lbl) lbl.textContent = label||'Valor';
    _numpadRenderDisplay();
    updateFieldIndicator(inputEl);
    const sigBtn = document.getElementById('numpad-siguiente');
    if (sigBtn) sigBtn.classList.toggle('hidden', !_numpadNext);
    const ambBtn = document.getElementById('numpad-ambos');
    if (ambBtn) ambBtn.classList.toggle('hidden', !getOppositeField(inputEl));
    const vp = document.querySelector('meta[name=viewport]');
    if (vp) vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
    const ov = document.getElementById('numpad-overlay');
    ov.classList.remove('hidden'); ov.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('np-visible')));
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function confirmNumpad() {
    if (!_numpadTarget || !_numpadRaw) return;
    _numpadTarget.value = (_numpadSign==='-'?'-':'+')+_numpadRaw;
    _numpadTarget.dispatchEvent(new Event('input',{bubbles:true}));
    _numpadTarget.dispatchEvent(new Event('change',{bubbles:true}));
    const d = document.getElementById('numpad-display');
    if (d) { d.classList.add('np-confirmed'); setTimeout(() => { d.classList.remove('np-confirmed'); closeNumpad(); }, 500); }
    else closeNumpad();
  }

  function closeNumpad() {
    const ov = document.getElementById('numpad-overlay');
    ov.classList.remove('np-visible');
    setTimeout(() => { ov.classList.add('hidden'); ov.style.display=''; }, 280);
    const vp = document.querySelector('meta[name=viewport]');
    if (vp) vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    _numpadTarget=null; _numpadRaw=''; _numpadSign='+'; _numpadNext=null; _numpadStopRepeat();
  }

  function attachNumpadListeners(container) {
    container.querySelectorAll('.grad-esf,.grad-cil,.grad-add').forEach(inp => {
      inp.setAttribute('readonly','readonly');
      inp.style.fontSize = '16px';
      const label = inp.classList.contains('grad-esf') ? 'Esfera' : inp.classList.contains('grad-cil') ? 'Cilindro' : 'Adición';
      inp.addEventListener('touchstart', (e) => { e.preventDefault(); openNumpad(inp,label); }, { passive: false });
      inp.addEventListener('mousedown',  (e) => { e.preventDefault(); openNumpad(inp,label); });
      inp.addEventListener('change', () => formatGradInput(inp));
    });
    container.querySelectorAll('.grad-eje').forEach(inp => {
      inp.style.fontSize = '16px';
      inp.addEventListener('blur', () => { const v=inp.value.replace(/[^0-9]/g,''); if(!v||v==='0'){inp.value='';return;} inp.value=String(Math.min(180,Math.max(0,parseInt(v)))); });
      inp.addEventListener('focus', () => setTimeout(()=>inp.select(),0));
    });
  }

  function formatGradInput(inp) {
    let v=inp.value.trim().replace(',','.'); if(!v) return;
    let sign=''; if(v.startsWith('+')||v.startsWith('-')){sign=v[0];v=v.slice(1);}
    v=v.replace(/[^0-9.]/g,''); if(!v){inp.value='';return;}
    const n=parseFloat(v); if(isNaN(n)||n===0){inp.value='';return;}
    const r=Math.round(n*4)/4;
    if(!sign) sign=inp.classList.contains('grad-cil')?'-':'+';
    inp.value=sign+r.toFixed(2);
  }

  // ── Push ─────────────────────────────────────────
  const VAPID_PUBLIC = 'BNHBkj7wiOQKz06CN3-AdpB1n0RXBKUuKvneiQ_zkUt9Q_yOUifGe_NeXL3eePKDXdmSNkTyBNnqWHed3VeY5LQ';
  async function initPush() {
    if (!('serviceWorker' in navigator)||!('PushManager' in window)) return;
    try {
      const reg=await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
      const perm=await Notification.requestPermission(); if (perm!=='granted') return;
      const ex=await reg.pushManager.getSubscription();
      if (ex){await guardarSuscripcion(ex);return;}
      const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC)});
      await guardarSuscripcion(sub); toast('🔔 Notificaciones activadas','success');
    } catch(e){console.warn('Push:',e);}
  }
  async function guardarSuscripcion(sub) {
    const {data:{user}}=await window.supabaseClient.auth.getUser(); if (!user) return;
    await window.supabaseClient.from('push_subscriptions').upsert({user_id:user.id,subscription:sub.toJSON()},{onConflict:'user_id'});
  }
  async function enviarNotificacion(title,body,soloAdmin=false) {
    try { await fetch(`${SUPABASE_URL}/functions/v1/push-notify`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},body:JSON.stringify({title,body,soloAdmin})}); } catch{}
  }
  function urlBase64ToUint8Array(b64) {
    const pad='='.repeat((4-b64.length%4)%4),base64=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from([...atob(base64)].map(c=>c.charCodeAt(0)));
  }

  // ── INIT ─────────────────────────────────────────
  async function init() {
    const session = await Auth.init();
    if (!session) return;

    document.getElementById('app-layout').style.display = 'flex';
    document.getElementById('header-user').textContent  = Auth.getNombre();
    document.getElementById('logo-home-btn').addEventListener('click', () => showScreen('seguimiento'));
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    if (Auth.isAdmin()) {
      document.getElementById('nav-panel').classList.remove('hidden');
      document.getElementById('nav-config').classList.remove('hidden');
    }

    const fechaEl = document.getElementById('f-fecha-carga');
    if (fechaEl) {
      fechaEl.value = todayStr();
      if (!document.getElementById('f-fecha-prometida')) {
        const promGroup = document.createElement('div');
        promGroup.className = 'form-group';
        promGroup.innerHTML = `<label class="form-label">Fecha prometida <span class="form-label-hint">(cuándo estará listo)</span></label>
          <input type="date" id="f-fecha-prometida" class="form-control">`;
        fechaEl.closest('.form-group')?.insertAdjacentElement('afterend', promGroup);
      }
    }
    document.getElementById('toggle-dos-anteojos').addEventListener('change', (e) => {
      document.getElementById('bloque-anteojo2').classList.toggle('hidden', !e.target.checked);
      document.getElementById('bloque1-title').textContent = e.target.checked ? 'Anteojo A' : 'Anteojo';
    });

    document.getElementById('form-nuevo-pedido').addEventListener('submit', handleFormSubmit);
    document.getElementById('modal-close-btn').addEventListener('click',  closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('modal-confirm-btn').addEventListener('click', handleConfirm);

    document.getElementById('btn-cerrar-detalle').addEventListener('click', cerrarDetalle);
    document.getElementById('btn-abrir-edicion').addEventListener('click',  abrirEdicion);
    document.getElementById('btn-eliminar-pedido').addEventListener('click', () => { if (_detalleId) eliminarPedido(_detalleId); });
    document.getElementById('detalle-modal').addEventListener('click', (e) => { if (e.target===document.getElementById('detalle-modal')) cerrarDetalle(); });
    document.getElementById('btn-cerrar-edit').addEventListener('click', cerrarEdicion);
    document.getElementById('edit-modal').addEventListener('click', (e) => { if (e.target===document.getElementById('edit-modal')) cerrarEdicion(); });

    document.getElementById('cliente-sheet-overlay')?.addEventListener('click', () => {
      if (typeof cerrarFichaCliente === 'function') cerrarFichaCliente();
    });
    document.getElementById('cliente-form-overlay')?.addEventListener('click', () => {
      if (typeof cerrarFormCliente === 'function') cerrarFormCliente();
    });

    initNumpad();
    _inyectarModalDuplicado();
    _initFotoViewer();
    _initOrdenRealTimeCheck();   // ← NUEVO: detección en tiempo real
    await loadConfig();
    buildBloqueFields(1);
    buildBloqueFields(2);

    if (typeof initAgenda === 'function') initAgenda();
    initClienteSearch();

    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 400);
    setTimeout(() => initPush(), 2000);

    showScreen('seguimiento');
  }

  // ══════════════════════════════════════════════════
  //  DETECCIÓN EN TIEMPO REAL — NÚMERO DE ORDEN
  // ══════════════════════════════════════════════════

  /**
   * Inicializa el listener del campo f-orden para detectar duplicados
   * mientras el usuario tipea, con debounce de 600 ms.
   * Inyecta el div de estado (#orden-check-status) debajo del campo.
   */
  function _initOrdenRealTimeCheck() {
    const input = document.getElementById('f-orden');
    if (!input) return;

    // Inyectar div de estado si no existe
    if (!document.getElementById('orden-check-status')) {
      const statusEl = document.createElement('div');
      statusEl.id = 'orden-check-status';
      statusEl.className = 'orden-check-status hidden';
      // Insertarlo después del input (dentro del mismo .form-group)
      input.insertAdjacentElement('afterend', statusEl);
    }

    input.addEventListener('input', () => {
      const valor = input.value.trim();
      clearTimeout(_ordenCheckTimer);

      // Si está vacío, limpiar estado
      if (!valor) {
        _ordenUltimaQuery = '';
        _renderOrdenStatus('idle');
        return;
      }

      // Si es el mismo valor que ya consultamos, no repetir
      if (valor === _ordenUltimaQuery) return;

      // Mostrar "verificando..." mientras espera el debounce
      _renderOrdenStatus('checking');

      _ordenCheckTimer = setTimeout(() => _consultarOrdenDuplicado(valor), 600);
    });

    // Al limpiar el campo (ej: resetForm), ocultar el indicador
    input.addEventListener('change', () => {
      if (!input.value.trim()) {
        _ordenUltimaQuery = '';
        _renderOrdenStatus('idle');
      }
    });
  }

  /**
   * Consulta Supabase para ver si ya existe un pedido con ese número de orden.
   * Actualiza el indicador inline según el resultado.
   */
  async function _consultarOrdenDuplicado(orden) {
    if (_ordenChecking) return; // evitar solapamiento
    _ordenChecking = true;
    _ordenUltimaQuery = orden;

    try {
      const { data, error } = await window.supabaseClient
        .from('pedidos')
        .select('id, cliente, estado, fecha_carga, sufijo')
        .eq('orden', orden)
        .limit(5);

      if (error) throw error;

      if (data && data.length > 0) {
        _renderOrdenStatus('duplicado', data);
      } else {
        _renderOrdenStatus('libre');
      }
    } catch (e) {
      // Si falla la consulta, limpiar silenciosamente (no bloquear al usuario)
      console.warn('Error al verificar orden en tiempo real:', e);
      _renderOrdenStatus('idle');
    } finally {
      _ordenChecking = false;
    }
  }

  /**
   * Renderiza el indicador inline debajo del campo f-orden.
   *
   * estados:
   *  'idle'      → oculto (sin valor)
   *  'checking'  → "Verificando..."
   *  'libre'     → ✅ Número disponible
   *  'duplicado' → 🔴 Ya existe — con detalle de los pedidos existentes
   */
  function _renderOrdenStatus(estado, pedidos) {
    const el = document.getElementById('orden-check-status');
    const input = document.getElementById('f-orden');
    if (!el) return;

    if (estado === 'idle') {
      el.className = 'orden-check-status hidden';
      el.innerHTML = '';
      input?.classList.remove('orden-input--libre', 'orden-input--dup');
      return;
    }

    el.classList.remove('hidden');

    if (estado === 'checking') {
      el.className = 'orden-check-status orden-check--checking';
      el.innerHTML = `<span class="orden-check-spinner"></span> Verificando número de orden...`;
      input?.classList.remove('orden-input--libre', 'orden-input--dup');
      return;
    }

    if (estado === 'libre') {
      el.className = 'orden-check-status orden-check--libre';
      el.innerHTML = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><polyline points="4 10 8 14 16 6"/></svg> Número disponible`;
      input?.classList.remove('orden-input--dup');
      input?.classList.add('orden-input--libre');
      return;
    }

    if (estado === 'duplicado' && pedidos?.length) {
      const ESTADO_SHORT = {
        'Cristales pedidos a lab':     '⏳ Cristales',
        'Armazón enviado p/calibrado': '📦 En tránsito',
        'En laboratorio':              '🏭 En lab.',
        'Pendiente de retirar':        '✅ Listo para retirar',
        'Retirado':                    '✔️ Retirado',
      };

      const filas = pedidos.map(p => {
        const sufijo = p.sufijo ? `-${p.sufijo}` : '';
        const fecha  = new Date(p.fecha_carga).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
        const estadoLabel = ESTADO_SHORT[p.estado] || p.estado;
        return `<div class="orden-dup-row">
          <span class="orden-dup-ord">#${esc(String(p.orden))}${esc(sufijo)}</span>
          <span class="orden-dup-cliente">${esc(p.cliente || '—')}</span>
          <span class="orden-dup-est">${estadoLabel}</span>
          <span class="orden-dup-fecha">${fecha}</span>
        </div>`;
      }).join('');

      el.className = 'orden-check-status orden-check--dup';
      el.innerHTML = `
        <div class="orden-dup-header">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><circle cx="10" cy="10" r="8"/><line x1="10" y1="6" x2="10" y2="10"/><circle cx="10" cy="14" r="1" fill="currentColor" stroke="none"/></svg>
          Este número ya está en uso — no se puede repetir
        </div>
        <div class="orden-dup-list">${filas}</div>`;
      input?.classList.remove('orden-input--libre');
      input?.classList.add('orden-input--dup');
    }
  }

  // ── FOTO ADJUNTA ─────────────────────────────────
  function _initFotoViewer() {
    if (!document.getElementById('foto-viewer-overlay')) {
      const ov = document.createElement('div');
      ov.id = 'foto-viewer-overlay'; ov.className = 'hidden';
      ov.innerHTML = `<div class="foto-viewer-bg" onclick="App.cerrarFotoViewer()"></div>
        <img id="foto-viewer-img" src="" alt="Foto del pedido">
        <button class="foto-viewer-close" onclick="App.cerrarFotoViewer()">✕</button>`;
      document.body.appendChild(ov);
    }
    if (!document.getElementById('foto-input-existente')) {
      const fi = document.createElement('input');
      fi.type = 'file'; fi.id = 'foto-input-existente'; fi.accept = 'image/*'; fi.className = 'hidden';
      fi.addEventListener('change', () => _handleFotoExistenteChange(fi));
      document.body.appendChild(fi);
    }
  }

  function onFotoSelected(num, input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    _fotoFiles[num] = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById(`foto-preview-wrap${num}`)?.classList.remove('hidden');
      document.getElementById(`foto-zone${num}`)?.classList.add('hidden');
      const img = document.getElementById(`foto-preview-img${num}`);
      if (img) img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function clearFoto(num) {
    _fotoFiles[num] = null;
    document.getElementById(`foto-preview-wrap${num}`)?.classList.add('hidden');
    document.getElementById(`foto-zone${num}`)?.classList.remove('hidden');
    const inp = document.getElementById(`foto-finput${num}`);
    if (inp) inp.value = '';
  }

  function abrirFotoViewer(id) {
    const p = _pedidosCache.find(x => x.id === id);
    if (!p?.foto_url) return;
    const ov = document.getElementById('foto-viewer-overlay');
    const img = document.getElementById('foto-viewer-img');
    if (!ov || !img) return;
    img.src = p.foto_url;
    ov.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function cerrarFotoViewer() {
    document.getElementById('foto-viewer-overlay')?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function uploadFotoExistente(id) { _fotoUploadTarget = id; document.getElementById('foto-input-existente')?.click(); }
  function cambiarFoto(id) { _fotoUploadTarget = id; document.getElementById('foto-input-existente')?.click(); }

  async function eliminarFotoConfirm(id) {
    if (!Auth.isAdmin()) return;
    const p = _pedidosCache.find(x => x.id === id);
    const desc = p ? `#${p.orden}${p.sufijo?'-'+p.sufijo:''} — ${p.cliente}` : `ID ${id}`;
    if (!confirm(`¿Eliminar la foto de ${desc}?\n\nEsta acción no se puede deshacer.`)) return;
    try {
      await Pedidos.eliminarFoto(id);
      const idx = _pedidosCache.findIndex(x => x.id === id);
      if (idx !== -1) _pedidosCache[idx] = { ..._pedidosCache[idx], foto_url: null };
      toast('Foto eliminada', 'success');
      _refreshTrassCambioFoto(id);
    } catch(e) { toast('Error al eliminar foto: ' + e.message, 'error'); }
  }

  async function _handleFotoExistenteChange(input) {
    const id = _fotoUploadTarget; _fotoUploadTarget = null;
    if (!input.files || !input.files[0] || !id) { input.value = ''; return; }
    const file = input.files[0]; input.value = '';
    try {
      toast('Subiendo foto…', 'success');
      const url = await Pedidos.uploadFoto(id, file);
      const idx = _pedidosCache.findIndex(x => x.id === id);
      if (idx !== -1) _pedidosCache[idx] = { ..._pedidosCache[idx], foto_url: url };
      toast('Foto guardada ✓', 'success');
      _refreshTrassCambioFoto(id);
    } catch(e) { toast('Error al subir foto: ' + e.message, 'error'); }
  }

  function _refreshTrassCambioFoto(id) {
    if (_currentScreen === 'pedidos') { renderPedidosList(); }
    else if (_currentScreen === 'seguimiento') { _renderSeguimientoFiltered(); }
    const em = document.getElementById('edit-modal');
    if (em && !em.classList.contains('hidden') && _detalleId === id) abrirEdicion();
  }

  // ── CONFIG CACHE ──────────────────────────────────
  async function loadConfig() {
    try {
      const {data,error}=await window.supabaseClient.from('configuracion').select('*').eq('activo',true).order('orden');
      if (error) throw error;
      _configCache.laboratorios=data.filter(r=>r.tipo==='laboratorio').map(r=>r.valor);
      _configCache.marcas=data.filter(r=>r.tipo==='marca').map(r=>({id:r.id,valor:r.valor}));
      _configCache.materiales=data.filter(r=>r.tipo==='material').map(r=>({id:r.id,valor:r.valor}));
      _configCache.tratamientos={};
      data.filter(r=>r.tipo==='tratamiento').forEach(r=>{
        if (!_configCache.tratamientos[r.categoria]) _configCache.tratamientos[r.categoria]=[];
        _configCache.tratamientos[r.categoria].push({id:r.id,valor:r.valor});
      });
    } catch(e) {
      _configCache.laboratorios=['Sol','Bichara','Cristian','Vitolen'];
      _configCache.marcas=[]; _configCache.materiales=[];
    }
    const fl=document.getElementById('filtro-lab');
    if (fl) fl.innerHTML='<option value="">Todos los labs</option>'+_configCache.laboratorios.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');
  }

  function buildBloqueFields(num) {
    const container=document.getElementById(`bloque${num}-fields`); if (!container) return;
    const labs=_configCache.laboratorios.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');
    const marcaSelectOpts=['<option value="">— Sin especificar —</option>',..._configCache.marcas.map(m=>`<option value="${esc(m.valor)}">${esc(m.valor)}</option>`)].join('');
    const matOpts=['<option value="">— Sin especificar —</option>',..._configCache.materiales.map(m=>`<option value="${esc(m.valor)}">${esc(m.valor)}</option>`)].join('');

    container.innerHTML=`
      <div class="form-row">
        <div class="form-group"><label class="form-label required">Laboratorio</label>
          <select id="f-lab${num}" class="form-control"><option value="">— Seleccionar —</option>${labs}</select>
          <div class="form-error" id="err-lab${num}">Campo obligatorio</div></div>
        <div class="form-group"><label class="form-label required">Tipo de lente</label>
          <select id="f-lente${num}" class="form-control" onchange="App.onLenteChange(${num})">
            <option value="">— Seleccionar —</option>
            <option>Monofocal</option><option>Bifocal</option><option>Ocupacional</option><option>Progresivo</option><option>Teñido</option>
          </select>
          <div class="form-error" id="err-lente${num}">Campo obligatorio</div></div>
      </div>
      <div class="form-group"><label class="form-label">Tratamiento</label>
        <select id="f-tratamiento${num}" class="form-control"><option value="">— Primero elegí tipo de lente —</option></select></div>
      <div class="form-group"><label class="form-label">Distancia</label>
        <div class="distancia-tabs" id="dist-tabs${num}">
          <button type="button" class="dist-tab active" data-dist="lejos" onclick="App.setDistancia(${num},'lejos')">Lejos</button>
          <button type="button" class="dist-tab" data-dist="cerca" onclick="App.setDistancia(${num},'cerca')">Cerca</button>
          <button type="button" class="dist-tab" data-dist="ambos" onclick="App.setDistancia(${num},'ambos')">Ambos</button>
        </div></div>
      <div class="grad-tabla" id="grad-lejos${num}"><div class="grad-tabla-title">👁️ Lejos</div>${gradTablaHTML(num,'L')}</div>
      <div class="grad-tabla hidden" id="grad-cerca${num}"><div class="grad-tabla-title">📖 Cerca</div>${gradTablaHTML(num,'C')}</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">2 etapas</label>
          <select id="f-etapas${num}" class="form-control"><option value="No">No</option><option value="Si">Sí</option></select></div>
        <div class="form-group"><label class="form-label">Armazón</label>
          <select id="f-armazon-tipo${num}" class="form-control" onchange="App.onArmazonTipoChange(${num})">
            <option value="">— Sin armazón —</option>
            <option value="nuevo">Nuevo</option>
            <option value="cliente">Del cliente</option>
          </select></div>
      </div>
      <div id="f-armazon-nuevo${num}" class="armazon-bloque hidden">
        <div class="armazon-bloque-title">🆕 Armazón nuevo</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Marca</label>
            <select id="f-marca${num}" class="form-control">${marcaSelectOpts}</select></div>
          <div class="form-group"><label class="form-label">Código / Ref</label>
            <input type="text" id="f-codigoref${num}" class="form-control" placeholder="RB3025"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Material</label>
            <select id="f-material${num}" class="form-control">${matOpts}</select></div>
          <div class="form-group"><label class="form-label">Color</label>
            <input type="text" id="f-color${num}" class="form-control" placeholder="Negro, Dorado..."></div>
        </div>
      </div>
      <div id="f-armazon-cliente${num}" class="armazon-bloque hidden">
        <div class="armazon-bloque-title">👤 Armazón del cliente</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Marca</label>
            <input type="text" id="f-marca-cli${num}" class="form-control" placeholder="Escribe la marca"></div>
          <div class="form-group"><label class="form-label">Material</label>
            <select id="f-material-cli${num}" class="form-control">${matOpts}</select></div>
        </div>
        <div class="form-group"><label class="form-label">Color</label>
          <input type="text" id="f-color-cli${num}" class="form-control" placeholder="Negro, Dorado..."></div>
      </div>
      <div class="form-group">
        <label class="form-label">Observaciones</label>
        <textarea id="f-obs${num}" class="form-control" rows="2" placeholder="Notas adicionales sobre este anteojo..." style="resize:vertical;font-size:1rem"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Foto del pedido <span class="form-label-hint">(opcional — sobre / armazón)</span></label>
        <div class="foto-upload-zone" id="foto-zone${num}" onclick="document.getElementById('foto-finput${num}').click()">
          📷 Tocar para adjuntar foto
          <input type="file" id="foto-finput${num}" accept="image/*" class="hidden" onchange="App.onFotoSelected(${num}, this)">
        </div>
        <div class="foto-preview-wrap hidden" id="foto-preview-wrap${num}">
          <img class="foto-preview-img" id="foto-preview-img${num}" src="" alt="Vista previa" onclick="document.getElementById('foto-finput${num}').click()">
          <div>
            <div style="font-size:.78rem;color:var(--gris-texto);margin-bottom:6px">Foto seleccionada</div>
            <button type="button" class="btn-foto-clear" onclick="App.clearFoto(${num})">✕ Quitar</button>
          </div>
        </div>
      </div>`;

    attachNumpadListeners(container);
  }

  function onArmazonTipoChange(num) {
    const tipo = document.getElementById(`f-armazon-tipo${num}`)?.value;
    document.getElementById(`f-armazon-nuevo${num}`)?.classList.toggle('hidden', tipo !== 'nuevo');
    document.getElementById(`f-armazon-cliente${num}`)?.classList.toggle('hidden', tipo !== 'cliente');
  }

  function gradTablaHTML(num,dc) {
    const esf=(id)=>`<input type="text" class="form-control grad-input grad-esf" id="${id}" placeholder="ej: -1.25" readonly autocomplete="off">`;
    const cil=(id)=>`<input type="text" class="form-control grad-input grad-cil" id="${id}" placeholder="ej: -0.50" readonly autocomplete="off">`;
    const eje=(id)=>`<input type="text" class="form-control grad-input grad-eje" id="${id}" placeholder="°" inputmode="numeric" autocomplete="off">`;
    const add=(id)=>`<input type="text" class="form-control grad-input grad-add" id="${id}" placeholder="ej: +2.00" readonly autocomplete="off">`;
    return `<div class="grad-grid">
      <div class="grad-header"></div><div class="grad-header">Esf</div><div class="grad-header">Cil</div><div class="grad-header">Eje</div><div class="grad-header">Ad.</div>
      <div class="grad-ojo">D</div>${esf(`g-${dc}-esf-D-${num}`)}${cil(`g-${dc}-cil-D-${num}`)}${eje(`g-${dc}-eje-D-${num}`)}${add(`g-${dc}-add-D-${num}`)}
      <div class="grad-ojo">I</div>${esf(`g-${dc}-esf-I-${num}`)}${cil(`g-${dc}-cil-I-${num}`)}${eje(`g-${dc}-eje-I-${num}`)}${add(`g-${dc}-add-I-${num}`)}
    </div>`;
  }

  function onLenteChange(num) {
    const lente=document.getElementById(`f-lente${num}`)?.value;
    const sel=document.getElementById(`f-tratamiento${num}`); if (!sel) return;
    const opts=_configCache.tratamientos[lente]||[];
    sel.innerHTML=opts.length?`<option value="">— Seleccionar —</option>`+opts.map(t=>`<option value="${esc(t.valor)}">${esc(t.valor)}</option>`).join(''):`<option value="">Sin tratamientos para este tipo</option>`;
  }

  function setDistancia(num,dist) {
    document.querySelectorAll(`#dist-tabs${num} .dist-tab`).forEach(t=>t.classList.toggle('active',t.dataset.dist===dist));
    document.getElementById(`grad-lejos${num}`).classList.toggle('hidden',dist==='cerca');
    document.getElementById(`grad-cerca${num}`).classList.toggle('hidden',dist==='lejos');
  }

  // ── NAVIGATION ───────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.getElementById(`screen-${name}`)?.classList.add('active');
    document.getElementById(`nav-${name}`)?.classList.add('active');
    _currentScreen=name;
    if (name==='pedidos')     loadPedidos();
    if (name==='seguimiento') loadSeguimiento();
    if (name==='panel')       refreshPanel();
    if (name==='config')      loadConfigScreen();
    if (name==='agenda' && typeof loadClientes === 'function') loadClientes();
    if (name==='inicio') { setTimeout(_cargarObrasSocialesForm, 50); }
    const fab=document.getElementById('fab-nuevo-pedido');
    if (fab) fab.style.display=(name==='inicio'||name==='agenda')?'none':'flex';
  }

  function estadoRowClass(estado) {
    const map = {
      'Cristales pedidos a lab': 'ped-row--estado-cristales',
      'Armazón enviado p/calibrado': 'ped-row--estado-armazon',
      'En laboratorio': 'ped-row--estado-lab',
      'Pendiente de retirar': 'ped-row--estado-retirar',
      'Retirado': 'ped-row--estado-retirado',
    };
    return map[estado] || '';
  }

  function calcDiasHabiles(fecha) {
    if (!fecha) return 0;
    const inicio = new Date(fecha); inicio.setHours(0,0,0,0);
    const hoyDate = new Date(); hoyDate.setHours(0,0,0,0);
    let dias = 0;
    const cur = new Date(inicio);
    while (cur < hoyDate) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) dias++;
      cur.setDate(cur.getDate() + 1);
    }
    return dias;
  }

  const CARD_ESTADO_MAP = {
    'Cristales pedidos a lab':     { badgeCls: 'amarillo', icono: '⏳', label: 'CRISTALES',   borderCls: 'amarillo' },
    'Armazón enviado p/calibrado': { badgeCls: 'indigo',   icono: '📦', label: 'EN TRÁNSITO', borderCls: 'indigo'   },
    'En laboratorio':              { badgeCls: 'azul',     icono: '🔵', label: 'EN LAB',       borderCls: 'azul'     },
    'Pendiente de retirar':        { badgeCls: 'verde',    icono: '✅', label: 'LISTO',        borderCls: 'verde'    },
    'Retirado':                    { badgeCls: 'morado',   icono: '✔️', label: 'RETIRADO',     borderCls: 'morado'   },
  };

  function getCardConfig(p) {
    const dh = calcDiasHabiles(p.fecha_pedido || p.fecha_carga);
    let advertencia = dh >= 5 && p.estado !== 'Retirado';
    if (p.fecha_prometida && p.estado !== 'Retirado') {
      const hoy = new Date(); hoy.setHours(0,0,0,0);
      const prom = new Date(p.fecha_prometida + 'T00:00:00');
      advertencia = hoy > prom;
    }
    const cfg = CARD_ESTADO_MAP[p.estado] || { badgeCls: 'gris', icono: '●', label: p.estado, borderCls: 'gris' };
    let borderCls = cfg.borderCls;
    if (advertencia || p._est.valor === 'critico') borderCls = 'rojo';
    else if (p._est.valor === 'demorado') borderCls = 'naranja';
    return { ...cfg, dh, advertencia, borderCls };
  }

  function getCategoryKey(p) {
    if (p.estado === 'Retirado') return 'retirado';
    const dh = calcDiasHabiles(p.fecha_pedido || p.fecha_carga);
    if (dh >= 5 || p._est.valor === 'critico' || p._est.valor === 'demorado') return 'advertencia';
    if (['Cristales pedidos a lab', 'Armazón enviado p/calibrado'].includes(p.estado)) return 'espera';
    if (p.estado === 'En laboratorio') return 'lab';
    if (p.estado === 'Pendiente de retirar') return 'listo';
    return 'lab';
  }

  const CAT_ORDER = { advertencia: 0, espera: 1, lab: 2, listo: 3, retirado: 4 };

  function sortPorPrioridad(a, b) {
    const catA = CAT_ORDER[getCategoryKey(a)] ?? 9;
    const catB = CAT_ORDER[getCategoryKey(b)] ?? 9;
    if (catA !== catB) return catA - catB;
    const dhA = calcDiasHabiles(a.fecha_pedido || a.fecha_carga);
    const dhB = calcDiasHabiles(b.fecha_pedido || b.fecha_carga);
    if (dhB !== dhA) return dhB - dhA;
    return new Date(b.fecha_carga) - new Date(a.fecha_carga);
  }

  // ═══════════════════════════════════════════════
  //  SEGUIMIENTO — rediseño
  // ═══════════════════════════════════════════════

  function _buildSegHeader() {
    const screen = document.getElementById('screen-seguimiento');
    if (!screen || document.getElementById('seg-kpis-wrap')) return;
    const tabs = screen.querySelector('.seg-tabs');
    if (!tabs) return;
    const wrap = document.createElement('div');
    wrap.id = 'seg-header-wrap';
    wrap.innerHTML = '<div id="seg-kpis-wrap"></div><div id="seg-chips-wrap"></div>';
    tabs.parentNode.insertBefore(wrap, tabs);
  }

  async function loadSeguimiento() {
    try {
      const todos = await Pedidos.getPedidosActivos();
      _pedidosCache = todos;
      _buildSegHeader();
      _renderSegKPIs(todos);
      _renderSegChips(todos);
      _renderSeguimientoFiltered();
      updateBadge();
      const criticos = todos.filter(p => p._est.valor === 'critico');
      const demorados = todos.filter(p => p._est.valor === 'demorado');
      if (criticos.length > 0) enviarNotificacion('🔴 Pedidos críticos — OLVISIÓN', `${criticos.length} pedido${criticos.length>1?'s':''} superó el tiempo límite`, true);
      else if (demorados.length > 0) enviarNotificacion('⚠️ Demorados — OLVISIÓN', `${demorados.length} pedido${demorados.length>1?'s':''} demorado en laboratorio`, true);
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  }

  function _renderSegKPIs(todos) {
    const el = document.getElementById('seg-kpis-wrap'); if (!el) return;
    const activos  = todos.filter(p => p.estado !== 'Retirado');
    const urgentes = activos.filter(p => p.urgente === 'Si');
    const atencion = activos.filter(p => p.urgente !== 'Si' && (p._est?.valor === 'critico' || p._est?.valor === 'demorado'));
    const retirar  = todos.filter(p => p.estado === 'Pendiente de retirar');
    const contarFilas = (lista) => { const groups = groupPedidos(lista); return groups.length; };
    el.innerHTML = `<div class="seg-kpi-grid">
      <div class="seg-kpi-card" onclick="App.setSeguimientoFilter('todos')">
        <div class="seg-kpi-icon-bg">📋</div>
        <div class="seg-kpi-val">${contarFilas(activos)}</div>
        <div class="seg-kpi-label">Pedidos activos</div>
        <div class="seg-kpi-link">Ver todos →</div>
      </div>
      <div class="seg-kpi-card seg-kpi-card--red" onclick="App.setSeguimientoFilter('urgentes')">
        <div class="seg-kpi-icon-bg">🚨</div>
        <div class="seg-kpi-val seg-kpi-val--red">${contarFilas(urgentes)}</div>
        <div class="seg-kpi-label">Urgentes</div>
        <div class="seg-kpi-link seg-kpi-link--red">Ver urgentes →</div>
      </div>
      <div class="seg-kpi-card seg-kpi-card--amber" onclick="App.setSeguimientoFilter('atencion')">
        <div class="seg-kpi-icon-bg">⚠️</div>
        <div class="seg-kpi-val seg-kpi-val--amber">${contarFilas(atencion)}</div>
        <div class="seg-kpi-label">Requieren atención</div>
        <div class="seg-kpi-link seg-kpi-link--amber">Ver pendientes →</div>
      </div>
      <div class="seg-kpi-card seg-kpi-card--green" onclick="App.switchSegTab('retirar')">
        <div class="seg-kpi-icon-bg">📅</div>
        <div class="seg-kpi-val seg-kpi-val--green">${contarFilas(retirar)}</div>
        <div class="seg-kpi-label">Listos para retirar</div>
        <div class="seg-kpi-link seg-kpi-link--green">Ir a para retirar →</div>
      </div>
    </div>`;
  }

  function _renderSegChips(todos) {
    const el = document.getElementById('seg-chips-wrap'); if (!el) return;
    const activos = todos.filter(p => p.estado !== 'Retirado');
    const labCounts = {};
    activos.forEach(p => { if (p.laboratorio) labCounts[p.laboratorio] = (labCounts[p.laboratorio]||0)+1; });
    const labs = Object.keys(labCounts).sort();
    el.innerHTML = `<div class="seg-chips-row">
      <div class="seg-chips-scroll">
        <span class="seg-chip-label">Laboratorios</span>
        ${labs.map(lab => `<button class="seg-lab-chip ${_labFilter===lab?'seg-lab-chip--active':''}" onclick="App.setLabFilter('${esc(lab)}')">
          <span class="seg-lab-dot-sm" style="background:${getLabColor(lab)}"></span>
          ${esc(lab)} <span class="seg-chip-count">${labCounts[lab]}</span>
        </button>`).join('')}
      </div>
      <div class="seg-search-box">
        <svg class="seg-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="8.5" cy="8.5" r="5.5"/><line x1="13" y1="13" x2="17" y2="17"/>
        </svg>
        <input type="text" class="seg-search-input" placeholder="Buscar pedido..."
               value="${esc(_segSearch)}" oninput="App.onSegSearch(this.value)" autocomplete="off">
      </div>
    </div>`;
  }

  function _renderSeguimientoFiltered() {
    const todos = _pedidosCache;
    const searchPanel = document.getElementById('seg-search-results');
    const tabsEl      = document.querySelector('#screen-seguimiento .seg-tabs');
    const contentLab  = document.getElementById('seg-content-lab');
    const contentRet  = document.getElementById('seg-content-retirar');

    if (_segSearch) {
      const q = _segSearch;
      const match = p => p.cliente?.toLowerCase().includes(q) || String(p.orden).toLowerCase().includes(q);
      let resultados = todos.filter(match);
      if (_labFilter) resultados = resultados.filter(p => p.laboratorio === _labFilter);

      if (tabsEl)     tabsEl.style.display     = 'none';
      if (contentLab) contentLab.style.display  = 'none';
      if (contentRet) contentRet.style.display  = 'none';

      if (!searchPanel) {
        const div = document.createElement('div');
        div.id = 'seg-search-results';
        contentLab?.parentNode.appendChild(div);
      }
      const panel = document.getElementById('seg-search-results');
      if (!panel) return;
      panel.style.display = 'block';

      if (!resultados.length) {
        panel.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><h3>Sin resultados</h3><p>No se encontró ningún pedido para "${esc(_segSearch)}"</p></div>`;
        return;
      }

      const sorted = [...resultados].sort((a,b) => {
        const aR = a.estado === 'Retirado' ? 1 : 0;
        const bR = b.estado === 'Retirado' ? 1 : 0;
        if (aR !== bR) return aR - bR;
        return new Date(b.fecha_carga) - new Date(a.fecha_carga);
      });
      const groups = groupPedidos(sorted);
      panel.innerHTML = `
        <div class="seg-search-header">
          <span class="seg-search-res-label">🔍 ${groups.length} resultado${groups.length!==1?'s':''} en toda la app</span>
        </div>
        <div class="seg-list">${groups.map(g => g.type==='pair' ? _renderSegPair(g.a,g.b) : _renderSegRow(g.p)).join('')}</div>`;
      attachInlineSelects(panel);
      return;
    }

    if (tabsEl)     tabsEl.style.display     = '';
    if (contentLab) contentLab.style.display  = '';
    if (contentRet) contentRet.style.display  = '';
    if (searchPanel) searchPanel.style.display = 'none';

    let enLab   = todos.filter(p => ['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio'].includes(p.estado));
    let retirar = todos.filter(p => p.estado === 'Pendiente de retirar');
    if (_labFilter) {
      enLab   = enLab.filter(p => p.laboratorio === _labFilter);
      retirar = retirar.filter(p => p.laboratorio === _labFilter);
    }

    const cntEl  = document.getElementById('seg-count-lab');
    const cntRet = document.getElementById('seg-count-retirar');
    if (cntEl)  cntEl.textContent = groupPedidos(enLab).length;
    if (cntRet) cntRet.textContent = groupPedidos(retirar).length;

    _renderSegList('seg-content-lab',     enLab.sort(sortPorPrioridad),   true);
    _renderSegList('seg-content-retirar', retirar.sort(sortPorPrioridad), false);
  }

  function setLabFilter(lab) {
    _labFilter = _labFilter === lab ? null : lab;
    _renderSegChips(_pedidosCache);
    _renderSeguimientoFiltered();
  }

  function onSegSearch(val) {
    _segSearch = val.trim().toLowerCase();
    if (_segSearch) _collapsedSections = {};
    _renderSeguimientoFiltered();
  }

  function setSeguimientoFilter(type) {
    _labFilter = null; _segSearch = '';
    _renderSegChips(_pedidosCache);
    switchSegTab('lab');

    if (type === 'todos') {
      _collapsedSections = {};
    } else if (type === 'urgentes') {
      _collapsedSections = { atencion: true, lab: true };
    } else if (type === 'atencion') {
      _collapsedSections = { urgentes: true, lab: true };
    }

    _renderSeguimientoFiltered();

    setTimeout(() => {
      const ids = { urgentes:'sg-urgentes', atencion:'sg-atencion', todos:null };
      const elId = ids[type];
      if (elId) {
        const el = document.getElementById(elId);
        if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
      } else {
        document.getElementById('seg-content-lab')?.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    }, 150);
  }

  function _renderSegList(containerId, pedidos, conGrupos) {
    const el = document.getElementById(containerId); if (!el) return;
    if (!pedidos.length) {
      el.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><h3>Sin pedidos</h3><p>No hay pedidos en este estado</p></div>`;
      return;
    }
    const groups = groupPedidos(pedidos);
    if (!conGrupos) {
      el.innerHTML = `<div class="seg-list">${groups.map(g => g.type==='pair' ? _renderSegPair(g.a,g.b) : _renderSegRow(g.p)).join('')}</div>`;
      attachInlineSelects(el); return;
    }
    const SEG_CATS = [
      { key:'urgentes', id:'sg-urgentes', icon:'⚡', label:'URGENTES',           color:'#DC2626', bg:'#FFF0F0' },
      { key:'atencion', id:'sg-atencion', icon:'⚠️', label:'REQUIEREN ATENCIÓN', color:'#B45309', bg:'#FFFBEB' },
      { key:'lab',      id:'sg-lab',      icon:'●',  label:'EN LABORATORIO',     color:'#034291', bg:'#EFF6FF' },
    ];
    const buckets = { urgentes:[], atencion:[], lab:[] };
    groups.forEach(g => {
      const p = g.type==='pair' ? g.a : g.p;
      (buckets[getSegCatKey(p)] || buckets.lab).push(g);
    });
    const getDh = g => g.type==='pair'
      ? Math.max(getCardConfig(g.a).dh, getCardConfig(g.b).dh)
      : getCardConfig(g.p).dh;
    Object.keys(buckets).forEach(k => buckets[k].sort((a,b) => getDh(b) - getDh(a)));

    let html = '<div class="seg-list">';
    SEG_CATS.forEach(cat => {
      const items = buckets[cat.key]; if (!items.length) return;
      const isCollapsed = !!_collapsedSections[cat.key];
      html += `<div class="seg-gh seg-gh--clickable" id="${cat.id}" style="--gc:${cat.color};--gb:${cat.bg}" onclick="App.toggleSegSection('${cat.key}')">
        <span class="seg-gh-icon">${cat.icon}</span>
        <span class="seg-gh-label">${cat.label}</span>
        <span class="seg-gh-count">(${items.length})</span>
        <span class="seg-gh-arrow${isCollapsed?'':' seg-gh-arrow--open'}">›</span>
      </div>`;
      if (!isCollapsed) {
        html += `<div class="seg-section-body">`;
        html += _segTableHeader();
        html += items.map(g => g.type==='pair' ? _renderSegPair(g.a,g.b) : _renderSegRow(g.p)).join('');
        html += `</div>`;
      }
    });
    html += '</div>';
    el.innerHTML = html;
    attachInlineSelects(el);
  }

  function toggleSegSection(key) {
    _collapsedSections[key] = !_collapsedSections[key];
    _renderSeguimientoFiltered();
  }

  function _segTableHeader() {
    return `<div class="seg-th-row">
      <div class="seg-th seg-th--orden"># ORDEN</div>
      <div class="seg-th seg-th--paciente">PACIENTE</div>
      <div class="seg-th seg-th--estado">ESTADO</div>
      <div class="seg-th seg-th--tiempo">TIEMPO</div>
      <div class="seg-th seg-th--arrow"></div>
    </div>`;
  }

  function _renderSegRow(p) {
    const sufijo   = p.sufijo ? `-${p.sufijo}` : '';
    const isOpen   = _expandedId === p.id;
    const cfg      = getCardConfig(p);
    const d        = new Date(p.fecha_carga);
    const fecha    = `${d.getDate()}/${d.getMonth()+1}`;
    const labColor = getLabColor(p.laboratorio);
    const isUrgente = p.urgente === 'Si' && p.estado !== 'Retirado';
    let daysCls = 'seg-time';
    if (isUrgente || cfg.advertencia || p._est?.valor === 'critico') daysCls = 'seg-time seg-time--red';
    else if (p._est?.valor === 'demorado') daysCls = 'seg-time seg-time--amber';
    const timeLabel = (isUrgente || cfg.advertencia) ? 'Demorado' : 'En curso';

    const ESTADOS = ['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
    const opts = ESTADOS.map(e=>`<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');

    const detalle = `<div class="ped-row-detail ${isOpen?'':'hidden'}" onclick="event.stopPropagation()">
      <div class="ped-row-detail-grid">
        ${p.tipo_lente?`<div class="prd-item"><span class="prd-label">Lente</span><span class="prd-val">${esc(p.tipo_lente)}</span></div>`:''}
        ${p.tratamiento?`<div class="prd-item"><span class="prd-label">Tratamiento</span><span class="prd-val">${esc(p.tratamiento)}</span></div>`:''}
        ${p.tipo?`<div class="prd-item"><span class="prd-label">Tipo</span><span class="prd-val">${esc(p.tipo)}</span></div>`:''}
        ${p.dos_etapas==='Si'?`<div class="prd-item"><span class="prd-label">Etapas</span><span class="prd-val">2 etapas</span></div>`:''}
        ${p.graduacion?`<div class="prd-item prd-item--full"><span class="prd-label">Graduación</span><span class="prd-val" style="font-family:var(--font-mono);font-size:.8rem">${esc(p.graduacion).replace(/\|/g,' | ')}</span></div>`:''}
        ${p.armazon?`<div class="prd-item prd-item--full"><span class="prd-label">Armazón</span><span class="prd-val">${esc(p.armazon)}</span></div>`:''}
        ${p.observaciones?`<div class="prd-item prd-item--full"><span class="prd-label">Obs.</span><span class="prd-val" style="font-style:italic;color:var(--gris-texto)">${esc(p.observaciones)}</span></div>`:''}
        <div class="prd-item"><span class="prd-label">Est. inteligente</span><span class="prd-val">${p._est.texto}</span></div>
        ${p.fecha_prometida?`<div class="prd-item"><span class="prd-label">Fecha prometida</span><span class="prd-val" style="font-weight:600;color:${new Date(p.fecha_prometida+'T00:00:00')>=new Date(new Date().setHours(0,0,0,0))?'#16A34A':'#DC2626'}">📅 ${new Date(p.fecha_prometida+'T00:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})}</span></div>`:''}
        <div class="prd-item"><span class="prd-label">Cargado por</span><span class="prd-val">${esc(p.cargado_por||'—')}</span></div>
        ${_fotoDetalle(p)}
      </div>
      <div class="ped-row-detail-actions">
        <select class="estado-select ${Pedidos.claseEstado(p.estado)} estado-select-inline" data-id="${p.id}" data-prev="${esc(p.estado)}" onclick="event.stopPropagation()">${opts}</select>
        ${Auth.isAdmin()?`<button class="ped-row-edit-btn" onclick="event.stopPropagation();App._abrirDetalleRapido(${p.id})">✏️ Editar</button>`:''}
        ${Auth.isAdmin()?`<button class="ped-row-del-btn" onclick="event.stopPropagation();App.eliminarPedido(${p.id})">🗑️</button>`:''}
      </div>
    </div>`;

    return `<div class="seg-row ped-row${isUrgente?' seg-row--urg':''}" data-id="${p.id}">
      <div class="seg-tr">
        <div class="seg-td seg-td--orden">
          <span class="seg-orden-num">#${esc(p.orden)}${sufijo}</span>
          ${p.foto_url?'<span class="seg-foto-ic" title="Tiene foto">📷</span>':''}
        </div>
        <div class="seg-td seg-td--paciente">
          <div class="seg-pac-name">${isUrgente?'<span class="seg-urg-ic">⚡</span>':''}${esc(p.cliente)}</div>
          <div class="seg-pac-meta">
            ${p.laboratorio?`<span class="seg-row-lab"><span class="seg-lab-dot-sm" style="background:${labColor}"></span>${esc(p.laboratorio)}</span><span class="seg-sep">·</span>`:''}
            <span class="seg-row-date">${fecha}</span>
          </div>
        </div>
        <div class="seg-td seg-td--estado" onclick="event.stopPropagation()">
          <select class="seg-estado-select estado-select ${Pedidos.claseEstado(p.estado)}" data-id="${p.id}" data-prev="${esc(p.estado)}">${opts}</select>
        </div>
        <div class="seg-td seg-td--tiempo">
          <span class="${daysCls}">${cfg.dh}dh</span>
          <span class="seg-time-label">${timeLabel}</span>
        </div>
        <div class="seg-td seg-td--arrow" onclick="event.stopPropagation();App.togglePedidoRow(${p.id})">
          <span class="ped-row-arrow ${isOpen?'open':''}">›</span>
        </div>
      </div>
      ${detalle}
    </div>`;
  }

  function _renderSegPair(pA, pB) {
    const pairId   = `pair-${pA.orden}`;
    const isOpen   = _expandedId === pairId;
    const cfgA     = getCardConfig(pA);
    const cfgB     = getCardConfig(pB);
    const dhMax    = Math.max(cfgA.dh, cfgB.dh);
    const advertencia = cfgA.advertencia || cfgB.advertencia;
    const BORDER_PRIO = ['rojo','naranja','amarillo','indigo','azul','verde','teal','morado','gris'];
    const prioA    = BORDER_PRIO.indexOf(cfgA.borderCls);
    const prioB    = BORDER_PRIO.indexOf(cfgB.borderCls);
    const worstCfg = prioA <= prioB ? cfgA : cfgB;
    const urgente  = pA.urgente==='Si' || pB.urgente==='Si';
    const d        = new Date(pA.fecha_carga);
    const fecha    = `${d.getDate()}/${d.getMonth()+1}`;
    const labColor = getLabColor(pA.laboratorio);
    let daysCls = 'seg-time';
    if (urgente || advertencia || worstCfg._est?.valor === 'critico') daysCls = 'seg-time seg-time--red';
    else if (worstCfg._est?.valor === 'demorado') daysCls = 'seg-time seg-time--amber';
    const timeLabel = (urgente || advertencia) ? 'Demorado' : 'En curso';

    const ESTADOS = ['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
    const subRow = (p, color) => {
      const opts = ESTADOS.map(e=>`<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');
      const pcfg = getCardConfig(p);
      let sdCls = 'seg-d';
      if (pcfg.advertencia || p._est?.valor==='critico') sdCls='seg-d seg-d--red';
      else if (p._est?.valor==='demorado') sdCls='seg-d seg-d--amber';
      return `<div class="ped-pair-sub ped-pair-sub--${color}">
        <div class="ped-pair-header">
          <span class="ped-pair-badge ped-pair-badge--${color}">${p.sufijo}</span>
          ${p.tipo_lente?`<span class="ped-pair-lente-chip">${esc(p.tipo_lente)}</span>`:''}
          <span class="seg-badge badge--${pcfg.badgeCls}" style="font-size:.6rem;padding:2px 8px">${pcfg.icono} ${pcfg.label}</span>
          ${p.laboratorio?`<span class="ped-row-lab">${esc(p.laboratorio)}</span>`:''}
          <span class="ped-pair-spacer"></span>
          <span class="${sdCls}">${pcfg.dh}dh</span>
        </div>
        ${p.graduacion?`<div class="ped-pair-grad">${esc(p.graduacion).replace(/\|/g,' | ')}</div>`:''}
        ${p.observaciones?`<div class="ped-pair-obs">💬 ${esc(p.observaciones)}</div>`:''}
        ${_fotoSubRow(p)}
        <div class="ped-pair-actions">
          <select class="estado-select ${Pedidos.claseEstado(p.estado)} estado-select-inline" data-id="${p.id}" data-prev="${esc(p.estado)}" onclick="event.stopPropagation()">${opts}</select>
          ${Auth.isAdmin()?`<button class="ped-row-edit-btn" onclick="event.stopPropagation();App._abrirDetalleRapido(${p.id})">✏️</button>`:''}
          ${Auth.isAdmin()?`<button class="ped-row-del-btn" onclick="event.stopPropagation();App.eliminarPedido(${p.id})">🗑️</button>`:''}
        </div>
      </div>`;
    };

    return `<div class="seg-row ped-row ped-row--pair${urgente?' seg-row--urg':''}" data-pair-id="${pairId}">
      <div class="seg-tr">
        <div class="seg-td seg-td--orden">
          <span class="seg-orden-num">#${esc(pA.orden)}</span>
        </div>
        <div class="seg-td seg-td--paciente">
          <div class="seg-pac-name">${urgente?'<span class="seg-urg-ic">⚡</span>':''}${esc(pA.cliente)}</div>
          <div class="seg-pac-meta">
            ${pA.laboratorio?`<span class="seg-row-lab"><span class="seg-lab-dot-sm" style="background:${labColor}"></span>${esc(pA.laboratorio)}</span><span class="seg-sep">·</span>`:''}
            <span class="seg-row-date">${fecha}</span>
            <span class="ped-pair-ab-badge" style="margin-left:4px">A · B</span>
          </div>
        </div>
        <div class="seg-td seg-td--estado" onclick="event.stopPropagation()">
          <span class="seg-badge badge--${worstCfg.badgeCls}">${worstCfg.label}</span>
        </div>
        <div class="seg-td seg-td--tiempo">
          <span class="${daysCls}">${dhMax}dh</span>
          <span class="seg-time-label">${timeLabel}</span>
        </div>
        <div class="seg-td seg-td--arrow" onclick="event.stopPropagation();App.togglePedidoRow('${pairId}')">
          <span class="ped-row-arrow ${isOpen?'open':''}">›</span>
        </div>
      </div>
      <div class="ped-row-detail ${isOpen?'':'hidden'}" onclick="event.stopPropagation()">
        ${subRow(pA,'azul')}${subRow(pB,'teal')}
      </div>
    </div>`;
  }

  function groupPedidos(list) {
    const result = [], seen = new Set();
    for (const p of list) {
      if (seen.has(p.id)) continue;
      if (p.sufijo === 'A') {
        const b = list.find(x => x.orden === p.orden && x.sufijo === 'B' && !seen.has(x.id));
        if (b) { result.push({ type:'pair', a:p, b }); seen.add(p.id); seen.add(b.id); continue; }
      } else if (p.sufijo === 'B') {
        const a = list.find(x => x.orden === p.orden && x.sufijo === 'A' && !seen.has(x.id));
        if (a) { result.push({ type:'pair', a, b:p }); seen.add(a.id); seen.add(p.id); continue; }
      }
      result.push({ type:'single', p }); seen.add(p.id);
    }
    return result;
  }

  function _fotoDetalle(p) {
    const isAdmin = Auth.isAdmin();
    if (p.foto_url) {
      const adminBtns = isAdmin
        ? `<button class="btn-foto-sm btn-foto-cambiar" onclick="event.stopPropagation();App.cambiarFoto(${p.id})">🔄 Cambiar</button>
           <button class="btn-foto-sm btn-foto-del" onclick="event.stopPropagation();App.eliminarFotoConfirm(${p.id})">🗑</button>`
        : '';
      return `<div class="prd-item prd-item--full"><span class="prd-label">Foto</span>
        <div class="foto-detalle-wrap">
          <img class="foto-thumb" src="${esc(p.foto_url)}" alt="Foto" loading="lazy" onclick="event.stopPropagation();App.abrirFotoViewer(${p.id})">
          <div class="foto-detalle-btns">
            <button class="btn-foto-sm" onclick="event.stopPropagation();App.abrirFotoViewer(${p.id})">👁 Ver</button>
            ${adminBtns}
          </div>
        </div></div>`;
    }
    return `<div class="prd-item prd-item--full"><span class="prd-label">Foto</span>
      <button class="btn-foto-upload-inline" onclick="event.stopPropagation();App.uploadFotoExistente(${p.id})">📷 Adjuntar foto</button></div>`;
  }

  function _fotoSubRow(p) {
    const isAdmin = Auth.isAdmin();
    if (p.foto_url) {
      const adminBtns = isAdmin
        ? `<button class="btn-foto-sm btn-foto-cambiar" onclick="event.stopPropagation();App.cambiarFoto(${p.id})">🔄</button>
           <button class="btn-foto-sm btn-foto-del" onclick="event.stopPropagation();App.eliminarFotoConfirm(${p.id})">🗑</button>`
        : '';
      return `<div class="foto-sub-wrap">
        <img class="foto-thumb foto-thumb--sm" src="${esc(p.foto_url)}" alt="Foto" loading="lazy" onclick="event.stopPropagation();App.abrirFotoViewer(${p.id})">
        ${adminBtns}</div>`;
    }
    return `<button class="btn-foto-upload-inline btn-foto-upload-inline--sm" onclick="event.stopPropagation();App.uploadFotoExistente(${p.id})">📷 Foto</button>`;
  }

  function renderCompactRow(p) {
    const sufijo = p.sufijo ? `-${p.sufijo}` : '';
    const isOpen = _expandedId === p.id;
    const cfg    = getCardConfig(p);
    const ESTADOS = ['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
    const opts   = ESTADOS.map(e=>`<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');
    const scls   = Pedidos.claseEstado(p.estado);
    const fechaCorta = new Date(p.fecha_carga).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
    const daysBadge = cfg.advertencia ? `<span class="ped-warning-badge">⚠️ ${cfg.dh}dh</span>` : `<span class="ped-days-badge">${cfg.dh}dh</span>`;
    const urgenteBadge = p.urgente==='Si' && p.estado !== 'Retirado' ? '<span class="ped-urgente-chip">⚡ URGENTE</span>' : '';
    const promBadge = (() => {
      if (!p.fecha_prometida || p.estado === 'Retirado') return '';
      const hoy = new Date(); hoy.setHours(0,0,0,0);
      const prom = new Date(p.fecha_prometida + 'T00:00:00');
      const diff = Math.floor((prom - hoy) / (1000*60*60*24));
      const str  = prom.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
      return diff >= 0
        ? `<span class="ped-days-badge" style="color:#16A34A;background:#DCFCE7">📅 ${str}</span>`
        : `<span class="ped-warning-badge">📅 ${str}</span>`;
    })();
    const detalle = `
      <div class="ped-row-detail ${isOpen?'':'hidden'}" onclick="event.stopPropagation()">
        <div class="ped-row-detail-grid">
          ${p.laboratorio?`<div class="prd-item"><span class="prd-label">Lab</span><span class="prd-val">${esc(p.laboratorio)}</span></div>`:''}
          ${p.tipo_lente ?`<div class="prd-item"><span class="prd-label">Lente</span><span class="prd-val">${esc(p.tipo_lente)}</span></div>`:''}
          ${p.tratamiento?`<div class="prd-item"><span class="prd-label">Tratamiento</span><span class="prd-val">${esc(p.tratamiento)}</span></div>`:''}
          ${p.tipo       ?`<div class="prd-item"><span class="prd-label">Tipo</span><span class="prd-val">${esc(p.tipo)}</span></div>`:''}
          ${p.dos_etapas==='Si'?`<div class="prd-item"><span class="prd-label">Etapas</span><span class="prd-val">2 etapas</span></div>`:''}
          ${p.graduacion ?`<div class="prd-item prd-item--full"><span class="prd-label">Graduación</span><span class="prd-val" style="font-family:var(--font-mono);font-size:.8rem">${esc(p.graduacion).replace(/\|/g,' | ')}</span></div>`:''}
          ${p.armazon    ?`<div class="prd-item prd-item--full"><span class="prd-label">Armazón</span><span class="prd-val">${esc(p.armazon)}</span></div>`:''}
          ${p.observaciones?`<div class="prd-item prd-item--full"><span class="prd-label">Observaciones</span><span class="prd-val" style="font-style:italic;color:var(--gris-texto)">${esc(p.observaciones)}</span></div>`:''}
          <div class="prd-item"><span class="prd-label">Estado inteligente</span><span class="prd-val">${p._est.texto}</span></div>
          ${p.fecha_prometida ? (() => {
            const hoy = new Date(); hoy.setHours(0,0,0,0);
            const prom = new Date(p.fecha_prometida + 'T00:00:00');
            const ok   = prom >= hoy;
            const str  = prom.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
            return `<div class="prd-item"><span class="prd-label">Fecha prometida</span><span class="prd-val" style="font-weight:600;color:${ok?'#16A34A':'#DC2626'}">📅 ${str}</span></div>`;
          })() : ''}
          <div class="prd-item"><span class="prd-label">Cargado por</span><span class="prd-val">${esc(p.cargado_por||'—')}</span></div>
          ${_fotoDetalle(p)}
        </div>
        <div class="ped-row-detail-actions">
          <select class="estado-select ${scls} estado-select-inline" data-id="${p.id}" data-prev="${esc(p.estado)}" onclick="event.stopPropagation()">${opts}</select>
          ${Auth.isAdmin()?`<button class="ped-row-edit-btn" onclick="event.stopPropagation();App._abrirDetalleRapido(${p.id})">✏️ Editar</button>`:''}
          ${Auth.isAdmin()?`<button class="ped-row-del-btn" onclick="event.stopPropagation();App.eliminarPedido(${p.id})">🗑️</button>`:''}
        </div>
      </div>`;
    return `<div class="ped-row ped-card ped-card--${cfg.borderCls}" data-id="${p.id}" onclick="App.togglePedidoRow(${p.id})">
      <div class="ped-card-main">
        <div class="ped-card-top-row">
          <span class="ped-status-badge badge--${cfg.badgeCls}">${cfg.icono} ${cfg.label}</span>
          <div class="ped-card-indicators">${urgenteBadge}${daysBadge}<span class="ped-row-arrow ${isOpen?'open':''}">›</span></div>
        </div>
        <div class="ped-card-cliente">${esc(p.cliente)}</div>
        <div class="ped-card-meta">
          <span class="ped-card-orden">#${esc(p.orden)}${sufijo}</span>
          ${p.laboratorio?`<span class="meta-dot">·</span><span>${esc(p.laboratorio)}</span>`:''}
          <span class="meta-dot">·</span><span>${fechaCorta}</span>
          ${promBadge ? `<span class="meta-dot">·</span>${promBadge}` : ''}
          ${p.foto_url ? '<span class="meta-dot">·</span><span style="font-size:.72rem">📷</span>' : ''}
        </div>
      </div>
      ${detalle}
    </div>`;
  }

  function renderPairedRow(pA, pB) {
    const pairId = `pair-${pA.orden}`;
    const isOpen = _expandedId === pairId;
    const cfgA   = getCardConfig(pA);
    const cfgB   = getCardConfig(pB);
    const BORDER_PRIO = ['rojo','naranja','amarillo','indigo','azul','verde','teal','morado','gris'];
    const prioA = BORDER_PRIO.indexOf(cfgA.borderCls);
    const prioB = BORDER_PRIO.indexOf(cfgB.borderCls);
    const borderCls = BORDER_PRIO[Math.min(prioA < 0 ? 99 : prioA, prioB < 0 ? 99 : prioB)] || 'gris';
    const worstCfg  = (prioA <= prioB ? prioA : prioB) === prioA ? cfgA : cfgB;
    const ambosRetirados = pA.estado === 'Retirado' && pB.estado === 'Retirado';
    const urgente    = (pA.urgente==='Si' || pB.urgente==='Si') && !ambosRetirados;
    const dhMax      = Math.max(cfgA.dh, cfgB.dh);
    const advertencia = cfgA.advertencia || cfgB.advertencia;
    const fechaCorta  = new Date(pA.fecha_carga).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
    const ESTADOS = ['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
    const daysBadge = advertencia ? `<span class="ped-warning-badge">⚠️ ${dhMax}dh</span>` : `<span class="ped-days-badge">${dhMax}dh</span>`;
    const subRow = (p, color) => {
      const opts = ESTADOS.map(e=>`<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');
      const scls = Pedidos.claseEstado(p.estado);
      const pcfg = getCardConfig(p);
      return `<div class="ped-pair-sub ped-pair-sub--${color}">
        <div class="ped-pair-header">
          <span class="ped-pair-badge ped-pair-badge--${color}">${p.sufijo}</span>
          ${p.tipo_lente?`<span class="ped-pair-lente-chip">${esc(p.tipo_lente)}</span>`:''}
          <span class="ped-status-badge badge--${pcfg.badgeCls}" style="font-size:.6rem;padding:2px 8px">${pcfg.icono} ${pcfg.label}</span>
          ${p.laboratorio?`<span class="ped-row-lab">${esc(p.laboratorio)}</span>`:''}
          <span class="ped-pair-spacer"></span>
          ${(() => {
            if (!p.fecha_prometida || p.estado === 'Retirado')
              return pcfg.advertencia ? `<span class="ped-warning-badge">⚠️ ${pcfg.dh}dh</span>` : `<span class="ped-days-badge">${pcfg.dh}dh</span>`;
            const hoy = new Date(); hoy.setHours(0,0,0,0);
            const prom = new Date(p.fecha_prometida + 'T00:00:00');
            const diff = Math.floor((prom - hoy) / (1000*60*60*24));
            const str  = prom.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
            return diff >= 0
              ? `<span class="ped-days-badge" style="color:#16A34A;background:#DCFCE7">📅 ${str}</span>`
              : `<span class="ped-warning-badge">📅 ${str}</span>`;
          })()}
        </div>
        ${p.graduacion?`<div class="ped-pair-grad">${esc(p.graduacion).replace(/\|/g,' | ')}</div>`:''}
        ${p.observaciones?`<div class="ped-pair-obs">💬 ${esc(p.observaciones)}</div>`:''}
        ${_fotoSubRow(p)}
        <div class="ped-pair-actions">
          <select class="estado-select ${scls} estado-select-inline" data-id="${p.id}" data-prev="${esc(p.estado)}" onclick="event.stopPropagation()">${opts}</select>
          ${Auth.isAdmin()?`<button class="ped-row-edit-btn" onclick="event.stopPropagation();App._abrirDetalleRapido(${p.id})">✏️</button>`:''}
          ${Auth.isAdmin()?`<button class="ped-row-del-btn" onclick="event.stopPropagation();App.eliminarPedido(${p.id})">🗑️</button>`:''}
        </div>
      </div>`;
    };
    const tienenFoto = pA.foto_url || pB.foto_url;
    return `<div class="ped-row ped-card ped-card--${borderCls} ped-row--pair" data-pair-id="${pairId}" onclick="App.togglePedidoRow('${pairId}')">
      <div class="ped-card-main">
        <div class="ped-card-top-row">
          <span class="ped-status-badge badge--${worstCfg.badgeCls}">${worstCfg.icono} ${worstCfg.label}</span>
          <div class="ped-card-indicators">
            ${urgente?'<span class="ped-urgente-chip">⚡ URGENTE</span>':''}
            ${daysBadge}
            <span class="ped-pair-ab-badge">A · B</span>
            <span class="ped-row-arrow ${isOpen?'open':''}">›</span>
          </div>
        </div>
        <div class="ped-card-cliente">${esc(pA.cliente)}</div>
        <div class="ped-card-meta">
          <span class="ped-card-orden">#${esc(pA.orden)}</span>
          <span class="meta-dot">·</span><span>${fechaCorta}</span>
          ${tienenFoto ? '<span class="meta-dot">·</span><span style="font-size:.72rem">📷</span>' : ''}
        </div>
      </div>
      <div class="ped-row-detail ${isOpen?'':'hidden'}" onclick="event.stopPropagation()">
        ${subRow(pA,'azul')}${subRow(pB,'teal')}
      </div>
    </div>`;
  }

  function switchSegTab(tab) {
    _segTab=tab;
    document.querySelectorAll('.seg-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
    document.getElementById('seg-content-lab').classList.toggle('hidden',tab!=='lab');
    document.getElementById('seg-content-retirar').classList.toggle('hidden',tab!=='retirar');
  }

  function mesLabel(d) { return d.toLocaleDateString('es-AR',{month:'long',year:'numeric'}).replace(/^\w/,c=>c.toUpperCase()); }

  function renderMesNav() {
    const container=document.getElementById('mes-nav-container'); if (!container) return;
    const esHoy = _mesActual.getFullYear()===hoy.getFullYear() && _mesActual.getMonth()===hoy.getMonth();
    container.innerHTML=`<div class="mes-nav">
      <button class="mes-nav-btn" onclick="App.mesPrev()">‹</button>
      <span class="mes-nav-label">${mesLabel(_mesActual)}</span>
      <button class="mes-nav-btn ${esHoy?'mes-nav-btn--disabled':''}" onclick="App.mesNext()" ${esHoy?'disabled':''}>›</button>
    </div>`;
  }

  function mesPrev() { _mesActual=new Date(_mesActual.getFullYear(),_mesActual.getMonth()-1,1); _expandedId=null; renderMesNav(); renderPedidosList(); }
  function mesNext() { const n=new Date(_mesActual.getFullYear(),_mesActual.getMonth()+1,1); if(n>hoy)return; _mesActual=n; _expandedId=null; renderMesNav(); renderPedidosList(); }

  async function loadPedidos() {
    const skel=document.getElementById('pedidos-skeleton');
    const list=document.getElementById('pedidos-list-container');
    const sub=document.getElementById('pedidos-subtitle');
    skel.style.display='flex'; skel.style.flexDirection='column';
    list.style.display='none'; sub.textContent='Cargando...';
    renderMesNav();
    try {
      _pedidosCache=await Pedidos.getTodosPedidos();
      skel.style.display='none'; list.style.display='block';
      renderPedidosList(); updateBadge();
    } catch(e) {
      skel.style.display='none'; list.style.display='block';
      list.innerHTML=`<div class="empty-state"><p style="color:var(--rojo)">Error: ${esc(e.message)}</p></div>`;
    }
  }

  function switchEstadoTab(estado) {
    _estadoTab=estado; _expandedId=null;
    document.querySelectorAll('.estado-tab').forEach(t=>t.classList.toggle('active',t.dataset.estado===estado));
    renderPedidosList();
  }

  function renderPedidosList() {
    const container=document.getElementById('pedidos-list-container');
    const sub=document.getElementById('pedidos-subtitle');
    if (!container) return;
    const mesInicio=_mesActual;
    const mesFin=new Date(_mesActual.getFullYear(),_mesActual.getMonth()+1,1);
    const filtered=_pedidosCache.filter(p=>{
      const fc=new Date(p.fecha_carga);
      if (fc<mesInicio||fc>=mesFin) return false;
      if (_estadoTab!=='todos'&&p.estado!==_estadoTab) return false;
      return true;
    });
    sub.textContent=`${filtered.length} pedido${filtered.length!==1?'s':''}`;
    if (!filtered.length) {
      container.innerHTML=`<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><h3>Sin pedidos</h3><p>No hay pedidos en ${mesLabel(_mesActual).toLowerCase()}</p></div>`;
      return;
    }
    const sorted=[...filtered].sort((a,b)=>new Date(b.fecha_carga)-new Date(a.fecha_carga));
    const groups=groupPedidos(sorted);
    container.innerHTML=`<div class="ped-compact-list">${groups.map(g=>g.type==='pair'?renderPairedRow(g.a,g.b):renderCompactRow(g.p)).join('')}</div>`;
    if (_expandedId !== null) {
      const isPair = typeof _expandedId === 'string' && _expandedId.startsWith('pair-');
      const sel = isPair ? `.ped-row[data-pair-id="${_expandedId}"]` : `.ped-row[data-id="${_expandedId}"]`;
      const row = container.querySelector(sel);
      if (row) { row.querySelector('.ped-row-detail')?.classList.remove('hidden'); row.querySelector('.ped-row-arrow')?.classList.add('open'); }
    }
    attachInlineSelects(container);
  }

  function togglePedidoRow(id) {
    const isPair = typeof id === 'string' && id.startsWith('pair-');
    const selector = isPair ? `.ped-row[data-pair-id="${id}"]` : `.ped-row[data-id="${id}"]`;
    const clickedRow = document.querySelector(selector);
    if (!clickedRow) return;
    const detail = clickedRow.querySelector('.ped-row-detail');
    const arrow  = clickedRow.querySelector('.ped-row-arrow');
    const isOpen = !detail.classList.contains('hidden');
    document.querySelectorAll('.ped-row').forEach(r=>{
      r.querySelector('.ped-row-detail')?.classList.add('hidden');
      r.querySelector('.ped-row-arrow')?.classList.remove('open');
    });
    if (isOpen) { _expandedId=null; return; }
    detail.classList.remove('hidden');
    arrow?.classList.add('open');
    _expandedId = id;
    setTimeout(()=>clickedRow.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
  }

  function attachInlineSelects(container) {
    container.querySelectorAll('.estado-select-inline, .seg-estado-select').forEach(sel=>{
      sel.addEventListener('change', async(e)=>{
        e.stopPropagation();
        const id=parseInt(e.target.dataset.id), est=e.target.value, prev=e.target.dataset.prev;
        e.target.dataset.prev=est;
        e.target.className=`estado-select ${Pedidos.claseEstado(est)} estado-select-inline`;
        try {
          await Pedidos.actualizarEstado(id,est); toast(`Estado: ${est}`,'success');
          const p=_pedidosCache.find(x=>x.id===id);
          if (est==='Retirado'&&p) enviarNotificacion('✅ Retirado — OLVISIÓN',`#${p.orden} de ${p.cliente}`,false);
          _pedidosCache=await Pedidos.getTodosPedidos();
          if (_currentScreen==='pedidos') renderPedidosList();
          if (_currentScreen==='seguimiento') {
            _renderSegKPIs(_pedidosCache);
            _renderSegChips(_pedidosCache);
            _renderSeguimientoFiltered();
          }
          updateBadge();
        } catch(err){
          toast(`Error: ${err.message}`,'error');
          e.target.value=prev;
          e.target.className=`estado-select ${Pedidos.claseEstado(prev)} estado-select-inline`;
        }
      });
    });
  }

  async function _abrirDetalleRapido(id) { _detalleId=id; abrirEdicion(); }

  async function abrirDetalle(id) {
    _detalleId=id;
    const modal=document.getElementById('detalle-modal');
    const body=document.getElementById('detalle-body');
    modal.classList.remove('hidden');
    body.innerHTML='<div style="padding:32px;text-align:center;color:#888">Cargando...</div>';
    try {
      const p=await Pedidos.getPedidoById(id);
      const sufijo=p.sufijo?`-${p.sufijo}`:'';
      document.getElementById('detalle-orden').textContent=`#${p.orden}${sufijo}`;
      const esAdmin=Auth.isAdmin();
      document.getElementById('btn-abrir-edicion').style.display=esAdmin?'':'none';
      document.getElementById('btn-eliminar-pedido').style.display=esAdmin?'':'none';
      const fechaCarga=p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString('es-AR'):'—';
      const fechaRetiro=p.fecha_retiro?new Date(p.fecha_retiro).toLocaleDateString('es-AR'):'—';
      body.innerHTML=`
        <div class="detalle-seccion"><div class="detalle-seccion-title">Cliente</div>
          <div class="detalle-row"><span class="detalle-label">Nombre</span><span class="detalle-valor">${esc(p.cliente)}</span></div>
          <div class="detalle-row"><span class="detalle-label">Orden</span><span class="detalle-valor">#${esc(p.orden)}${sufijo}</span></div>
          <div class="detalle-row"><span class="detalle-label">Tipo</span><span class="detalle-valor">${esc(p.tipo||'—')}</span></div>
          <div class="detalle-row"><span class="detalle-label">Urgente</span><span class="detalle-valor">${p.urgente==='Si'?'⚡ Sí':'No'}</span></div>
          <div class="detalle-row"><span class="detalle-label">Fecha carga</span><span class="detalle-valor">${fechaCarga}</span></div>
        </div>
        <div class="detalle-seccion"><div class="detalle-seccion-title">Lente</div>
          <div class="detalle-row"><span class="detalle-label">Laboratorio</span><span class="detalle-valor">${esc(p.laboratorio||'—')}</span></div>
          <div class="detalle-row"><span class="detalle-label">Tipo de lente</span><span class="detalle-valor">${esc(p.tipo_lente||'—')}</span></div>
          <div class="detalle-row"><span class="detalle-label">Tratamiento</span><span class="detalle-valor">${esc(p.tratamiento||'—')}</span></div>
          <div class="detalle-row"><span class="detalle-label">2 etapas</span><span class="detalle-valor">${p.dos_etapas||'No'}</span></div>
          ${p.graduacion?`<div class="detalle-row" style="flex-direction:column;align-items:flex-start"><span class="detalle-label">Graduación</span><div class="detalle-grad">${esc(p.graduacion).replace(/\|/g,'<br>')}</div></div>`:''}
        </div>
        ${p.armazon?`<div class="detalle-seccion"><div class="detalle-seccion-title">Armazón</div><div class="detalle-row"><span class="detalle-label">Detalle</span><span class="detalle-valor">${esc(p.armazon)}</span></div></div>`:''}
        ${p.observaciones?`<div class="detalle-seccion"><div class="detalle-seccion-title">Observaciones</div><div class="detalle-row"><span class="detalle-valor" style="font-style:italic">${esc(p.observaciones)}</span></div></div>`:''}
        <div class="detalle-seccion"><div class="detalle-seccion-title">Estado</div>
          <div class="detalle-row"><span class="detalle-label">Estado actual</span><span class="detalle-valor">${esc(p.estado)}</span></div>
          <div class="detalle-row"><span class="detalle-label">Días en proceso</span><span class="detalle-valor">${p._dias}d</span></div>
          <div class="detalle-row"><span class="detalle-label">Est. inteligente</span><span class="detalle-valor">${p._est.texto}</span></div>
          ${p.fecha_retiro?`<div class="detalle-row"><span class="detalle-label">Fecha retiro</span><span class="detalle-valor">${fechaRetiro}</span></div>`:''}
          <div class="detalle-row"><span class="detalle-label">Cargado por</span><span class="detalle-valor">${esc(p.cargado_por||'—')}</span></div>
        </div>`;
    } catch(e){body.innerHTML=`<p style="padding:16px;color:var(--rojo)">Error: ${e.message}</p>`;}
  }

  function cerrarDetalle() { document.getElementById('detalle-modal').classList.add('hidden'); _detalleId=null; }

  async function eliminarPedido(id) {
    if (!Auth.isAdmin()) return;
    const p=_pedidosCache.find(x=>x.id===id);
    const desc=p?`#${p.orden}${p.sufijo?'-'+p.sufijo:''} — ${p.cliente}`:`ID ${id}`;
    if (!confirm(`¿Eliminar el pedido ${desc}?\n\nEsta acción no se puede deshacer.`)) return;
    try {
      const {error}=await window.supabaseClient.from('pedidos').delete().eq('id',id);
      if (error) throw error;
      cerrarDetalle(); cerrarEdicion(); _expandedId=null;
      toast('Pedido eliminado','success');
      _pedidosCache=await Pedidos.getTodosPedidos();
      if (_currentScreen==='pedidos') renderPedidosList();
      if (_currentScreen==='seguimiento') loadSeguimiento();
      updateBadge();
    } catch(e){toast(`Error al eliminar: ${e.message}`,'error');}
  }

  async function abrirEdicion() {
    const id=_detalleId; if (!id) return;
    cerrarDetalle();
    const em=document.getElementById('edit-modal'), eb=document.getElementById('edit-body');
    em.classList.remove('hidden');
    eb.innerHTML='<div style="padding:32px;text-align:center;color:#888">Cargando...</div>';
    try {
      const p=await Pedidos.getPedidoById(id);
      const idx=_pedidosCache.findIndex(x=>x.id===id);
      if (idx!==-1) _pedidosCache[idx]=p;
      const labs=_configCache.laboratorios.map(l=>`<option value="${esc(l)}"${l===p.laboratorio?' selected':''}>${esc(l)}</option>`).join('');
      const lentes=['Monofocal','Bifocal','Ocupacional','Progresivo','Teñido'].map(l=>`<option value="${l}"${l===p.tipo_lente?' selected':''}>${l}</option>`).join('');
      const tipos=['Cristales','Armazón + Cristales','Armazón'].map(t=>`<option value="${t}"${t===p.tipo?' selected':''}>${t}</option>`).join('');
      const urgentes=['Si','No'].map(u=>`<option value="${u}"${u===p.urgente?' selected':''}>${u==='Si'?'Sí':'No'}</option>`).join('');
      const etapas=['No','Si'].map(u=>`<option value="${u}"${u===p.dos_etapas?' selected':''}>${u==='Si'?'Sí':'No'}</option>`).join('');
      const ESTADOS=['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
      const estados=ESTADOS.map(e=>`<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');
      const fotoSection = p.foto_url
        ? `<div class="foto-edit-wrap">
            <img class="foto-thumb--edit" src="${esc(p.foto_url)}" alt="Foto del pedido" loading="lazy"
                 onclick="App.abrirFotoViewer(${p.id})" style="cursor:pointer;border-radius:var(--radius-sm);border:2px solid var(--gris-borde);max-width:100%;object-fit:cover;height:140px;">
            <div class="foto-edit-actions" style="margin-top:10px">
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.cambiarFoto(${p.id})">🔄 Cambiar foto</button>
              <button type="button" class="btn btn-danger btn-sm" onclick="App.eliminarFotoConfirm(${p.id})">🗑 Eliminar</button>
            </div></div>`
        : `<button type="button" class="btn btn-secondary btn-full" style="border-style:dashed" onclick="App.uploadFotoExistente(${p.id})">📷 Adjuntar foto del pedido</button>`;
      eb.innerHTML=`
        <div class="form-section"><div class="form-section-title">Cliente</div>
          <div class="form-group"><label class="form-label">Nombre</label><input type="text" id="e-cliente" class="form-control" value="${esc(p.cliente||'')}"></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nº de orden</label><input type="text" id="e-orden" class="form-control" value="${esc(p.orden||'')}"></div>
            <div class="form-group"><label class="form-label">Urgente</label><select id="e-urgente" class="form-control">${urgentes}</select></div>
          </div>
          <div class="form-group"><label class="form-label">Tipo</label><select id="e-tipo" class="form-control">${tipos}</select></div>
        </div>
        <div class="form-section"><div class="form-section-title">Lente</div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Laboratorio</label><select id="e-lab" class="form-control"><option value="">—</option>${labs}</select></div>
            <div class="form-group"><label class="form-label">Tipo de lente</label><select id="e-lente" class="form-control"><option value="">—</option>${lentes}</select></div>
          </div>
          <div class="form-group"><label class="form-label">Tratamiento</label><input type="text" id="e-tratamiento" class="form-control" value="${esc(p.tratamiento||'')}"></div>
          <div class="form-group"><label class="form-label">Fecha prometida</label><input type="date" id="e-fecha-prometida" class="form-control" value="${p.fecha_prometida||''}"></div>
          <div class="form-group"><label class="form-label">Graduación</label><textarea id="e-graduacion" class="form-control" rows="3" style="resize:vertical;font-family:var(--font-mono);font-size:.85rem">${esc(p.graduacion||'')}</textarea></div>
          <div class="form-group"><label class="form-label">2 etapas</label><select id="e-etapas" class="form-control">${etapas}</select></div>
        </div>
        <div class="form-section"><div class="form-section-title">Armazón</div>
          <div class="form-group"><label class="form-label">Detalle</label><input type="text" id="e-armazon" class="form-control" value="${esc(p.armazon||'')}"></div>
        </div>
        <div class="form-section"><div class="form-section-title">Observaciones</div>
          <div class="form-group"><textarea id="e-observaciones" class="form-control" rows="2" style="resize:vertical;font-size:1rem" placeholder="Observaciones...">${esc(p.observaciones||'')}</textarea></div>
        </div>
        <div class="form-section"><div class="form-section-title">Estado</div>
          <div class="form-group"><label class="form-label">Estado actual</label><select id="e-estado" class="form-control">${estados}</select></div>
        </div>
        <div class="form-section"><div class="form-section-title">Foto</div>${fotoSection}</div>
        <button class="edit-save-btn" onclick="App.guardarEdicion(${p.id})">Guardar cambios</button>`;
    } catch(e){eb.innerHTML=`<p style="padding:16px;color:var(--rojo)">Error: ${e.message}</p>`;}
  }

  async function guardarEdicion(id) {
    const btn=document.querySelector('.edit-save-btn');
    if (btn){btn.textContent='Guardando...';btn.disabled=true;}
    try {
      const nuevoEstado=document.getElementById('e-estado')?.value;
      const campos={
        cliente:document.getElementById('e-cliente')?.value.trim(),
        orden:document.getElementById('e-orden')?.value.trim(),
        urgente:document.getElementById('e-urgente')?.value,
        tipo:document.getElementById('e-tipo')?.value,
        laboratorio:document.getElementById('e-lab')?.value,
        tipo_lente:document.getElementById('e-lente')?.value,
        tratamiento:document.getElementById('e-tratamiento')?.value.trim()||null,
        graduacion:document.getElementById('e-graduacion')?.value.trim()||null,
        fecha_prometida:document.getElementById('e-fecha-prometida')?.value||null,
        dos_etapas:document.getElementById('e-etapas')?.value,
        armazon:document.getElementById('e-armazon')?.value.trim()||null,
        observaciones:document.getElementById('e-observaciones')?.value.trim()||null,
        estado:nuevoEstado,
      };
      if (nuevoEstado==='Retirado') campos.fecha_retiro=new Date().toISOString();
      await Pedidos.actualizarPedido(id,campos);
      cerrarEdicion(); toast('Pedido actualizado ✓','success');
      _pedidosCache=await Pedidos.getTodosPedidos();
      if (_currentScreen==='pedidos') renderPedidosList();
      if (_currentScreen==='seguimiento') loadSeguimiento();
    } catch(e){toast(`Error: ${e.message}`,'error'); if(btn){btn.textContent='Guardar cambios';btn.disabled=false;}}
  }

  function cerrarEdicion() { document.getElementById('edit-modal').classList.add('hidden'); }

  async function refreshPanel() {
    if (!Auth.isAdmin()) return;
    await Panel.render(); updateBadge();
  }

  async function updateBadge() {
    if (!Auth.isAdmin()) return;
    try {
      const todos=_pedidosCache.length?_pedidosCache:await Pedidos.getPedidosActivos();
      const count=Panel.contarCriticos(todos);
      const badge=document.getElementById('criticos-badge');
      badge.textContent=count; badge.classList.toggle('hidden',count===0);
    } catch{}
  }

  // ── CONFIG SCREEN ─────────────────────────────────
  async function loadConfigScreen() {
    _editingConfig = null;
    await loadConfig();
    renderConfigLabs(); renderConfigMarcas(); renderConfigMateriales(); loadConfigTratamientos();
  }

  function _configItemNormal(label, onEdit, onDelete) {
    return `<div class="config-item"><span class="config-item-label">${label}</span><div class="config-item-actions"><button class="btn btn-secondary btn-sm config-edit-btn" onclick="${onEdit}">✏️</button><button class="btn btn-danger btn-sm" onclick="${onDelete}">Eliminar</button></div></div>`;
  }
  function _configItemEditing(inputId, onSave, onCancel, currentVal) {
    return `<div class="config-item config-item--editing"><input type="text" id="${inputId}" class="form-control config-edit-input" value="${esc(currentVal)}" style="flex:1;min-width:0"><div class="config-item-actions"><button class="btn btn-primary btn-sm" onclick="${onSave}">Guardar</button><button class="btn btn-secondary btn-sm" onclick="${onCancel}">✕</button></div></div>`;
  }
  function _focusConfigInput(id) { setTimeout(() => { const inp = document.getElementById(id); if (inp) { inp.focus(); inp.select(); } }, 30); }

  function renderConfigLabs() {
    const el = document.getElementById('config-labs-list'); if (!el) return;
    if (!_configCache.laboratorios.length) { el.innerHTML = '<p style="color:var(--gris-texto);font-size:.85rem;padding:8px 0">Sin laboratorios</p>'; return; }
    el.innerHTML = _configCache.laboratorios.map(lab => {
      const isEditing = _editingConfig?.type === 'lab' && _editingConfig?.valor === lab;
      if (isEditing) return _configItemEditing('cfg-edit-lab', `App.saveConfigLab('${esc(lab)}')`, `App.cancelConfigEdit()`, lab);
      return _configItemNormal(esc(lab), `App.startEditLab('${esc(lab)}')`, `App.deleteLab('${esc(lab)}')`);
    }).join('');
    if (_editingConfig?.type === 'lab') _focusConfigInput('cfg-edit-lab');
  }
  function startEditLab(valor) { _editingConfig = { type: 'lab', valor }; renderConfigLabs(); }
  async function saveConfigLab(oldValor) {
    const newValor = document.getElementById('cfg-edit-lab')?.value.trim(); if (!newValor) return;
    if (newValor === oldValor) { cancelConfigEdit(); return; }
    try { const {error}=await window.supabaseClient.from('configuracion').update({valor:newValor}).eq('tipo','laboratorio').eq('valor',oldValor); if(error)throw error; _editingConfig=null; await loadConfig(); renderConfigLabs(); buildBloqueFields(1); buildBloqueFields(2); toast('Laboratorio actualizado','success'); } catch(e){toast('Error: '+e.message,'error');}
  }
  async function addLab() {
    const i=document.getElementById('new-lab-input'), v=i.value.trim(); if(!v)return;
    try{await window.supabaseClient.from('configuracion').insert({tipo:'laboratorio',valor:v,orden:99,activo:true});i.value='';await loadConfig();renderConfigLabs();buildBloqueFields(1);buildBloqueFields(2);toast('Laboratorio agregado','success');}catch(e){toast('Error: '+e.message,'error');}
  }
  async function deleteLab(v) {
    if(!confirm(`¿Eliminar laboratorio "${v}"?`))return;
    try{await window.supabaseClient.from('configuracion').delete().eq('tipo','laboratorio').eq('valor',v);await loadConfig();renderConfigLabs();buildBloqueFields(1);buildBloqueFields(2);toast('Laboratorio eliminado','success');}catch(e){toast('Error: '+e.message,'error');}
  }

  function renderConfigMarcas() {
    const el = document.getElementById('config-marcas-list'); if (!el) return;
    if (!_configCache.marcas.length) { el.innerHTML = '<p style="color:var(--gris-texto);font-size:.85rem;padding:8px 0">Sin marcas</p>'; return; }
    el.innerHTML = _configCache.marcas.map(m => {
      const isEditing = _editingConfig?.type === 'marca' && _editingConfig?.id === m.id;
      if (isEditing) return _configItemEditing('cfg-edit-marca', `App.saveConfigMarca(${m.id})`, `App.cancelConfigEdit()`, m.valor);
      return _configItemNormal(esc(m.valor), `App.startEditMarca(${m.id},'${esc(m.valor)}')`, `App.deleteMarca(${m.id})`);
    }).join('');
    if (_editingConfig?.type === 'marca') _focusConfigInput('cfg-edit-marca');
  }
  function startEditMarca(id, valor) { _editingConfig = { type:'marca', id, valor }; renderConfigMarcas(); }
  async function saveConfigMarca(id) {
    const newValor = document.getElementById('cfg-edit-marca')?.value.trim(); if(!newValor)return;
    try{const{error}=await window.supabaseClient.from('configuracion').update({valor:newValor}).eq('id',id);if(error)throw error;_editingConfig=null;await loadConfig();renderConfigMarcas();buildBloqueFields(1);buildBloqueFields(2);toast('Marca actualizada','success');}catch(e){toast('Error: '+e.message,'error');}
  }
  async function addMarca() {
    const i=document.getElementById('new-marca-input'), v=i.value.trim(); if(!v)return;
    try{await window.supabaseClient.from('configuracion').insert({tipo:'marca',categoria:'armazon',valor:v,orden:99,activo:true});i.value='';await loadConfig();renderConfigMarcas();buildBloqueFields(1);buildBloqueFields(2);toast('Marca agregada','success');}catch(e){toast('Error: '+e.message,'error');}
  }
  async function deleteMarca(id) {
    if(!confirm('¿Eliminar esta marca?'))return;
    try{await window.supabaseClient.from('configuracion').delete().eq('id',id);await loadConfig();renderConfigMarcas();buildBloqueFields(1);buildBloqueFields(2);toast('Marca eliminada','success');}catch(e){toast('Error: '+e.message,'error');}
  }

  function renderConfigMateriales() {
    const el = document.getElementById('config-materiales-list'); if (!el) return;
    if (!_configCache.materiales.length) { el.innerHTML = '<p style="color:var(--gris-texto);font-size:.85rem;padding:8px 0">Sin materiales</p>'; return; }
    el.innerHTML = _configCache.materiales.map(m => {
      const isEditing = _editingConfig?.type === 'material' && _editingConfig?.id === m.id;
      if (isEditing) return _configItemEditing('cfg-edit-material', `App.saveConfigMaterial(${m.id})`, `App.cancelConfigEdit()`, m.valor);
      return _configItemNormal(esc(m.valor), `App.startEditMaterial(${m.id},'${esc(m.valor)}')`, `App.deleteMaterial(${m.id})`);
    }).join('');
    if (_editingConfig?.type === 'material') _focusConfigInput('cfg-edit-material');
  }
  function startEditMaterial(id, valor) { _editingConfig = { type:'material', id, valor }; renderConfigMateriales(); }
  async function saveConfigMaterial(id) {
    const newValor = document.getElementById('cfg-edit-material')?.value.trim(); if(!newValor)return;
    try{const{error}=await window.supabaseClient.from('configuracion').update({valor:newValor}).eq('id',id);if(error)throw error;_editingConfig=null;await loadConfig();renderConfigMateriales();buildBloqueFields(1);buildBloqueFields(2);toast('Material actualizado','success');}catch(e){toast('Error: '+e.message,'error');}
  }
  async function addMaterial() {
    const i=document.getElementById('new-material-input'), v=i.value.trim(); if(!v)return;
    try{await window.supabaseClient.from('configuracion').insert({tipo:'material',categoria:'armazon',valor:v,orden:99,activo:true});i.value='';await loadConfig();renderConfigMateriales();buildBloqueFields(1);buildBloqueFields(2);toast('Material agregado','success');}catch(e){toast('Error: '+e.message,'error');}
  }
  async function deleteMaterial(id) {
    if(!confirm('¿Eliminar este material?'))return;
    try{await window.supabaseClient.from('configuracion').delete().eq('id',id);await loadConfig();renderConfigMateriales();buildBloqueFields(1);buildBloqueFields(2);toast('Material eliminado','success');}catch(e){toast('Error: '+e.message,'error');}
  }

  async function loadConfigTratamientos() {
    const lente = document.getElementById('config-lente-select')?.value;
    const el    = document.getElementById('config-trat-list');
    if (!el || !lente) return;
    const lista = _configCache.tratamientos[lente] || [];
    if (!lista.length) { el.innerHTML = '<p style="color:var(--gris-texto);font-size:.85rem;padding:8px 0">Sin tratamientos</p>'; return; }
    el.innerHTML = lista.map(t => {
      const isEditing = _editingConfig?.type === 'trat' && _editingConfig?.id === t.id;
      if (isEditing) return _configItemEditing('cfg-edit-trat', `App.saveConfigTrat(${t.id})`, `App.cancelConfigEdit()`, t.valor);
      return _configItemNormal(esc(t.valor), `App.startEditTrat(${t.id},'${esc(t.valor)}')`, `App.deleteTratamiento(${t.id})`);
    }).join('');
    if (_editingConfig?.type === 'trat') _focusConfigInput('cfg-edit-trat');
  }
  function startEditTrat(id, valor) { _editingConfig = { type:'trat', id, valor }; loadConfigTratamientos(); }
  async function saveConfigTrat(id) {
    const newValor = document.getElementById('cfg-edit-trat')?.value.trim(); if(!newValor)return;
    try{const{error}=await window.supabaseClient.from('configuracion').update({valor:newValor}).eq('id',id);if(error)throw error;_editingConfig=null;await loadConfig();loadConfigTratamientos();toast('Tratamiento actualizado','success');}catch(e){toast('Error: '+e.message,'error');}
  }
  async function addTratamiento() {
    const lente=document.getElementById('config-lente-select')?.value, i=document.getElementById('new-trat-input'), v=i.value.trim(); if(!v||!lente)return;
    try{await window.supabaseClient.from('configuracion').insert({tipo:'tratamiento',categoria:lente,valor:v,orden:99,activo:true});i.value='';await loadConfig();loadConfigTratamientos();toast('Tratamiento agregado','success');}catch(e){toast('Error: '+e.message,'error');}
  }
  async function deleteTratamiento(id) {
    if(!confirm('¿Eliminar este tratamiento?'))return;
    try{await window.supabaseClient.from('configuracion').delete().eq('id',id);await loadConfig();loadConfigTratamientos();toast('Tratamiento eliminado','success');}catch(e){toast('Error: '+e.message,'error');}
  }
  function cancelConfigEdit() { _editingConfig=null; renderConfigLabs(); renderConfigMarcas(); renderConfigMateriales(); loadConfigTratamientos(); }

  // ── FORM NUEVO PEDIDO ─────────────────────────────
  function getGraduacion(num) {
    const dist=document.querySelector(`#dist-tabs${num} .dist-tab.active`)?.dataset.dist||'lejos';
    const leer=(dc)=>{
      const v=(campo,ojo)=>document.getElementById(`g-${dc}-${campo}-${ojo}-${num}`)?.value.trim()||'';
      const partes=[];
      ['D','I'].forEach(ojo=>{
        const esf=v('esf',ojo),cil=v('cil',ojo),eje=v('eje',ojo),add=v('add',ojo);
        if(esf||cil){let s=`O${ojo}: ${esf}`;if(cil)s+=` ${cil}`;if(eje)s+=` x${eje}`;if(add)s+=` ADD:${add}`;partes.push(s.trim());}
      });
      return partes.join(' | ');
    };
    if(dist==='lejos') return leer('L');
    if(dist==='cerca') return leer('C');
    const l=leer('L'),c=leer('C');
    return [l&&`Lejos: ${l}`,c&&`Cerca: ${c}`].filter(Boolean).join(' — ');
  }

  function getArmazonData(num) {
    const tipo = document.getElementById(`f-armazon-tipo${num}`)?.value;
    if (!tipo) return { armazon: null };
    const g = id => document.getElementById(id)?.value.trim() || '';
    if (tipo === 'nuevo') {
      const marca=g(`f-marca${num}`), ref=g(`f-codigoref${num}`), mat=g(`f-material${num}`), color=g(`f-color${num}`);
      return { armazon: ['Nuevo',marca&&`Marca: ${marca}`,ref&&`Ref: ${ref}`,mat&&`Mat: ${mat}`,color&&`Color: ${color}`].filter(Boolean).join(' / ') };
    } else {
      const marca=g(`f-marca-cli${num}`), mat=g(`f-material-cli${num}`), color=g(`f-color-cli${num}`);
      return { armazon: ['Del cliente',marca&&`Marca: ${marca}`,mat&&`Mat: ${mat}`,color&&`Color: ${color}`].filter(Boolean).join(' / ') };
    }
  }

  function getFormData() {
    const g=id=>document.getElementById(id)?.value.trim()??'';
    const doble=document.getElementById('toggle-dos-anteojos').checked;
    const antData=(n)=>({laboratorio:g(`f-lab${n}`),tipo_lente:g(`f-lente${n}`),tratamiento:g(`f-tratamiento${n}`),graduacion:getGraduacion(n),dos_etapas:g(`f-etapas${n}`),...getArmazonData(n),observaciones:document.getElementById(`f-obs${n}`)?.value.trim()||null});
    return {doble,base:{
      cliente:g('f-cliente'),orden:g('f-orden'),urgente:g('f-urgente'),tipo:g('f-tipo'),
      fecha_carga:g('f-fecha-carga')||todayStr(),
      fecha_prometida:document.getElementById('f-fecha-prometida')?.value||null,
      celular:g('f-cliente-cel'), dni:g('f-cliente-dni'),
      obra_social:g('f-cliente-os'),
      cliente_id:document.getElementById('campo-cliente-id')?.value||null,
    },ant1:antData(1),ant2:doble?antData(2):null};
  }

  function validateForm(data) {
    let valid=true;
    const check=(fId,eId,cond)=>{const f=document.getElementById(fId),e=document.getElementById(eId);if(!f||!e)return;f.classList.toggle('error',cond);e.classList.toggle('visible',cond);if(cond)valid=false;};
    check('f-cliente','err-cliente',!data.base.cliente); check('f-orden','err-orden',!data.base.orden);
    check('f-cliente-cel','err-cliente-cel',!data.base.celular);
    check('f-urgente','err-urgente',!data.base.urgente); check('f-tipo','err-tipo',!data.base.tipo);
    check('f-lab1','err-lab1',!data.ant1.laboratorio);   check('f-lente1','err-lente1',!data.ant1.tipo_lente);
    if(data.doble){check('f-lab2','err-lab2',!data.ant2.laboratorio);check('f-lente2','err-lente2',!data.ant2.tipo_lente);}
    return valid;
  }

  // ══════════════════════════════════════════════════
  //  DETECCIÓN DE DUPLICADOS (al guardar)
  // ══════════════════════════════════════════════════

  function _inyectarModalDuplicado() {
    if (document.getElementById('dup-modal')) return;
    const el = document.createElement('div');
    el.id = 'dup-modal';
    el.className = 'confirm-modal hidden';
    el.style.cssText = 'z-index:9999';
    el.innerHTML = `
      <div class="confirm-sheet" style="max-width:440px;padding:28px 20px 24px">
        <div id="dup-icon" style="font-size:2.8rem;text-align:center;margin-bottom:12px;line-height:1"></div>
        <div id="dup-title" style="font-size:1.05rem;font-weight:700;color:var(--azul);text-align:center;margin-bottom:6px"></div>
        <div id="dup-subtitle" style="font-size:.85rem;color:var(--gris-texto);text-align:center;margin-bottom:18px;line-height:1.5"></div>
        <div id="dup-body" style="margin-bottom:20px;max-height:220px;overflow-y:auto"></div>
        <div id="dup-actions" style="display:flex;flex-direction:column;gap:10px"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) _cerrarModalDuplicado(); });
  }

  async function checkDuplicados(data) {
    const orden    = data.base.orden?.trim();
    const celular  = data.base.celular?.trim();
    const dni      = data.base.dni?.trim();
    const nombre   = data.base.cliente?.trim();
    const clienteId = data.base.cliente_id;

    // ── 1. Número de orden: bloqueo duro ─────────────
    const { data: existeOrden } = await window.supabaseClient
      .from('pedidos')
      .select('id,cliente,estado,fecha_carga,sufijo')
      .eq('orden', orden)
      .limit(5);

    if (existeOrden?.length) {
      return { tipo: 'orden_duplicada', pedidos: existeOrden, orden };
    }

    // ── 2. Cliente con pedidos activos: advertencia suave ──
    let pedidosActivos = [];
    let clienteEncontrado = null;
    let matchPor = '';

    if (clienteId) {
      const { data: peds } = await window.supabaseClient
        .from('pedidos')
        .select('id,orden,sufijo,estado,fecha_carga,laboratorio')
        .eq('cliente_id', clienteId)
        .neq('estado', 'Retirado')
        .limit(5);
      if (peds?.length) {
        pedidosActivos = peds;
        clienteEncontrado = { displayName: nombre };
        matchPor = 'cliente seleccionado';
      }
    } else {
      if (celular && celular !== '—' && celular.length >= 6) {
        const { data: cl } = await window.supabaseClient
          .from('clientes')
          .select('id,nombre,apellido,telefono,dni')
          .eq('telefono', celular)
          .maybeSingle();
        if (cl) {
          clienteEncontrado = cl;
          matchPor = 'celular ' + celular;
          const { data: peds } = await window.supabaseClient
            .from('pedidos')
            .select('id,orden,sufijo,estado,fecha_carga,laboratorio')
            .eq('cliente_id', cl.id)
            .neq('estado', 'Retirado')
            .limit(5);
          pedidosActivos = peds || [];
        }
      }

      if (!clienteEncontrado && dni && dni.length >= 4) {
        const { data: cl } = await window.supabaseClient
          .from('clientes')
          .select('id,nombre,apellido,telefono,dni')
          .eq('dni', dni)
          .maybeSingle();
        if (cl) {
          clienteEncontrado = cl;
          matchPor = 'DNI ' + dni;
          const { data: peds } = await window.supabaseClient
            .from('pedidos')
            .select('id,orden,sufijo,estado,fecha_carga,laboratorio')
            .eq('cliente_id', cl.id)
            .neq('estado', 'Retirado')
            .limit(5);
          pedidosActivos = peds || [];
        }
      }

      if (!clienteEncontrado && nombre && nombre.length >= 3) {
        const { data: peds } = await window.supabaseClient
          .from('pedidos')
          .select('id,orden,sufijo,estado,fecha_carga,laboratorio,cliente')
          .ilike('cliente', nombre)
          .neq('estado', 'Retirado')
          .limit(3);
        if (peds?.length) {
          pedidosActivos = peds;
          clienteEncontrado = { displayName: nombre };
          matchPor = 'nombre "' + nombre + '"';
        }
      }
    }

    if (pedidosActivos.length > 0) {
      let displayName = nombre;
      if (clienteEncontrado?.apellido) {
        displayName = [clienteEncontrado.apellido, clienteEncontrado.nombre].filter(Boolean).join(', ');
      } else if (clienteEncontrado?.displayName) {
        displayName = clienteEncontrado.displayName;
      }
      return {
        tipo: 'cliente_activo',
        cliente: { ...clienteEncontrado, displayName },
        pedidos: pedidosActivos,
        matchPor,
      };
    }

    return null;
  }

  function _mostrarModalDuplicadoOrden(dup) {
    const modal = document.getElementById('dup-modal');
    if (!modal) return;

    document.getElementById('dup-icon').textContent = '🚫';
    document.getElementById('dup-title').textContent = `Número de orden duplicado`;
    document.getElementById('dup-subtitle').textContent =
      `Ya existe un pedido con el número #${esc(String(dup.orden))}. No se puede usar el mismo número dos veces.`;

    const ESTADO_SHORT = {
      'Cristales pedidos a lab': '⏳ Cristales',
      'Armazón enviado p/calibrado': '📦 En tránsito',
      'En laboratorio': '🏭 En lab.',
      'Pendiente de retirar': '✅ Listo',
      'Retirado': '✔️ Retirado',
    };

    document.getElementById('dup-body').innerHTML = dup.pedidos.map(p => {
      const sufijo = p.sufijo ? `-${p.sufijo}` : '';
      const fecha  = new Date(p.fecha_carga).toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'});
      return `<div style="background:#FFF0F0;border:1.5px solid #FECACA;border-radius:12px;padding:12px 14px;margin-bottom:8px">
        <div style="font-weight:700;color:#DC2626;font-size:.95rem">Orden #${esc(String(p.orden))}${esc(sufijo)}</div>
        <div style="font-size:.85rem;color:#555;margin-top:4px;font-weight:500">${esc(p.cliente || '—')}</div>
        <div style="font-size:.78rem;color:#888;margin-top:3px">${esc(ESTADO_SHORT[p.estado] || p.estado)} · ${fecha}</div>
      </div>`;
    }).join('');

    document.getElementById('dup-actions').innerHTML = `
      <button class="btn btn-primary" onclick="App._cerrarModalDuplicado()"
              style="width:100%;font-size:1rem;padding:14px">
        ← Volver y cambiar el número
      </button>`;

    modal.classList.remove('hidden');
  }

  function _mostrarModalDuplicadoCliente(dup) {
    const modal = document.getElementById('dup-modal');
    if (!modal) return;

    const displayName = dup.cliente.displayName || 'Este cliente';
    const matchTxt = dup.matchPor ? ` (coincidencia por ${dup.matchPor})` : '';

    document.getElementById('dup-icon').textContent = '⚠️';
    document.getElementById('dup-title').textContent = `${displayName} ya tiene pedidos activos`;
    document.getElementById('dup-subtitle').textContent =
      `Se detectó un posible duplicado${matchTxt}. Revisá si realmente es un pedido nuevo antes de continuar.`;

    const ESTADO_SHORT = {
      'Cristales pedidos a lab': '⏳ Cristales',
      'Armazón enviado p/calibrado': '📦 En tránsito',
      'En laboratorio': '🏭 En lab.',
      'Pendiente de retirar': '✅ Listo para retirar',
    };

    document.getElementById('dup-body').innerHTML = dup.pedidos.map(p => {
      const sufijo = p.sufijo ? `-${p.sufijo}` : '';
      const fecha  = new Date(p.fecha_carga).toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'});
      return `<div style="background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:12px;padding:12px 14px;margin-bottom:8px">
        <div style="font-weight:700;color:#92400E;font-size:.9rem">Orden #${esc(String(p.orden))}${esc(sufijo)}</div>
        <div style="font-size:.8rem;color:#555;margin-top:3px">${esc(ESTADO_SHORT[p.estado] || p.estado)}</div>
        <div style="font-size:.75rem;color:#888;margin-top:2px">
          ${p.laboratorio ? esc(p.laboratorio) + ' · ' : ''}${fecha}
        </div>
      </div>`;
    }).join('');

    document.getElementById('dup-actions').innerHTML = `
      <button class="btn btn-secondary" onclick="App._cerrarModalDuplicado()"
              style="width:100%;font-size:.95rem;padding:13px;font-weight:600">
        ← Volver y revisar
      </button>
      <button onclick="App._confirmarSinImportarDuplicado()"
              style="width:100%;padding:13px;border-radius:var(--radius-md,12px);border:none;cursor:pointer;
                     background:#B45309;color:#fff;font-size:.9rem;font-weight:600;
                     font-family:inherit">
        Es un pedido nuevo — Continuar igual →
      </button>`;

    modal.classList.remove('hidden');
  }

  function _cerrarModalDuplicado() {
    document.getElementById('dup-modal')?.classList.add('hidden');
    _pendingDuplicadoWarning = null;
  }

  function _confirmarSinImportarDuplicado() {
    document.getElementById('dup-modal')?.classList.add('hidden');
    const data = _pendingDuplicadoWarning;
    _pendingDuplicadoWarning = null;
    if (!data) return;
    _mostrarConfirmModal(data);
  }

  function _mostrarConfirmModal(data) {
    const rf = (label, val) => val
      ? `<div class="modal-row"><span class="modal-label">${label}</span><span class="modal-value">${esc(String(val))}</span></div>`
      : '';

    let html = rf('Cliente', data.base.cliente)
      + rf('Orden', data.doble ? `${data.base.orden}-A / -B` : data.base.orden)
      + rf('Tipo', data.base.tipo)
      + rf('Urgente', data.base.urgente)
      + rf('Fecha', data.base.fecha_carga)
      + rf('Fecha prometida', data.base.fecha_prometida);

    if (data.doble) {
      html += `<div style="margin:10px 0 4px;font-size:.78rem;font-weight:700;color:var(--azul)">ANTEOJO A</div>`;
      html += rf('Lab', data.ant1.laboratorio) + rf('Lente', data.ant1.tipo_lente) + rf('Tratamiento', data.ant1.tratamiento) + rf('Graduación', data.ant1.graduacion) + rf('Armazón', data.ant1.armazon) + rf('Obs.', data.ant1.observaciones);
      if (_fotoFiles[1]) html += `<div class="modal-row"><span class="modal-label">Foto A</span><span class="modal-value">📷 ${esc(_fotoFiles[1].name)}</span></div>`;
      html += `<div style="margin:10px 0 4px;font-size:.78rem;font-weight:700;color:var(--azul)">ANTEOJO B</div>`;
      html += rf('Lab', data.ant2.laboratorio) + rf('Lente', data.ant2.tipo_lente) + rf('Tratamiento', data.ant2.tratamiento) + rf('Graduación', data.ant2.graduacion) + rf('Armazón', data.ant2.armazon) + rf('Obs.', data.ant2.observaciones);
      if (_fotoFiles[2]) html += `<div class="modal-row"><span class="modal-label">Foto B</span><span class="modal-value">📷 ${esc(_fotoFiles[2].name)}</span></div>`;
    } else {
      html += rf('Laboratorio', data.ant1.laboratorio) + rf('Lente', data.ant1.tipo_lente) + rf('Tratamiento', data.ant1.tratamiento) + rf('Graduación', data.ant1.graduacion) + rf('Armazón', data.ant1.armazon) + rf('Obs.', data.ant1.observaciones);
      if (_fotoFiles[1]) html += `<div class="modal-row"><span class="modal-label">Foto</span><span class="modal-value">📷 ${esc(_fotoFiles[1].name)}</span></div>`;
    }

    document.getElementById('modal-body-content').innerHTML = html;
    _pendingGuardar = data;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }

  // ── FORM SUBMIT con detección de duplicados ───────
  async function handleFormSubmit(e) {
    e.preventDefault();
    const data = getFormData();
    if (!validateForm(data)) { toast('Completá los campos obligatorios', 'warn'); return; }

    // Si el campo orden ya tiene estado "duplicado" visible, bloquear directamente
    const statusEl = document.getElementById('orden-check-status');
    if (statusEl?.classList.contains('orden-check--dup')) {
      // Scroll al campo y enfocar
      document.getElementById('f-orden')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('f-orden')?.focus();
      toast('Cambiá el número de orden — ya está en uso', 'error');
      return;
    }

    const submitBtn = document.querySelector('#form-nuevo-pedido [type="submit"], #form-nuevo-pedido button[type="submit"]');
    const btnTextoOriginal = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verificando...'; }

    try {
      const dup = await checkDuplicados(data);

      if (dup) {
        if (dup.tipo === 'orden_duplicada') {
          _mostrarModalDuplicadoOrden(dup);
          // También actualizar el indicador inline para consistencia
          _renderOrdenStatus('duplicado', dup.pedidos);
          _ordenUltimaQuery = data.base.orden;
          return;
        }
        if (dup.tipo === 'cliente_activo') {
          _pendingDuplicadoWarning = data;
          _mostrarModalDuplicadoCliente(dup);
          return;
        }
      }
    } catch (err) {
      console.warn('Error al verificar duplicados:', err);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; if (btnTextoOriginal) submitBtn.textContent = btnTextoOriginal; }
    }

    _mostrarConfirmModal(data);
  }

  async function handleConfirm() {
    if (!_pendingGuardar) return;
    const data=_pendingGuardar, btn=document.getElementById('modal-confirm-btn');
    btn.classList.add('btn-loading'); btn.disabled=true;
    try {
      const nombre=Auth.getNombre(), fechaISO=new Date(data.base.fecha_carga+'T12:00:00').toISOString();
      let clienteId = data.base.cliente_id;
      if (!clienteId && data.base.cliente) {
        try {
          const nombreCompleto = data.base.cliente.trim();
          let apellido = '', nombre = '';
          if (nombreCompleto.includes(',')) {
            apellido = nombreCompleto.split(',')[0].trim();
            nombre   = nombreCompleto.split(',').slice(1).join(',').trim();
          } else {
            apellido = nombreCompleto;
            nombre   = '';
          }
          const { data: nuevo } = await window.supabaseClient.from('clientes').insert([{
            nombre, apellido,
            telefono:    data.base.celular || '—',
            dni:         data.base.dni || null,
            obra_social: data.base.obra_social || null,
          }]).select('id').single();
          if (nuevo) clienteId = nuevo.id;
        } catch(e) { console.warn('No se pudo crear cliente:', e); }
      }
      const buildRow=(ant,sufijo)=>({
        cliente:data.base.cliente, cliente_id:clienteId,
        orden:data.base.orden, sufijo,
        tipo:data.base.tipo, urgente:data.base.urgente,
        laboratorio:ant.laboratorio, tipo_lente:ant.tipo_lente,
        tratamiento:ant.tratamiento||null, graduacion:ant.graduacion||null,
        dos_etapas:ant.dos_etapas||'No', armazon:ant.armazon||null,
        observaciones:ant.observaciones||null,
        cargado_por:nombre, fecha_carga:fechaISO, fecha_pedido:fechaISO, fecha_prometida:data.base.fecha_prometida||null,
      });
      const rows=data.doble?[buildRow(data.ant1,'A'),buildRow(data.ant2,'B')]:[buildRow(data.ant1,null)];
      const creados = await Pedidos.crearPedido(rows);
      if (data.doble) {
        if (_fotoFiles[1] && creados?.[0]) { try { await Pedidos.uploadFoto(creados[0].id, _fotoFiles[1]); } catch(fe) { console.warn('Foto A:', fe); } }
        if (_fotoFiles[2] && creados?.[1]) { try { await Pedidos.uploadFoto(creados[1].id, _fotoFiles[2]); } catch(fe) { console.warn('Foto B:', fe); } }
      } else {
        if (_fotoFiles[1] && creados?.[0]) { try { await Pedidos.uploadFoto(creados[0].id, _fotoFiles[1]); } catch(fe) { console.warn('Foto:', fe); } }
      }
      _fotoFiles = {};
      enviarNotificacion('📋 Nuevo pedido — OLVISIÓN',`${nombre} cargó un pedido para ${data.base.cliente}`,true);
      closeModal(); toast('Pedido guardado ✓','success'); resetForm();
      showScreen('seguimiento');
    } catch(err){closeModal();toast(err.message,'error');}
    finally{btn.classList.remove('btn-loading');btn.disabled=false;}
  }

  function resetForm() {
    document.getElementById('form-nuevo-pedido').reset();
    document.getElementById('f-fecha-carga').value=todayStr();
    document.getElementById('bloque-anteojo2').classList.add('hidden');
    document.getElementById('bloque1-title').textContent='Anteojo';
    document.querySelectorAll('.form-control').forEach(el=>el.classList.remove('error'));
    document.querySelectorAll('.form-error').forEach(el=>el.classList.remove('visible'));
    [1,2].forEach(n=>{
      try{setDistancia(n,'lejos');}catch{}
      document.getElementById(`f-armazon-nuevo${n}`)?.classList.add('hidden');
      document.getElementById(`f-armazon-cliente${n}`)?.classList.add('hidden');
      clearFoto(n);
    });
    _fotoFiles = {};
    _pendingGuardar=null;
    // Limpiar indicador de orden
    _ordenUltimaQuery = '';
    _renderOrdenStatus('idle');
    limpiarClienteForm();
    ['f-cliente-cel','f-cliente-dni'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const selOs=document.getElementById('f-cliente-os'); if(selOs) selOs.value='';
  }

  function closeModal() { document.getElementById('confirm-modal').classList.add('hidden'); _pendingGuardar=null; }

  async function activarNotificaciones() {
    const btn=document.getElementById('btn-activar-notif'),status=document.getElementById('notif-status');
    if(!('serviceWorker' in navigator)||!('PushManager' in window)){if(status)status.textContent='⚠️ Tu navegador no soporta notificaciones push';return;}
    try {
      if(btn){btn.disabled=true;btn.textContent='Activando...';}
      const reg=await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
      const perm=await Notification.requestPermission();
      if(perm!=='granted'){if(status)status.textContent='❌ Permiso denegado.';if(btn){btn.textContent='🔔 Activar notificaciones push';btn.disabled=false;}return;}
      let sub=await reg.pushManager.getSubscription();
      if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC)});
      await guardarSuscripcion(sub);
      if(btn){btn.textContent='✅ Notificaciones activadas';btn.style.background='var(--verde)';}
      if(status)status.textContent='Vas a recibir alertas de pedidos nuevos y críticos.';
      toast('🔔 Notificaciones activadas','success');
    } catch(e){if(btn){btn.textContent='🔔 Activar notificaciones push';btn.disabled=false;}if(status)status.textContent=`Error: ${e.message}`;}
  }

  // ── CLIENTE AUTOCOMPLETE ──────────────────────────
  let _clienteSearchTimer = null;
  let _obrasSocialesCache = [];
  let _clientesSugData    = [];

  async function _cargarObrasSocialesForm() {
    if (_obrasSocialesCache.length) { _poblarSelectOS(); return; }
    const { data } = await window.supabaseClient
      .from('configuracion').select('valor').eq('tipo','obra_social').order('orden');
    _obrasSocialesCache = data ? data.map(d => d.valor) : [];
    _poblarSelectOS();
  }

  function _poblarSelectOS() {
    const sel = document.getElementById('f-cliente-os');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Particular / Sin obra social —</option>' +
      _obrasSocialesCache.map(os => `<option value="${esc(os)}">${esc(os)}</option>`).join('');
    if (cur) sel.value = cur;
  }

  function initClienteSearch() {
    _cargarObrasSocialesForm();
    document.addEventListener('click', e => {
      if (!e.target.closest('.autocomplete-wrap') && !e.target.closest('#cliente-seleccionado')) {
        document.getElementById('cliente-suggestions')?.classList.add('hidden');
      }
    });
  }

  async function onClienteInput(valor) {
    const sugEl = document.getElementById('cliente-suggestions');
    if (!sugEl) return;
    const idEl = document.getElementById('campo-cliente-id');
    if (idEl?.value) {
      idEl.value = '';
      document.getElementById('cliente-seleccionado')?.classList.add('hidden');
    }
    clearTimeout(_clienteSearchTimer);
    if (valor.trim().length < 2) { sugEl.classList.add('hidden'); return; }
    _clienteSearchTimer = setTimeout(async () => {
      const q = valor.trim().toLowerCase();
      const { data } = await window.supabaseClient
        .from('clientes').select('id,nombre,apellido,telefono,dni,obra_social')
        .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,telefono.ilike.%${q}%,dni.ilike.%${q}%`)
        .order('apellido').limit(6);
      _clientesSugData = data || [];
      if (!_clientesSugData.length) {
        sugEl.classList.add('hidden');
        return;
      }
      sugEl.innerHTML = _clientesSugData.map(cl => {
        const det = [cl.telefono ? `📱 ${cl.telefono}` : '', cl.obra_social || ''].filter(Boolean).join(' · ');
        return `<div class="sug-item" onclick="App.seleccionarCliente('${cl.id}')">
          <div>
            <div style="font-weight:600">${esc(cl.apellido)}, ${esc(cl.nombre)}</div>
            ${det ? `<div style="font-size:.78rem;color:var(--gris-texto);margin-top:2px">${det}</div>` : ''}
          </div>
        </div>`;
      }).join('') +
      `<div class="sug-item" style="color:var(--gris-texto);font-size:.82rem;border-top:1px solid var(--gris-borde);padding:10px 14px;text-align:center"
            onclick="document.getElementById('cliente-suggestions').classList.add('hidden')">
        Ninguno de estos — continuar con este nombre
      </div>`;
      sugEl.classList.remove('hidden');
    }, 280);
  }

  async function seleccionarCliente(id) {
    let cl = _clientesSugData.find(x => x.id === id || x.id === String(id));
    if (!cl) {
      const { data } = await window.supabaseClient
        .from('clientes')
        .select('id,nombre,apellido,telefono,dni,obra_social')
        .eq('id', id)
        .single();
      if (!data) return;
      cl = data;
    }
    const nombre = [cl.apellido, cl.nombre].filter(Boolean).join(', ');
    const fCliente = document.getElementById('f-cliente');
    if (fCliente) fCliente.value = nombre;
    const fId = document.getElementById('campo-cliente-id');
    if (fId) fId.value = cl.id;
    const celEl = document.getElementById('f-cliente-cel');
    const dniEl = document.getElementById('f-cliente-dni');
    const osEl  = document.getElementById('f-cliente-os');
    if (celEl && cl.telefono) celEl.value = cl.telefono;
    if (dniEl && cl.dni)      dniEl.value = cl.dni;
    if (osEl  && cl.obra_social) {
      await _cargarObrasSocialesForm();
      osEl.value = cl.obra_social;
    }
    const chipNombre = document.getElementById('cliente-chip-nombre');
    if (chipNombre) chipNombre.textContent = nombre;
    const chipDet = document.getElementById('cliente-chip-detalle');
    if (chipDet) {
      chipDet.textContent = [
        cl.telefono ? '📱 ' + cl.telefono : '',
        cl.obra_social || ''
      ].filter(Boolean).join(' · ');
    }
    document.getElementById('cliente-seleccionado')?.classList.remove('hidden');
    document.getElementById('cliente-suggestions')?.classList.add('hidden');
    toast(`✓ ${nombre}${cl.telefono ? ' · ' + cl.telefono : ''}`, 'success');
  }

  function limpiarClienteForm() {
    ['f-cliente','f-cliente-cel','f-cliente-dni'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const idEl = document.getElementById('campo-cliente-id'); if (idEl) idEl.value = '';
    const sel  = document.getElementById('f-cliente-os'); if (sel) sel.value = '';
    document.getElementById('cliente-seleccionado')?.classList.add('hidden');
    document.getElementById('cliente-suggestions')?.classList.add('hidden');
    document.getElementById('f-cliente')?.focus();
  }

  function crearClienteDesdeNuevo() {
    document.getElementById('cliente-suggestions')?.classList.add('hidden');
    if (typeof abrirFormCliente === 'function') abrirFormCliente();
  }

  // ── UTILS ─────────────────────────────────────────
  function todayStr() { return new Date().toISOString().slice(0,10); }
  function toast(msg,tipo='success') {
    const c=document.getElementById('toast-container');
    const d=document.createElement('div'); d.className=`toast toast-${tipo}`; d.textContent=msg;
    c.appendChild(d); setTimeout(()=>d.remove(),3100);
  }
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  window.toast=toast; window.escHtml=esc;

  return {
    init, showScreen,
    loadPedidos, loadSeguimiento, refreshPanel, resetForm,
    switchEstadoTab, switchSegTab,
    onLenteChange, setDistancia, onArmazonTipoChange,
    loadConfigScreen, loadConfigTratamientos,
    addLab, deleteLab, startEditLab, saveConfigLab,
    addMarca, deleteMarca, startEditMarca, saveConfigMarca,
    addMaterial, deleteMaterial, startEditMaterial, saveConfigMaterial,
    addTratamiento, deleteTratamiento, startEditTrat, saveConfigTrat,
    cancelConfigEdit,
    guardarEdicion, eliminarPedido, activarNotificaciones,
    togglePedidoRow, mesPrev, mesNext,
    _abrirDetalleRapido,
    onClienteInput, seleccionarCliente, crearClienteDesdeNuevo, limpiarClienteForm,
    initClienteSearch,
    onFotoSelected, clearFoto,
    abrirFotoViewer, cerrarFotoViewer,
    uploadFotoExistente, cambiarFoto, eliminarFotoConfirm,
    attachNumpadListeners,
    // Seguimiento
    setLabFilter, onSegSearch, setSeguimientoFilter, toggleSegSection,
    // Duplicados
    _cerrarModalDuplicado, _confirmarSinImportarDuplicado,
  };
})();

App.init();
