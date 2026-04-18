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
    const limite = LIMITES[pedido.laboratorio];
    if (!limite) return { texto: '—', clase: '', valor: 'ok' };
    const dias = calcDias(pedido);
    if (dias <= limite.ok)  return { texto: '✅ OK',       clase: 'est-ok',   valor: 'ok' };
    if (dias <= limite.dem) return { texto: '⚠️ Demorado', clase: 'est-dem',  valor: 'demorado' };
    return                         { texto: '🔴 Crítico',  clase: 'est-crit', valor: 'critico' };
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
      cliente:       d.cliente,
      cliente_id:    d.cliente_id || null,
      estado:        'Cristales pedidos a lab',
      orden:         d.orden,
      sufijo:        d.sufijo || null,
      tipo:          d.tipo,
      laboratorio:   d.laboratorio,
      urgente:       d.urgente,
      tipo_lente:    d.tipo_lente,
      tratamiento:   d.tratamiento   || null,
      graduacion:    d.graduacion    || null,
      dos_etapas:    d.dos_etapas    || 'No',
      armazon:       d.armazon       || null,
      observaciones: d.observaciones || null,
      cargado_por:   d.cargado_por,
      fecha_carga:   d.fecha_carga   || new Date().toISOString(),
      fecha_pedido:  d.fecha_pedido  || new Date().toISOString(),
      fecha_retiro:  null,
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
    // Timestamp para romper caché del browser
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
    // Extraer path del storage desde la URL pública
    const marker = '/pedidos-fotos/';
    const idx = row.foto_url.indexOf(marker);
    if (idx === -1) throw new Error('URL de foto inválida');
    const storagePath = decodeURIComponent(
      row.foto_url.slice(idx + marker.length).split('?')[0]
    );
    const { error: delErr } = await window.supabaseClient.storage
      .from('pedidos-fotos').remove([storagePath]);
    if (delErr) throw delErr;
    const { error } = await window.supabaseClient
      .from('pedidos').update({ foto_url: null }).eq('id', id);
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
