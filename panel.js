// ===================================================
//  OLVISIÓN — panel.js
//  Dashboard visual con KPIs, gráficos y rankings
// ===================================================

const Panel = (() => {

  // ── Renderizar panel completo ─────────────────────
  async function render() {
    const kpiEl = document.getElementById('panel-kpis');
    if (!kpiEl) return;

    kpiEl.innerHTML = '<div style="padding:24px;text-align:center;color:#888;font-size:13px">Cargando panel...</div>';

    try {
      const todos = await Pedidos.getTodosPedidos();
      renderDashboard(null, todos);
    } catch (e) {
      kpiEl.innerHTML = `<p style="color:var(--rojo);padding:16px">Error cargando panel: ${e.message}</p>`;
    }
  }

  // ── Contar críticos para badge ────────────────────
  function contarCriticos(pedidos) {
    return pedidos.filter(p =>
      p.estado !== 'Retirado' && p._est.valor === 'critico'
    ).length;
  }

  // ── Dashboard principal ───────────────────────────
  function renderDashboard(container, todos) {
    const activos = todos.filter(p => p.estado !== 'Retirado');

    // --- KPIs de estado actual ---
    const enLab    = activos.filter(p => p.estado === 'Pedido a laboratorio' || p.estado === 'En laboratorio').length;
    const paraRet  = activos.filter(p => p.estado === 'Pendiente de retirar').length;
    const hoy      = new Date().toDateString();
    const retHoy   = todos.filter(p => p.estado === 'Retirado' && p.fecha_retiro && new Date(p.fecha_retiro).toDateString() === hoy).length;
    const demorados = activos.filter(p => p._est.valor === 'demorado').length;
    const criticos  = activos.filter(p => p._est.valor === 'critico').length;
    const urgentes  = activos.filter(p => p.urgente === 'Si').length;
    const totalActivos = activos.length;

    // --- Métricas temporales ---
    const ahora    = new Date();
    const iniSemana = new Date(ahora); iniSemana.setDate(ahora.getDate() - ahora.getDay() + 1); iniSemana.setHours(0,0,0,0);
    const iniMes   = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const iniAnio  = new Date(ahora.getFullYear(), 0, 1);

    const pedidosSemana = todos.filter(p => new Date(p.fecha_carga) >= iniSemana).length;
    const pedidosMes    = todos.filter(p => new Date(p.fecha_carga) >= iniMes).length;
    const pedidosAnio   = todos.filter(p => new Date(p.fecha_carga) >= iniAnio).length;

    // --- Semana anterior ---
    const iniSemAnt = new Date(iniSemana); iniSemAnt.setDate(iniSemAnt.getDate() - 7);
    const finSemAnt = new Date(iniSemana);
    const semAnt    = todos.filter(p => { const f = new Date(p.fecha_carga); return f >= iniSemAnt && f < finSemAnt; }).length;
    const deltaSem  = pedidosSemana - semAnt;

    // --- Mes anterior ---
    const iniMesAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    const finMesAnt = new Date(iniMes);
    const mesAnt    = todos.filter(p => { const f = new Date(p.fecha_carga); return f >= iniMesAnt && f < finMesAnt; }).length;
    const deltaMes  = pedidosMes - mesAnt;

    // --- Promedio días en lab (todos activos) ---
    let promDias = 0;
    if (activos.length > 0) {
      const sum = activos.reduce((a, p) => a + p._dias, 0);
      promDias = (sum / activos.length).toFixed(1);
    }

    // --- Ranking laboratorios (mes actual) ---
    const labCounts = {};
    todos.filter(p => new Date(p.fecha_carga) >= iniMes).forEach(p => {
      if (!p.laboratorio) return;
      labCounts[p.laboratorio] = (labCounts[p.laboratorio] || 0) + 1;
    });
    const labRanking = Object.entries(labCounts).sort((a,b) => b[1]-a[1]);

    // --- Promedio días por laboratorio (activos) ---
    const labDias = {}; const labN = {};
    activos.forEach(p => {
      if (!p.laboratorio) return;
      labDias[p.laboratorio] = (labDias[p.laboratorio] || 0) + p._dias;
      labN[p.laboratorio] = (labN[p.laboratorio] || 0) + 1;
    });
    const labPromedios = Object.keys(labDias).map(lab => ({
      lab,
      avg: (labDias[lab] / labN[lab]).toFixed(1),
      estado: getEstadoLab(lab, labDias[lab] / labN[lab])
    })).sort((a,b) => parseFloat(b.avg) - parseFloat(a.avg));

    // --- Ranking tipo de lente (mes actual) ---
    const lenteCounts = {};
    todos.filter(p => new Date(p.fecha_carga) >= iniMes).forEach(p => {
      if (!p.tipo_lente) return;
      lenteCounts[p.tipo_lente] = (lenteCounts[p.tipo_lente] || 0) + 1;
    });
    const lenteRanking = Object.entries(lenteCounts).sort((a,b) => b[1]-a[1]);

    // --- Gráfico: pedidos por día (últimos 7 días) ---
    const dias7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const fin = new Date(d); fin.setDate(fin.getDate() + 1);
      const count = todos.filter(p => { const f = new Date(p.fecha_carga); return f >= d && f < fin; }).length;
      dias7.push({ label: i === 0 ? 'Hoy' : d.toLocaleDateString('es-AR', {weekday:'short'}), count });
    }
    const maxDia = Math.max(...dias7.map(d => d.count), 1);

    // --- Gráfico: pedidos por mes (últimos 6 meses) ---
    const meses6 = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      const fin = new Date(ahora.getFullYear(), ahora.getMonth() - i + 1, 1);
      const count = todos.filter(p => { const f = new Date(p.fecha_carga); return f >= m && f < fin; }).length;
      meses6.push({ label: m.toLocaleDateString('es-AR', {month:'short'}), count });
    }
    const maxMes = Math.max(...meses6.map(m => m.count), 1);

    const LAB_COLORS = ['#034291','#0460D9','#F9A825','#C62828','#00695C','#4527A0'];

    // ── HTML del panel ────────────────────────────────
    const kpiEl = document.getElementById('panel-kpis');
    if (!kpiEl) return;

    kpiEl.innerHTML = `

      <!-- PERÍODO CARDS -->
      <div class="dash-section-label">Actividad del período</div>
      <div class="dash-periodo-grid">

        <div class="dash-periodo-card dash-periodo-blue">
          <div class="dash-periodo-value">${pedidosSemana}</div>
          <div class="dash-periodo-label">Esta semana</div>
          <div class="dash-periodo-delta ${deltaSem >= 0 ? '' : 'neg'}">
            ${deltaSem >= 0 ? '↑' : '↓'} ${Math.abs(deltaSem)} vs semana anterior
          </div>
        </div>

        <div class="dash-periodo-card dash-periodo-yellow">
          <div class="dash-periodo-value">${pedidosMes}</div>
          <div class="dash-periodo-label">Este mes</div>
          <div class="dash-periodo-delta ${deltaMes >= 0 ? '' : 'neg'}">
            ${deltaMes >= 0 ? '↑' : '↓'} ${Math.abs(deltaMes)} vs mes anterior
          </div>
        </div>

        <div class="dash-periodo-card dash-periodo-teal">
          <div class="dash-periodo-value">${pedidosAnio}</div>
          <div class="dash-periodo-label">Este año</div>
          <div class="dash-periodo-delta">Total acumulado ${ahora.getFullYear()}</div>
        </div>

        <div class="dash-periodo-card dash-periodo-purple">
          <div class="dash-periodo-value">${promDias}<span style="font-size:14px">d</span></div>
          <div class="dash-periodo-label">Prom. días en lab.</div>
          <div class="dash-periodo-delta">Todos los activos</div>
        </div>

      </div>

      <!-- KPI ESTADO ACTUAL -->
      <div class="dash-section-label">Estado actual</div>
      <div class="dash-kpi-grid">

        <div class="dash-kpi-card dash-kpi-blue">
          <div class="dash-kpi-icon">🔬</div>
          <div class="dash-kpi-value">${enLab}</div>
          <div class="dash-kpi-label">En laboratorio</div>
        </div>

        <div class="dash-kpi-card dash-kpi-yellow">
          <div class="dash-kpi-icon">📦</div>
          <div class="dash-kpi-value">${paraRet}</div>
          <div class="dash-kpi-label">Para retirar</div>
        </div>

        <div class="dash-kpi-card dash-kpi-green">
          <div class="dash-kpi-icon">✅</div>
          <div class="dash-kpi-value">${retHoy}</div>
          <div class="dash-kpi-label">Retirados hoy</div>
        </div>

        <div class="dash-kpi-card dash-kpi-orange">
          <div class="dash-kpi-icon">⚠️</div>
          <div class="dash-kpi-value">${demorados}</div>
          <div class="dash-kpi-label">Demorados</div>
        </div>

        <div class="dash-kpi-card dash-kpi-red">
          <div class="dash-kpi-icon">🔴</div>
          <div class="dash-kpi-value">${criticos}</div>
          <div class="dash-kpi-label">Críticos</div>
        </div>

        <div class="dash-kpi-card dash-kpi-purple">
          <div class="dash-kpi-icon">⚡</div>
          <div class="dash-kpi-value">${urgentes}</div>
          <div class="dash-kpi-label">Urgentes activos</div>
        </div>

        <div class="dash-kpi-card dash-kpi-teal" style="grid-column: span 2">
          <div class="dash-kpi-icon">📋</div>
          <div class="dash-kpi-value">${totalActivos}</div>
          <div class="dash-kpi-label">Total activos</div>
        </div>

      </div>

      <!-- GRÁFICO: pedidos por día -->
      <div class="dash-section-label">Pedidos por día (últimos 7 días)</div>
      <div class="dash-wide-card">
        <div class="dash-bar-chart">
          ${dias7.map((d, i) => {
            const h = Math.max(4, Math.round((d.count / maxDia) * 80));
            const isHoy = i === 6;
            return `
              <div class="dash-bar-col">
                <div class="dash-bar-val">${d.count}</div>
                <div class="dash-bar" style="height:${h}px;background:${isHoy ? '#034291' : '#B5D4F4'}"></div>
                <div class="dash-bar-lbl">${d.label}</div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- GRÁFICO: pedidos por mes -->
      <div class="dash-section-label">Pedidos por mes (últimos 6 meses)</div>
      <div class="dash-wide-card">
        <div class="dash-bar-chart">
          ${meses6.map((m, i) => {
            const h = Math.max(4, Math.round((m.count / maxMes) * 80));
            const isActual = i === 5;
            return `
              <div class="dash-bar-col">
                <div class="dash-bar-val">${m.count}</div>
                <div class="dash-bar" style="height:${h}px;background:${isActual ? '#034291' : '#B5D4F4'}"></div>
                <div class="dash-bar-lbl">${m.label}</div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- RANKING LABORATORIOS -->
      <div class="dash-section-label">Ranking de laboratorios (este mes)</div>
      <div class="dash-wide-card">
        ${labRanking.length === 0
          ? '<p class="dash-empty">Sin datos del mes actual</p>'
          : `<div class="dash-rank-list">
              ${labRanking.map(([lab, count], i) => {
                const pct = Math.round((count / labRanking[0][1]) * 100);
                const color = LAB_COLORS[i % LAB_COLORS.length];
                return `
                  <div class="dash-rank-item">
                    <div class="dash-rank-num">${i + 1}</div>
                    <div class="dash-rank-name">${lab}</div>
                    <div class="dash-rank-bar-bg">
                      <div class="dash-rank-bar-fill" style="width:${pct}%;background:${color}"></div>
                    </div>
                    <div class="dash-rank-count">${count}</div>
                  </div>`;
              }).join('')}
            </div>`
        }
      </div>

      <!-- PROMEDIO POR LABORATORIO -->
      <div class="dash-section-label">Tiempo promedio por laboratorio</div>
      <div class="dash-wide-card">
        ${labPromedios.length === 0
          ? '<p class="dash-empty">Sin pedidos activos</p>'
          : `<table class="dash-avg-table">
              <thead><tr><th>Laboratorio</th><th>Días prom.</th><th>Límite OK</th><th>Estado</th></tr></thead>
              <tbody>
                ${labPromedios.map(r => `
                  <tr>
                    <td><strong>${r.lab}</strong></td>
                    <td>${r.avg}d</td>
                    <td style="color:#888;font-size:11px">${getLimite(r.lab)}</td>
                    <td><span class="dash-pill dash-pill-${r.estado.clase}">${r.estado.texto}</span></td>
                  </tr>`).join('')}
              </tbody>
            </table>`
        }
      </div>

      <!-- RANKING TIPO DE LENTE -->
      <div class="dash-section-label">Tipos de lente más pedidos (este mes)</div>
      <div class="dash-wide-card">
        ${lenteRanking.length === 0
          ? '<p class="dash-empty">Sin datos del mes actual</p>'
          : `<div class="dash-rank-list">
              ${lenteRanking.map(([lente, count], i) => {
                const pct = lenteRanking[0][1] > 0 ? Math.round((count / lenteRanking[0][1]) * 100) : 0;
                const color = LAB_COLORS[i % LAB_COLORS.length];
                return `
                  <div class="dash-rank-item">
                    <div class="dash-rank-num">${i + 1}</div>
                    <div class="dash-rank-name" style="font-size:11px">${lente}</div>
                    <div class="dash-rank-bar-bg">
                      <div class="dash-rank-bar-fill" style="width:${pct}%;background:${color}"></div>
                    </div>
                    <div class="dash-rank-count">${count}</div>
                  </div>`;
              }).join('')}
            </div>`
        }
      </div>

      <!-- TABLA CRÍTICOS Y DEMORADOS -->
      <div class="dash-section-label">Críticos y demorados 🔴</div>
      <div class="dash-wide-card" id="panel-criticos">
        ${renderFilasCriticos(todos)}
      </div>

      <!-- TABLA PARA RETIRAR -->
      <div class="dash-section-label">Para retirar 📦</div>
      <div class="dash-wide-card" id="panel-pendientes">
        ${renderFilasPendientes(todos)}
      </div>

      <!-- TABLA ÚLTIMOS INGRESADOS -->
      <div class="dash-section-label">Últimos 10 pedidos ingresados</div>
      <div class="dash-wide-card" id="panel-ultimos">
        ${renderFilasUltimos(todos)}
      </div>

    `;
  }

  // ── Helpers estado lab ────────────────────────────
  function getLimite(lab) {
    const limites = { Bichara:'≤2 días', Sol:'≤5 días', Vitolen:'≤5 días', Cristian:'≤7 días' };
    return limites[lab] || '—';
  }

  function getEstadoLab(lab, avg) {
    const reglas = {
      Bichara: { ok: 2, dem: 4 },
      Sol:     { ok: 5, dem: 7 },
      Vitolen: { ok: 5, dem: 7 },
      Cristian:{ ok: 7, dem: 10 },
    };
    const r = reglas[lab] || { ok: 5, dem: 7 };
    if (avg <= r.ok)  return { texto: '✅ OK',       clase: 'green'  };
    if (avg <= r.dem) return { texto: '⚠️ Demorado', clase: 'yellow' };
    return               { texto: '🔴 Crítico',  clase: 'red'    };
  }

  // ── Filas de tablas ───────────────────────────────
  function renderFilasCriticos(todos) {
    const rows = todos
      .filter(p => p.estado !== 'Retirado' && (p._est.valor === 'critico' || p._est.valor === 'demorado'))
      .sort((a, b) => b._dias - a._dias)
      .slice(0, 10);

    if (!rows.length) return '<p class="dash-empty">Sin pedidos críticos o demorados</p>';
    return rows.map(p => panelRow(p)).join('');
  }

  function renderFilasPendientes(todos) {
    const rows = todos
      .filter(p => p.estado === 'Pendiente de retirar')
      .sort((a, b) => b._dias - a._dias)
      .slice(0, 10);

    if (!rows.length) return '<p class="dash-empty">Sin pedidos pendientes de retiro</p>';
    return rows.map(p => panelRow(p)).join('');
  }

  function renderFilasUltimos(todos) {
    const rows = todos
      .sort((a, b) => new Date(b.fecha_carga) - new Date(a.fecha_carga))
      .slice(0, 10);

    if (!rows.length) return '<p class="dash-empty">Sin pedidos</p>';
    return rows.map(p => panelRow(p)).join('');
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
