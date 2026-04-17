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

  const hoy = new Date();
  let _mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

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
      sig.id = 'numpad-siguiente';
      sig.type = 'button';
      sig.className = 'numpad-siguiente-btn hidden';
      sig.innerHTML = 'Siguiente <span class="np-sig-arrow">›</span>';
      ok.parentNode.insertBefore(sig, ok);
      sig.addEventListener('click', siguienteNumpad);
    }

    if (ok && !document.getElementById('numpad-ambos')) {
      const amb = document.createElement('button');
      amb.id = 'numpad-ambos';
      amb.type = 'button';
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
      if (next.classList.contains('grad-eje')) {
        next.focus();
        setTimeout(() => next.select(), 50);
      } else {
        const label = next.classList.contains('grad-esf') ? 'Esfera' : 'Cilindro';
        openNumpad(next, label);
      }
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

    const fechaEl = document.getElementById('f-fecha-carga'); if (fechaEl) fechaEl.value = todayStr();
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

    // ── Agenda sheets ─────────────────────────────
    document.getElementById('cliente-sheet-overlay')?.addEventListener('click', () => {
      if (typeof cerrarFichaCliente === 'function') cerrarFichaCliente();
    });
    document.getElementById('cliente-form-overlay')?.addEventListener('click', () => {
      if (typeof cerrarFormCliente === 'function') cerrarFormCliente();
    });

    initNumpad();
    await loadConfig();
    buildBloqueFields(1);
    buildBloqueFields(2);

    // Inicializar agenda
    if (typeof initAgenda === 'function') initAgenda();
    initClienteSearch();

    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 400);
    setTimeout(() => initPush(), 2000);

    showScreen('seguimiento');
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

  // ── HELPERS DE COLOR POR ESTADO ───────────────────
  function estadoRowClass(estado) {
    const map = {
      'Cristales pedidos a lab':      'ped-row--estado-cristales',
      'Armazón enviado p/calibrado':  'ped-row--estado-armazon',
      'En laboratorio':               'ped-row--estado-lab',
      'Pendiente de retirar':         'ped-row--estado-retirar',
      'Retirado':                     'ped-row--estado-retirado',
    };
    return map[estado] || '';
  }

  function calcDiasHabiles(fecha) {
    if (!fecha) return 0;
    const inicio = new Date(fecha);
    inicio.setHours(0, 0, 0, 0);
    const hoyDate = new Date();
    hoyDate.setHours(0, 0, 0, 0);
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
    'Cristales pedidos a lab':     { badgeCls: 'amarillo', icono: '⏳', label: 'CRISTALES PEDIDOS',   borderCls: 'amarillo' },
    'Armazón enviado p/calibrado': { badgeCls: 'indigo',   icono: '📦', label: 'ARMAZÓN EN TRÁNSITO', borderCls: 'indigo'   },
    'En laboratorio':              { badgeCls: 'azul',     icono: '🔵', label: 'EN LABORATORIO',      borderCls: 'azul'     },
    'Pendiente de retirar':        { badgeCls: 'verde',    icono: '✅', label: 'LISTO PARA RETIRAR',  borderCls: 'verde'    },
    'Retirado':                    { badgeCls: 'morado',   icono: '✔️', label: 'RETIRADO',            borderCls: 'morado'   },
  };

  function getCardConfig(p) {
    const dh = calcDiasHabiles(p.fecha_pedido || p.fecha_carga);
    const advertencia = dh >= 5 && p.estado !== 'Retirado';
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

  // ── SEGUIMIENTO ───────────────────────────────────
  async function loadSeguimiento() {
    try {
      const todos=await Pedidos.getPedidosActivos();
      _pedidosCache=todos;
      const enLab=todos.filter(p=>['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio'].includes(p.estado));
      const retirar=todos.filter(p=>p.estado==='Pendiente de retirar');
      document.getElementById('seg-count-lab').textContent=enLab.length;
      document.getElementById('seg-count-retirar').textContent=retirar.length;
      renderSegPanel('seg-content-lab',     enLab.sort(sortPorPrioridad),   true);
      renderSegPanel('seg-content-retirar', retirar.sort(sortPorPrioridad), false);
      updateBadge();
      if (typeof Panel !== 'undefined') Panel.renderLabCards(todos, 'seg-labs-cards');
      const criticos=todos.filter(p=>p._est.valor==='critico');
      const demorados=todos.filter(p=>p._est.valor==='demorado');
      if (criticos.length>0)  enviarNotificacion('🔴 Pedidos críticos — OLVISIÓN',`${criticos.length} pedido${criticos.length>1?'s':''} superó el tiempo límite`,true);
      else if (demorados.length>0) enviarNotificacion('⚠️ Demorados — OLVISIÓN',`${demorados.length} pedido${demorados.length>1?'s':''} demorado en laboratorio`,true);
    } catch(e){toast('Error: '+e.message,'error');}
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

  function renderCompactRow(p) {
    const sufijo    = p.sufijo ? `-${p.sufijo}` : '';
    const isOpen    = _expandedId === p.id;
    const cfg       = getCardConfig(p);
    const ESTADOS   = ['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
    const opts      = ESTADOS.map(e=>`<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');
    const scls      = Pedidos.claseEstado(p.estado);
    const fechaCorta = new Date(p.fecha_carga).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
    const daysBadge = cfg.advertencia ? `<span class="ped-warning-badge">⚠️ ${cfg.dh}dh</span>` : `<span class="ped-days-badge">${cfg.dh}dh</span>`;
    const urgenteBadge = p.urgente==='Si' ? '<span class="ped-urgente-chip">⚡ URGENTE</span>' : '';
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
          <div class="prd-item"><span class="prd-label">Cargado por</span><span class="prd-val">${esc(p.cargado_por||'—')}</span></div>
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
        </div>
      </div>
      ${detalle}
    </div>`;
  }

  function renderPairedRow(pA, pB) {
    const pairId   = `pair-${pA.orden}`;
    const isOpen   = _expandedId === pairId;
    const cfgA     = getCardConfig(pA);
    const cfgB     = getCardConfig(pB);
    const BORDER_PRIO = ['rojo','naranja','amarillo','indigo','azul','verde','teal','morado','gris'];
    const prioA = BORDER_PRIO.indexOf(cfgA.borderCls);
    const prioB = BORDER_PRIO.indexOf(cfgB.borderCls);
    const borderCls = BORDER_PRIO[Math.min(prioA < 0 ? 99 : prioA, prioB < 0 ? 99 : prioB)] || 'gris';
    const worstCfg = (prioA <= prioB ? prioA : prioB) === prioA ? cfgA : cfgB;
    const urgente  = pA.urgente==='Si' || pB.urgente==='Si';
    const dhMax    = Math.max(cfgA.dh, cfgB.dh);
    const advertencia = cfgA.advertencia || cfgB.advertencia;
    const fechaCorta  = new Date(pA.fecha_carga).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
    const ESTADOS  = ['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
    const daysBadge = advertencia ? `<span class="ped-warning-badge">⚠️ ${dhMax}dh</span>` : `<span class="ped-days-badge">${dhMax}dh</span>`;
    const subRow = (p, color) => {
      const opts = ESTADOS.map(e=>`<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');
      const scls = Pedidos.claseEstado(p.estado);
      const pcfg = getCardConfig(p);
      return `<div class="ped-pair-sub ped-pair-sub--${color}">
        <div class="ped-pair-header">
          <span class="ped-pair-badge ped-pair-badge--${color}">${p.sufijo}</span>
          <span class="ped-status-badge badge--${pcfg.badgeCls}" style="font-size:.6rem;padding:2px 8px">${pcfg.icono} ${pcfg.label}</span>
          ${p.laboratorio?`<span class="ped-row-lab">${esc(p.laboratorio)}</span>`:''}
          <span class="ped-pair-spacer"></span>
          ${pcfg.advertencia?`<span class="ped-warning-badge">⚠️ ${pcfg.dh}dh</span>`:`<span class="ped-days-badge">${pcfg.dh}dh</span>`}
        </div>
        ${p.graduacion?`<div class="ped-pair-grad">${esc(p.graduacion).replace(/\|/g,' | ')}</div>`:''}
        ${p.observaciones?`<div class="ped-pair-obs">💬 ${esc(p.observaciones)}</div>`:''}
        <div class="ped-pair-actions">
          <select class="estado-select ${scls} estado-select-inline" data-id="${p.id}" data-prev="${esc(p.estado)}" onclick="event.stopPropagation()">${opts}</select>
          ${Auth.isAdmin()?`<button class="ped-row-edit-btn" onclick="event.stopPropagation();App._abrirDetalleRapido(${p.id})">✏️</button>`:''}
          ${Auth.isAdmin()?`<button class="ped-row-del-btn" onclick="event.stopPropagation();App.eliminarPedido(${p.id})">🗑️</button>`:''}
        </div>
      </div>`;
    };
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
        <div class="ped-card-meta"><span class="ped-card-orden">#${esc(pA.orden)}</span><span class="meta-dot">·</span><span>${fechaCorta}</span></div>
      </div>
      <div class="ped-row-detail ${isOpen?'':'hidden'}" onclick="event.stopPropagation()">
        ${subRow(pA,'azul')}${subRow(pB,'teal')}
      </div>
    </div>`;
  }

  function renderSegPanel(id, pedidos, conGrupos=false) {
    const el = document.getElementById(id); if (!el) return;
    if (!pedidos.length) {
      el.innerHTML=`<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><h3>Sin pedidos</h3><p>No hay pedidos en este estado</p></div>`;
      return;
    }
    const groups = groupPedidos(pedidos);
    if (!conGrupos) {
      el.innerHTML=`<div class="ped-compact-list">${groups.map(g=>g.type==='pair'?renderPairedRow(g.a,g.b):renderCompactRow(g.p)).join('')}</div>`;
      attachInlineSelects(el); return;
    }
    const CATS = [
      { key:'advertencia', label:'⚠️ Requieren atención', color:'#DC2626' },
      { key:'espera',      label:'⏳ En espera',           color:'#D97706' },
      { key:'lab',         label:'🔵 En laboratorio',      color:'#034291' },
      { key:'listo',       label:'✅ Listos para retirar', color:'#16A34A' },
      { key:'retirado',    label:'✔ Retirados',            color:'#9CA3AF' },
    ];
    const buckets = {};
    CATS.forEach(c => { buckets[c.key] = []; });
    groups.forEach(g => {
      const p = g.type==='pair' ? g.a : g.p;
      const key = getCategoryKey(p);
      if (buckets[key]) buckets[key].push(g);
    });
    let html = '<div class="ped-compact-list">';
    CATS.forEach(cat => {
      const items = buckets[cat.key]; if (!items.length) return;
      html += `<div class="ped-group-header"><span class="ped-group-dot" style="background:${cat.color}"></span><span>${cat.label}</span><span class="ped-group-count">${items.length}</span></div>`;
      html += items.map(g => g.type==='pair' ? renderPairedRow(g.a,g.b) : renderCompactRow(g.p)).join('');
    });
    html += '</div>';
    el.innerHTML = html;
    attachInlineSelects(el);
  }

  function switchSegTab(tab) {
    _segTab=tab;
    document.querySelectorAll('.seg-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
    document.getElementById('seg-content-lab').classList.toggle('hidden',tab!=='lab');
    document.getElementById('seg-content-retirar').classList.toggle('hidden',tab!=='retirar');
  }

  // ── HISTORIAL ────────────────────────────────────
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
    container.querySelectorAll('.estado-select-inline').forEach(sel=>{
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
          if (_currentScreen==='seguimiento') loadSeguimiento();
          updateBadge();
        } catch(err){
          toast(`Error: ${err.message}`,'error');
          e.target.value=prev;
          e.target.className=`estado-select ${Pedidos.claseEstado(prev)} estado-select-inline`;
        }
      });
    });
  }

  // ── Detalle / Edición ─────────────────────────────
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
      const labs=_configCache.laboratorios.map(l=>`<option value="${esc(l)}"${l===p.laboratorio?' selected':''}>${esc(l)}</option>`).join('');
      const lentes=['Monofocal','Bifocal','Ocupacional','Progresivo','Teñido'].map(l=>`<option value="${l}"${l===p.tipo_lente?' selected':''}>${l}</option>`).join('');
      const tipos=['Cristales','Armazón + Cristales','Armazón'].map(t=>`<option value="${t}"${t===p.tipo?' selected':''}>${t}</option>`).join('');
      const urgentes=['Si','No'].map(u=>`<option value="${u}"${u===p.urgente?' selected':''}>${u==='Si'?'Sí':'No'}</option>`).join('');
      const etapas=['No','Si'].map(u=>`<option value="${u}"${u===p.dos_etapas?' selected':''}>${u==='Si'?'Sí':'No'}</option>`).join('');
      const ESTADOS=['Cristales pedidos a lab','Armazón enviado p/calibrado','En laboratorio','Pendiente de retirar','Retirado'];
      const estados=ESTADOS.map(e=>`<option value="${e}"${e===p.estado?' selected':''}>${e}</option>`).join('');
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

  // ── PANEL ─────────────────────────────────────────
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
    renderConfigLabs();
    renderConfigMarcas();
    renderConfigMateriales();
    loadConfigTratamientos();
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

  async function handleFormSubmit(e) {
    e.preventDefault();
    const data=getFormData();
    if (!validateForm(data)){toast('Completá los campos obligatorios','warn');return;}
    const rf=(label,val)=>val?`<div class="modal-row"><span class="modal-label">${label}</span><span class="modal-value">${esc(String(val))}</span></div>`:'';
    let html=rf('Cliente',data.base.cliente)+rf('Orden',data.doble?`${data.base.orden}-A / -B`:data.base.orden)+rf('Tipo',data.base.tipo)+rf('Urgente',data.base.urgente)+rf('Fecha',data.base.fecha_carga);
    if(data.doble){
      html+=`<div style="margin:10px 0 4px;font-size:.78rem;font-weight:700;color:var(--azul)">ANTEOJO A</div>`;
      html+=rf('Lab',data.ant1.laboratorio)+rf('Lente',data.ant1.tipo_lente)+rf('Tratamiento',data.ant1.tratamiento)+rf('Graduación',data.ant1.graduacion)+rf('Armazón',data.ant1.armazon)+rf('Obs.',data.ant1.observaciones);
      html+=`<div style="margin:10px 0 4px;font-size:.78rem;font-weight:700;color:var(--azul)">ANTEOJO B</div>`;
      html+=rf('Lab',data.ant2.laboratorio)+rf('Lente',data.ant2.tipo_lente)+rf('Tratamiento',data.ant2.tratamiento)+rf('Graduación',data.ant2.graduacion)+rf('Armazón',data.ant2.armazon)+rf('Obs.',data.ant2.observaciones);
    } else {
      html+=rf('Laboratorio',data.ant1.laboratorio)+rf('Lente',data.ant1.tipo_lente)+rf('Tratamiento',data.ant1.tratamiento)+rf('Graduación',data.ant1.graduacion)+rf('Armazón',data.ant1.armazon)+rf('Obs.',data.ant1.observaciones);
    }
    document.getElementById('modal-body-content').innerHTML=html;
    _pendingGuardar=data;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }

  async function handleConfirm() {
    if (!_pendingGuardar) return;
    const data=_pendingGuardar, btn=document.getElementById('modal-confirm-btn');
    btn.classList.add('btn-loading'); btn.disabled=true;
    try {
      const nombre=Auth.getNombre(), fechaISO=new Date(data.base.fecha_carga+'T12:00:00').toISOString();
      // Si no hay cliente_id, crear cliente nuevo en la agenda
      let clienteId = data.base.cliente_id;
      if (!clienteId && data.base.cliente) {
        try {
          const { data: nuevo } = await window.supabaseClient.from('clientes').insert([{
            nombre:      data.base.cliente.includes(',') ? data.base.cliente.split(',')[1].trim() : data.base.cliente,
            apellido:    data.base.cliente.includes(',') ? data.base.cliente.split(',')[0].trim() : '',
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
        cargado_por:nombre, fecha_carga:fechaISO, fecha_pedido:fechaISO,
      });
      const rows=data.doble?[buildRow(data.ant1,'A'),buildRow(data.ant2,'B')]:[buildRow(data.ant1,null)];
      await Pedidos.crearPedido(rows);
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
    [1,2].forEach(n=>{ try{setDistancia(n,'lejos');}catch{} document.getElementById(`f-armazon-nuevo${n}`)?.classList.add('hidden'); document.getElementById(`f-armazon-cliente${n}`)?.classList.add('hidden'); });
    _pendingGuardar=null;
    // Limpiar cliente vinculado
    if (typeof limpiarClienteForm === 'function') limpiarClienteForm();
    else {
      document.getElementById('campo-cliente-id') && (document.getElementById('campo-cliente-id').value='');
      document.getElementById('cliente-seleccionado')?.classList.add('hidden');
    }
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

  // ── CLIENTE AUTOCOMPLETE (agenda) ─────────────────
  let _clienteSearchTimer = null;
  let _obrasSocialesCache = [];
  let _clientesSugData = [];

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
        sugEl.innerHTML = `<div class="sug-item sug-nuevo" onclick="App.crearClienteDesdeNuevo()">+ Crear cliente nuevo</div>`;
        sugEl.classList.remove('hidden'); return;
      }
      sugEl.innerHTML = _clientesSugData.map(cl => {
        const det = [cl.telefono?`📱 ${cl.telefono}`:'', cl.obra_social||''].filter(Boolean).join(' · ');
        return `<div class="sug-item" onclick="App.seleccionarCliente(${cl.id})">
          <div><div style="font-weight:600">${esc(cl.apellido)}, ${esc(cl.nombre)}</div>
          ${det?`<div style="font-size:.78rem;color:var(--gris-texto);margin-top:2px">${det}</div>`:''}</div>
        </div>`;
      }).join('') + `<div class="sug-item sug-nuevo" onclick="App.crearClienteDesdeNuevo()">+ Crear cliente nuevo</div>`;
      sugEl.classList.remove('hidden');
    }, 280);
  }

  function seleccionarCliente(id) {
    const cl = _clientesSugData.find(x => x.id === id);
    if (!cl) return;
    const nombre = `${cl.apellido}, ${cl.nombre}`;
    document.getElementById('f-cliente').value = nombre;
    document.getElementById('campo-cliente-id').value = cl.id;
    if (cl.telefono) document.getElementById('f-cliente-cel') && (document.getElementById('f-cliente-cel').value = cl.telefono);
    if (cl.dni)      document.getElementById('f-cliente-dni') && (document.getElementById('f-cliente-dni').value = cl.dni);
    if (cl.obra_social) { const sel=document.getElementById('f-cliente-os'); if(sel) sel.value=cl.obra_social; }
    document.getElementById('cliente-chip-nombre').textContent = nombre;
    const det = document.getElementById('cliente-chip-detalle');
    if (det) det.textContent = [cl.telefono?'📱 '+cl.telefono:'', cl.obra_social].filter(Boolean).join(' · ');
    document.getElementById('cliente-seleccionado')?.classList.remove('hidden');
    document.getElementById('cliente-suggestions')?.classList.add('hidden');
  }

  function limpiarClienteForm() {
    ['f-cliente','f-cliente-cel','f-cliente-dni'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value='';
    });
    document.getElementById('campo-cliente-id').value = '';
    const sel = document.getElementById('f-cliente-os'); if(sel) sel.value='';
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
  };
})();

App.init();
