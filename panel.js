// ===================================================
//  OLVISIÓN — panel.js
//  KPIs y tablas del panel admin
// ===================================================

const Panel = (() => {

  // ── Renderizar panel completo ─────────────────────
  async function render() {
    const el = document.getElementById('panel-content');
    if (!el) return;

    try {
      const todos = await Pedidos.getTodosPedidos();
      renderKPIs(el, todos);
      renderTablaPendientes(el, todos);
      renderTablaCriticos(el, todos);
      renderTablaUltimos(el, todos);
    } catch (e) {
      el.innerHTML = `<p style="color:var(--rojo);padding:16px">Error cargando panel: ${e.message}</p>`;
    }
  }

  // ── Contar críticos para badge ────────────────────
  function contarCriticos(pedidos) {
    return pedidos.filter(p =>
      p.estado !== 'Retirado' && p._est.valor === 'critico'
    ).length;
  }

  // ── KPIs ──────────────────────────────────────────
  function renderKPIs(container, todos) {
    const activos = todos.filter(p => p.estado !== 'Retirado');

    const enLab    = activos.filter(p => p.estado === 'Pedido a laboratorio' || p.estado === 'En laboratorio').length;
    const paraRet  = activos.filter(p => p.estado === 'Pendiente de retirar').length;

    const hoy      = new Date().toDateString();
    const retHoy   = todos.filter(p => {
      if (p.estado !== 'Retirado' || !p.fecha_retiro) return false;
      return new Date(p.fecha_retiro).toDateString() === hoy;
    }).length;

    const demorados = activos.filter(p => p._est.valor === 'demorado').length;
    const criticos  = activos.filter(p => p._est.valor === 'critico').length;
    const total     = activos.length;
    const urgentes  = activos.filter(p => p.urgente === 'Si').length;

    // Promedio de días por laboratorio
    const avgPorLab = {};
    const labCount  = {};
    activos.forEach(p => {
      const lab = p.laboratorio;
      if (!lab) return;
      if (!avgPorLab[lab]) { avgPorLab[lab] = 0; labCount[lab] = 0; }
      avgPorLab[lab] += p._dias;
      labCount[lab]++;
    });
    const avgRows = Object.keys(avgPorLab).map(lab => ({
      lab,
      avg: labCount[lab] > 0 ? (avgPorLab[lab] / labCount[lab]).toFixed(1) : '—',
    })).sort((a, b) => parseFloat(b.avg) - parseFloat(a.avg));

    const kpiEl = document.getElementById('panel-kpis');
    if (!kpiEl) return;

    kpiEl.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard('En laboratorio', enLab,   'Activos en proceso', '🔬', '')}
        ${kpiCard('Para retirar',   paraRet, 'Pendientes de retiro', '📦', 'yellow')}
        ${kpiCard('Retirados hoy',  retHoy,  'Completados hoy', '✅', 'green')}
        ${kpiCard('Demorados',      demorados,'Est. Demorado', '⚠️', 'orange')}
        ${kpiCard('Críticos',       criticos, 'Est. Crítico', '🔴', 'red')}
        ${kpiCard('Total activos',  total,   'Pedidos en curso', '📋', '')}
        ${kpiCard('Urgentes',       urgentes,'Urgentes activos', '⚡', 'orange')}
        <div class="kpi-card">
          <div class="kpi-label">Promedio por lab.</div>
          <table class="avg-lab-table">
            <thead><tr><th>Lab</th><th>Días</th></tr></thead>
            <tbody>
              ${avgRows.map(r => `<tr><td>${r.lab}</td><td>${r.avg}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function kpiCard(label, valor, sub, icon, mod) {
    return `
      <div class="kpi-card ${mod}">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value ${valor > 9 ? '' : 'big'}">${valor}</div>
        <div class="kpi-sub">${sub}</div>
        <div class="kpi-icon">${icon}</div>
      </div>
    `;
  }

  // ── Tabla pendientes ──────────────────────────────
  function renderTablaPendientes(container, todos) {
    const el = document.getElementById('panel-pendientes');
    if (!el) return;

    const rows = todos
      .filter(p => p.estado === 'Pendiente de retirar')
      .sort((a, b) => b._dias - a._dias)
      .slice(0, 10);

    el.innerHTML = rows.length
      ? rows.map(p => panelRow(p)).join('')
      : '<div class="panel-row"><span style="color:var(--gris-texto);font-size:.85rem">Sin pedidos pendientes</span></div>';
  }

  // ── Tabla críticos y demorados ────────────────────
  function renderTablaCriticos(container, todos) {
    const el = document.getElementById('panel-criticos');
    if (!el) return;

    const rows = todos
      .filter(p => p.estado !== 'Retirado' && (p._est.valor === 'critico' || p._est.valor === 'demorado'))
      .sort((a, b) => b._dias - a._dias)
      .slice(0, 10);

    el.innerHTML = rows.length
      ? rows.map(p => panelRow(p)).join('')
      : '<div class="panel-row"><span style="color:var(--gris-texto);font-size:.85rem">Sin pedidos críticos</span></div>';
  }

  // ── Tabla últimos 10 ingresados ───────────────────
  function renderTablaUltimos(container, todos) {
    const el = document.getElementById('panel-ultimos');
    if (!el) return;

    const rows = todos
      .sort((a, b) => new Date(b.fecha_carga) - new Date(a.fecha_carga))
      .slice(0, 10);

    el.innerHTML = rows.length
      ? rows.map(p => panelRow(p)).join('')
      : '<div class="panel-row"><span style="color:var(--gris-texto);font-size:.85rem">Sin pedidos</span></div>';
  }

  function panelRow(p) {
    const estClase = p._est.valor === 'critico' ? 'critico' : p._est.valor === 'demorado' ? 'demorado' : '';
    const sufijo   = p.sufijo ? `-${p.sufijo}` : '';
    return `
      <div class="panel-row ${estClase}">
        <span class="pr-orden">${p.orden}${sufijo}</span>
        <span class="pr-cliente">${escHtml(p.cliente)}</span>
        <span class="pr-lab">${p.laboratorio || '—'}</span>
        <span class="pr-dias">${p._dias}d</span>
        <span class="pr-est ${p._est.clase}">${p._est.texto}</span>
      </div>
    `;
  }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render, contarCriticos };
})();
