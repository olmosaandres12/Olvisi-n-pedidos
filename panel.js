// ===================================================
//  OLVISIÓN — panel.js
//  Dashboard visual con KPIs, gráficos, rankings y exportador PDF
// ===================================================

const Panel = (() => {

  async function render() {
    const kpiEl = document.getElementById('panel-kpis');
    if (!kpiEl) return;
    kpiEl.innerHTML = '<div style="padding:24px;text-align:center;color:#888;font-size:13px">Cargando panel...</div>';
    try {
      const todos = await Pedidos.getTodosPedidos();
      renderDashboard(todos);
    } catch (e) {
      kpiEl.innerHTML = `<p style="color:var(--rojo);padding:16px">Error cargando panel: ${e.message}</p>`;
    }
  }

  function contarCriticos(pedidos) {
    return pedidos.filter(p => p.estado !== 'Retirado' && p._est.valor === 'critico').length;
  }

  function irAPedidos(estado) {
    App.showScreen('pedidos');
    App.switchEstadoTab(estado && estado !== 'todos' ? estado : 'todos');
  }
  function irAPedidosDemorados() { App.showScreen('pedidos'); App.switchEstadoTab('todos'); setTimeout(() => window.toast('Demorados resaltados en naranja ⚠️','warn'),600); }
  function irAPedidosCriticos()  { App.showScreen('pedidos'); App.switchEstadoTab('todos'); setTimeout(() => window.toast('Críticos resaltados en rojo 🔴','error'),600); }
  function irAPedidosUrgentes()  { App.showScreen('pedidos'); App.switchEstadoTab('todos'); setTimeout(() => window.toast('Buscá los chips URGENTE ⚡','success'),600); }

  // ── Exportar PDF ──────────────────────────────────
  async function abrirExportador() {
    const modal = document.getElementById('export-modal');
    if (!modal) return;

    // Generar opciones de meses (últimos 12)
    const ahora = new Date();
    const opciones = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      const val   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('es-AR', { month:'long', year:'numeric' });
      opciones.push({ val, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }

    document.getElementById('export-mes-select').innerHTML = opciones
      .map(o => `<option value="${o.val}">${o.label}</option>`).join('');

    modal.classList.remove('hidden');
  }

  function cerrarExportador() {
    document.getElementById('export-modal').classList.add('hidden');
  }

  async function generarPDF() {
    const mesVal = document.getElementById('export-mes-select').value;
    const [anio, mes] = mesVal.split('-').map(Number);

    const btn = document.getElementById('btn-generar-pdf');
    btn.textContent = 'Generando...';
    btn.disabled = true;

    try {
      const todos = await Pedidos.getTodosPedidos();

      const iniMes = new Date(anio, mes - 1, 1);
      const finMes = new Date(anio, mes, 1);
      const pedidos = todos.filter(p => {
        const f = new Date(p.fecha_carga);
        return f >= iniMes && f < finMes;
      }).sort((a,b) => new Date(a.fecha_carga) - new Date(b.fecha_carga));

      const mesLabel = iniMes.toLocaleDateString('es-AR', { month:'long', year:'numeric' });
      const mesTitle = mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1);

      // ── Resumen por laboratorio ───────────────────
      const labStats = {};
      pedidos.forEach(p => {
        if (!p.laboratorio) return;
        if (!labStats[p.laboratorio]) labStats[p.laboratorio] = { count: 0, dias: 0 };
        labStats[p.laboratorio].count++;
        labStats[p.laboratorio].dias += p._dias;
      });

      // ── Colores por usuario ───────────────────────
      const avatarColor = (nombre) => {
        const n = (nombre || '').toLowerCase();
        if (n.includes('andr')) return '#034291';
        if (n.includes('sand')) return '#7B1FA2';
        if (n.includes('vale')) return '#00695C';
        return '#888';
      };

      const avatarInitial = (nombre) => (nombre || '?').charAt(0).toUpperCase();

      // ── HTML del PDF ──────────────────────────────
      const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>OLVISIÓN — Pedidos ${mesTitle}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');

            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: 'DM Sans', sans-serif;
              font-size: 11px;
              color: #1a1a2e;
              background: #fff;
              padding: 32px 36px;
            }

            /* ── Header ── */
            .pdf-header {
              display: flex; align-items: flex-start;
              justify-content: space-between;
              border-bottom: 3px solid #034291;
              padding-bottom: 16px; margin-bottom: 24px;
            }
            .pdf-logo-text {
              font-size: 28px; font-weight: 800;
              color: #034291; letter-spacing: -1px; line-height: 1;
            }
            .pdf-logo-sub {
              font-size: 10px; color: #888; margin-top: 4px; letter-spacing: .5px;
            }
            .pdf-header-right { text-align: right; }
            .pdf-report-title {
              font-size: 15px; font-weight: 700; color: #034291;
            }
            .pdf-report-sub {
              font-size: 10px; color: #888; margin-top: 4px;
            }

            /* ── Resumen KPIs ── */
            .pdf-kpis {
              display: grid; grid-template-columns: repeat(4,1fr);
              gap: 10px; margin-bottom: 24px;
            }
            .pdf-kpi {
              background: #F0F4FF; border-radius: 8px;
              padding: 10px 12px; border-left: 3px solid #034291;
            }
            .pdf-kpi-value { font-size: 22px; font-weight: 800; color: #034291; line-height: 1; }
            .pdf-kpi-label { font-size: 9px; color: #888; margin-top: 3px; text-transform: uppercase; letter-spacing: .5px; }

            /* ── Tabla ── */
            .pdf-table-title {
              font-size: 12px; font-weight: 700; color: #034291;
              text-transform: uppercase; letter-spacing: .8px;
              margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
            }
            .pdf-table-title::after { content:''; flex:1; height:1px; background:#034291; opacity:.2; }

            table {
              width: 100%; border-collapse: collapse;
              margin-bottom: 28px;
            }
            thead tr {
              background: #034291; color: #fff;
            }
            thead th {
              padding: 8px 7px; text-align: left;
              font-size: 9px; font-weight: 700;
              text-transform: uppercase; letter-spacing: .5px;
            }
            tbody tr { border-bottom: 1px solid #f0f0f0; }
            tbody tr:nth-child(even) { background: #F8F9FF; }
            tbody tr:last-child { border-bottom: none; }
            tbody td { padding: 7px 7px; vertical-align: middle; }

            /* Columnas específicas */
            .col-orden { font-family: 'DM Mono', monospace; font-weight: 600; color: #034291; white-space: nowrap; }
            .col-cliente { font-weight: 600; }
            .col-estado { white-space: nowrap; }
            .col-grad { font-family: 'DM Mono', monospace; font-size: 9px; color: #555; }

            /* Pills de estado */
            .pill { display: inline-block; padding: 2px 7px; border-radius: 20px; font-size: 8px; font-weight: 700; }
            .pill-retirado   { background: #E8F5E9; color: #1B5E20; }
            .pill-retirar    { background: #FFF8E1; color: #7A5200; }
            .pill-cristales  { background: #EBF2FF; color: #034291; }
            .pill-armazon    { background: #EBF2FF; color: #034291; }
            .pill-lab        { background: #D6EDFF; color: #014E8F; }
            .pill-urgente    { background: #FFEBEE; color: #C62828; font-size: 7px; margin-left: 3px; }

            /* Avatar usuario */
            .avatar {
              display: inline-flex; align-items: center; justify-content: center;
              width: 18px; height: 18px; border-radius: 50%;
              font-size: 8px; font-weight: 800; color: #fff;
              margin-right: 4px; vertical-align: middle;
            }

            /* ── Resumen por laboratorio ── */
            .pdf-lab-summary {
              display: grid; grid-template-columns: repeat(2,1fr);
              gap: 10px; margin-bottom: 28px;
            }
            .pdf-lab-card {
              border: 1px solid #eaecf0; border-radius: 8px;
              padding: 12px; border-left: 4px solid #034291;
            }
            .pdf-lab-name { font-size: 13px; font-weight: 700; color: #034291; margin-bottom: 6px; }
            .pdf-lab-stat { font-size: 10px; color: #555; margin-bottom: 2px; }
            .pdf-lab-stat span { font-weight: 700; color: #1a1a2e; }

            /* ── Footer ── */
            .pdf-footer {
              margin-top: 24px; padding-top: 12px;
              border-top: 1px solid #eaecf0;
              display: flex; justify-content: space-between;
              font-size: 9px; color: #bbb;
            }

            @media print {
              body { padding: 20px 24px; }
              @page { margin: 1cm; size: A4 landscape; }
            }
          </style>
        </head>
        <body>

          <!-- Header -->
          <div class="pdf-header">
            <div>
              <div class="pdf-logo-text">OLVISIÓN</div>
              <div class="pdf-logo-sub">Gestión de pedidos de laboratorio</div>
            </div>
            <div class="pdf-header-right">
              <div class="pdf-report-title">Reporte de pedidos — ${mesTitle}</div>
              <div class="pdf-report-sub">Generado el ${new Date().toLocaleDateString('es-AR', {day:'2-digit',month:'long',year:'numeric'})}</div>
            </div>
          </div>

          <!-- KPIs -->
          <div class="pdf-kpis">
            <div class="pdf-kpi">
              <div class="pdf-kpi-value">${pedidos.length}</div>
              <div class="pdf-kpi-label">Total pedidos</div>
            </div>
            <div class="pdf-kpi">
              <div class="pdf-kpi-value">${pedidos.filter(p=>p.estado==='Retirado').length}</div>
              <div class="pdf-kpi-label">Retirados</div>
            </div>
            <div class="pdf-kpi">
              <div class="pdf-kpi-value">${pedidos.filter(p=>p.urgente==='Si').length}</div>
              <div class="pdf-kpi-label">Urgentes</div>
            </div>
            <div class="pdf-kpi">
              <div class="pdf-kpi-value">${pedidos.length > 0 ? (pedidos.reduce((a,p)=>a+p._dias,0)/pedidos.length).toFixed(1) : '—'}d</div>
              <div class="pdf-kpi-label">Prom. días</div>
            </div>
          </div>

          <!-- Tabla de pedidos -->
          <div class="pdf-table-title">Detalle de pedidos</div>
          ${pedidos.length === 0
            ? '<p style="color:#888;font-size:12px;text-align:center;padding:24px">Sin pedidos en este período</p>'
            : `<table>
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Laboratorio</th>
                  <th>Lente</th>
                  <th>Tratamiento</th>
                  <th>Graduación</th>
                  <th>Estado</th>
                  <th>Días</th>
                  <th>Cargado por</th>
                </tr>
              </thead>
              <tbody>
                ${pedidos.map(p => {
                  const sufijo = p.sufijo ? `-${p.sufijo}` : '';
                  const fecha  = new Date(p.fecha_carga).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
                  const pillClass = p.estado === 'Retirado' ? 'pill-retirado'
                    : p.estado === 'Pendiente de retirar' ? 'pill-retirar'
                    : p.estado === 'Armazón enviado p/calibrado' ? 'pill-armazon'
                    : p.estado === 'En laboratorio' ? 'pill-lab'
                    : 'pill-cristales';
                  const estadoCorto = p.estado === 'Cristales pedidos a lab' ? 'Cristales'
                    : p.estado === 'Armazón enviado p/calibrado' ? 'Armazón'
                    : p.estado === 'En laboratorio' ? 'En lab.'
                    : p.estado === 'Pendiente de retirar' ? 'Para retirar'
                    : 'Retirado';
                  const color = avatarColor(p.cargado_por);
                  const ini   = avatarInitial(p.cargado_por);
                  return `<tr>
                    <td class="col-orden">#${p.orden}${sufijo}${p.urgente==='Si'?'<span class="pill pill-urgente">URG</span>':''}</td>
                    <td class="col-cliente">${p.cliente || '—'}</td>
                    <td>${fecha}</td>
                    <td>${p.laboratorio || '—'}</td>
                    <td>${p.tipo_lente || '—'}</td>
                    <td>${p.tratamiento || '—'}</td>
                    <td class="col-grad">${p.graduacion || '—'}</td>
                    <td class="col-estado"><span class="pill ${pillClass}">${estadoCorto}</span></td>
                    <td style="text-align:center;font-weight:600">${p._dias}d</td>
                    <td><span class="avatar" style="background:${color}">${ini}</span>${p.cargado_por || '—'}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>`
          }

          <!-- Resumen por laboratorio -->
          ${Object.keys(labStats).length > 0 ? `
          <div class="pdf-table-title">Resumen por laboratorio</div>
          <div class="pdf-lab-summary">
            ${Object.entries(labStats).sort((a,b)=>b[1].count-a[1].count).map(([lab, s]) => `
              <div class="pdf-lab-card">
                <div class="pdf-lab-name">${lab}</div>
                <div class="pdf-lab-stat">Pedidos: <span>${s.count}</span></div>
                <div class="pdf-lab-stat">Promedio de días: <span>${(s.dias/s.count).toFixed(1)}d</span></div>
              </div>
            `).join('')}
          </div>` : ''}

          <!-- Footer -->
          <div class="pdf-footer">
            <span>OLVISIÓN © ${new Date().getFullYear()} — Sistema interno de gestión</span>
            <span>Reporte generado automáticamente</span>
          </div>

        </body>
        </html>
      `;

      // Abrir ventana de impresión
      const ventana = window.open('', '_blank', 'width=1100,height=700');
      ventana.document.write(html);
      ventana.document.close();
      ventana.onload = () => {
        setTimeout(() => {
          ventana.print();
        }, 500);
      };

      cerrarExportador();
    } catch (e) {
      window.toast('Error generando PDF: ' + e.message, 'error');
    } finally {
      btn.textContent = 'Generar PDF';
      btn.disabled = false;
    }
  }

  // ── Dashboard principal ───────────────────────────
  function renderDashboard(todos) {
    const activos = todos.filter(p => p.estado !== 'Retirado');

    const enLab     = activos.filter(p =>
      p.estado === 'Cristales pedidos a lab' ||
      p.estado === 'Armazón enviado p/calibrado' ||
      p.estado === 'En laboratorio'
    ).length;
    const paraRet   = activos.filter(p => p.estado === 'Pendiente de retirar').length;
    const hoy       = new Date().toDateString();
    const retHoy    = todos.filter(p => p.estado === 'Retirado' && p.fecha_retiro && new Date(p.fecha_retiro).toDateString() === hoy).length;
    const demorados = activos.filter(p => p._est.valor === 'demorado').length;
    const criticos  = activos.filter(p => p._est.valor === 'critico').length;
    const urgentes  = activos.filter(p => p.urgente === 'Si').length;
    const totalActivos = activos.length;

    const ahora     = new Date();
    const iniSemana = new Date(ahora); iniSemana.setDate(ahora.getDate() - ahora.getDay() + 1); iniSemana.setHours(0,0,0,0);
    const iniMes    = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const iniAnio   = new Date(ahora.getFullYear(), 0, 1);

    const pedidosSemana = todos.filter(p => new Date(p.fecha_carga) >= iniSemana).length;
    const pedidosMes    = todos.filter(p => new Date(p.fecha_carga) >= iniMes).length;
    const pedidosAnio   = todos.filter(p => new Date(p.fecha_carga) >= iniAnio).length;

    const iniSemAnt = new Date(iniSemana); iniSemAnt.setDate(iniSemAnt.getDate() - 7);
    const semAnt    = todos.filter(p => { const f = new Date(p.fecha_carga); return f >= iniSemAnt && f < iniSemana; }).length;
    const deltaSem  = pedidosSemana - semAnt;

    const iniMesAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    const mesAnt    = todos.filter(p => { const f = new Date(p.fecha_carga); return f >= iniMesAnt && f < iniMes; }).length;
    const deltaMes  = pedidosMes - mesAnt;

    let promDias = 0;
    if (activos.length > 0) {
      promDias = (activos.reduce((a, p) => a + p._dias, 0) / activos.length).toFixed(1);
    }

    const labCounts = {};
    todos.filter(p => new Date(p.fecha_carga) >= iniMes).forEach(p => {
      if (!p.laboratorio) return;
      labCounts[p.laboratorio] = (labCounts[p.laboratorio] || 0) + 1;
    });
    const labRanking = Object.entries(labCounts).sort((a,b) => b[1]-a[1]);

    const labDias = {}; const labN = {};
    activos.forEach(p => {
      if (!p.laboratorio) return;
      labDias[p.laboratorio] = (labDias[p.laboratorio] || 0) + p._dias;
      labN[p.laboratorio] = (labN[p.laboratorio] || 0) + 1;
    });
    const labPromedios = Object.keys(labDias).map(lab => ({
      lab, avg: (labDias[lab] / labN[lab]).toFixed(1),
      estado: getEstadoLab(lab, labDias[lab] / labN[lab])
    })).sort((a,b) => parseFloat(b.avg) - parseFloat(a.avg));

    const lenteCounts = {};
    todos.filter(p => new Date(p.fecha_carga) >= iniMes).forEach(p => {
      if (!p.tipo_lente) return;
      lenteCounts[p.tipo_lente] = (lenteCounts[p.tipo_lente] || 0) + 1;
    });
    const lenteRanking = Object.entries(lenteCounts).sort((a,b) => b[1]-a[1]);

    const dias7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      const fin = new Date(d); fin.setDate(fin.getDate() + 1);
      dias7.push({ label: i === 0 ? 'Hoy' : d.toLocaleDateString('es-AR', {weekday:'short'}), count: todos.filter(p => { const f = new Date(p.fecha_carga); return f >= d && f < fin; }).length });
    }
    const maxDia = Math.max(...dias7.map(d => d.count), 1);

    const meses6 = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      const fin = new Date(ahora.getFullYear(), ahora.getMonth() - i + 1, 1);
      meses6.push({ label: m.toLocaleDateString('es-AR', {month:'short'}), count: todos.filter(p => { const f = new Date(p.fecha_carga); return f >= m && f < fin; }).length });
    }
    const maxMes = Math.max(...meses6.map(m => m.count), 1);

    const LAB_COLORS = ['#034291','#0460D9','#F9A825','#C62828','#00695C','#4527A0'];

    const kpiEl = document.getElementById('panel-kpis');
    if (!kpiEl) return;

    kpiEl.innerHTML = `

      <!-- Botón exportar PDF -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
        <button class="btn-export-pdf" onclick="Panel.abrirExportador()">
          📄 Exportar PDF
        </button>
      </div>

      <div class="dash-section-label">Actividad del período</div>
      <div class="dash-periodo-grid">
        <div class="dash-periodo-card dash-periodo-blue dash-clickable" onclick="Panel.irAPedidos('todos')">
          <div class="dash-periodo-value">${pedidosSemana}</div>
          <div class="dash-periodo-label">Esta semana</div>
          <div class="dash-periodo-delta ${deltaSem>=0?'':'neg'}">${deltaSem>=0?'↑':'↓'} ${Math.abs(deltaSem)} vs sem. anterior</div>
          <div class="dash-tap-hint">Ver pedidos →</div>
        </div>
        <div class="dash-periodo-card dash-periodo-yellow dash-clickable" onclick="Panel.irAPedidos('todos')">
          <div class="dash-periodo-value">${pedidosMes}</div>
          <div class="dash-periodo-label">Este mes</div>
          <div class="dash-periodo-delta ${deltaMes>=0?'':'neg'}">${deltaMes>=0?'↑':'↓'} ${Math.abs(deltaMes)} vs mes anterior</div>
          <div class="dash-tap-hint">Ver pedidos →</div>
        </div>
        <div class="dash-periodo-card dash-periodo-teal dash-clickable" onclick="Panel.irAPedidos('todos')">
          <div class="dash-periodo-value">${pedidosAnio}</div>
          <div class="dash-periodo-label">Este año</div>
          <div class="dash-periodo-delta">Total ${ahora.getFullYear()}</div>
          <div class="dash-tap-hint">Ver pedidos →</div>
        </div>
        <div class="dash-periodo-card dash-periodo-purple">
          <div class="dash-periodo-value">${promDias}<span style="font-size:14px">d</span></div>
          <div class="dash-periodo-label">Prom. días en lab.</div>
          <div class="dash-periodo-delta">Todos los activos</div>
        </div>
      </div>

      <div class="dash-section-label">Estado actual</div>
      <div class="dash-kpi-grid">
        <div class="dash-kpi-card dash-kpi-blue dash-clickable" onclick="Panel.irAPedidos('Cristales pedidos a lab')">
          <div class="dash-kpi-icon">🔬</div><div class="dash-kpi-value">${enLab}</div>
          <div class="dash-kpi-label">En laboratorio</div><div class="dash-tap-hint-sm">Ver →</div>
        </div>
        <div class="dash-kpi-card dash-kpi-yellow dash-clickable" onclick="Panel.irAPedidos('Pendiente de retirar')">
          <div class="dash-kpi-icon">📦</div><div class="dash-kpi-value">${paraRet}</div>
          <div class="dash-kpi-label">Para retirar</div><div class="dash-tap-hint-sm">Ver →</div>
        </div>
        <div class="dash-kpi-card dash-kpi-green dash-clickable" onclick="Panel.irAPedidos('Retirado')">
          <div class="dash-kpi-icon">✅</div><div class="dash-kpi-value">${retHoy}</div>
          <div class="dash-kpi-label">Retirados hoy</div><div class="dash-tap-hint-sm">Ver →</div>
        </div>
        <div class="dash-kpi-card dash-kpi-orange dash-clickable" onclick="Panel.irAPedidosDemorados()">
          <div class="dash-kpi-icon">⚠️</div><div class="dash-kpi-value">${demorados}</div>
          <div class="dash-kpi-label">Demorados</div><div class="dash-tap-hint-sm">Ver →</div>
        </div>
        <div class="dash-kpi-card dash-kpi-red dash-clickable" onclick="Panel.irAPedidosCriticos()">
          <div class="dash-kpi-icon">🔴</div><div class="dash-kpi-value">${criticos}</div>
          <div class="dash-kpi-label">Críticos</div><div class="dash-tap-hint-sm">Ver →</div>
        </div>
        <div class="dash-kpi-card dash-kpi-purple dash-clickable" onclick="Panel.irAPedidosUrgentes()">
          <div class="dash-kpi-icon">⚡</div><div class="dash-kpi-value">${urgentes}</div>
          <div class="dash-kpi-label">Urgentes activos</div><div class="dash-tap-hint-sm">Ver →</div>
        </div>
        <div class="dash-kpi-card dash-kpi-teal dash-clickable" style="grid-column:span 2" onclick="Panel.irAPedidos('todos')">
          <div class="dash-kpi-icon">📋</div><div class="dash-kpi-value">${totalActivos}</div>
          <div class="dash-kpi-label">Total activos</div><div class="dash-tap-hint-sm">Ver todos →</div>
        </div>
      </div>

      <div class="dash-section-label">Pedidos por día (últimos 7 días)</div>
      <div class="dash-wide-card">
        <div class="dash-bar-chart">
          ${dias7.map((d,i) => { const h=Math.max(4,Math.round((d.count/maxDia)*80)); return `<div class="dash-bar-col"><div class="dash-bar-val">${d.count}</div><div class="dash-bar" style="height:${h}px;background:${i===6?'#034291':'#B5D4F4'}"></div><div class="dash-bar-lbl">${d.label}</div></div>`; }).join('')}
        </div>
      </div>

      <div class="dash-section-label">Pedidos por mes (últimos 6 meses)</div>
      <div class="dash-wide-card">
        <div class="dash-bar-chart">
          ${meses6.map((m,i) => { const h=Math.max(4,Math.round((m.count/maxMes)*80)); return `<div class="dash-bar-col"><div class="dash-bar-val">${m.count}</div><div class="dash-bar" style="height:${h}px;background:${i===5?'#034291':'#B5D4F4'}"></div><div class="dash-bar-lbl">${m.label}</div></div>`; }).join('')}
        </div>
      </div>

      <div class="dash-section-label">Ranking de laboratorios (este mes)</div>
      <div class="dash-wide-card">
        ${labRanking.length===0 ? '<p class="dash-empty">Sin datos</p>' : `<div class="dash-rank-list">${labRanking.map(([lab,count],i) => { const pct=Math.round((count/labRanking[0][1])*100); return `<div class="dash-rank-item"><div class="dash-rank-num">${i+1}</div><div class="dash-rank-name">${lab}</div><div class="dash-rank-bar-bg"><div class="dash-rank-bar-fill" style="width:${pct}%;background:${LAB_COLORS[i%LAB_COLORS.length]}"></div></div><div class="dash-rank-count">${count}</div></div>`; }).join('')}</div>`}
      </div>

      <div class="dash-section-label">Tiempo promedio por laboratorio</div>
      <div class="dash-wide-card">
        ${labPromedios.length===0 ? '<p class="dash-empty">Sin pedidos activos</p>' : `<table class="dash-avg-table"><thead><tr><th>Laboratorio</th><th>Días prom.</th><th>Límite OK</th><th>Estado</th></tr></thead><tbody>${labPromedios.map(r=>`<tr><td><strong>${r.lab}</strong></td><td>${r.avg}d</td><td style="color:#888;font-size:11px">${getLimite(r.lab)}</td><td><span class="dash-pill dash-pill-${r.estado.clase}">${r.estado.texto}</span></td></tr>`).join('')}</tbody></table>`}
      </div>

      <div class="dash-section-label">Tipos de lente más pedidos (este mes)</div>
      <div class="dash-wide-card">
        ${lenteRanking.length===0 ? '<p class="dash-empty">Sin datos</p>' : `<div class="dash-rank-list">${lenteRanking.map(([lente,count],i) => { const pct=lenteRanking[0][1]>0?Math.round((count/lenteRanking[0][1])*100):0; return `<div class="dash-rank-item"><div class="dash-rank-num">${i+1}</div><div class="dash-rank-name" style="font-size:11px">${lente}</div><div class="dash-rank-bar-bg"><div class="dash-rank-bar-fill" style="width:${pct}%;background:${LAB_COLORS[i%LAB_COLORS.length]}"></div></div><div class="dash-rank-count">${count}</div></div>`; }).join('')}</div>`}
      </div>

      <div class="dash-section-label">Críticos y demorados 🔴</div>
      <div class="dash-wide-card" id="panel-criticos">${renderFilasCriticos(todos)}</div>

      <div class="dash-section-label">Para retirar 📦</div>
      <div class="dash-wide-card" id="panel-pendientes">${renderFilasPendientes(todos)}</div>

      <div class="dash-section-label">Últimos 10 pedidos ingresados</div>
      <div class="dash-wide-card" id="panel-ultimos">${renderFilasUltimos(todos)}</div>
    `;
  }

  function getLimite(lab) { return {Bichara:'≤2 días',Sol:'≤5 días',Vitolen:'≤5 días',Cristian:'≤7 días'}[lab]||'—'; }
  function getEstadoLab(lab,avg) {
    const r={Bichara:{ok:2,dem:4},Sol:{ok:5,dem:7},Vitolen:{ok:5,dem:7},Cristian:{ok:7,dem:10}}[lab]||{ok:5,dem:7};
    if(avg<=r.ok)  return{texto:'✅ OK',clase:'green'};
    if(avg<=r.dem) return{texto:'⚠️ Demorado',clase:'yellow'};
    return{texto:'🔴 Crítico',clase:'red'};
  }

  function renderFilasCriticos(todos) {
    const rows = todos.filter(p=>p.estado!=='Retirado'&&(p._est.valor==='critico'||p._est.valor==='demorado')).sort((a,b)=>b._dias-a._dias).slice(0,10);
    return rows.length ? rows.map(panelRow).join('') : '<p class="dash-empty">Sin pedidos críticos o demorados</p>';
  }
  function renderFilasPendientes(todos) {
    const rows = todos.filter(p=>p.estado==='Pendiente de retirar').sort((a,b)=>b._dias-a._dias).slice(0,10);
    return rows.length ? rows.map(panelRow).join('') : '<p class="dash-empty">Sin pedidos pendientes de retiro</p>';
  }
  function renderFilasUltimos(todos) {
    const rows = todos.sort((a,b)=>new Date(b.fecha_carga)-new Date(a.fecha_carga)).slice(0,10);
    return rows.length ? rows.map(panelRow).join('') : '<p class="dash-empty">Sin pedidos</p>';
  }

  function panelRow(p) {
    const estClase = p._est.valor==='critico'?'critico':p._est.valor==='demorado'?'demorado':'';
    const sufijo   = p.sufijo?`-${p.sufijo}`:'';
    return `<div class="panel-row ${estClase}">
      <span class="pr-orden">${p.orden}${sufijo}</span>
      <span class="pr-cliente">${escHtml(p.cliente)}</span>
      <span class="pr-lab">${p.laboratorio||'—'}</span>
      <span class="pr-dias">${p._dias}d</span>
      <span class="pr-est ${p._est.clase}">${p._est.texto}</span>
    </div>`;
  }

  function escHtml(str) {
    if(!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render, contarCriticos, irAPedidos, irAPedidosDemorados, irAPedidosCriticos, irAPedidosUrgentes, abrirExportador, cerrarExportador, generarPDF };
})();
