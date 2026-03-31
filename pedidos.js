// ===================================================
//  OLVISIÓN — pedidos.js
//  CRUD de pedidos + estado inteligente
// ===================================================

const Pedidos = (() => {

  // ── Estado inteligente ────────────────────────────
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

  // ── Obtener pedidos ───────────────────────────────
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

  // ── Verificar duplicado ───────────────────────────
  async function existeOrden(orden, sufijo, excludeId = null) {
    let q = window.supabaseClient.from('pedidos').select('id').eq('orden', orden);
    if (sufijo) q = q.eq('sufijo', sufijo);
    else q = q.is('sufijo', null);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw error;
    return data && data.length > 0;
  }

  // ── Crear pedido(s) ───────────────────────────────
  async function crearPedido(datosArray) {
    for (const d of datosArray) {
      const existe = await existeOrden(d.orden, d.sufijo);
      if (existe) {
        const sufStr = d.sufijo ? ` (${d.sufijo})` : '';
        throw new Error(`Ya existe un pedido con el número de orden ${d.orden}${sufStr}.`);
      }
    }
    const rows = datosArray.map(d => ({
      cliente:      d.cliente,
      estado:       'Pedido a laboratorio',
      orden:        d.orden,
      sufijo:       d.sufijo || null,
      tipo:         d.tipo,
      laboratorio:  d.laboratorio,
      urgente:      d.urgente,
      tipo_lente:   d.tipo_lente,
      tratamiento:  d.tratamiento  || null,
      graduacion:   d.graduacion   || null,
      dos_etapas:   d.dos_etapas   || 'No',
      armazon:      d.armazon      || null,
      cargado_por:  d.cargado_por,
      fecha_pedido: new Date().toISOString(),
      fecha_retiro: null,
    }));
    const { data, error } = await window.supabaseClient.from('pedidos').insert(rows).select();
    if (error) throw error;
    return data;
  }

  // ── Actualizar pedido completo ────────────────────
  async function actualizarPedido(id, campos) {
    // Si cambia la orden, verificar que no duplique
    if (campos.orden !== undefined) {
      const existe = await existeOrden(campos.orden, campos.sufijo, id);
      if (existe) throw new Error(`Ya existe un pedido con el número de orden ${campos.orden}.`);
    }
    const { error } = await window.supabaseClient
      .from('pedidos').update(campos).eq('id', id);
    if (error) throw error;
  }

  // ── Actualizar estado ─────────────────────────────
  async function actualizarEstado(id, nuevoEstado) {
    const updates = { estado: nuevoEstado };
    if (nuevoEstado === 'Retirado') updates.fecha_retiro = new Date().toISOString();
    const { error } = await window.supabaseClient.from('pedidos').update(updates).eq('id', id);
    if (error) throw error;
  }

  // ── Helpers ───────────────────────────────────────
  function claseEstado(estado) {
    const map = {
      'Pedido a laboratorio': 'estado-pedido',
      'En laboratorio':       'estado-lab',
      'Pendiente de retirar': 'estado-retirar',
      'Retirado':             'estado-retirado',
    };
    return map[estado] || '';
  }

  return {
    getPedidosActivos, getTodosPedidos, getPedidoById,
    crearPedido, actualizarPedido, actualizarEstado,
    calcEstInteligente, calcDias, enrich, claseEstado,
  };
})();
