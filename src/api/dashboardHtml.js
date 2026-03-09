function renderDashboardHtml() {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SEACE Core</title>
    <style>
      :root {
        --bg: #07131f;
        --panel: rgba(10, 25, 39, 0.78);
        --panel-strong: rgba(15, 35, 55, 0.95);
        --text: #e8f2fb;
        --muted: #95abc2;
        --accent: #48c78e;
        --accent-2: #f6b93b;
        --danger: #ff6b6b;
        --line: rgba(162, 191, 222, 0.18);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(72, 199, 142, 0.25), transparent 28%),
          radial-gradient(circle at top right, rgba(246, 185, 59, 0.18), transparent 30%),
          linear-gradient(180deg, #08111a 0%, #0c1b2a 55%, #07131f 100%);
        min-height: 100vh;
      }

      .shell {
        max-width: 1180px;
        margin: 0 auto;
        padding: 28px 18px 42px;
      }

      .hero {
        padding: 26px;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: linear-gradient(135deg, rgba(8, 22, 35, 0.92), rgba(11, 31, 47, 0.78));
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
      }

      .tag {
        display: inline-flex;
        padding: 6px 12px;
        border-radius: 999px;
        background: rgba(72, 199, 142, 0.14);
        color: #bff4da;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 14px 0 10px;
        font-size: clamp(30px, 5vw, 54px);
        line-height: 1.02;
      }

      p {
        margin: 0;
        color: var(--muted);
        max-width: 800px;
        font-size: 15px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
        margin-top: 20px;
      }

      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        backdrop-filter: blur(18px);
      }

      .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .value { margin-top: 10px; font-size: 28px; font-weight: 700; }

      .columns {
        display: grid;
        grid-template-columns: 1.2fr 1fr;
        gap: 18px;
        margin-top: 18px;
      }

      .panel {
        min-height: 420px;
        background: var(--panel-strong);
        border: 1px solid var(--line);
        border-radius: 22px;
        padding: 18px;
      }

      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
      th { color: var(--muted); font-weight: 600; }
      code { color: #c7f3dd; }
      .logs {
        font-family: Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        display: grid;
        gap: 10px;
        max-height: 520px;
        overflow: auto;
      }

      .log {
        border: 1px solid var(--line);
        border-left: 3px solid var(--accent);
        border-radius: 14px;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.02);
      }

      .warn { border-left-color: var(--accent-2); }
      .error { border-left-color: var(--danger); }

      .section-title {
        margin: 0 0 14px;
        font-size: 18px;
      }

      @media (max-width: 960px) {
        .grid, .columns { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <div class="tag">SEACE Core / VPS Mode</div>
        <h1>Monitoreo diario de Buena Pro y leads oficiales desde PDF</h1>
        <p>El microservicio mantiene una base limpia, reevalua candidatos por fecha, extrae contactos oficiales del PDF ganador y publica la salida esperada para n8n.</p>
      </section>

      <section class="grid">
        <article class="card"><div class="label">Total Procesos</div><div class="value" id="total-processes">-</div></article>
        <article class="card"><div class="label">Leads Finales</div><div class="value" id="total-leads">-</div></article>
        <article class="card"><div class="label">Pendientes</div><div class="value" id="pending-count">-</div></article>
        <article class="card"><div class="label">Completados</div><div class="value" id="completed-count">-</div></article>
      </section>

      <section class="columns">
        <article class="panel">
          <h2 class="section-title">Procesos recientes</h2>
          <table>
            <thead>
              <tr>
                <th>Nomenclatura</th>
                <th>Estado</th>
                <th>Buena Pro</th>
                <th>Siguiente revision</th>
              </tr>
            </thead>
            <tbody id="processes-body"></tbody>
          </table>
        </article>
        <article class="panel">
          <h2 class="section-title">Eventos en vivo</h2>
          <div class="logs" id="logs"></div>
        </article>
      </section>
    </div>

    <script>
      async function refresh() {
        const [healthRes, processesRes] = await Promise.all([
          fetch('/health'),
          fetch('/api/processes?limit=12')
        ]);
        const health = await healthRes.json();
        const processes = await processesRes.json();

        document.getElementById('total-processes').textContent = health.summary.totalProcesses;
        document.getElementById('total-leads').textContent = health.summary.totalLeads;
        document.getElementById('pending-count').textContent = health.summary.pendingReview;
        document.getElementById('completed-count').textContent = health.summary.completed;

        const tbody = document.getElementById('processes-body');
        tbody.innerHTML = processes.items.map((item) => 
          '<tr>' +
            '<td><code>' + (item.nomenclature || '-') + '</code></td>' +
            '<td>' + (item.review_state || '-') + '</td>' +
            '<td>' + (item.award_date || '-') + '</td>' +
            '<td>' + (item.next_review_at || '-') + '</td>' +
          '</tr>'
        ).join('');
      }

      function appendLog(entry) {
        const logs = document.getElementById('logs');
        const div = document.createElement('div');
        div.className = 'log ' + (entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : '');
        div.innerHTML = '<strong>' + entry.eventName + '</strong><br>' + entry.message + '<br><small>' + entry.timestamp + '</small>';
        logs.prepend(div);
        while (logs.children.length > 40) {
          logs.removeChild(logs.lastChild);
        }
      }

      const stream = new EventSource('/api/stream');
      stream.addEventListener('message', (event) => {
        const data = JSON.parse(event.data);
        appendLog(data);
      });

      refresh();
      setInterval(refresh, 10000);
    </script>
  </body>
</html>`;
}

module.exports = { renderDashboardHtml };
