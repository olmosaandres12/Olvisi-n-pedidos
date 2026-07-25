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

    const rows = datosArray.map(d => {
      const row = {
        cliente:         d.cliente,
        cliente_id:      d.cliente_id      || null,
        estado:          'Cristales pedidos a lab',
        orden:           d.orden,
        sufijo:          d.sufijo          || null,
        tipo:            d.tipo,
        laboratorio:     d.laboratorio,
        urgente:         d.urgente,
        tipo_lente:      d.tipo_lente,
        tratamiento:     d.tratamiento     || null,
        graduacion:      d.graduacion      || null,
        dos_etapas:      d.dos_etapas      || 'No',
        armazon:         d.armazon         || null,
        observaciones:   d.observaciones   || null,
        cargado_por:     d.cargado_por,
        fecha_carga:     d.fecha_carga     || new Date().toISOString(),
        fecha_pedido:    d.fecha_pedido    || new Date().toISOString(),
        fecha_prometida: d.fecha_prometida || null,
        fecha_retiro:    null,
        codigo_seguimiento: d.codigo_seguimiento || null,
      };

      // Campos PAMI: solo se incluyen si el pedido tiene obra social PAMI
      // Esto evita errores si las columnas aún no existen en la DB
      if (d.obra_social) {
        row.obra_social       = d.obra_social;
        row.numero_afiliado   = d.numero_afiliado   || null;
        row.tipo_trabajo_pami = d.tipo_trabajo_pami || null;
        row.diferencia_pami   = d.diferencia_pami   || null;
      }

      return row;
    });

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

  async function actualizarEstado(id, nuevoEstado, usuario) {
    const { data: actual } = await window.supabaseClient
      .from('pedidos').select('estado').eq('id', id).maybeSingle();
    const updates = { estado: nuevoEstado };
    if (nuevoEstado === 'Retirado') updates.fecha_retiro = new Date().toISOString();
    const { error } = await window.supabaseClient.from('pedidos').update(updates).eq('id', id);
    if (error) throw error;
    registrarCambioEstado(id, actual?.estado || null, nuevoEstado, usuario);
  }

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

  // ── Reseñas de Google ──────────────────────────────
  async function getPedidosParaResenar() {
    const desde = new Date(); desde.setDate(desde.getDate() - 7); desde.setHours(0,0,0,0);
    const hasta = new Date(); hasta.setDate(hasta.getDate() - 5); hasta.setHours(23,59,59,999);
    const { data, error } = await window.supabaseClient
      .from('pedidos').select('*')
      .eq('estado', 'Retirado')
      .gte('fecha_retiro', desde.toISOString())
      .lte('fecha_retiro', hasta.toISOString())
      .or('resena_solicitada.is.null,resena_solicitada.eq.false')
      .order('fecha_retiro', { ascending: true });
    if (error) throw error;
    return data;
  }

  async function marcarResenaSolicitada(orden) {
    const { error } = await window.supabaseClient
      .from('pedidos').update({ resena_solicitada: true }).eq('orden', orden);
    if (error) throw error;
  }

  // ── Postventa: historial de estados ────────────────
  async function registrarCambioEstado(pedidoId, estadoAnterior, estadoNuevo, usuario) {
    try {
      await window.supabaseClient.from('pedidos_historial_estados').insert({
        pedido_id: pedidoId,
        estado_anterior: estadoAnterior || null,
        estado_nuevo: estadoNuevo,
        usuario: usuario || null,
      });
    } catch (e) { console.warn('No se pudo registrar historial de estado:', e); }
  }

  // ── Postventa: comunicaciones (WhatsApp) ───────────
  async function registrarComunicacion(pedidoId, orden, tipo, enviado, usuario) {
    try {
      await window.supabaseClient.from('pedidos_comunicaciones').insert({
        pedido_id: pedidoId,
        orden: orden != null ? String(orden) : null,
        tipo, enviado,
        usuario: usuario || null,
      });
    } catch (e) { console.warn('No se pudo registrar comunicación:', e); }
  }

  async function getHistorialCompleto(pedidoId) {
    const [estadosRes, comsRes] = await Promise.all([
      window.supabaseClient.from('pedidos_historial_estados').select('*').eq('pedido_id', pedidoId).order('fecha_hora', { ascending: true }),
      window.supabaseClient.from('pedidos_comunicaciones').select('*').eq('pedido_id', pedidoId).order('fecha_hora', { ascending: true }),
    ]);
    return { estados: estadosRes.data || [], comunicaciones: comsRes.data || [] };
  }

  // ── Postventa: resultado de reseña y satisfacción ──
  async function actualizarResenaResultado(orden, resultado) {
    const { error } = await window.supabaseClient
      .from('pedidos').update({ resena_resultado: resultado }).eq('orden', orden);
    if (error) throw error;
  }

  async function actualizarPostventa(id, campos) {
    const { error } = await window.supabaseClient.from('pedidos').update(campos).eq('id', id);
    if (error) throw error;
  }

  // ── Postventa: KPIs mensuales ───────────────────────
  async function getKPIsPostventa(mesInicio, mesFin) {
    const { data: retirados, error } = await window.supabaseClient
      .from('pedidos')
      .select('id, orden, fecha_pedido, fecha_carga, fecha_retiro, resena_solicitada, resena_resultado')
      .eq('estado', 'Retirado')
      .gte('fecha_retiro', mesInicio.toISOString())
      .lt('fecha_retiro', mesFin.toISOString());
    if (error) throw error;

    const tiemposEntrega = retirados
      .map(p => (new Date(p.fecha_retiro) - new Date(p.fecha_pedido || p.fecha_carga)) / (1000*60*60*24))
      .filter(n => n >= 0);
    const promEntrega = tiemposEntrega.length ? (tiemposEntrega.reduce((a,b)=>a+b,0) / tiemposEntrega.length) : null;

    let promRetiroPostAviso = null;
    const ids = retirados.map(p => p.id);
    if (ids.length) {
      const { data: historial } = await window.supabaseClient
        .from('pedidos_historial_estados').select('pedido_id, fecha_hora')
        .in('pedido_id', ids).eq('estado_nuevo', 'Pendiente de retirar')
        .order('fecha_hora', { ascending: true });
      const avisoPorPedido = {};
      (historial || []).forEach(h => { if (!avisoPorPedido[h.pedido_id]) avisoPorPedido[h.pedido_id] = h.fecha_hora; });
      const tiemposRetiro = retirados
        .filter(p => avisoPorPedido[p.id])
        .map(p => (new Date(p.fecha_retiro) - new Date(avisoPorPedido[p.id])) / (1000*60*60*24))
        .filter(n => n >= 0);
      if (tiemposRetiro.length) promRetiroPostAviso = tiemposRetiro.reduce((a,b)=>a+b,0) / tiemposRetiro.length;
    }

    const solicitados = retirados.filter(p => p.resena_solicitada);
    const obtenidas    = solicitados.filter(p => p.resena_resultado === 'obtenida');
    const conversion   = solicitados.length ? (obtenidas.length / solicitados.length) * 100 : null;

    return {
      totalRetirados: retirados.length,
      promEntrega, promRetiroPostAviso,
      solicitadas: solicitados.length, obtenidas: obtenidas.length, conversion,
    };
  }

  return {
    getPedidosActivos, getTodosPedidos, getPedidoById,
    crearPedido, actualizarPedido, actualizarEstado,
    calcEstInteligente, calcDias, enrich, claseEstado,
    uploadFoto, eliminarFoto,
    getPedidosParaResenar, marcarResenaSolicitada,
    registrarCambioEstado, registrarComunicacion, getHistorialCompleto,
    actualizarResenaResultado, actualizarPostventa, getKPIsPostventa,
  };
})();
