const state = {
  wells: [],
  selectedWellId: null,
  activeTab: 'candidatos',
};

const reasons = ['Ranking IWTT', 'Polímeros', 'Geles', 'Estudio', 'Proyecto Especial'];

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Error inesperado' }));
    throw new Error(error.detail || 'Error API');
  }
  return res.json();
}

async function loadWells() {
  state.wells = await api('/api/wells');
  render();
}

function setTab(tab) {
  state.activeTab = tab;
  if (tab !== 'candidatos') {
    state.selectedWellId = null;
  }
  render();
}

function filteredWells() {
  const search = document.getElementById('searchWell')?.value?.toLowerCase() || '';
  const field = document.getElementById('fieldFilter')?.value || '';
  const block = document.getElementById('blockFilter')?.value || '';
  return state.wells.filter((w) =>
    w.id.toLowerCase().includes(search)
    && (!field || w.field === field)
    && (!block || w.block === block)
  );
}

function renderListView() {
  const fields = [...new Set(state.wells.map((w) => w.field))];
  const blocks = [...new Set(state.wells.map((w) => w.block))];

  const container = document.getElementById('view-candidatos-lista');
  container.innerHTML = `
    <div class="layout-list">
      <div class="card filter-block">
        <h3>FILTROS</h3>
        <select id="fieldFilter" class="select">
          <option value="">Yacimiento</option>
          ${fields.map((f) => `<option>${f}</option>`).join('')}
        </select>
        <select id="blockFilter" class="select">
          <option value="">Bloque</option>
          ${blocks.map((b) => `<option>${b}</option>`).join('')}
        </select>
      </div>
      <div>
        <input class="search" id="searchWell" placeholder="Buscar Pozo" />
        <div class="card table-block">
          <h3>Ranking IWTT</h3>
          <table>
            <thead>
              <tr>
                <th>Inyector</th>
                <th>Ranking</th>
                <th>Ranking bloque</th>
                <th>Aprobación Técnica</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody id="wellsBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('fieldFilter').addEventListener('change', populateTable);
  document.getElementById('blockFilter').addEventListener('change', populateTable);
  document.getElementById('searchWell').addEventListener('input', populateTable);
  populateTable();
}

function populateTable() {
  const rows = filteredWells();
  const tbody = document.getElementById('wellsBody');
  tbody.innerHTML = rows.map((w) => `
    <tr class="clickable" data-id="${w.id}">
      <td>${w.id}</td>
      <td>${w.ranking}</td>
      <td>${w.block_ranking}</td>
      <td>${w.technical_approval === null ? '-' : (w.technical_approval ? 'SI' : 'NO')}</td>
      <td>${w.reason || '-'}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      state.selectedWellId = tr.dataset.id;
      render();
    });
  });
}

function checklistCompleted(well) {
  return Object.values(well.checklist).every(Boolean);
}

function renderDetailView() {
  const well = state.wells.find((w) => w.id === state.selectedWellId);
  const container = document.getElementById('view-candidato-detalle');
  if (!well) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <button id="backButton">Volver</button>
    <div class="detail-top">
      <div class="card detail-title">${well.id}</div>
      <div class="card approval-controls">
        <label>Aprobación técnica</label>
        <label><input type="radio" name="approval" value="si" ${well.technical_approval === true ? 'checked' : ''}/> SI</label>
        <label><input type="radio" name="approval" value="no" ${well.technical_approval === false ? 'checked' : ''}/> NO</label>
      </div>
    </div>

    <div class="detail-grid">
      <div class="card">
        <h3>Check list de revisión de pozo (A nivel Capa)</h3>
        ${Object.entries(well.checklist).map(([key, value]) => `
          <label class="checklist-item">
            <input type="checkbox" data-check="${key}" ${value ? 'checked' : ''}/>
            ${key.replaceAll('_', ' ')}
          </label>
        `).join('')}
      </div>
      <div>
        <div class="card reason-select">
          <label>Motivo</label>
          <select id="reasonSelect" class="select" ${well.technical_approval === true ? '' : 'disabled'}>
            <option value="">Seleccione...</option>
            ${reasons.map((r) => `<option ${well.reason === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        <div class="card">
          <h3>Mandriles a Trazar</h3>
          ${well.mandrels.map((m, idx) => `
            <label class="mandrel-item">
              <input type="checkbox" data-mandrel="${idx}" ${m.selected ? 'checked' : ''}/>
              ${m.name}
            </label>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  document.getElementById('backButton').addEventListener('click', () => {
    state.selectedWellId = null;
    render();
  });

  container.querySelectorAll('input[data-check]').forEach((input) => {
    input.addEventListener('change', async () => {
      well.checklist[input.dataset.check] = input.checked;
      await saveWell(well.id, { checklist: well.checklist });
    });
  });

  container.querySelectorAll('input[data-mandrel]').forEach((input) => {
    input.addEventListener('change', async () => {
      const idx = Number(input.dataset.mandrel);
      well.mandrels[idx].selected = input.checked;
      await saveWell(well.id, { mandrels: well.mandrels });
    });
  });

  container.querySelectorAll('input[name="approval"]').forEach((input) => {
    input.disabled = !checklistCompleted(well);
    input.addEventListener('change', async () => {
      await saveWell(well.id, { technical_approval: input.value === 'si' });
    });
  });

  const reasonSelect = document.getElementById('reasonSelect');
  reasonSelect.addEventListener('change', async () => {
    if (reasonSelect.value) {
      await saveWell(well.id, { reason: reasonSelect.value });
    }
  });
}

async function saveWell(id, payload) {
  try {
    const updated = await api(`/api/wells/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    state.wells = state.wells.map((w) => (w.id === id ? updated : w));
    render();
  } catch (err) {
    alert(err.message);
    await loadWells();
  }
}

function render() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });

  const header = document.getElementById('headerTitle');
  const listView = document.getElementById('view-candidatos-lista');
  const detailView = document.getElementById('view-candidato-detalle');
  const emptyView = document.getElementById('view-empty');

  if (state.activeTab !== 'candidatos') {
    header.textContent = 'Gestión Oportunidades IWTT';
    listView.classList.add('hidden');
    detailView.classList.add('hidden');
    emptyView.classList.remove('hidden');
    return;
  }

  emptyView.classList.add('hidden');
  if (state.selectedWellId) {
    header.textContent = 'Gestión Oportunidades IWTT - Pozo';
    listView.classList.add('hidden');
    detailView.classList.remove('hidden');
    renderDetailView();
  } else {
    header.textContent = 'Gestión Oportunidades IWTT';
    detailView.classList.add('hidden');
    listView.classList.remove('hidden');
    renderListView();
  }
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

loadWells();
