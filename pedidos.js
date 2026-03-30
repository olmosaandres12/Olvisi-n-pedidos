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
    const ms    = hasta - desde;
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  }

  function calcEstInteligente(pedido) {
    // Solo aplica a pedidos que están en laboratorio (no retirados)
    if (pedido.estado === 'Retirado') return { texto: '✅ OK', clase: 'est-ok', valor: 'ok' };

    const lab    = pedido.laboratorio;
    const limite = LIMITES[lab];
    if (!limite) return { texto: '—', clase: '', valor: 'ok' };

    const dias = calcDias(pedido);
    if (dias <= limite.ok)  return { texto: '✅ OK',       clase: 'est-ok',   valor: 'ok' };
    if (dias <= limite.dem) return { texto: '⚠️ Demorado', clase: 'est-dem',  valor: 'demorado' };
    return                         { texto: '🔴 Crítico',  clase: 'est-crit', valor: 'critico' };
  }

  // ── Obtener pedidos activos ───────────────────────
  async function getPedidosActivos() {
    const { data, error } = await window.supabaseClient
      .from('pedidos')
      .select('*')
      .neq('estado', 'Retirado')
      .order('fecha_carga', { ascending: false });

    if (error) throw error;

    return data.map(enrich);
  }

  // ── Obtener TODOS los pedidos (para panel admin) ──
  async function getTodosPedidos() {
    const { data, error } = await window.supabaseClient
      .from('pedidos')
      .select('*')
      .order('fecha_carga', { ascending: false });

    if (error) throw error;

    return data.map(enrich);
  }

  // ── Enrichment con campos calculados ─────────────
  function enrich(p) {
    const dias = calcDias(p);
    const est  = calcEstInteligente(p);
    return { ...p, _dias: dias, _est: est };
  }

  // ── Verificar duplicado de orden+sufijo ───────────
  async function existeOrden(orden, sufijo) {
    const q = window.supabaseClient
      .from('pedidos')
      .select('id')
      .eq('orden', orden);

    if (sufijo) {
      q.eq('sufijo', sufijo);
    } else {
      q.is('sufijo', null);
    }

    const { data, error } = await q;
    if (error) throw error;
    return data && data.length > 0;
  }

  // ── Crear pedido(s) ───────────────────────────────
  async function crearPedido(datosArray) {
    // datosArray: [{...}, ...] — puede ser 1 o 2 pedidos
    for (const d of datosArray) {
      const existe = await existeOrden(d.orden, d.sufijo);
      if (existe) {
        const sufStr = d.sufijo ? ` (${d.sufijo})` : '';
        throw new Error(`Ya existe un pedido con el número de orden ${d.orden}${sufStr}.`);
      }
    }

    const rows = datosArray.map(d => ({
      cliente:       d.cliente,
      estado:        'Pedido a laboratorio',
      orden:         d.orden,
      sufijo:        d.sufijo || null,
      tipo:          d.tipo,
      laboratorio:   d.laboratorio,
      urgente:       d.urgente,
      tipo_lente:    d.tipo_lente,
      tratamiento:   d.tratamiento   || null,
      graduacion:    buildGraduacion(d.grad_od, d.grad_oi),
      dos_etapas:    d.dos_etapas    || 'No',
      armazon:       buildArmazon(d),
      cargado_por:   d.cargado_por,
      fecha_pedido:  new Date().toISOString(),
      fecha_retiro:  null,
    }));

    const { data, error } = await window.supabaseClient
      .from('pedidos')
      .insert(rows)
      .select();

    if (error) throw error;
    return data;
  }

  function buildGraduacion(od, oi) {
    if (!od && !oi) return null;
    const parts = [];
    if (od) parts.push(`OD: ${od}`);
    if (oi) parts.push(`OI: ${oi}`);
    return parts.join(' | ');
  }

  function buildArmazon(d) {
    const partes = [];
    if (d.armazon)   partes.push(d.armazon);
    if (d.marca)     partes.push(`Marca: ${d.marca}`);
    if (d.codigoref) partes.push(`Ref: ${d.codigoref}`);
    if (d.material)  partes.push(`Mat: ${d.material}`);
    if (d.color)     partes.push(`Color: ${d.color}`);
    return partes.length ? partes.join(' / ') : null;
  }

  // ── Actualizar estado ─────────────────────────────
  async function actualizarEstado(id, nuevoEstado) {
    const updates = { estado: nuevoEstado };
    if (nuevoEstado === 'Retirado') {
      updates.fecha_retiro = new Date().toISOString();
    }

    const { error } = await window.supabaseClient
      .from('pedidos')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
  }

  // ── Helpers ───────────────────────────────────────
  function labelEstado(estado) {
    const map = {
      'Pedido a laboratorio': 'Pedido a lab.',
      'En laboratorio':       'En laboratorio',
      'Pendiente de retirar': 'Para retirar',
      'Retirado':             'Retirado',
    };
    return map[estado] || estado;
  }

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
    getPedidosActivos,
    getTodosPedidos,
    crearPedido,
    actualizarEstado,
    calcEstInteligente,
    calcDias,
    enrich,
    labelEstado,
    claseEstado,
  };
})();
