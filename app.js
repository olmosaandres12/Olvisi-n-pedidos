/* ── PAMI — KPIs globales ────────────────────────── */
.pami-kpis-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.pami-kpi-card {
  border-radius: var(--radius);
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.pami-kpi-icon { font-size: 1.3rem; line-height: 1; }
.pami-kpi-val  { font-size: 1.8rem; font-weight: 800; line-height: 1; }
.pami-kpi-lbl  { font-size: .72rem; opacity: .75; font-weight: 500; }
.pami-kpi-card--blue   { background: #EFF6FF; color: #1D4ED8; }
.pami-kpi-card--indigo { background: #EEF2FF; color: #4338CA; }
.pami-kpi-card--green  { background: #F0FDF4; color: #15803D; }
.pami-kpi-card--amber  { background: #FFFBEB; color: #B45309; }

/* ── PAMI — Stats del mes ────────────────────────── */
.pami-mes-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.pami-mes-stat {
  flex: 1;
  min-width: 64px;
  background: var(--gris-bg, #F5F6FA);
  border-radius: var(--radius-sm, 10px);
  padding: 10px 8px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pami-mes-stat-val { font-size: 1.4rem; font-weight: 800; line-height: 1; color: var(--azul); }
.pami-mes-stat-lbl { font-size: .68rem; color: var(--gris-texto); font-weight: 500; }
.pami-mes-stat--green .pami-mes-stat-val { color: #15803D; }
.pami-mes-stat--amber .pami-mes-stat-val { color: #B45309; }
.pami-mes-stat--blue  .pami-mes-stat-val { color: #1D4ED8; }

/* ── PAMI — Cards de pedidos ─────────────────────── */
.pami-card {
  background: var(--blanco);
  border-radius: var(--radius-sm, 10px);
  border: 1.5px solid var(--gris-borde);
  margin-bottom: 8px;
  overflow: hidden;
}
.pami-card-left {
  padding: 12px 14px;
  border-left: 4px solid #888;
}
.pami-card-cliente {
  font-size: .95rem;
  font-weight: 700;
  color: var(--gris-dark);
  margin-bottom: 4px;
}
.pami-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  font-size: .78rem;
  color: var(--gris-texto);
  margin-bottom: 6px;
}
.pami-card-orden { font-weight: 600; color: var(--azul); }
.pami-card-sep   { opacity: .4; }
.pami-card-lab   { opacity: .8; }
.pami-card-afiliado {
  font-size: .75rem;
  color: var(--gris-texto);
  margin-bottom: 6px;
}
.pami-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}
.pami-card-estado {
  font-size: .72rem;
  font-weight: 600;
}
