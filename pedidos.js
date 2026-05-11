// ===================================================
//  OLVISIÓN — pedidos.js
//  CRUD de pedidos + estado inteligente
// ===================================================

const Pedidos = (() => {

  const LIMITES = {
    'Bichara':  { ok: 2, dem: 4 },
    'Sol':      { ok: 5, dem: 7 },
    'Vitolen':  { ok: 5, dem: 7 },
    'Cristian': { ok: 7, dem: 10 },
  };

  function calcDias(pedido) {
    const desde = new Date(pedido.fecha_pedido);
    const hasta = pedido.fecha_retiro ? new Date(pedido.fecha_retiro) : new Date();
    return Math.max(0, Math.floor((hasta - desde) / (1000 * 60 * 60 * 24)));
  }

  function calcEstInteligente(pedido) {
    if (pedido.estado === 'Retirado') return { texto: '✅ OK', clase: 'est-ok', valor: 'ok' };
    if (pedido.fecha_prometida) {
      const hoy  = new Date(); hoy.setHours(0,0,0,0);
      const prom = new Date(pedido.fecha_prometida + 'T00:00:00');
      const atraso = Math.floor((hoy - prom) / (1000*60*60*24));
      if (atraso <= 0) return { texto: '✅ En plazo',  clase: 'est-ok',   valor: 'ok'       };
      if (atraso <= 1) return { texto: '⚠️ Demorado',  clase: 'est-dem',  valor: 'demorado' };
      return                  { texto: '🔴 Crítico',   clase: 'est-crit', valor: 'critico'   };
    }
    const limite = LIMITES[pedido.laboratorio];
    if (!limite) return { texto: '—', clase: '', valor: 'ok' };
    const dias = calcDias(pedido);
    if (dias <= limite.ok)  return { texto: '✅ OK',       clase: 'est-ok',   valor: 'ok'       };
    if (dias <= limite.dem) return { texto: '⚠️ Demorado', clase: 'est-dem',  valor: 'demorado' };
    return                         { texto: '🔴 Crítico',  clase: 'est-crit', valor: 'critico'   };
  }

  function enrich(p) {
    return { ...p, _dias: calcDias(p), _est: calcEstInteligente(p) };
  }

  async function getPedidosActivos() {
    const { data, error } = await window.supabaseClient
      .from('pedidos').select('*').neq('estado', 'Retirado')
      .order('fecha_carga', { ascending: false });
    if (error) throw error;
    return data.map(enrich);
  }

  async function getTodosPedidos() {
    const { data, error } = await window.supabaseClient
      .from('pedidos').select('*').order('fecha_carga', { ascending: false });
    if (error) throw error;
    return data.map(enrich);
  }

  async function getPedidoById(id) {
    const { data, error } = await window.supabaseClient
      .from('pedidos').select('*').eq('id', id).single();
    if (error) throw error;
    return enrich(data);
  }

  async function existeOrden(orden, sufijo, excludeId = null) {
    let q = window.supabaseClient.from('pedidos').select('id').eq('orden', orden);
    if (sufijo) q = q.eq('sufijo', sufijo);
    else q = q.is('sufijo', null);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw error;
    return data && data.length > 0;
  }

  async function crearPedido(datosArray) {
    for (const d of datosArray) {
      const existe = await existeOrden(d.orden, d.sufijo);
      if (existe) {
        const sufStr = d.sufijo ? ` (${d.sufijo})` : '';
        throw new Error(`Ya existe un pedido con el número de orden ${d.orden}${sufStr}.`);
      }
    }
    const rows = datosArray.map(d => ({
      cliente:           d.cliente,
      cliente_id:        d.cliente_id        || null,
      estado:            'Cristales pedidos a lab',
      orden:             d.orden,
      sufijo:            d.sufijo            || null,
      tipo:              d.tipo,
      laboratorio:       d.laboratorio,
      urgente:           d.urgente,
      tipo_lente:        d.tipo_lente,
      tratamiento:       d.tratamiento       || null,
      graduacion:        d.graduacion        || null,
      dos_etapas:        d.dos_etapas        || 'No',
      armazon:           d.armazon           || null,
      observaciones:     d.observaciones     || null,
      cargado_por:       d.cargado_por,
      fecha_carga:       d.fecha_carga       || new Date().toISOString(),
      fecha_pedido:      d.fecha_pedido      || new Date().toISOString(),
      fecha_prometida:   d.fecha_prometida   || null,
      fecha_retiro:      null,
      // Obra social y datos PAMI
      obra_social:       d.obra_social       || null,
      numero_afiliado:   d.numero_afiliado   || null,
      tipo_trabajo_pami: d.tipo_trabajo_pami || null,
      diferencia_pami:   d.diferencia_pami   || null,
    }));
    const { data, error } = await window.supabaseClient.from('pedidos').insert(rows).select();
    if (error) throw error;
    return data;
  }

  async function actualizarPedido(id, campos) {
    if (campos.orden !== undefined) {
      const existe = await existeOrden(campos.orden, campos.sufijo, id);
      if (existe) throw new Error(`Ya existe un pedido con el número de orden ${campos.orden}.`);
    }
    const { error } = await window.supabaseClient.from('pedidos').update(campos).eq('id', id);
    if (error) throw error;
  }

  async function actualizarEstado(id, nuevoEstado) {
    const updates = { estado: nuevoEstado };
    if (nuevoEstado === 'Retirado') updates.fecha_retiro = new Date().toISOString();
    const { error } = await window.supabaseClient.from('pedidos').update(updates).eq('id', id);
    if (error) throw error;
  }

  // ── FOTO ADJUNTA ──────────────────────────────────

  async function uploadFoto(id, file) {
    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${id}/foto.${ext}`;
    const { error: upErr } = await window.supabaseClient.storage
      .from('pedidos-fotos')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) throw upErr;
    const { data: urlData } = window.supabaseClient.storage
      .from('pedidos-fotos').getPublicUrl(path);
    const fotoUrl = urlData.publicUrl + '?t=' + Date.now();
    const { error } = await window.supabaseClient
      .from('pedidos').update({ foto_url: fotoUrl }).eq('id', id);
    if (error) throw error;
    return fotoUrl;
  }

  async function eliminarFoto(id) {
    const { data: row, error: fetchErr } = await window.supabaseClient
      .from('pedidos').select('foto_url').eq('id', id).single();
    if (fetchErr) throw fetchErr;
    if (!row?.foto_url) return;
    const marker = '/pedidos-fotos/';
    const idx = row.foto_url.indexOf(marker);
    if (idx === -1) throw new Error('URL de foto inválida');
    const storagePath = decodeURIComponent(row.foto_url.slice(idx + marker.length).split('?')[0]);
    const { error: delErr } = await window.supabaseClient.storage.from('pedidos-fotos').remove([storagePath]);
    if (delErr) throw delErr;
    const { error } = await window.supabaseClient.from('pedidos').update({ foto_url: null }).eq('id', id);
    if (error) throw error;
  }

  // ─────────────────────────────────────────────────

  function claseEstado(estado) {
    const map = {
      'Cristales pedidos a lab':     'estado-pedido',
      'Armazón enviado p/calibrado': 'estado-pedido',
      'En laboratorio':              'estado-lab',
      'Pendiente de retirar':        'estado-retirar',
      'Retirado':                    'estado-retirado',
    };
    return map[estado] || '';
  }

  return {
    getPedidosActivos, getTodosPedidos, getPedidoById,
    crearPedido, actualizarPedido, actualizarEstado,
    calcEstInteligente, calcDias, enrich, claseEstado,
    uploadFoto, eliminarFoto,
  };
})();
/* ══════════════════════════════════════════════════
   PAMI — campos en formulario y pantalla historial
   ══════════════════════════════════════════════════ */

.pami-fields {
  background: #F0F7FF;
  border: 1.5px solid #BFD4F5;
  border-radius: var(--radius-sm);
  padding: 14px 14px 6px;
  margin-top: 10px;
  margin-bottom: 4px;
  animation: expandDown .2s ease;
}
.pami-fields-title {
  font-size: .78rem;
  font-weight: 700;
  color: var(--azul);
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: 12px;
}
.pami-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.pami-stat-card {
  background: var(--blanco);
  border: 1.5px solid var(--gris-borde);
  border-radius: var(--radius);
  padding: 14px 10px 12px;
  text-align: center;
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}
.pami-stat-card::before { content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--azul); }
.pami-stat-card--green::before { background: var(--verde); }
.pami-stat-card--amber::before { background: #D97706; }
.pami-stat-val { font-size:1.8rem;font-weight:800;color:var(--azul);line-height:1;letter-spacing:-1px;margin-bottom:4px; }
.pami-stat-card--green .pami-stat-val { color: var(--verde); }
.pami-stat-card--amber .pami-stat-val { color: #D97706; }
.pami-stat-lbl { font-size:.65rem;font-weight:600;color:var(--gris-texto);text-transform:uppercase;letter-spacing:.05em;line-height:1.3; }
.pami-list-container { display:flex;flex-direction:column;border-radius:var(--radius);border:1.5px solid var(--gris-borde);overflow:hidden;box-shadow:var(--shadow-sm);background:var(--blanco); }
.pami-row { display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--gris-bg);border-left:4px solid var(--azul);gap:10px; }
.pami-row:last-child { border-bottom: none; }
.pami-row-left { flex:1;min-width:0; }
.pami-row-cliente { font-size:.95rem;font-weight:600;color:var(--gris-dark);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.pami-row-meta { display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px; }
.pami-row-orden { font-family:var(--font-mono);font-size:.78rem;font-weight:700;color:var(--azul); }
.pami-afiliado { font-size:.75rem;color:var(--gris-texto);background:var(--gris-bg);padding:2px 7px;border-radius:8px; }
.pami-row-fecha { font-size:.75rem;color:var(--gris-texto); }
.pami-retirado-ic { font-size:.8rem;opacity:.7; }
.pami-row-badges { display:flex;gap:6px;flex-wrap:wrap;align-items:center; }
.pami-tipo-badge { font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:10px;background:var(--azul-light);color:var(--azul);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap; }
.pami-dif-badge { font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap; }
.pami-dif-badge--green { background:#DCFCE7;color:#166534; }
.pami-dif-badge--amber { background:#FEF3C7;color:#92400E; }
