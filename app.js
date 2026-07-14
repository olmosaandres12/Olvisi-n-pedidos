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
  let _ordenCheckTimer   = null;
  let _ordenChecking     = false;
  let _ordenUltimaQuery  = '';

  // Seguimiento filters
  let _labFilter  = null;
  let _segSearch  = '';
  let _collapsedSections = {};

  let _fotoFiles        = {};
  let _fotoUploadTarget = null;

  const hoy = new Date();
  let _mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  let _mesPami   = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  // ── Lab colors ────────────────────────────────────
  const LAB_COLORS = { Sol:'#2563EB', Bichara:'#DC2626', Cristian:'#16A34A', Vitolen:'#7C3AED' };
  function getLabColor(lab) { return LAB_COLORS[lab] || '#6B7280'; }

  // ══════════════════════════════════════════════════
  //  BLOQUEO DE ORIENTACIÓN — solo en pantallas chicas
  //  (celu queda fijo en vertical; tablet/desktop rota libre)
  // ══════════════════════════════════════════════════
  function aplicarBloqueoOrientacion() {
    const esPantallaChica = window.matchMedia('(max-width: 767px)').matches;

    if (esPantallaChica) {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {
          // iOS o navegadores que no lo permiten fuera de fullscreen: no rompe nada
        });
      }
    } else {
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    }
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

    // Bloqueo de orientación: celu fijo en vertical, tablet/desktop libre
    aplicarBloqueoOrientacion();
    window.addEventListener('resize', aplicarBloqueoOrientacion);

    initNumpad();
    _inyectarModalDuplicado();
    _initFotoViewer();
    _initOrdenRealTimeCheck();
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
  //  OBRA SOCIAL — mostrar/ocultar campos PAMI
  // ══════════════════════════════════════════════════

  function onObraSocialChange(val) {
    const el = document.getElementById('pami-extra-fields');
    if (!el) return;
    const esPami = val === 'PAMI';
    el.classList.toggle('hidden', !esPami);
    if (!esPami) {
      ['f-num-afiliado','f-tipo-trabajo-pami','f-diferencia-pami'].forEach(id => {
        const campo = document.getElementById(id);
        if (campo) campo.value = '';
      });
    }
  }

  // ══════════════════════════════════════════════════
  //  DETECCIÓN EN TIEMPO REAL — NÚMERO DE ORDEN
  // ══════════════════════════════════════════════════

  function _initOrdenRealTimeCheck() {
    const input = document.getElementById('f-orden');
    if (!input) return;

    if (!document.getElementById('orden-check-status')) {
      const statusEl = document.createElement('div');
      statusEl.id = 'orden-check-status';
      statusEl.className = 'orden-check-status hidden';
      input.insertAdjacentElement('afterend', statusEl);
    }

    input.addEventListener('input', () => {
      const valor = input.value.trim();
      clearTimeout(_ordenCheckTimer);
      if (!valor) { _ordenUltimaQuery = ''; _renderOrdenStatus('idle'); return; }
      if (valor === _ordenUltimaQuery) return;
      _renderOrdenStatus('checking');
      _ordenCheckTimer = setTimeout(() => _consultarOrdenDuplicado(valor), 600);
    });

    input.addEventListener('change', () => {
      if (!input.value.trim()) { _ordenUltimaQuery = ''; _renderOrdenStatus('idle'); }
    });
  }

  async function _consultarOrdenDuplicado(orden) {
    if (_ordenChecking) return;
    _ordenChecking = true;
    _ordenUltimaQuery = orden;
    try {
      const { data, error } = await window.supabaseClient
        .from('pedidos').select('id, cliente, estado, fecha_carga, sufijo').eq('orden', orden).limit(5);
      if (error) throw error;
      if (data && data.length > 0) _renderOrdenStatus('duplicado', data);
      else _renderOrdenStatus('libre');
    } catch (e) { console.warn('Error al verificar orden en tiempo real:', e); _renderOrdenStatus('idle'); }
    finally { _ordenChecking = false; }
  }

  function _renderOrdenStatus(estado, pedidos) {
    const el = document.getElementById('orden-check-status');
    const input = document.getElementById('f-orden');
    if (!el) return;
    if (estado === 'idle') {
      el.className = 'orden-check-status hidden'; el.innerHTML = '';
      input?.classList.remove('orden-input--libre', 'orden-input--dup'); return;
    }
    el.classList.remove('hidden');
    if (estado === 'checking') {
      el.className = 'orden-check-status orden-check--checking';
      el.innerHTML = `<span class="orden-check-spinner"></span> Verificando número de orden...`;
      input?.classList.remove('orden-input--libre', 'orden-input--dup'); return;
    }
    if (estado === 'libre') {
      el.className = 'orden-check-status orden-check--libre';
      el.innerHTML = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><polyline points="4 10 8 14 16 6"/></svg> Número disponible`;
      input?.classList.remove('orden-input--dup'); input?.classList.add('orden-input--libre'); return;
    }
    if (estado === 'duplicado' && pedidos?.length) {
      const ESTADO_SHORT = {
        'Cristales pedidos a lab':'⏳ Cristales','Armazón enviado p/calibrado':'📦 En tránsito',
        'En laboratorio':'🏭 En lab.','Pendiente de retirar':'✅ Listo para retirar','Retirado':'✔️ Retirado',
      };
      const filas = pedidos.map(p => {
        const sufijo = p.sufijo ? `-${p.sufijo}` : '';
        const fecha  = new Date(p.fecha_carga).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
        return `<div class="orden-dup-row">
          <span class="orden-dup-ord">#${esc(String(p.orden))}${esc(sufijo)}</span>
          <span class="orden-dup-cliente">${esc(p.cliente || '—')}</span>
          <span class="orden-dup-est">${ESTADO_SHORT[p.estado] || p.estado}</span>
          <span class="orden-dup-fecha">${fecha}</span>
        </div>`;
      }).join('');
      el.className = 'orden-check-status orden-check--dup';
      el.innerHTML = `<div class="orden-dup-header"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><circle cx="10" cy="10" r="8"/><line x1="10" y1="6" x2="10" y2="10"/><circle cx="10" cy="14" r="1" fill="currentColor" stroke="none"/></svg> Este número ya está en uso — no se puede repetir</div><div class="orden-dup-list">${filas}</div>`;
      input?.classList.remove('orden-input--libre'); input?.classList.add('orden-input--dup');
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
    else if (_currentScreen === 'seguimiento') { _renderKanban(_pedidosCache); }
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
    if (name==='pami')        loadPami();
    if (name==='agenda' && typeof loadClientes === 'function') loadClientes();
    if (name==='inicio') { setTimeout(_cargarObrasSocialesForm, 50); }
    const fab=document.getElementById('fab-nuevo-pedido');
    if (fab) fab.style.display=(name==='inicio'||name==='agenda'||name==='pami')?'none':'flex';
    // Mostrar/ocultar barra de búsqueda kanban solo en Estado
    const kb = document.getElementById('kanban-search-bar');
    if (kb) kb.style.display = name==='seguimiento' ? '' : 'none';
  }

  // ══════════════════════════════════════════════════
  //  PANTALLA PAMI
  // ══════════════════════════════════════════════════

  let _pamiSearchQuery = '';
  let _pamiTodosCache  = [];

  async function loadPami() {
    const listEl  = document.getElementById('pami-list');
    const statsEl = document.getElementById('pami-stats');
    const kpisEl  = document.getElementById('pami-kpis-globales');
    if (!listEl) return;

    // Barra de búsqueda
    if (!document.getElementById('pami-search-bar')) {
      const screen = document.getElementById('screen-pami');
      if (screen) {
        const sb = document.createElement('div');
        sb.id = 'pami-search-bar';
        sb.className = 'kanban-search-bar';
        sb.style.cssText = 'margin:0 0 10px';
        sb.innerHTML = `<div class="kanban-search-wrap">
          <svg class="kanban-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="8.5" cy="8.5" r="5.5"/><line x1="13" y1="13" x2="17" y2="17"/>
          </svg>
          <input type="text" id="pami-search-input" class="kanban-search-input"
                 placeholder="Buscar por nombre o número de orden..."
                 autocomplete="off">
          <button class="kanban-search-clear hidden" id="pami-search-clear" onclick="App._clearPamiSearch()">✕</button>
        </div>`;
        const mesNav = screen.querySelector('#pami-mes-nav');
        if (mesNav) mesNav.insertAdjacentElement('afterend', sb);
        document.getElementById('pami-search-input').addEventListener('input', e => {
          _pamiSearchQuery = e.target.value.trim().toLowerCase();
          const clearBtn = document.getElementById('pami-search-clear');
          if (clearBtn) clearBtn.classList.toggle('hidden', !_pamiSearchQuery);
          _renderPamiLista();
        });
      }
    }

    // Skeletons
    listEl.innerHTML = `<div class="skeleton-card skeleton" style="height:80px;border-radius:12px;margin-bottom:6px"></div>
      <div class="skeleton-card skeleton" style="height:80px;border-radius:12px;opacity:.6;margin-bottom:6px"></div>
      <div class="skeleton-card skeleton" style="height:80px;border-radius:12px;opacity:.3"></div>`;

    try {
      // Traer TODOS los pedidos PAMI para KPIs globales
      const { data: todos, error: errTodos } = await window.supabaseClient
        .from('pedidos')
        .select('id, orden, sufijo, cliente, fecha_carga, tipo_trabajo_pami, diferencia_pami, numero_afiliado, estado, laboratorio')
        .eq('obra_social', 'PAMI')
        .order('fecha_carga', { ascending: false });
      if (errTodos) throw errTodos;

      _pamiTodosCache = todos || [];

      // KPIs globales
      if (kpisEl) {
        const totalHistorico = _pamiTodosCache.length;
        const totalSinCargo  = _pamiTodosCache.filter(p => p.diferencia_pami === 'Sin cargo').length;
        const totalConDif    = _pamiTodosCache.filter(p => p.diferencia_pami === 'Con diferencia').length;

        // Promedio por mes
        const meses = {};
        _pamiTodosCache.forEach(p => {
          const d = new Date(p.fecha_carga);
          const k = `${d.getFullYear()}-${d.getMonth()}`;
          meses[k] = (meses[k] || 0) + 1;
        });
        const cantMeses = Object.keys(meses).length || 1;
        const promedio  = (totalHistorico / cantMeses).toFixed(1);

        kpisEl.innerHTML = `<div class="pami-kpis-grid">
          <div class="pami-kpi-card pami-kpi-card--blue">
            <div class="pami-kpi-icon">🏥</div>
            <div class="pami-kpi-val">${totalHistorico}</div>
            <div class="pami-kpi-lbl">Total histórico</div>
          </div>
          <div class="pami-kpi-card pami-kpi-card--indigo">
            <div class="pami-kpi-icon">📅</div>
            <div class="pami-kpi-val">${promedio}</div>
            <div class="pami-kpi-lbl">Promedio / mes</div>
          </div>
          <div class="pami-kpi-card pami-kpi-card--green">
            <div class="pami-kpi-icon">✅</div>
            <div class="pami-kpi-val">${totalSinCargo}</div>
            <div class="pami-kpi-lbl">Sin cargo (total)</div>
          </div>
          <div class="pami-kpi-card pami-kpi-card--amber">
            <div class="pami-kpi-icon">💰</div>
            <div class="pami-kpi-val">${totalConDif}</div>
            <div class="pami-kpi-lbl">Con diferencia (total)</div>
          </div>
        </div>`;
      }

      // Stats y lista del mes seleccionado
      _renderPamiMesNav();
      _renderPamiMesStats(statsEl);
      _renderPamiLista();

    } catch(e) {
      listEl.innerHTML = `<div class="empty-state"><p style="color:var(--rojo)">Error: ${esc(e.message)}</p></div>`;
    }
  }

  function _renderPamiMesStats(statsEl) {
    if (!statsEl) return;
    const mesInicio = _mesPami;
    const mesFin    = new Date(_mesPami.getFullYear(), _mesPami.getMonth() + 1, 1);
    const delMes    = _pamiTodosCache.filter(p => {
      const fc = new Date(p.fecha_carga);
      return fc >= mesInicio && fc < mesFin;
    });
    const total    = delMes.length;
    const sinCargo = delMes.filter(p => p.diferencia_pami === 'Sin cargo').length;
    const conDif   = delMes.filter(p => p.diferencia_pami === 'Con diferencia').length;
    const activos  = delMes.filter(p => p.estado !== 'Retirado').length;

    statsEl.innerHTML = `<div class="pami-mes-stats">
      <div class="pami-mes-stat">
        <span class="pami-mes-stat-val">${total}</span>
        <span class="pami-mes-stat-lbl">del mes</span>
      </div>
      <div class="pami-mes-stat pami-mes-stat--green">
        <span class="pami-mes-stat-val">${sinCargo}</span>
        <span class="pami-mes-stat-lbl">sin cargo</span>
      </div>
      <div class="pami-mes-stat pami-mes-stat--amber">
        <span class="pami-mes-stat-val">${conDif}</span>
        <span class="pami-mes-stat-lbl">con dif.</span>
      </div>
      <div class="pami-mes-stat pami-mes-stat--blue">
        <span class="pami-mes-stat-val">${activos}</span>
        <span class="pami-mes-stat-lbl">activos</span>
      </div>
    </div>`;
  }

  function _renderPamiLista() {
    const listEl = document.getElementById('pami-list');
    if (!listEl) return;
    const q = _pamiSearchQuery;

    let datos;
    if (q) {
      // Búsqueda: ignorar filtro de mes
      datos = _pamiTodosCache.filter(p =>
        p.cliente?.toLowerCase().includes(q) ||
        String(p.orden).includes(q)
      );
    } else {
      const mesInicio = _mesPami;
      const mesFin    = new Date(_mesPami.getFullYear(), _mesPami.getMonth() + 1, 1);
      datos = _pamiTodosCache.filter(p => {
        const fc = new Date(p.fecha_carga);
        return fc >= mesInicio && fc < mesFin;
      });
    }

    if (!datos.length) {
      listEl.innerHTML = `<div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        <h3>${q ? 'Sin resultados' : 'Sin trabajos PAMI'}</h3>
        <p>${q ? `No hay resultados para "${esc(q)}"` : 'No hay pedidos PAMI en ' + mesLabel(_mesPami).toLowerCase()}</p>
      </div>`;
      return;
    }

    listEl.innerHTML = datos.map(p => _renderPamiRow(p)).join('');
  }

  function _clearPamiSearch() {
    _pamiSearchQuery = '';
    const inp = document.getElementById('pami-search-input');
    if (inp) inp.value = '';
    const clearBtn = document.getElementById('pami-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
    _renderPamiLista();
  }

  function _renderPamiRow(p) {
    const sufijo   = p.sufijo ? `-${p.sufijo}` : '';
    const fecha    = new Date(p.fecha_carga).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const esDif    = p.diferencia_pami === 'Con diferencia';
    const esSinCargo = p.diferencia_pami === 'Sin cargo';
    const estadoRetirado = p.estado === 'Retirado';

    const estadoColor = {
      'Cristales pedidos a lab': '#F59E0B', 'Armazón enviado p/calibrado': '#6366F1',
      'En laboratorio': '#034291', 'Pendiente de retirar': '#10B981', 'Retirado': '#7C3AED',
    };
    const color = estadoColor[p.estado] || '#888';

    const difBadge = p.diferencia_pami
      ? `<span class="pami-dif-badge ${esDif ? 'pami-dif-badge--amber' : 'pami-dif-badge--green'}">${p.diferencia_pami}</span>` : '';
    const tipoBadge = p.tipo_trabajo_pami
      ? `<span class="pami-tipo-badge">${esc(p.tipo_trabajo_pami)}</span>` : '';
    const afiliadoTxt = p.numero_afiliado
      ? `<span class="pami-afiliado">🪪 ${esc(p.numero_afiliado)}</span>` : '';

    return `<div class="pami-card">
      <div class="pami-card-left" style="border-left-color:${color}">
        <div class="pami-card-cliente">${esc(p.cliente)}</div>
        <div class="pami-card-meta">
          <span class="pami-card-orden">#${esc(p.orden)}${sufijo}</span>
          <span class="pami-card-sep">·</span>
          <span class="pami-card-fecha">${fecha}</span>
          ${p.laboratorio ? `<span class="pami-card-sep">·</span><span class="pami-card-lab">${esc(p.laboratorio)}</span>` : ''}
        </div>
        ${afiliadoTxt ? `<div class="pami-card-afiliado">${afiliadoTxt}</div>` : ''}
        <div class="pami-card-badges">
          ${tipoBadge}${difBadge}
          <span class="pami-card-estado" style="color:${color}">${estadoRetirado ? '✔️ Retirado' : p.estado}</span>
        </div>
      </div>
    </div>`;
  }

  function _renderPamiMesNav() {
    const container = document.getElementById('pami-mes-nav'); if (!container) return;
    const esHoy = _mesPami.getFullYear() === hoy.getFullYear() && _mesPami.getMonth() === hoy.getMonth();
    container.innerHTML = `<div class="mes-nav">
      <button class="mes-nav-btn" onclick="App.pamiMesPrev()">‹</button>
      <span class="mes-nav-label">${mesLabel(_mesPami)}</span>
      <button class="mes-nav-btn ${esHoy?'mes-nav-btn--disabled':''}" onclick="App.pamiMesNext()" ${esHoy?'disabled':''}>›</button>
    </div>`;
  }

  function pamiMesPrev() {
    _mesPami = new Date(_mesPami.getFullYear(), _mesPami.getMonth() - 1, 1);
    _renderPamiMesNav();
    const statsEl = document.getElementById('pami-stats');
    _renderPamiMesStats(statsEl);
    _renderPamiLista();
  }
  function pamiMesNext() {
    const n = new Date(_mesPami.getFullYear(), _mesPami.getMonth() + 1, 1);
    if (n > hoy) return;
    _mesPami = n;
    _renderPamiMesNav();
    const statsEl = document.getElementById('pami-stats');
    _renderPamiMesStats(statsEl);
    _renderPamiLista();
  }

  // ══════════════════════════════════════════════════
  //  SEGUIMIENTO / KANBAN
  // ══════════════════════════════════════════════════

  const KANBAN_COLS = [
    { key: 'cristales', label: 'Cristales',      estados: ['Cristales pedidos a lab'], color: '#2563EB' },
    { key: 'lab',       label: 'En laboratorio', estados: ['Armazón enviado p/calibrado','En laboratorio'], color: '#16A34A' },
    { key: 'retirar',   label: 'Para retirar',   estados: ['Pendiente de retirar'], color: '#D97706' },
    { key: 'retirado',  label: 'Retirado',        estados: ['Retirado'], color: '#7C3AED' },
  ];

  let _kanbanDetalleId = null;
  let _dragId          = null;

  async function loadSeguimiento() {
    try {
      const todos = await Pedidos.getPedidosActivos();
      _pedidosCache = todos;
      _buildSegHeader();
      _renderKanbanKPIs(todos);
      _renderKanban(todos);
      updateBadge();
      const criticos  = todos.filter(p => p._est.valor === 'critico');
      const demorados = todos.filter(p => p._est.valor === 'demorado');
      if (criticos.length > 0)       enviarNotificacion('🔴 Pedidos críticos — OLVISIÓN', `${criticos.length} pedido${criticos.length>1?'s':''} superó el tiempo límite`, true);
      else if (demorados.length > 0) enviarNotificacion('⚠️ Demorados — OLVISIÓN', `${demorados.length} pedido${demorados.length>1?'s':''} demorado en laboratorio`, true);
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  }

  function _buildSegHeader() {
    const screen = document.getElementById('screen-seguimiento');
    if (!screen || document.getElementById('seg-kpis-wrap')) return;
    const tabs = screen.querySelector('.seg-tabs');
    if (!tabs) return;
    const wrap = document.createElement('div');
    wrap.id = 'seg-header-wrap';
    wrap.innerHTML = '<div id="seg-kpis-wrap"></div>';
    tabs.parentNode.insertBefore(wrap, tabs);
  }

  function _renderKanbanKPIs(todos) {
    const el = document.getElementById('seg-kpis-wrap');
    if (!el) return;
    const activos  = todos.filter(p => p.estado !== 'Retirado');
    const criticos = activos.filter(p => p._est.valor === 'critico').length;
    const retirar  = todos.filter(p => p.estado === 'Pendiente de retirar').length;
    const urgentes = activos.filter(p => p.urgente === 'Si').length;
    el.innerHTML = `<div class="seg-kpi-grid" style="margin-bottom:14px">
      <div class="seg-kpi-card">
        <div class="seg-kpi-icon-bg">📋</div>
        <div class="seg-kpi-val">${activos.length}</div>
        <div class="seg-kpi-label">Activos</div>
      </div>
      <div class="seg-kpi-card seg-kpi-card--red">
        <div class="seg-kpi-icon-bg">🔴</div>
        <div class="seg-kpi-val seg-kpi-val--red">${criticos}</div>
        <div class="seg-kpi-label">Críticos</div>
      </div>
      <div class="seg-kpi-card seg-kpi-card--amber">
        <div class="seg-kpi-icon-bg">⚡</div>
        <div class="seg-kpi-val seg-kpi-val--amber">${urgentes}</div>
        <div class="seg-kpi-label">Urgentes</div>
      </div>
      <div class="seg-kpi-card seg-kpi-card--green">
        <div class="seg-kpi-icon-bg">📦</div>
        <div class="seg-kpi-val seg-kpi-val--green">${retirar}</div>
        <div class="seg-kpi-label">Para retirar</div>
      </div>
    </div>`;
  }

  let _kanbanSearchQuery = '';
  let _historialQuery = '';

  function _renderKanban(todos) {
    const screen = document.getElementById('screen-seguimiento');
    if (!screen) return;

    // Ocultar tabs y panels viejos
    const segTabs     = screen.querySelector('.seg-tabs');
    const segPanelLab = document.getElementById('seg-content-lab');
    const segPanelRet = document.getElementById('seg-content-retirar');
    if (segTabs)     segTabs.style.display     = 'none';
    if (segPanelLab) segPanelLab.style.display  = 'none';
    if (segPanelRet) segPanelRet.style.display  = 'none';

    // Barra de búsqueda
    let searchBar = document.getElementById('kanban-search-bar');
    if (!searchBar) {
      searchBar = document.createElement('div');
      searchBar.id = 'kanban-search-bar';
      searchBar.className = 'kanban-search-bar';
      searchBar.innerHTML = `
        <div class="kanban-search-wrap">
          <svg class="kanban-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="8.5" cy="8.5" r="5.5"/><line x1="13" y1="13" x2="17" y2="17"/>
          </svg>
          <input type="text" id="kanban-search-input" class="kanban-search-input"
                 placeholder="Buscar por nombre o número de orden..."
                 autocomplete="off" autocorrect="off" spellcheck="false">
          <button class="kanban-search-clear hidden" id="kanban-search-clear" onclick="App._clearKanbanSearch()">✕</button>
        </div>`;
      const headerWrap = document.getElementById('seg-header-wrap');
      if (headerWrap) headerWrap.insertAdjacentElement('afterend', searchBar);
      else screen.appendChild(searchBar);
      document.getElementById('kanban-search-input').addEventListener('input', e => {
        App._onKanbanSearch(e.target.value);
      });
    }

    let board = document.getElementById('kanban-board');
    if (!board) {
      board = document.createElement('div');
      board.id = 'kanban-board';
      board.className = 'kanban-board';
      searchBar.insertAdjacentElement('afterend', board);
    }

    board.innerHTML = KANBAN_COLS.map(col => {
      const items = todos.filter(p => col.estados.includes(p.estado));
      return _renderKanbanCol(col, items);
    }).join('');

    _attachKanbanDnD(board);
  }

  function _onKanbanSearch(val) {
    _kanbanSearchQuery = val.trim().toLowerCase();
    const clearBtn = document.getElementById('kanban-search-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !_kanbanSearchQuery);
    _renderKanbanFiltrado();
  }

  function _clearKanbanSearch() {
    _kanbanSearchQuery = '';
    const inp = document.getElementById('kanban-search-input');
    if (inp) inp.value = '';
    const clearBtn = document.getElementById('kanban-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
    _renderKanbanFiltrado();
  }

  function _renderKanbanFiltrado() {
    const board = document.getElementById('kanban-board');
    if (!board) return;
    const q = _kanbanSearchQuery;
    const todos = q
      ? _pedidosCache.filter(p =>
          p.cliente?.toLowerCase().includes(q) ||
          String(p.orden).includes(q)
        )
      : _pedidosCache;
    board.innerHTML = KANBAN_COLS.map(col => {
      const items = todos.filter(p => col.estados.includes(p.estado));
      return _renderKanbanCol(col, items);
    }).join('');
    _attachKanbanDnD(board);
  }

  function _renderKanbanCol(col, items) {
    const groups = groupPedidos(items);
    const count  = groups.length;
    const bodyContent = count === 0
      ? `<div class="kanban-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          Vacío
        </div>`
      : groups.map(g => g.type === 'pair'
          ? _renderKanbanPair(g.a, g.b)
          : _renderKanbanCard(g.p)
        ).join('');

    return `<div class="kanban-col ${col.key === 'retirado' ? 'kanban-col--retirado' : ''}" data-col="${col.key}">
      <div class="kanban-col-header">
        <div class="kanban-col-dot" style="background:${col.color}"></div>
        <span class="kanban-col-label">${col.label}</span>
        <span class="kanban-col-count">${count}</span>
      </div>
      <div class="kanban-col-body" data-col="${col.key}">${bodyContent}</div>
    </div>`;
  }

  function _renderKanbanCard(p) {
    const sufijo   = p.sufijo ? `-${p.sufijo}` : '';
    const cfg      = getCardConfig(p);
    const labColor = getLabColor(p.laboratorio);
    const isUrgente = p.urgente === 'Si' && p.estado !== 'Retirado';
    const isCrit   = p._est.valor === 'critico';
    const isDem    = p._est.valor === 'demorado';

    let cardCls = 'kanban-card';
    if (isCrit || isUrgente) cardCls += ' kanban-card--crit';
    else if (isDem)          cardCls += ' kanban-card--dem';
    else                     cardCls += ' kanban-card--ok';

    let labBadgeCls = 'kc-lab-badge';
    if (isCrit)                  labBadgeCls += ' kc-lab-badge--crit';
    else if (isDem || isUrgente) labBadgeCls += ' kc-lab-badge--dem';

    let diasCls = 'kc-dias';
    if (isCrit)     diasCls += ' kc-dias--crit';
    else if (isDem) diasCls += ' kc-dias--dem';

    let labStatus = '';
    if (isCrit)         labStatus = `<span class="kc-lab-status" style="color:#DC2626">🔴 crítico</span>`;
    else if (isDem)     labStatus = `<span class="kc-lab-status" style="color:#D97706">⚠️ demorado</span>`;
    else if (isUrgente) labStatus = `<span class="kc-lab-status" style="color:#D97706">⚡ urgente</span>`;

    const sigEstado = _getSigEstado(p.estado);
    const armazonLimpio = p.armazon ? p.armazon.replace(/Del cliente\s*\/?\s*/i,'').replace(/Nuevo\s*\/?\s*/i,'') : '';

    return `<div class="${cardCls}" data-id="${p.id}" draggable="true"
                 onclick="App._abrirKanbanDetalle(${p.id})">
      <div class="kc-top">
        <div class="kc-nombre">${esc(p.cliente)}</div>
        <div class="kc-orden">#${esc(p.orden)}${sufijo}</div>
      </div>
      ${armazonLimpio ? `<div class="kc-armazon">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="12" r="3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        ${esc(armazonLimpio)}
      </div>` : ''}
      ${p.tipo_lente ? `<div class="kc-lente-box">
        <div class="kc-lente-label">Lente</div>
        <div class="kc-lente-val">${esc(p.tipo_lente)}${p.tratamiento ? ' · ' + esc(p.tratamiento) : ''}</div>
      </div>` : ''}
      <div class="${labBadgeCls}">
        <div class="kc-lab-dot" style="background:${labColor}"></div>
        ${esc(p.laboratorio || '—')}
        ${labStatus}
      </div>
      <div class="kc-footer">
        <div class="${diasCls}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${cfg.dh} día${cfg.dh !== 1 ? 's' : ''}
        </div>
        ${sigEstado ? `<button class="kc-mover" onclick="event.stopPropagation();App._moverKanbanCard(${p.id},'${sigEstado}')">Mover →</button>` : ''}
      </div>
    </div>`;
  }

  function _renderKanbanPair(pA, pB) {
    const cfgA     = getCardConfig(pA);
    const cfgB     = getCardConfig(pB);
    const dhMax    = Math.max(cfgA.dh, cfgB.dh);
    const isCrit   = pA._est.valor === 'critico' || pB._est.valor === 'critico';
    const isDem    = pA._est.valor === 'demorado' || pB._est.valor === 'demorado';
    const isUrg    = (pA.urgente === 'Si' || pB.urgente === 'Si') && pA.estado !== 'Retirado';
    const labColor = getLabColor(pA.laboratorio);
    const sigEstado = _getSigEstado(pA.estado);

    let cardCls = 'kanban-card';
    if (isCrit || isUrg) cardCls += ' kanban-card--crit';
    else if (isDem)      cardCls += ' kanban-card--dem';
    else                 cardCls += ' kanban-card--ok';

    let labBadgeCls = 'kc-lab-badge';
    if (isCrit)              labBadgeCls += ' kc-lab-badge--crit';
    else if (isDem || isUrg) labBadgeCls += ' kc-lab-badge--dem';

    let diasCls = 'kc-dias';
    if (isCrit)     diasCls += ' kc-dias--crit';
    else if (isDem) diasCls += ' kc-dias--dem';

    let labStatus = '';
    if (isCrit)     labStatus = `<span class="kc-lab-status" style="color:#DC2626">🔴 crítico</span>`;
    else if (isDem) labStatus = `<span class="kc-lab-status" style="color:#D97706">⚠️ demorado</span>`;
    else if (isUrg) labStatus = `<span class="kc-lab-status" style="color:#D97706">⚡ urgente</span>`;

    return `<div class="${cardCls}" data-pair-id="pair-${pA.orden}" draggable="true"
                 onclick="App._abrirKanbanDetallePair('${pA.orden}')">
      <div class="kc-top">
        <div class="kc-nombre">${esc(pA.cliente)}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <div class="kc-orden">#${esc(pA.orden)}</div>
          <span class="kc-pair-badge">A·B</span>
        </div>
      </div>
      <div class="kc-lente-box">
        <div class="kc-lente-label">Lente A / B</div>
        <div class="kc-lente-val">${esc(pA.tipo_lente || '—')} / ${esc(pB.tipo_lente || '—')}</div>
      </div>
      <div class="${labBadgeCls}">
        <div class="kc-lab-dot" style="background:${labColor}"></div>
        ${esc(pA.laboratorio || '—')}
        ${labStatus}
      </div>
      <div class="kc-footer">
        <div class="${diasCls}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${dhMax} día${dhMax !== 1 ? 's' : ''}
        </div>
        ${sigEstado ? `<button class="kc-mover" onclick="event.stopPropagation();App._moverKanbanPair('${pA.orden}','${sigEstado}')">Mover →</button>` : ''}
      </div>
    </div>`;
  }

  function _getSigEstado(estado) {
    const map = {
      'Cristales pedidos a lab':     'En laboratorio',
      'Armazón enviado p/calibrado': 'En laboratorio',
      'En laboratorio':              'Pendiente de retirar',
      'Pendiente de retirar':        'Retirado',
      'Retirado':                    null,
    };
    return map[estado] || null;
  }

  async function _moverKanbanCard(id, nuevoEstado) {
    try {
      await Pedidos.actualizarEstado(id, nuevoEstado);
      toast(`→ ${nuevoEstado}`, 'success');
      const p = _pedidosCache.find(x => x.id === id);
      if (nuevoEstado === 'Retirado' && p) enviarNotificacion('✅ Retirado — OLVISIÓN', `#${p.orden} de ${p.cliente}`, false);
      _pedidosCache = await Pedidos.getTodosPedidos();
      _renderKanbanKPIs(_pedidosCache);
      _renderKanban(_pedidosCache);
      updateBadge();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  }

  async function _moverKanbanPair(orden, nuevoEstado) {
    const pares = _pedidosCache.filter(p => p.orden === orden && (p.sufijo === 'A' || p.sufijo === 'B'));
    try {
      for (const p of pares) await Pedidos.actualizarEstado(p.id, nuevoEstado);
      toast(`→ ${nuevoEstado}`, 'success');
      _pedidosCache = await Pedidos.getTodosPedidos();
      _renderKanbanKPIs(_pedidosCache);
      _renderKanban(_pedidosCache);
      updateBadge();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  }

  function _attachKanbanDnD(board) {
    board.querySelectorAll('.kanban-card[draggable]').forEach(card => {
      card.addEventListener('dragstart', e => {
        _dragId = card.dataset.id || card.dataset.pairId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', _dragId);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        board.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
        _dragId = null;
      });
    });

    board.querySelectorAll('.kanban-col-body').forEach(zone => {
      zone.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', e => {
        if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
      });
      zone.addEventListener('drop', async e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const colKey = zone.dataset.col;
        const col    = KANBAN_COLS.find(c => c.key === colKey);
        if (!col || !_dragId) return;
        const nuevoEstado = col.estados[col.estados.length - 1];
        if (_dragId.startsWith('pair-')) {
          const orden = _dragId.replace('pair-', '');
          await _moverKanbanPair(orden, nuevoEstado);
        } else {
          const id = parseInt(_dragId);
          const p  = _pedidosCache.find(x => x.id === id);
          if (p && p.estado !== nuevoEstado) await _moverKanbanCard(id, nuevoEstado);
        }
      });
    });
  }

  function _ensureKanbanDetalleModal() {
    if (document.getElementById('kdetalle-modal')) return;
    const el = document.createElement('div');
    el.id = 'kdetalle-modal';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="kdetalle-sheet">
        <div class="kdetalle-header">
          <div class="kdetalle-header-top">
            <div>
              <span class="kdetalle-orden" id="kd-orden"></span>
              <span class="kdetalle-estado-badge" id="kd-estado-badge" style="margin-left:10px"></span>
            </div>
            <button class="kdetalle-close" onclick="App._cerrarKanbanDetalle()">✕</button>
          </div>
          <div class="kdetalle-cliente-row">
            <span class="kdetalle-cliente-name" id="kd-cliente"></span>
          </div>
        </div>
        <div class="kdetalle-body" id="kd-body"></div>
        <div class="kdetalle-footer">
          <select class="kdetalle-estado-select" id="kd-estado-sel">
            <option value="Cristales pedidos a lab">Cristales pedidos a lab</option>
            <option value="En laboratorio">En laboratorio</option>
            <option value="Pendiente de retirar">Pendiente de retirar</option>
            <option value="Retirado">Retirado</option>
          </select>
          <div class="kdetalle-actions">
            <button class="kdetalle-edit-btn" id="kd-edit-btn">✏️ Editar</button>
            <button class="kdetalle-del-btn" id="kd-del-btn">🗑️</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) _cerrarKanbanDetalle(); });
    document.getElementById('kd-estado-sel').addEventListener('change', async e => {
      const nuevoEstado = e.target.value;
      if (!_kanbanDetalleId) return;
      await _moverKanbanCard(_kanbanDetalleId, nuevoEstado);
      _cerrarKanbanDetalle();
    });
    document.getElementById('kd-edit-btn').addEventListener('click', () => {
      _detalleId = _kanbanDetalleId; _cerrarKanbanDetalle(); abrirEdicion();
    });
    document.getElementById('kd-del-btn').addEventListener('click', () => {
      if (_kanbanDetalleId) { _cerrarKanbanDetalle(); eliminarPedido(_kanbanDetalleId); }
    });
  }

  function _abrirKanbanDetalle(id) {
    _ensureKanbanDetalleModal();
    _kanbanDetalleId = id;
    const p = _pedidosCache.find(x => x.id === id);
    if (!p) return;
    const sufijo = p.sufijo ? `-${p.sufijo}` : '';
    document.getElementById('kd-orden').textContent   = `#${p.orden}${sufijo}`;
    document.getElementById('kd-cliente').textContent = p.cliente;
    document.getElementById('kd-estado-badge').textContent = p.estado;
    document.getElementById('kd-estado-sel').value    = p.estado;

    const esAdmin = Auth.isAdmin();
    document.getElementById('kd-edit-btn').style.display = esAdmin ? '' : 'none';
    document.getElementById('kd-del-btn').style.display  = esAdmin ? '' : 'none';

    const body     = document.getElementById('kd-body');
    const labColor = getLabColor(p.laboratorio);
    const cfg      = getCardConfig(p);

    body.innerHTML = `
      <div class="kdetalle-section-title">Especificaciones</div>
      <div class="kdetalle-grid">
        ${p.armazon ? `<div class="kdetalle-item kdetalle-item--full">
          <div class="kdetalle-item-label">Armazón</div>
          <div class="kdetalle-item-val">${esc(p.armazon)}</div>
        </div>` : ''}
        ${p.tipo_lente ? `<div class="kdetalle-item">
          <div class="kdetalle-item-label">Lente</div>
          <div class="kdetalle-item-val">${esc(p.tipo_lente)}</div>
        </div>` : ''}
        ${p.tratamiento ? `<div class="kdetalle-item">
          <div class="kdetalle-item-label">Tratamiento</div>
          <div class="kdetalle-item-val">${esc(p.tratamiento)}</div>
        </div>` : ''}
        ${p.graduacion ? `<div class="kdetalle-item kdetalle-item--full">
          <div class="kdetalle-item-label">Graduación</div>
          <div class="kdetalle-item-val" style="font-family:var(--font-mono);font-size:.8rem">${esc(p.graduacion).replace(/\|/g,' | ')}</div>
        </div>` : ''}
        ${p.observaciones ? `<div class="kdetalle-item kdetalle-item--full">
          <div class="kdetalle-item-label">Observaciones</div>
          <div class="kdetalle-item-val" style="font-style:italic">${esc(p.observaciones)}</div>
        </div>` : ''}
      </div>
      <div class="kdetalle-section-title">Logística</div>
      <div class="kdetalle-grid">
        <div class="kdetalle-item">
          <div class="kdetalle-item-label">Laboratorio</div>
          <div class="kdetalle-item-val" style="display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${labColor};display:inline-block;flex-shrink:0"></span>
            ${esc(p.laboratorio || '—')}
          </div>
        </div>
        <div class="kdetalle-item">
          <div class="kdetalle-item-label">Días en proceso</div>
          <div class="kdetalle-item-val" style="color:${cfg.advertencia||p._est.valor==='critico'?'#DC2626':p._est.valor==='demorado'?'#D97706':'inherit'};font-weight:600">${cfg.dh}dh · ${p._est.texto}</div>
        </div>
        <div class="kdetalle-item">
          <div class="kdetalle-item-label">Fecha pedido</div>
          <div class="kdetalle-item-val">${new Date(p.fecha_pedido||p.fecha_carga).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})}</div>
        </div>
        ${p.fecha_prometida ? `<div class="kdetalle-item">
          <div class="kdetalle-item-label">Fecha prometida</div>
          <div class="kdetalle-item-val" style="font-weight:600;color:${new Date(p.fecha_prometida+'T00:00:00')>=new Date(new Date().setHours(0,0,0,0))?'#16A34A':'#DC2626'}">📅 ${new Date(p.fecha_prometida+'T00:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})}</div>
        </div>` : ''}
        <div class="kdetalle-item">
          <div class="kdetalle-item-label">Tipo</div>
          <div class="kdetalle-item-val">${esc(p.tipo||'—')}</div>
        </div>
        <div class="kdetalle-item">
          <div class="kdetalle-item-label">Urgente</div>
          <div class="kdetalle-item-val">${p.urgente==='Si'?'⚡ Sí':'No'}</div>
        </div>
        <div class="kdetalle-item">
          <div class="kdetalle-item-label">Cargado por</div>
          <div class="kdetalle-item-val">${esc(p.cargado_por||'—')}</div>
        </div>
        ${p.obra_social ? `<div class="kdetalle-item">
          <div class="kdetalle-item-label">Obra social</div>
          <div class="kdetalle-item-val">${esc(p.obra_social)}</div>
        </div>` : ''}
      </div>
      ${p.foto_url ? `<div class="kdetalle-section-title">Foto</div>
        <img src="${esc(p.foto_url)}" loading="lazy" onclick="App.abrirFotoViewer(${p.id})"
             style="width:100%;max-height:180px;object-fit:cover;border-radius:var(--radius-sm);border:1.5px solid var(--gris-borde);cursor:pointer;margin-bottom:8px">` : ''}
    `;

    document.getElementById('kdetalle-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function _abrirKanbanDetallePair(orden) {
    const p = _pedidosCache.find(x => x.orden === orden && x.sufijo === 'A');
    if (p) _abrirKanbanDetalle(p.id);
  }

  function _cerrarKanbanDetalle() {
    document.getElementById('kdetalle-modal')?.classList.add('hidden');
    document.body.style.overflow = '';
    _kanbanDetalleId = null;
  }

  function _clearHistorialSearch() {
    _historialQuery = '';
    const inp = document.getElementById('historial-search-input');
    if (inp) inp.value = '';
    const clearBtn = document.getElementById('historial-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderPedidosList();
  }

  // Stubs para compatibilidad con funciones que el resto del código llama
  function setSeguimientoFilter() { loadSeguimiento(); }
  function setLabFilter()         { loadSeguimiento(); }
  function onSegSearch()          {}
  function toggleSegSection()     {}
  function switchSegTab()         { loadSeguimiento(); }
  function _renderSeguimientoFiltered() { _renderKanban(_pedidosCache); }

  // ══════════════════════════════════════════════════
  //  HELPERS usados por kanban y otras pantallas
  // ══════════════════════════════════════════════════

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
    // Barra de búsqueda historial
    if (!document.getElementById('historial-search-bar')) {
      const screen = document.getElementById('screen-pedidos');
      if (screen) {
        const sb = document.createElement('div');
        sb.id = 'historial-search-bar';
        sb.className = 'kanban-search-bar';
        sb.style.marginBottom = '10px';
        sb.innerHTML = `<div class="kanban-search-wrap"><svg class="kanban-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="13" y1="13" x2="17" y2="17"/></svg><input type="text" id="historial-search-input" class="kanban-search-input" placeholder="Buscar por nombre o número de orden..." autocomplete="off"><button class="kanban-search-clear hidden" id="historial-search-clear" onclick="App._clearHistorialSearch()">✕</button></div>`;
        const mesNav = screen.querySelector('#mes-nav-container');
        if (mesNav) mesNav.insertAdjacentElement('afterend', sb);
        else screen.querySelector('.section-header')?.insertAdjacentElement('afterend', sb);
        document.getElementById('historial-search-input').addEventListener('input', e => {
          _historialQuery = e.target.value.trim().toLowerCase();
          const clearBtn = document.getElementById('historial-search-clear');
          if (clearBtn) clearBtn.classList.toggle('hidden', !_historialQuery);
          renderPedidosList();
        });
      }
    }
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
    const q = _historialQuery;
    const filtered=_pedidosCache.filter(p=>{
      // Si hay búsqueda activa, ignorar filtro de mes
      if (!q) {
        const fc=new Date(p.fecha_carga);
        if (fc<mesInicio||fc>=mesFin) return false;
      }
      if (_estadoTab!=='todos'&&p.estado!==_estadoTab) return false;
      if (q && !p.cliente?.toLowerCase().includes(q) && !String(p.orden).includes(q)) return false;
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
          ${p.obra_social?`<div class="detalle-row"><span class="detalle-label">Obra social</span><span class="detalle-valor">${esc(p.obra_social)}</span></div>`:''}
          ${p.numero_afiliado?`<div class="detalle-row"><span class="detalle-label">N° afiliado</span><span class="detalle-valor">${esc(p.numero_afiliado)}</span></div>`:''}
          ${p.tipo_trabajo_pami?`<div class="detalle-row"><span class="detalle-label">Trabajo PAMI</span><span class="detalle-valor">${esc(p.tipo_trabajo_pami)}</span></div>`:''}
          ${p.diferencia_pami?`<div class="detalle-row"><span class="detalle-label">Diferencia</span><span class="detalle-valor">${esc(p.diferencia_pami)}</span></div>`:''}
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

      const pamiSection = p.obra_social === 'PAMI' ? `
        <div class="form-section"><div class="form-section-title">PAMI</div>
          <div class="form-group"><label class="form-label">N° de afiliado</label>
            <input type="text" id="e-num-afiliado" class="form-control" value="${esc(p.numero_afiliado||'')}"></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Tipo de trabajo</label>
              <select id="e-tipo-trabajo-pami" class="form-control">
                <option value="">— Seleccionar —</option>
                <option value="Solo lejos"${p.tipo_trabajo_pami==='Solo lejos'?' selected':''}>Solo lejos</option>
                <option value="Solo cerca"${p.tipo_trabajo_pami==='Solo cerca'?' selected':''}>Solo cerca</option>
                <option value="Bifocal"${p.tipo_trabajo_pami==='Bifocal'?' selected':''}>Bifocal</option>
                <option value="Lejos y cerca"${p.tipo_trabajo_pami==='Lejos y cerca'?' selected':''}>Lejos y cerca</option>
              </select></div>
            <div class="form-group"><label class="form-label">¿Diferencia?</label>
              <select id="e-diferencia-pami" class="form-control">
                <option value="">— Seleccionar —</option>
                <option value="Sin cargo"${p.diferencia_pami==='Sin cargo'?' selected':''}>Sin cargo</option>
                <option value="Con diferencia"${p.diferencia_pami==='Con diferencia'?' selected':''}>Con diferencia</option>
              </select></div>
          </div>
        </div>` : '';

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
        ${pamiSection}
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
        numero_afiliado:document.getElementById('e-num-afiliado')?.value.trim()||null,
        tipo_trabajo_pami:document.getElementById('e-tipo-trabajo-pami')?.value||null,
        diferencia_pami:document.getElementById('e-diferencia-pami')?.value||null,
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
    _renderConfigObrasSociales();
  }

  async function _renderConfigObrasSociales() {
    const el = document.getElementById('config-os-list'); if (!el) return;
    const { data } = await window.supabaseClient.from('configuracion').select('*').eq('tipo','obra_social').order('orden');
    if (!data?.length) { el.innerHTML = '<p style="color:var(--gris-texto);font-size:.85rem;padding:8px 0">Sin obras sociales</p>'; return; }
    el.innerHTML = data.map(os => {
      const isEditing = _editingConfig?.type === 'os' && _editingConfig?.id === os.id;
      if (isEditing) return _configItemEditing('cfg-edit-os', `App.saveConfigOS(${os.id})`, `App.cancelConfigEdit()`, os.valor);
      return _configItemNormal(esc(os.valor), `App.startEditOS(${os.id},'${esc(os.valor)}')`, `App.deleteObraSocial(${os.id})`);
    }).join('');
    if (_editingConfig?.type === 'os') _focusConfigInput('cfg-edit-os');
  }

  function startEditOS(id, valor) { _editingConfig = { type:'os', id, valor }; _renderConfigObrasSociales(); }
  async function saveConfigOS(id) {
    const newValor = document.getElementById('cfg-edit-os')?.value.trim(); if (!newValor) return;
    try { const {error}=await window.supabaseClient.from('configuracion').update({valor:newValor}).eq('id',id); if(error)throw error; _editingConfig=null; _obrasSocialesCache=[]; _renderConfigObrasSociales(); toast('Obra social actualizada','success'); } catch(e){toast('Error: '+e.message,'error');}
  }
  async function addObraSocial() {
    const i=document.getElementById('new-os-input'), v=i.value.trim(); if(!v)return;
    try { await window.supabaseClient.from('configuracion').insert({tipo:'obra_social',valor:v,orden:99,activo:true}); i.value=''; _obrasSocialesCache=[]; _renderConfigObrasSociales(); toast('Obra social agregada','success'); } catch(e){toast('Error: '+e.message,'error');}
  }
  async function deleteObraSocial(id) {
    if(!confirm('¿Eliminar esta obra social?'))return;
    try { await window.supabaseClient.from('configuracion').delete().eq('id',id); _obrasSocialesCache=[]; _renderConfigObrasSociales(); toast('Obra social eliminada','success'); } catch(e){toast('Error: '+e.message,'error');}
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
  function cancelConfigEdit() { _editingConfig=null; renderConfigLabs(); renderConfigMarcas(); renderConfigMateriales(); loadConfigTratamientos(); _renderConfigObrasSociales(); }

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
    const obraSocial = g('f-cliente-os');
    return {
      doble,
      base:{
        cliente:g('f-cliente'),orden:g('f-orden'),urgente:g('f-urgente'),tipo:g('f-tipo'),
        fecha_carga:g('f-fecha-carga')||todayStr(),
        fecha_prometida:document.getElementById('f-fecha-prometida')?.value||null,
        celular:g('f-cliente-cel'), dni:g('f-cliente-dni'),
        obra_social: obraSocial || null,
        numero_afiliado:   obraSocial === 'PAMI' ? (g('f-num-afiliado')  || null) : null,
        tipo_trabajo_pami: obraSocial === 'PAMI' ? (g('f-tipo-trabajo-pami') || null) : null,
        diferencia_pami:   obraSocial === 'PAMI' ? (g('f-diferencia-pami')   || null) : null,
        cliente_id:document.getElementById('campo-cliente-id')?.value||null,
      },
      ant1:antData(1),
      ant2:doble?antData(2):null,
    };
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

  // ── MODAL DUPLICADO ───────────────────────────────
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

    const { data: existeOrden } = await window.supabaseClient
      .from('pedidos').select('id,cliente,estado,fecha_carga,sufijo').eq('orden', orden).limit(5);
    if (existeOrden?.length) return { tipo: 'orden_duplicada', pedidos: existeOrden, orden };

    let pedidosActivos = [], clienteEncontrado = null, matchPor = '';
    if (clienteId) {
      const { data: peds } = await window.supabaseClient.from('pedidos').select('id,orden,sufijo,estado,fecha_carga,laboratorio').eq('cliente_id', clienteId).neq('estado', 'Retirado').limit(5);
      if (peds?.length) { pedidosActivos = peds; clienteEncontrado = { displayName: nombre }; matchPor = 'cliente seleccionado'; }
    } else {
      if (celular && celular !== '—' && celular.length >= 6) {
        const { data: cl } = await window.supabaseClient.from('clientes').select('id,nombre,apellido,telefono,dni').eq('telefono', celular).maybeSingle();
        if (cl) {
          clienteEncontrado = cl; matchPor = 'celular ' + celular;
          const { data: peds } = await window.supabaseClient.from('pedidos').select('id,orden,sufijo,estado,fecha_carga,laboratorio').eq('cliente_id', cl.id).neq('estado', 'Retirado').limit(5);
          pedidosActivos = peds || [];
        }
      }
      if (!clienteEncontrado && dni && dni.length >= 4) {
        const { data: cl } = await window.supabaseClient.from('clientes').select('id,nombre,apellido,telefono,dni').eq('dni', dni).maybeSingle();
        if (cl) {
          clienteEncontrado = cl; matchPor = 'DNI ' + dni;
          const { data: peds } = await window.supabaseClient.from('pedidos').select('id,orden,sufijo,estado,fecha_carga,laboratorio').eq('cliente_id', cl.id).neq('estado', 'Retirado').limit(5);
          pedidosActivos = peds || [];
        }
      }
      if (!clienteEncontrado && nombre && nombre.length >= 3) {
        const { data: peds } = await window.supabaseClient.from('pedidos').select('id,orden,sufijo,estado,fecha_carga,laboratorio,cliente').ilike('cliente', nombre).neq('estado', 'Retirado').limit(3);
        if (peds?.length) { pedidosActivos = peds; clienteEncontrado = { displayName: nombre }; matchPor = 'nombre "' + nombre + '"'; }
      }
    }

    if (pedidosActivos.length > 0) {
      let displayName = nombre;
      if (clienteEncontrado?.apellido) displayName = [clienteEncontrado.apellido, clienteEncontrado.nombre].filter(Boolean).join(', ');
      else if (clienteEncontrado?.displayName) displayName = clienteEncontrado.displayName;
      return { tipo: 'cliente_activo', cliente: { ...clienteEncontrado, displayName }, pedidos: pedidosActivos, matchPor };
    }
    return null;
  }

  function _mostrarModalDuplicadoOrden(dup) {
    const modal = document.getElementById('dup-modal'); if (!modal) return;
    const ESTADO_SHORT = { 'Cristales pedidos a lab':'⏳ Cristales','Armazón enviado p/calibrado':'📦 En tránsito','En laboratorio':'🏭 En lab.','Pendiente de retirar':'✅ Listo','Retirado':'✔️ Retirado' };
    document.getElementById('dup-icon').textContent = '🚫';
    document.getElementById('dup-title').textContent = `Número de orden duplicado`;
    document.getElementById('dup-subtitle').textContent = `Ya existe un pedido con el número #${esc(String(dup.orden))}. No se puede usar el mismo número dos veces.`;
    document.getElementById('dup-body').innerHTML = dup.pedidos.map(p => {
      const sufijo = p.sufijo ? `-${p.sufijo}` : '';
      const fecha  = new Date(p.fecha_carga).toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'});
      return `<div style="background:#FFF0F0;border:1.5px solid #FECACA;border-radius:12px;padding:12px 14px;margin-bottom:8px">
        <div style="font-weight:700;color:#DC2626;font-size:.95rem">Orden #${esc(String(p.orden))}${esc(sufijo)}</div>
        <div style="font-size:.85rem;color:#555;margin-top:4px;font-weight:500">${esc(p.cliente || '—')}</div>
        <div style="font-size:.78rem;color:#888;margin-top:3px">${esc(ESTADO_SHORT[p.estado] || p.estado)} · ${fecha}</div>
      </div>`;
    }).join('');
    document.getElementById('dup-actions').innerHTML = `<button class="btn btn-primary" onclick="App._cerrarModalDuplicado()" style="width:100%;font-size:1rem;padding:14px">← Volver y cambiar el número</button>`;
    modal.classList.remove('hidden');
  }

  function _mostrarModalDuplicadoCliente(dup) {
    const modal = document.getElementById('dup-modal'); if (!modal) return;
    const ESTADO_SHORT = { 'Cristales pedidos a lab':'⏳ Cristales','Armazón enviado p/calibrado':'📦 En tránsito','En laboratorio':'🏭 En lab.','Pendiente de retirar':'✅ Listo para retirar' };
    const displayName = dup.cliente.displayName || 'Este cliente';
    const matchTxt = dup.matchPor ? ` (coincidencia por ${dup.matchPor})` : '';
    document.getElementById('dup-icon').textContent = '⚠️';
    document.getElementById('dup-title').textContent = `${displayName} ya tiene pedidos activos`;
    document.getElementById('dup-subtitle').textContent = `Se detectó un posible duplicado${matchTxt}. Revisá si realmente es un pedido nuevo antes de continuar.`;
    document.getElementById('dup-body').innerHTML = dup.pedidos.map(p => {
      const sufijo = p.sufijo ? `-${p.sufijo}` : '';
      const fecha  = new Date(p.fecha_carga).toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric'});
      return `<div style="background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:12px;padding:12px 14px;margin-bottom:8px">
        <div style="font-weight:700;color:#92400E;font-size:.9rem">Orden #${esc(String(p.orden))}${esc(sufijo)}</div>
        <div style="font-size:.8rem;color:#555;margin-top:3px">${esc(ESTADO_SHORT[p.estado] || p.estado)}</div>
        <div style="font-size:.75rem;color:#888;margin-top:2px">${p.laboratorio ? esc(p.laboratorio) + ' · ' : ''}${fecha}</div>
      </div>`;
    }).join('');
    document.getElementById('dup-actions').innerHTML = `
      <button class="btn btn-secondary" onclick="App._cerrarModalDuplicado()" style="width:100%;font-size:.95rem;padding:13px;font-weight:600">← Volver y revisar</button>
      <button onclick="App._confirmarSinImportarDuplicado()" style="width:100%;padding:13px;border-radius:var(--radius-md,12px);border:none;cursor:pointer;background:#B45309;color:#fff;font-size:.9rem;font-weight:600;font-family:inherit">
        Es un pedido nuevo — Continuar igual →
      </button>`;
    modal.classList.remove('hidden');
  }

  function _cerrarModalDuplicado() { document.getElementById('dup-modal')?.classList.add('hidden'); _pendingDuplicadoWarning = null; }

  function _confirmarSinImportarDuplicado() {
    document.getElementById('dup-modal')?.classList.add('hidden');
    const data = _pendingDuplicadoWarning; _pendingDuplicadoWarning = null;
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
      + rf('Fecha prometida', data.base.fecha_prometida)
      + rf('Obra social', data.base.obra_social);

    if (data.base.obra_social === 'PAMI') {
      html += rf('N° afiliado', data.base.numero_afiliado)
           +  rf('Tipo de trabajo', data.base.tipo_trabajo_pami)
           +  rf('Diferencia', data.base.diferencia_pami);
    }

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

  async function handleFormSubmit(e) {
    e.preventDefault();
    const data = getFormData();
    if (!validateForm(data)) { toast('Completá los campos obligatorios', 'warn'); return; }

    const statusEl = document.getElementById('orden-check-status');
    if (statusEl?.classList.contains('orden-check--dup')) {
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
    } catch (err) { console.warn('Error al verificar duplicados:', err); }
    finally { if (submitBtn) { submitBtn.disabled = false; if (btnTextoOriginal) submitBtn.textContent = btnTextoOriginal; } }

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
          if (nombreCompleto.includes(',')) { apellido = nombreCompleto.split(',')[0].trim(); nombre = nombreCompleto.split(',').slice(1).join(',').trim(); }
          else { const partes = nombreCompleto.split(' '); apellido = partes.slice(-1)[0]; nombre = partes.slice(0,-1).join(' '); }
          const { data: nuevo } = await window.supabaseClient.from('clientes').insert([{
            nombre, apellido,
            telefono:    data.base.celular || '—',
            dni:         data.base.dni || null,
            obra_social: data.base.obra_social || null,
          }]).select('id').single();
          if (nuevo) clienteId = nuevo.id;
        } catch(e) { console.warn('No se pudo crear cliente:', e); }
      }

      const buildRow = (ant, sufijo) => ({
        cliente:          data.base.cliente,
        cliente_id:       clienteId,
        orden:            data.base.orden,
        sufijo,
        tipo:             data.base.tipo,
        urgente:          data.base.urgente,
        laboratorio:      ant.laboratorio,
        tipo_lente:       ant.tipo_lente,
        tratamiento:      ant.tratamiento     || null,
        graduacion:       ant.graduacion      || null,
        dos_etapas:       ant.dos_etapas      || 'No',
        armazon:          ant.armazon         || null,
        observaciones:    ant.observaciones   || null,
        cargado_por:      nombre,
        fecha_carga:      fechaISO,
        fecha_pedido:     fechaISO,
        fecha_prometida:  data.base.fecha_prometida || null,
        obra_social:      data.base.obra_social      || null,
        numero_afiliado:  data.base.numero_afiliado  || null,
        tipo_trabajo_pami:data.base.tipo_trabajo_pami|| null,
        diferencia_pami:  data.base.diferencia_pami  || null,
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
    _ordenUltimaQuery = '';
    _renderOrdenStatus('idle');
    document.getElementById('pami-extra-fields')?.classList.add('hidden');
    ['f-num-afiliado','f-tipo-trabajo-pami','f-diferencia-pami'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
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
      if (!_clientesSugData.length) { sugEl.classList.add('hidden'); return; }
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
        .from('clientes').select('id,nombre,apellido,telefono,dni,obra_social').eq('id', id).single();
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
    if (osEl && cl.obra_social) {
      await _cargarObrasSocialesForm();
      osEl.value = cl.obra_social;
      onObraSocialChange(cl.obra_social);
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
    document.getElementById('pami-extra-fields')?.classList.add('hidden');
    ['f-num-afiliado','f-tipo-trabajo-pami','f-diferencia-pami'].forEach(id => {
      const campo = document.getElementById(id); if (campo) campo.value = '';
    });
    document.getElementById('cliente-seleccionado')?.classList.add('hidden');
    document.getElementById('cliente-suggestions')?.classList.add('hidden');
    document.getElementById('f-cliente')?.focus();
  }

  function crearClienteDesdeNuevo() {
    document.getElementById('cliente-suggestions')?.classList.add('hidden');
    if (typeof abrirFormCliente === 'function') abrirFormCliente();
  }

  // ── Render helpers para historial ─────────────────
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
    addObraSocial, deleteObraSocial, startEditOS, saveConfigOS,
    guardarEdicion, eliminarPedido, activarNotificaciones,
    togglePedidoRow, mesPrev, mesNext,
    _abrirDetalleRapido,
    onClienteInput, seleccionarCliente, crearClienteDesdeNuevo, limpiarClienteForm,
    initClienteSearch,
    onFotoSelected, clearFoto,
    abrirFotoViewer, cerrarFotoViewer,
    uploadFotoExistente, cambiarFoto, eliminarFotoConfirm,
    attachNumpadListeners,
    // Seguimiento / Kanban
    setLabFilter, onSegSearch, setSeguimientoFilter, toggleSegSection,
    _abrirKanbanDetalle, _abrirKanbanDetallePair, _cerrarKanbanDetalle,
    _moverKanbanCard, _moverKanbanPair,
    _onKanbanSearch, _clearKanbanSearch,
    _clearHistorialSearch,
    // Duplicados
    _cerrarModalDuplicado, _confirmarSinImportarDuplicado,
    // PAMI
    onObraSocialChange, loadPami, pamiMesPrev, pamiMesNext, _clearPamiSearch,
  };
})();

App.init();
