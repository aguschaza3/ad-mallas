const state = {
  wells: [],
  selectedWellId: null,
  activeTab: 'candidatos',
  listPage: { cand: 1, val: 1, cro: 1 },
};

const MAX_PAGE_SIZE = 25;

const reasons = ['Ranking IWTT', 'Polímeros', 'Geles', 'Estudio', 'Proyecto Especial'];

const technicalChecklistLabels = {
  productores_asociados: 'Productores Asociados',
  mallas_vecinas: 'Mallas Vecinas',
  historia_inyeccion: 'Historia Inyección',
  chequear_dp_dp: 'Chequear Dp DP',
  efectivizacion: 'Efectivización',
};

const operationalChecklistLabels = {
  estado_pozo: 'Estado de pozo',
  integridad_superficie: 'Integridad de instalación de superficie',
  integridad_fondo: 'Integridad de instalación de fondo',
  perdidas_pkrs: 'Pérdidas de PKRS',
};

function defaultOperationalChecklist() {
  return {
    estado_pozo: false,
    integridad_superficie: false,
    integridad_fondo: false,
    perdidas_pkrs: false,
  };
}

function normalizeWell(well) {
  const normalized = { ...well };

  if (!normalized.checklist) {
    normalized.checklist = {};
  }

  if (!Array.isArray(normalized.mandrels)) {
    normalized.mandrels = [];
  }

  normalized.technical_approval = normalized.technical_approval ?? false;
  normalized.operational_approval = normalized.operational_approval ?? false;
  normalized.operational_observations = normalized.operational_observations || '';
  const opChecklist = normalized.operational_checklist || {};
  normalized.operational_checklist = Object.fromEntries(
    Object.keys(defaultOperationalChecklist()).map((key) => [key, Boolean(opChecklist[key])]),
  );

  if (!Array.isArray(normalized.validated_mandrels)) {
    normalized.validated_mandrels = normalized.mandrels
      .filter((m) => m.selected)
      .map((m) => ({ name: m.name, selected: false }));
  }

  return normalized;
}

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
  const data = await api('/api/wells');
  state.wells = data.map(normalizeWell);
  render();
}

function setTab(tab) {
  state.activeTab = tab;
  state.selectedWellId = null;
  state.listPage.cand = 1;
  state.listPage.val = 1;
  state.listPage.cro = 1;
  render();
}

function sourceForMode(mode) {
  if (mode === 'validadas') {
    return state.wells.filter((w) => w.technical_approval === true);
  }
  if (mode === 'cronograma') {
    return state.wells.filter((w) => w.operational_approval === true);
  }
  return state.wells;
}

function filteredWells(prefix, mode = 'candidatos') {
  const search = document.getElementById(`${prefix}SearchWell`)?.value?.toLowerCase() || '';
  const field = document.getElementById(`${prefix}FieldFilter`)?.value || '';
  const block = document.getElementById(`${prefix}BlockFilter`)?.value || '';

  const candidates = sourceForMode(mode);

  return candidates.filter((w) =>
    w.id.toLowerCase().includes(search)
    && (!field || w.field === field)
    && (!block || w.block === block)
  );
}

function tableRows(rows, mode = 'candidatos', rowClickable = true) {
  if (mode === 'validadas' || mode === 'cronograma') {
    return rows.map((w) => `
      <tr class="${rowClickable ? 'clickable' : ''}" data-id="${w.id}">
        <td>${w.id}</td>
        <td>${w.ranking}</td>
        <td>${w.technical_approval ? 'SI' : 'NO'}${w.reason ? ` (${w.reason})` : ''}</td>
        <td>${w.operational_approval ? 'SI' : 'NO'}</td>
      </tr>
    `).join('');
  }

  return rows.map((w) => `
    <tr class="${rowClickable ? 'clickable' : ''}" data-id="${w.id}">
      <td>${w.id}</td>
      <td>${w.ranking}</td>
      <td>${w.block_ranking}</td>
      <td>${w.technical_approval ? 'SI' : 'NO'}</td>
      <td>${w.reason || '-'}</td>
    </tr>
  `).join('');
}

function currentPageSize(prefix) {
  const tbody = document.getElementById(`${prefix}WellsBody`);
  if (!tbody) {
    return MAX_PAGE_SIZE;
  }

  const tableBlock = tbody.closest('.table-block');
  const title = tableBlock?.querySelector('h3');
  const footer = tableBlock?.querySelector('.table-footer');
  const thead = tableBlock?.querySelector('thead');

  if (!tableBlock || !title || !footer || !thead) {
    return MAX_PAGE_SIZE;
  }

  const rowHeightVar = getComputedStyle(document.documentElement).getPropertyValue('--table-row-height');
  const rowHeight = Number.parseFloat(rowHeightVar) || 36;
  const availableHeight = tableBlock.clientHeight - title.offsetHeight - footer.offsetHeight - thead.offsetHeight - 30;
  const visibleRows = Math.floor(availableHeight / rowHeight);

  return Math.max(3, Math.min(MAX_PAGE_SIZE, visibleRows));
}

function bindListEvents(prefix, mode = 'candidatos', rowClickable = true) {
  const populate = () => {
    const allRows = filteredWells(prefix, mode);
    const tbody = document.getElementById(`${prefix}WellsBody`);
    const pageSize = currentPageSize(prefix);
    const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
    state.listPage[prefix] = Math.min(state.listPage[prefix] || 1, totalPages);

    const start = (state.listPage[prefix] - 1) * pageSize;
    const end = start + pageSize;
    const pageRows = allRows.slice(start, end);
    const rowsHtml = tableRows(pageRows, mode, rowClickable);
    const columnsCount = tbody.closest('table')?.querySelectorAll('thead th').length || 1;
    const emptyRowsCount = Math.max(0, pageSize - pageRows.length);
    const emptyRowsHtml = Array.from({ length: emptyRowsCount }, () => `
      <tr class="empty-row">
        ${Array.from({ length: columnsCount }, () => '<td>&nbsp;</td>').join('')}
      </tr>
    `).join('');

    tbody.innerHTML = rowsHtml + emptyRowsHtml;

    const pagerInfo = document.getElementById(`${prefix}PagerInfo`);
    const prevBtn = document.getElementById(`${prefix}PrevPage`);
    const nextBtn = document.getElementById(`${prefix}NextPage`);

    if (pagerInfo) {
      const base = `Página ${state.listPage[prefix]} de ${totalPages}`;
      pagerInfo.textContent = allRows.length
        ? `${base} · Mostrando ${start + 1}-${Math.min(end, allRows.length)} de ${allRows.length} pozos`
        : 'Sin resultados';
    }

    if (prevBtn) prevBtn.disabled = state.listPage[prefix] <= 1;
    if (nextBtn) nextBtn.disabled = state.listPage[prefix] >= totalPages;

    if (rowClickable) {
      tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
        tr.addEventListener('click', () => {
          state.selectedWellId = tr.dataset.id;
          render();
        });
      });
    }
  };

  const resetAndPopulate = () => {
    state.listPage[prefix] = 1;
    populate();
  };

  document.getElementById(`${prefix}FieldFilter`).addEventListener('change', resetAndPopulate);
  document.getElementById(`${prefix}BlockFilter`).addEventListener('change', resetAndPopulate);
  document.getElementById(`${prefix}SearchWell`).addEventListener('input', resetAndPopulate);

  document.getElementById(`${prefix}PrevPage`).addEventListener('click', () => {
    if ((state.listPage[prefix] || 1) > 1) {
      state.listPage[prefix] -= 1;
      populate();
    }
  });

  document.getElementById(`${prefix}NextPage`).addEventListener('click', () => {
    state.listPage[prefix] += 1;
    populate();
  });

  populate();
}

function listLayoutTemplate(prefix, title, columns, mode = 'candidatos') {
  const source = sourceForMode(mode);
  const fields = [...new Set(source.map((w) => w.field))];
  const blocks = [...new Set(source.map((w) => w.block))];

  return `
    <div class="layout-list">
      <div class="card filter-block">
        <h3>FILTROS</h3>
        <select id="${prefix}FieldFilter" class="select">
          <option value="">Yacimiento</option>
          ${fields.map((f) => `<option>${f}</option>`).join('')}
        </select>
        <select id="${prefix}BlockFilter" class="select">
          <option value="">Bloque</option>
          ${blocks.map((b) => `<option>${b}</option>`).join('')}
        </select>
      </div>
      <div class="list-main">
        <input class="search" id="${prefix}SearchWell" placeholder="Buscar Pozo" />
        <div class="card table-block">
          <h3>${title}</h3>
          <table>
            <thead>
              <tr>
                ${columns.map((c) => `<th>${c}</th>`).join('')}
              </tr>
            </thead>
            <tbody id="${prefix}WellsBody"></tbody>
          </table>
          <div class="table-footer">
            <span id="${prefix}PagerInfo" class="pager-info"></span>
            <div class="pager-controls">
              <button id="${prefix}PrevPage" class="pager-btn" type="button">Anterior</button>
              <button id="${prefix}NextPage" class="pager-btn" type="button">Siguiente</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCandidatosListView() {
  const container = document.getElementById('view-candidatos-lista');
  container.innerHTML = listLayoutTemplate(
    'cand',
    'Ranking IWTT',
    ['Inyector', 'Ranking', 'Ranking bloque', 'Aprobación Técnica', 'Motivo'],
    'candidatos',
  );
  bindListEvents('cand', 'candidatos');
}

function renderCronogramaListView() {
  const container = document.getElementById('view-cronograma-lista');
  container.innerHTML = listLayoutTemplate(
    'cro',
    'Oportunidades Listas para Cronograma',
    ['Inyector', 'Ranking', 'Aprobación Técnica (Motivo)', 'Aprobación Operativa'],
    'cronograma',
  );
  bindListEvents('cro', 'cronograma', false);
}

function checklistCompleted(well) {
  return Object.values(well.checklist).every(Boolean);
}

function operationalChecklistCompleted(well) {
  return Object.values(well.operational_checklist).every(Boolean);
}

function renderCandidatoDetailView() {
  const well = state.wells.find((w) => w.id === state.selectedWellId);
  const container = document.getElementById('view-candidato-detalle');
  if (!well) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="detail-top">
      <div class="card detail-title-row">
        <div class="detail-title">${well.id}</div>
      </div>
      <div class="card approval-controls">
        <label>Aprobación técnica</label>
        <label><input type="radio" name="approval" value="si" ${well.technical_approval === true ? 'checked' : ''} ${checklistCompleted(well) ? '' : 'disabled'}/> SI</label>
        <label><input type="radio" name="approval" value="no" ${well.technical_approval !== true ? 'checked' : ''}/> NO</label>
      </div>
    </div>

    <div class="detail-grid">
      <div class="card checklist-card">
        <h3>Check list de revisión de pozo (A nivel Capa)</h3>
        ${Object.entries(well.checklist).map(([key, value]) => `
          <label class="checklist-item">
            <input type="checkbox" data-check="${key}" ${value ? 'checked' : ''}/>
            ${technicalChecklistLabels[key] || key.replaceAll('_', ' ')}
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

function renderValidadasListView() {
  const container = document.getElementById('view-validadas-lista');
  container.innerHTML = listLayoutTemplate(
    'val',
    'Oportunidades Aprobadas Técnicamente',
    ['Inyector', 'Ranking', 'Aprobación Técnica (Motivo)', 'Aprobación Operativa'],
    'validadas',
  );
  bindListEvents('val', 'validadas');
}

function renderValidadasDetailView() {
  const well = state.wells.find((w) => w.id === state.selectedWellId);
  const container = document.getElementById('view-validadas-detalle');
  if (!well) {
    container.innerHTML = '';
    return;
  }

  const availableMandrels = well.mandrels.filter((m) => m.selected);
  if (!well.validated_mandrels?.length && availableMandrels.length) {
    well.validated_mandrels = availableMandrels.map((m) => ({ name: m.name, selected: false }));
  }

  container.innerHTML = `
    <div class="detail-top">
      <div class="card detail-title-row">
        <div class="detail-title">${well.id}</div>
      </div>
      <div class="card approval-controls">
        <label>Aprobación operativa</label>
        <label><input type="radio" name="opApproval" value="si" ${well.operational_approval === true ? 'checked' : ''} ${(well.technical_approval === true && operationalChecklistCompleted(well)) ? '' : 'disabled'}/> SI</label>
        <label><input type="radio" name="opApproval" value="no" ${well.operational_approval !== true ? 'checked' : ''}/> NO</label>
      </div>
    </div>

    <div class="detail-grid">
      <div class="card checklist-card">
        <h3>Check list de revisión Operativa de pozo</h3>
        ${Object.keys(defaultOperationalChecklist()).map((key) => `
          <label class="checklist-item">
            <input type="checkbox" data-op-check="${key}" ${well.operational_checklist[key] ? 'checked' : ''}/>
            ${operationalChecklistLabels[key]}
          </label>
        `).join('')}
      </div>
      <div>
        <div class="card reason-select">
          <label>Observaciones</label>
          <textarea id="operationalObservation" class="textarea" rows="4" placeholder="Escribí observaciones operativas...">${well.operational_observations || ''}</textarea>
        </div>
        <div class="card">
          <h3>Mandriles a Trazar</h3>
          ${well.validated_mandrels.length
            ? well.validated_mandrels.map((m, idx) => `
              <label class="mandrel-item">
                <input type="checkbox" data-op-mandrel="${idx}" ${m.selected ? 'checked' : ''}/>
                ${m.name}
              </label>
            `).join('')
            : '<p class="empty-note">No hay mandriles seleccionados desde Candidatos.</p>'}
        </div>
      </div>
    </div>
  `;


  container.querySelectorAll('input[data-op-check]').forEach((input) => {
    input.addEventListener('change', async () => {
      well.operational_checklist[input.dataset.opCheck] = input.checked;
      await saveWell(well.id, { operational_checklist: well.operational_checklist });
    });
  });

  container.querySelectorAll('input[name="opApproval"]').forEach((input) => {
    input.addEventListener('change', async () => {
      await saveWell(well.id, { operational_approval: input.value === 'si' });
    });
  });

  container.querySelectorAll('input[data-op-mandrel]').forEach((input) => {
    input.addEventListener('change', async () => {
      const idx = Number(input.dataset.opMandrel);
      well.validated_mandrels[idx].selected = input.checked;
      await saveWell(well.id, { validated_mandrels: well.validated_mandrels });
    });
  });

  const observation = document.getElementById('operationalObservation');
  observation.addEventListener('change', async () => {
    await saveWell(well.id, { operational_observations: observation.value });
  });
}

async function saveWell(id, payload) {
  try {
    const previous = state.wells.find((w) => w.id === id) || {};
    const response = await api(`/api/wells/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    const merged = {
      ...previous,
      ...response,
      ...(payload.checklist && Object.values(payload.checklist).includes(false)
        ? { technical_approval: false, reason: null }
        : {}),
      ...(payload.operational_checklist ? { operational_checklist: payload.operational_checklist } : {}),
      ...(payload.operational_checklist && Object.values(payload.operational_checklist).includes(false)
        ? { operational_approval: false }
        : {}),
      ...(payload.validated_mandrels ? { validated_mandrels: payload.validated_mandrels } : {}),
      ...(payload.operational_observations !== undefined ? { operational_observations: payload.operational_observations } : {}),
      ...(payload.operational_approval !== undefined ? { operational_approval: payload.operational_approval } : {}),
    };

    const updated = normalizeWell(merged);
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
  const headerBackButton = document.getElementById('headerBackButton');

  headerBackButton.classList.add('hidden');
  headerBackButton.onclick = null;

  const candidatosListView = document.getElementById('view-candidatos-lista');
  const candidatoDetailView = document.getElementById('view-candidato-detalle');
  const validadasListView = document.getElementById('view-validadas-lista');
  const validadasDetailView = document.getElementById('view-validadas-detalle');
  const cronogramaListView = document.getElementById('view-cronograma-lista');
  const emptyView = document.getElementById('view-empty');

  [candidatosListView, candidatoDetailView, validadasListView, validadasDetailView, cronogramaListView, emptyView]
    .forEach((el) => el.classList.add('hidden'));

  if (state.activeTab === 'candidatos') {
    if (state.selectedWellId) {
      header.textContent = 'Gestión Oportunidades IWTT - Pozo';
      headerBackButton.classList.remove('hidden');
      headerBackButton.onclick = () => {
        state.selectedWellId = null;
        render();
      };
      candidatoDetailView.classList.remove('hidden');
      renderCandidatoDetailView();
    } else {
      header.textContent = 'Gestión Oportunidades IWTT';
      candidatosListView.classList.remove('hidden');
      renderCandidatosListView();
    }
    return;
  }

  if (state.activeTab === 'validadas') {
    if (state.selectedWellId) {
      header.textContent = 'Gestión Oportunidades Validadas IWTT - Pozo';
      headerBackButton.classList.remove('hidden');
      headerBackButton.onclick = () => {
        state.selectedWellId = null;
        render();
      };
      validadasDetailView.classList.remove('hidden');
      renderValidadasDetailView();
    } else {
      header.textContent = 'Gestión Oportunidades Validadas IWTT';
      validadasListView.classList.remove('hidden');
      renderValidadasListView();
    }
    return;
  }

  if (state.activeTab === 'cronograma') {
    header.textContent = 'Gestión Oportunidades Listas IWTT';
    cronogramaListView.classList.remove('hidden');
    renderCronogramaListView();
    return;
  }

  header.textContent = 'Gestión Oportunidades IWTT';
  emptyView.classList.remove('hidden');
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

window.addEventListener('resize', () => {
  if (state.selectedWellId) {
    return;
  }
  render();
});

loadWells();
