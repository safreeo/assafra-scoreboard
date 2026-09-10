// ==================== PWA UPDATE LISTENER ====================
let newWorker;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          document.getElementById('pwa-update-toast').classList.remove('hidden');
        }
      });
    });
  });
}

function reloadAppUpdate() {
  if (newWorker) newWorker.postMessage({ action: 'skipWaiting' });
  window.location.reload();
}

// ==================== STANDARDIZED DATE FORMATTER (DD-MM-YYYY) ====================
function formatDateDDMMYYYY(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(dateInput)) {
    return dateInput;
  }
  
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const parts = dateInput.split('-');
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return String(dateInput);
  }
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// ==================== HARDWARE BACK BUTTON TRAP ====================
window.addEventListener('popstate', () => {
  const scoringScreen = document.getElementById('screen-scoring');
  if (scoringScreen && !scoringScreen.classList.contains('screen-hidden')) {
    history.pushState(null, null, window.location.href);
    handleExitSessionPrompt();
    return;
  }
  const manualScreen = document.getElementById('screen-manual');
  const contactScreen = document.getElementById('screen-contact');
  if ((manualScreen && !manualScreen.classList.contains('screen-hidden')) ||
      (contactScreen && !contactScreen.classList.contains('screen-hidden'))) {
    history.pushState(null, null, window.location.href);
    showScreen('screen-settings');
    return;
  }
  const settingsScreen = document.getElementById('screen-settings');
  const historyScreen = document.getElementById('screen-history');
  const profileScreen = document.getElementById('screen-profile');
  const setupScreen = document.getElementById('screen-setup');
  
  if ((settingsScreen && !settingsScreen.classList.contains('screen-hidden')) ||
      (historyScreen && !historyScreen.classList.contains('screen-hidden')) ||
      (profileScreen && !profileScreen.classList.contains('screen-hidden')) ||
      (setupScreen && !setupScreen.classList.contains('screen-hidden'))) {
    history.pushState(null, null, window.location.href);
    showScreen('screen-home');
  }
});

history.pushState(null, null, window.location.href);

// ==================== SCREEN WAKE LOCK ====================
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('Wake Lock request failed:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => { wakeLock = null; });
  }
}

// ==================== AUTO LOCATION & SETTINGS PREFERENCES ====================
function getAppSetting(key, defaultValue) {
  const saved = localStorage.getItem(`assafra_setting_${key}`);
  return saved !== null ? JSON.parse(saved) : defaultValue;
}

function setAppSetting(key, value) {
  localStorage.setItem(`assafra_setting_${key}`, JSON.stringify(value));
}

let detectedLocation = getAppSetting('default_location', 'Putatan, Sabah');

function fetchCurrentLocation() {
  const isGpsEnabled = getAppSetting('auto_gps', true);
  if (!isGpsEnabled) {
    detectedLocation = getAppSetting('default_location', 'Putatan, Sabah');
    return;
  }

  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
          const data = await res.json();
          if (data && data.address) {
            const city = data.address.town || data.address.city || data.address.municipality || data.address.county || 'Putatan';
            const state = data.address.state || 'Sabah';
            detectedLocation = `${city}, ${state}`;
          }
        } catch (err) {
          console.warn('Reverse geocoding error:', err);
        }
      },
      (err) => console.warn('Geolocation unavailable:', err),
      { timeout: 8000 }
    );
  }
}

fetchCurrentLocation();

// ==================== AUDIO SYNTHESIZER ====================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) audioCtx = new AudioCtx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playBeepSound(frequency = 800, duration = 0.15, type = 'sine') {
  const soundEnabled = getAppSetting('sound_enabled', true);
  if (!soundEnabled) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Audio play failed:', e);
  }
}

function playStartSound() {
  playBeepSound(659.25, 0.1, 'triangle');
  setTimeout(() => playBeepSound(880, 0.25, 'triangle'), 120);
}

function playCountdownBeep() {
  playBeepSound(900, 0.12, 'sine');
}

function playFinishTimerSequence() {
  playBeepSound(520, 0.15, 'square');
  setTimeout(() => playBeepSound(780, 0.15, 'square'), 160);
  setTimeout(() => playBeepSound(1040, 0.45, 'square'), 320);
}

// ==================== GLOBAL CONFIG & MATRICES ====================
let currentPracticeMode = 'personal';
let activeArchers = [];
let editingPresetId = null;
let editingMatrixId = null;
let isManualEditModeActive = false;
let isSessionFinishedLocked = false;
let pendingIncompleteTarget = null;
let lateArcherCount = 1;
let endsManagerCount = 6;
let isMasterArcherSelectMode = false;
let editingMasterArcherOldName = null;
let tempSelectedRoundForSwitch = 1;

let submittedEndsTracker = {};
let setupUndoStack = [];

function pushSetupUndoState() {
  setupUndoStack.push({
    archers: getArcherHistory(),
    presets: getPresets(),
    matrices: getMatrices()
  });
  if (setupUndoStack.length > 20) setupUndoStack.shift();
}

function undoSetupAction() {
  if (setupUndoStack.length > 0) {
    const prevState = setupUndoStack.pop();
    localStorage.setItem('assafra_archers_history', JSON.stringify(prevState.archers));
    localStorage.setItem('assafra_presets', JSON.stringify(prevState.presets));
    localStorage.setItem('assafra_matrices', JSON.stringify(prevState.matrices));

    initArcherSection();
    initPresetSelector();
    initMatrices();
    validateSetupInputs();
    alert('Action undone successfully.');
  } else {
    alert('No actions to undo.');
  }
}

const DEFAULT_PRESETS = [
  { id: "preset_30m_rings", name: "30m 10 Rings", distance: 30, tfSize: 80, rounds: 1, ends: 6, arrows: 6, matrix: "1-10-X-M", timerEnabled: false, timerSeconds: 60, laneEnabled: false, laneNo: "" }
];

const DEFAULT_MATRICES = [
  { id: "1-10-X-M", label: "1 - 10, X, M", values: ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"], isDefault: true },
  { id: "1-10-M", label: "1 - 10, M", values: ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"], isDefault: true },
  { id: "1-5-M", label: "1 - 5, M", values: ["5", "4", "3", "2", "1", "M"], isDefault: true },
  { id: "1-6-M", label: "1 - 6, M", values: ["6", "5", "4", "3", "2", "1", "M"], isDefault: true },
  { id: "5-10-M", label: "5 - 10, M", values: ["10", "9", "8", "7", "6", "5", "M"], isDefault: true }
];

const ALL_MATRIX_POINT_OPTIONS = ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"];

// ==================== SCREEN NAVIGATION & RESUME ====================
function showScreen(screenId) {
  const screens = ['screen-home', 'screen-setup', 'screen-history', 'screen-profile', 'screen-settings', 'screen-manual', 'screen-contact', 'screen-scoring'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === screenId) el.classList.remove('screen-hidden');
      else el.classList.add('screen-hidden');
    }
  });

  if (screenId === 'screen-setup') {
    releaseWakeLock();
    stopEndTimer();
    initMatrices();
    initPresetSelector();
    initArcherSection();
    checkActiveSessionBackup();
    fetchCurrentLocation();
    validateSetupInputs();
  } else if (screenId === 'screen-history') {
    releaseWakeLock();
    stopEndTimer();
    loadPracticeHistory();
  } else if (screenId === 'screen-profile') {
    releaseWakeLock();
    stopEndTimer();
    initArcherProfileScreen();
  } else if (screenId === 'screen-settings') {
    releaseWakeLock();
    stopEndTimer();
    initSettingsScreen();
  } else if (screenId === 'screen-manual') {
    releaseWakeLock();
    stopEndTimer();
  } else if (screenId === 'screen-contact') {
    releaseWakeLock();
    stopEndTimer();
  } else if (screenId === 'screen-home') {
    releaseWakeLock();
    stopEndTimer();
  }
}

function checkActiveSessionBackup() {
  const savedBackup = localStorage.getItem('assafra_active_session_backup');
  const banner = document.getElementById('resume-session-banner');
  if (savedBackup) {
    const data = JSON.parse(savedBackup);
    document.getElementById('resume-banner-meta').textContent = `${data.session.distance}M • End ${data.currentEnd}/${data.session.ends} • Round ${data.currentRound}`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function resumeSavedSession() {
  const savedBackup = localStorage.getItem('assafra_active_session_backup');
  if (savedBackup) {
    const data = JSON.parse(savedBackup);
    activeSession = data.session;
    sessionScores = data.scores;
    currentRound = data.currentRound;
    currentEnd = data.currentEnd;
    currentArcherIndex = data.currentArcherIndex || 0;
    targetEndIndex = data.targetEndIndex !== undefined ? data.targetEndIndex : (currentEnd - 1);
    targetArrowIndex = data.targetArrowIndex || 0;
    
    submittedEndsTracker = {};
    if (data.submittedEndsTracker) {
      Object.keys(data.submittedEndsTracker).forEach(arch => {
        submittedEndsTracker[arch] = data.submittedEndsTracker[arch].map(arr => new Set(arr));
      });
    } else {
      activeSession.archers.forEach(name => {
        submittedEndsTracker[name] = [];
        for (let r = 0; r < activeSession.rounds; r++) submittedEndsTracker[name].push(new Set());
      });
    }

    isSessionFinishedLocked = false;
    requestWakeLock();
    initScoringScreen();
    showScreen('screen-scoring');
  }
}

function discardSavedSession() {
  localStorage.removeItem('assafra_active_session_backup');
  checkActiveSessionBackup();
}

// ==================== SETUP VALIDATION ====================
function validateSetupInputs() {
  const dist = document.getElementById('input-distance').value.trim();
  const tf = document.getElementById('input-tf-size').value.trim();
  const rounds = document.getElementById('input-rounds').value.trim();
  const ends = document.getElementById('input-ends').value.trim();
  const arrows = document.getElementById('input-arrows').value.trim();
  const matrix = document.getElementById('select-matrix').value;

  const isValid = dist && tf && rounds && ends && arrows && matrix &&
                  parseInt(dist, 10) > 0 &&
                  parseInt(tf, 10) > 0 &&
                  parseInt(rounds, 10) > 0 &&
                  parseInt(ends, 10) > 0 &&
                  parseInt(arrows, 10) > 0;

  const btn = document.getElementById('btn-start-session-action');
  if (isValid) {
    btn.className = 'btn-start-session btn-start-valid';
    btn.disabled = false;
  } else {
    btn.className = 'btn-start-session btn-start-invalid';
    btn.disabled = true;
  }
}

// ==================== SETUP LOGIC ====================
function getPersonalName() {
  return localStorage.getItem('assafra_personal_name') || '';
}

function savePersonalName(name) {
  const val = name.trim();
  localStorage.setItem('assafra_personal_name', val);
}

function resetPersonalNameInput() {
  pushSetupUndoState();
  localStorage.removeItem('assafra_personal_name');
  document.getElementById('input-personal-name').value = '';
  validateSetupInputs();
}

function setPracticeMode(mode) {
  currentPracticeMode = mode;
  document.getElementById('btn-mode-personal').classList.toggle('active', mode === 'personal');
  document.getElementById('btn-mode-team').classList.toggle('active', mode === 'team');
  
  const teamBox = document.getElementById('team-selector-box');
  const personalBox = document.getElementById('personal-name-box');
  const masterSection = document.getElementById('card-master-archer-section');

  if (mode === 'team') {
    teamBox.classList.remove('hidden');
    personalBox.classList.add('hidden');
    if (masterSection) masterSection.classList.remove('hidden');
  } else {
    teamBox.classList.add('hidden');
    personalBox.classList.remove('hidden');
    if (masterSection) masterSection.classList.add('hidden');
    document.getElementById('input-personal-name').value = getPersonalName();
  }
  validateSetupInputs();
  renderMasterArcherList();
}

function getArcherHistory() {
  const saved = localStorage.getItem('assafra_archers_history');
  return saved ? JSON.parse(saved) : [];
}

function initArcherSection() {
  document.getElementById('input-personal-name').value = getPersonalName();
  const history = getArcherHistory();
  if (activeArchers.length === 0 && history.length > 0) {
    activeArchers = [];
  }
  renderActiveArchers();
  populateArcherHistoryDropdown();
  renderMasterArcherList();
}

function renderActiveArchers() {
  const container = document.getElementById('archer-chips-container');
  container.innerHTML = '';
  activeArchers.forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'archer-chip';
    chip.innerHTML = `
      <span>${name}</span>
      <button type="button" class="chip-del-btn" onclick="removeActiveArcher('${name}')">✕</button>
    `;
    container.appendChild(chip);
  });
  document.getElementById('archer-count-badge').textContent = `${activeArchers.length} active`;
}

function populateArcherHistoryDropdown() {
  const history = getArcherHistory();
  const select = document.getElementById('select-archers-history');
  select.innerHTML = '<option value="">-- Select from Master Archer List --</option>';
  history.forEach(name => {
    if (!activeArchers.includes(name)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  });
}

function renderMasterArcherList() {
  const history = getArcherHistory();
  const container = document.getElementById('archer-master-list');
  const headerLabel = document.querySelector('#card-master-archer-section .group-header-label');
  
  if (headerLabel) {
    if (history.length === 0) {
      headerLabel.classList.add('title-blinking-red');
    } else {
      headerLabel.classList.remove('title-blinking-red');
    }
  }

  if (!container) return;
  container.innerHTML = '';

  if (history.length === 0) {
    container.innerHTML = '<span style="font-size:0.75rem; color:#94a3b8;">No master archers saved yet.</span>';
    return;
  }

  history.forEach(name => {
    const row = document.createElement('div');
    row.className = 'archer-history-item-row';
    row.innerHTML = `
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>
      <div style="display:flex; gap:3px; flex-shrink:0;">
        <button type="button" class="btn-icon-sm" onclick="openEditMasterArcher('${name}')" title="Edit">✏️</button>
        <button type="button" class="btn-icon-sm" onclick="deleteFromMasterArcherList('${name}')" title="Delete" style="color:#dc2626;">✕</button>
      </div>
    `;
    container.appendChild(row);
  });
}

function openEditMasterArcher(oldName) {
  editingMasterArcherOldName = oldName;
  document.getElementById('input-edit-master-archer').value = oldName;
  openModal('modal-edit-archer');
}

function confirmEditMasterArcher() {
  const newName = document.getElementById('input-edit-master-archer').value.trim();
  if (!newName || !editingMasterArcherOldName) return;

  pushSetupUndoState();
  let history = getArcherHistory();
  const idx = history.indexOf(editingMasterArcherOldName);
  if (idx !== -1) {
    history[idx] = newName;
    localStorage.setItem('assafra_archers_history', JSON.stringify(history));
  }

  activeArchers = activeArchers.map(a => a === editingMasterArcherOldName ? newName : a);

  closeModal('modal-edit-archer');
  initArcherSection();
}

function deleteFromMasterArcherList(nameToDelete) {
  pushSetupUndoState();
  let history = getArcherHistory().filter(name => name !== nameToDelete);
  localStorage.setItem('assafra_archers_history', JSON.stringify(history));
  activeArchers = activeArchers.filter(name => name !== nameToDelete);
  renderActiveArchers();
  populateArcherHistoryDropdown();
  renderMasterArcherList();
}

function addArcherFromHistory(name) {
  if (!name) return;
  if (!activeArchers.includes(name)) {
    activeArchers.push(name);
  }
  renderActiveArchers();
  populateArcherHistoryDropdown();
  document.getElementById('select-archers-history').value = "";
}

function removeActiveArcher(name) {
  activeArchers = activeArchers.filter(n => n !== name);
  renderActiveArchers();
  populateArcherHistoryDropdown();
}

function addNewMasterArcher() {
  const input = document.getElementById('input-new-archer-master');
  const name = input.value.trim();
  if (!name) return;

  let history = getArcherHistory();
  if (!history.includes(name)) {
    pushSetupUndoState();
    history.push(name);
    localStorage.setItem('assafra_archers_history', JSON.stringify(history));
  }
  input.value = '';
  initArcherSection();
}

function handleMasterArcherEnter(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    addNewMasterArcher();
  }
}

function toggleTimerInput() {
  const chk = document.getElementById('chk-timer-enable');
  const box = document.getElementById('timer-config-box');
  if (chk.checked) box.classList.remove('hidden');
  else box.classList.add('hidden');
}

function toggleLaneInput() {
  const chk = document.getElementById('chk-lane-enable');
  const box = document.getElementById('lane-config-box');
  if (chk.checked) box.classList.remove('hidden');
  else box.classList.add('hidden');
}

// ==================== MATRIX CRUD ====================
function getMatrices() {
  const saved = localStorage.getItem('assafra_matrices');
  let list = saved ? JSON.parse(saved) : DEFAULT_MATRICES;
  
  if (!list.some(m => m.id === "1-10-M")) {
    list.splice(1, 0, { id: "1-10-M", label: "1 - 10, M", values: ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"], isDefault: true });
    localStorage.setItem('assafra_matrices', JSON.stringify(list));
  }
  return list;
}

function initMatrices() {
  const matrices = getMatrices();
  const select = document.getElementById('select-matrix');
  const currentVal = select.value;
  select.innerHTML = '';
  matrices.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    select.appendChild(opt);
  });
  if (currentVal && matrices.some(m => m.id === currentVal)) select.value = currentVal;
  renderCustomMatricesList();
  renderMatrixCheckboxGrid();
}

function renderMatrixCheckboxGrid(preSelectedValues = ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"]) {
  const container = document.getElementById('matrix-checkbox-grid');
  if (!container) return;
  container.innerHTML = '';
  ALL_MATRIX_POINT_OPTIONS.forEach(val => {
    const isChecked = preSelectedValues.includes(val);
    const label = document.createElement('label');
    label.className = 'matrix-check-label';
    label.innerHTML = `
      <input type="checkbox" value="${val}" ${isChecked ? 'checked' : ''}>
      <span>${val}</span>
    `;
    container.appendChild(label);
  });
}

function renderCustomMatricesList() {
  const matrices = getMatrices();
  const container = document.getElementById('matrix-custom-items-list');
  if (!container) return;
  container.innerHTML = '';
  
  matrices.forEach(m => {
    const row = document.createElement('div');
    row.className = 'matrix-item-row';
    const deleteBtnHtml = !m.isDefault ? `<button type="button" class="btn-icon-sm" onclick="deleteMatrix('${m.id}')" title="Delete">✕</button>` : '';
    row.innerHTML = `
      <span><strong>${m.label}</strong>: [${m.values.join(', ')}]</span>
      <div style="display:flex; gap:4px;">
        <button type="button" class="btn-icon-sm" onclick="editMatrixItem('${m.id}')" title="Edit">✏️</button>
        ${deleteBtnHtml}
      </div>
    `;
    container.appendChild(row);
  });
}

function toggleMatrixManager() {
  const drawer = document.getElementById('custom-matrix-box');
  if (drawer.classList.contains('hidden')) {
    drawer.classList.remove('hidden');
    cancelMatrixEdit(false);
  } else {
    drawer.classList.add('hidden');
  }
}

function cancelMatrixEdit(hideDrawer = true) {
  editingMatrixId = null;
  document.getElementById('matrix-drawer-title').textContent = 'Add New Scoring Matrix';
  document.getElementById('input-matrix-label').value = '';
  renderMatrixCheckboxGrid();
  document.getElementById('btn-save-matrix-action').textContent = 'Save Matrix';
  if (hideDrawer) {
    document.getElementById('custom-matrix-box').classList.add('hidden');
  }
}

function editMatrixItem(matrixId) {
  const matrices = getMatrices();
  const m = matrices.find(item => item.id === matrixId);
  if (m) {
    editingMatrixId = matrixId;
    document.getElementById('input-modal-matrix-label').value = m.label;
    
    // Paparkan grid checkbox mata scoring di dalam modal edit
    const container = document.getElementById('modal-matrix-checkbox-grid');
    if (container) {
      container.innerHTML = '';
      ALL_MATRIX_POINT_OPTIONS.forEach(val => {
        const isChecked = m.values.includes(val);
        const label = document.createElement('label');
        label.className = 'matrix-check-label';
        label.innerHTML = `
          <input type="checkbox" value="${val}" ${isChecked ? 'checked' : ''}>
          <span>${val}</span>
        `;
        container.appendChild(label);
      });
    }

    openModal('modal-edit-matrix-item');
  }
}

function confirmEditMatrixItem() {
  const newLabel = document.getElementById('input-modal-matrix-label').value.trim();
  const checkedBoxes = document.querySelectorAll('#modal-matrix-checkbox-grid input[type="checkbox"]:checked');
  const valuesArray = Array.from(checkedBoxes).map(cb => cb.value);

  if (!newLabel || !editingMatrixId) return;
  if (valuesArray.length === 0) {
    alert('Please select at least 1 point option for the matrix.');
    return;
  }

  pushSetupUndoState();
  let matrices = getMatrices();
  const idx = matrices.findIndex(m => m.id === editingMatrixId);
  if (idx !== -1) {
    matrices[idx].label = newLabel;
    matrices[idx].values = valuesArray; // Kemas kini nombor scoring matriks
    localStorage.setItem('assafra_matrices', JSON.stringify(matrices));
  }
  closeModal('modal-edit-matrix-item');
  initMatrices();
}

function deleteMatrix(matrixId) {
  pushSetupUndoState();
  let matrices = getMatrices().filter(m => m.id !== matrixId);
  localStorage.setItem('assafra_matrices', JSON.stringify(matrices));
  initMatrices();
}

function saveCustomMatrix() {
  const label = document.getElementById('input-matrix-label').value.trim();
  const checkedBoxes = document.querySelectorAll('#matrix-checkbox-grid input[type="checkbox"]:checked');
  const valuesArray = Array.from(checkedBoxes).map(cb => cb.value);

  if (!label) {
    alert('Please enter a matrix label.');
    return;
  }
  if (valuesArray.length === 0) {
    alert('Please select at least 1 point option for the matrix.');
    return;
  }

  pushSetupUndoState();
  let matrices = getMatrices();
  const matrixId = `matrix_${Date.now()}`;
  matrices.push({ id: matrixId, label: label, values: valuesArray, isDefault: false });
  localStorage.setItem('assafra_matrices', JSON.stringify(matrices));
  initMatrices();
  document.getElementById('select-matrix').value = matrixId;
  cancelMatrixEdit(true);
}

// ==================== PRESETS ====================
function getPresets() {
  const saved = localStorage.getItem('assafra_presets');
  return saved ? JSON.parse(saved) : DEFAULT_PRESETS;
}

function initPresetSelector() {
  const presets = getPresets();
  const container = document.getElementById('preset-chips');
  container.innerHTML = '';
  presets.forEach((preset, index) => {
    const card = document.createElement('div');
    card.className = `preset-card-item ${index === 0 ? 'active' : ''}`;
    card.id = `preset-card-${preset.id}`;
    card.innerHTML = `
      <button type="button" class="preset-btn-main" onclick="selectPreset('${preset.id}')">${preset.name}</button>
      <div class="preset-card-actions">
        <button type="button" class="btn-icon-sm" onclick="openEditPreset('${preset.id}')">✏️</button>
        <button type="button" class="btn-icon-sm" onclick="deletePreset('${preset.id}')">✕</button>
      </div>
    `;
    container.appendChild(card);
  });
  if (presets.length > 0) applyPresetValues(presets[0]);
}

function selectPreset(presetId) {
  const presets = getPresets();
  const preset = presets.find(p => p.id === presetId);
  if (preset) {
    document.querySelectorAll('.preset-card-item').forEach(c => c.classList.remove('active'));
    const activeEl = document.getElementById(`preset-card-${presetId}`);
    if (activeEl) activeEl.classList.add('active');
    applyPresetValues(preset);
  }
}

function applyPresetValues(preset) {
  document.getElementById('input-distance').value = preset.distance;
  document.getElementById('input-tf-size').value = preset.tfSize;
  document.getElementById('input-rounds').value = preset.rounds;
  document.getElementById('input-ends').value = preset.ends;
  document.getElementById('input-arrows').value = preset.arrows || 6;
  document.getElementById('select-matrix').value = preset.matrix;

  const hasTimer = !!preset.timerEnabled;
  document.getElementById('chk-timer-enable').checked = hasTimer;
  document.getElementById('input-timer-seconds').value = preset.timerSeconds || 60;
  
  const hasLane = !!preset.laneEnabled;
  document.getElementById('chk-lane-enable').checked = hasLane;
  document.getElementById('input-lane-no').value = preset.laneNo || "";

  toggleTimerInput();
  toggleLaneInput();
  validateSetupInputs();
}

function openEditPreset(presetId) {
  const presets = getPresets();
  const preset = presets.find(p => p.id === presetId);
  if (preset) {
    editingPresetId = presetId;
    selectPreset(presetId);
    document.getElementById('input-edit-preset-name').value = preset.name;
    document.getElementById('preset-edit-drawer').classList.remove('hidden');
  }
}

function cancelEditPreset() {
  editingPresetId = null;
  document.getElementById('preset-edit-drawer').classList.add('hidden');
}

function saveEditedPreset() {
  const newName = document.getElementById('input-edit-preset-name').value.trim();
  if (!newName) {
    alert('Please enter a name for the preset.');
    return;
  }
  pushSetupUndoState();
  let presets = getPresets();
  const idx = presets.findIndex(p => p.id === editingPresetId);
  if (idx !== -1) {
    presets[idx] = {
      id: editingPresetId,
      name: newName,
      distance: parseInt(document.getElementById('input-distance').value, 10),
      tfSize: parseInt(document.getElementById('input-tf-size').value, 10),
      rounds: parseInt(document.getElementById('input-rounds').value, 10),
      ends: parseInt(document.getElementById('input-ends').value, 10),
      arrows: parseInt(document.getElementById('input-arrows').value, 10),
      matrix: document.getElementById('select-matrix').value,
      timerEnabled: document.getElementById('chk-timer-enable').checked,
      timerSeconds: parseInt(document.getElementById('input-timer-seconds').value, 10) || 60,
      laneEnabled: document.getElementById('chk-lane-enable').checked,
      laneNo: document.getElementById('input-lane-no').value.trim()
    };
    localStorage.setItem('assafra_presets', JSON.stringify(presets));
    cancelEditPreset();
    initPresetSelector();
    selectPreset(editingPresetId);
  }
}

function deletePreset(presetId) {
  let presets = getPresets();
  if (presets.length <= 1) {
    alert('You must keep at least 1 preset.');
    return;
  }
  pushSetupUndoState();
  presets = presets.filter(p => p.id !== presetId);
  localStorage.setItem('assafra_presets', JSON.stringify(presets));
  initPresetSelector();
}

function toggleSavePresetInput() {
  const chk = document.getElementById('chk-save-preset');
  const box = document.getElementById('save-preset-input-box');
  if (chk.checked) {
    box.classList.remove('hidden');
    document.getElementById('input-preset-name').focus();
  } else {
    box.classList.add('hidden');
  }
}

function saveCurrentAsPreset() {
  const presetName = document.getElementById('input-preset-name').value.trim();
  if (!presetName) {
    alert('Please enter a preset name.');
    return;
  }
  pushSetupUndoState();
  const newPresetId = `preset_${Date.now()}`;
  const newPreset = {
    id: newPresetId,
    name: presetName,
    distance: parseInt(document.getElementById('input-distance').value, 10),
    tfSize: parseInt(document.getElementById('input-tf-size').value, 10),
    rounds: parseInt(document.getElementById('input-rounds').value, 10),
    ends: parseInt(document.getElementById('input-ends').value, 10),
    arrows: parseInt(document.getElementById('input-arrows').value, 10),
    matrix: document.getElementById('select-matrix').value,
    timerEnabled: document.getElementById('chk-timer-enable').checked,
    timerSeconds: parseInt(document.getElementById('input-timer-seconds').value, 10) || 60,
    laneEnabled: document.getElementById('chk-lane-enable').checked,
    laneNo: document.getElementById('input-lane-no').value.trim()
  };
  const presets = getPresets();
  presets.push(newPreset);
  localStorage.setItem('assafra_presets', JSON.stringify(presets));
  document.getElementById('chk-save-preset').checked = false;
  document.getElementById('save-preset-input-box').classList.add('hidden');
  document.getElementById('input-preset-name').value = '';
  initPresetSelector();
  selectPreset(newPresetId);
}

// ==================== VERSION MODAL CONTROLLER ====================
function openVersionModal() {
  openModal('modal-version-info');
}

// ==================== SCORING ENGINE & SCORESHEET ====================
let activeSession = null;
let currentRound = 1;
let currentEnd = 1;
let currentArcherIndex = 0;
let targetEndIndex = 0;
let targetArrowIndex = 0;
let sessionScores = {};

let timerInterval = null;
let timerSecondsRemaining = 60;
let isTimerRunning = false;

function getArcherActiveEndIndex(archerName, roundIdx = currentRound - 1) {
  const submittedSet = submittedEndsTracker[archerName] && submittedEndsTracker[archerName][roundIdx];
  for (let e = 0; e < activeSession.ends; e++) {
    if (!submittedSet || !submittedSet.has(e)) {
      return e;
    }
  }
  return activeSession.ends - 1;
}

document.addEventListener('DOMContentLoaded', () => {
  const gridContainer = document.getElementById('scoresheet-grid-table');
  if (gridContainer) {
    gridContainer.addEventListener('click', (ev) => {
      const slot = ev.target.closest('.sheet-slot-box');
      if (slot) {
        ev.stopPropagation();
        const endIdx = parseInt(slot.dataset.end, 10);
        const arrowIdx = parseInt(slot.dataset.arrow, 10);
        const currentArcher = activeSession.archers[currentArcherIndex];
        const isSubmitted = submittedEndsTracker[currentArcher][currentRound - 1]?.has(endIdx);
        const archerActiveEnd = getArcherActiveEndIndex(currentArcher, currentRound - 1);
        
        if (isManualEditModeActive || (!isSubmitted && endIdx === archerActiveEnd)) {
          targetEndIndex = endIdx;
          targetArrowIndex = arrowIdx;
          renderScoresheetTable();
        }
      }
    });
  }
});

function startPracticeSession() {
  const now = new Date();
  const autoDate = formatDateDDMMYYYY(now);
  const autoTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  let sessionArchers = [];
  if (currentPracticeMode === 'team') {
    if (activeArchers.length === 0) {
      alert('Please select or add at least 1 archer.');
      return;
    }
    sessionArchers = [...activeArchers];
  } else {
    const personalName = document.getElementById('input-personal-name').value.trim() || 'Archer';
    savePersonalName(personalName);
    sessionArchers = [personalName];
  }

  const timerActive = document.getElementById('chk-timer-enable').checked;
  const timerSecs = timerActive ? parseInt(document.getElementById('input-timer-seconds').value, 10) : 60;
  
  const laneActive = document.getElementById('chk-lane-enable').checked;
  const laneVal = laneActive ? document.getElementById('input-lane-no').value.trim() : "";

  activeSession = {
    sessionId: `session_${Date.now()}`,
    timestamp: { date: autoDate, time: autoTime, raw: now.toISOString() },
    mode: currentPracticeMode,
    archers: sessionArchers,
    distance: parseInt(document.getElementById('input-distance').value, 10),
    tfSize: parseInt(document.getElementById('input-tf-size').value, 10),
    rounds: parseInt(document.getElementById('input-rounds').value, 10),
    ends: parseInt(document.getElementById('input-ends').value, 10),
    arrows: parseInt(document.getElementById('input-arrows').value, 10),
    matrixId: document.getElementById('select-matrix').value,
    laneEnabled: laneActive,
    laneNo: laneVal,
    timer: { enabled: timerActive, secondsPerEnd: timerSecs }
  };

  sessionScores = {};
  submittedEndsTracker = {};
  sessionArchers.forEach(name => {
    initArcherScoreStructure(name);
  });

  currentRound = 1;
  currentEnd = 1;
  currentArcherIndex = 0;
  targetEndIndex = 0;
  targetArrowIndex = 0;
  isManualEditModeActive = false;
  isSessionFinishedLocked = false;
  endsManagerCount = activeSession.ends;

  saveSessionBackupToStorage();
  requestWakeLock();
  initScoringScreen();
  showScreen('screen-scoring');
}

function initArcherScoreStructure(name) {
  sessionScores[name] = [];
  submittedEndsTracker[name] = [];
  for (let r = 0; r < activeSession.rounds; r++) {
    sessionScores[name].push([]);
    submittedEndsTracker[name].push(new Set());
    for (let e = 0; e < activeSession.ends; e++) {
      sessionScores[name][r].push(new Array(activeSession.arrows).fill(null));
    }
  }
}

function saveSessionBackupToStorage() {
  if (!activeSession) return;
  const serializedTracker = {};
  Object.keys(submittedEndsTracker).forEach(k => {
    serializedTracker[k] = submittedEndsTracker[k].map(s => Array.from(s));
  });

  const backup = {
    session: activeSession,
    scores: sessionScores,
    currentRound,
    currentEnd,
    currentArcherIndex,
    targetEndIndex,
    targetArrowIndex,
    submittedEndsTracker: serializedTracker,
    savedAt: Date.now()
  };
  localStorage.setItem('assafra_active_session_backup', JSON.stringify(backup));
}

function initScoringScreen() {
  if (!activeSession) return;

  const modeLabel = activeSession.mode === 'team' ? 'TEAM' : 'PERSONAL';
  const laneInfo = (activeSession.laneEnabled && activeSession.laneNo) ? ` • Lane ${activeSession.laneNo}` : '';
  document.getElementById('score-header-info').textContent = `${activeSession.distance}M • TF ${activeSession.tfSize}CM${laneInfo} • ${modeLabel}`;
  
  document.getElementById('session-saved-badge-permanent').classList.add('hidden');

  updateScoreHeaderMeta();

  const giantTimer = document.getElementById('scoring-giant-timer-box');
  if (activeSession.timer.enabled) {
    giantTimer.classList.remove('hidden');
    resetEndTimer();
  } else {
    giantTimer.classList.add('hidden');
  }

  const tabsBar = document.getElementById('scoring-archer-tabs');
  if (activeSession.archers.length > 1) {
    tabsBar.classList.remove('hidden');
    renderArcherPillTabs();
  } else {
    tabsBar.classList.add('hidden');
  }

  renderDynamicKeypad();
  renderScoresheetTable();
}

function getCompletedEndsCount(archerName, roundIdx) {
  if (!submittedEndsTracker[archerName] || !submittedEndsTracker[archerName][roundIdx]) return 0;
  return submittedEndsTracker[archerName][roundIdx].size || 0;
}

function updateScoreHeaderMeta() {
  const currentArcher = activeSession.archers[currentArcherIndex];
  const archerActiveEnd = getArcherActiveEndIndex(currentArcher, currentRound - 1);
  document.getElementById('score-end-round-info').textContent = `END ${archerActiveEnd + 1}/${activeSession.ends} • ROUND ${currentRound}/${activeSession.rounds}`;
  document.getElementById('label-active-archer-name').textContent = currentArcher;
}

function renderArcherPillTabs() {
  const tabsBar = document.getElementById('scoring-archer-tabs');
  tabsBar.innerHTML = '';
  activeSession.archers.forEach((name, idx) => {
    const completed = getCompletedEndsCount(name, currentRound - 1);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab-pill-btn ${idx === currentArcherIndex ? 'active' : ''}`;
    btn.textContent = `${name} (${completed}/${activeSession.ends})`;
    btn.onclick = () => switchArcher(idx);
    tabsBar.appendChild(btn);
  });
}

function switchArcher(idx) {
  currentArcherIndex = idx;
  renderArcherPillTabs();
  updateScoreHeaderMeta();
  
  const currentArcher = activeSession.archers[currentArcherIndex];
  if (!isManualEditModeActive) {
    targetEndIndex = getArcherActiveEndIndex(currentArcher, currentRound - 1);
    const endSlots = sessionScores[currentArcher][currentRound - 1][targetEndIndex];
    const firstEmpty = endSlots.findIndex(s => s === null);
    targetArrowIndex = firstEmpty !== -1 ? firstEmpty : (activeSession.arrows - 1);
  }

  renderScoresheetTable();
}

function toggleManualEditMode() {
  const editBtn = document.getElementById('btn-mode-edit-toggle');
  
  if (!isManualEditModeActive) {
    isManualEditModeActive = true;
    editBtn.classList.remove('done-green-mode');
    editBtn.classList.remove('updated-green-mode');
    editBtn.classList.add('active-edit-mode');
    editBtn.textContent = 'Update';
  } else {
    saveSessionBackupToStorage();
    isManualEditModeActive = false;
    editBtn.classList.remove('active-edit-mode');
    editBtn.classList.add('updated-green-mode');
    editBtn.textContent = 'Updated ✓';

    setTimeout(() => {
      editBtn.classList.remove('updated-green-mode');
      editBtn.textContent = '✏️ Edit';
    }, 1500);

    const currentArcher = activeSession.archers[currentArcherIndex];
    targetEndIndex = getArcherActiveEndIndex(currentArcher, currentRound - 1);
    const endSlots = sessionScores[currentArcher][currentRound - 1][targetEndIndex];
    const firstEmpty = endSlots.findIndex(s => s === null);
    targetArrowIndex = firstEmpty !== -1 ? firstEmpty : (activeSession.arrows - 1);
  }

  renderScoresheetTable();
}

function renderScoresheetTable() {
  const container = document.getElementById('scoresheet-grid-table');
  container.innerHTML = '';

  const currentArcher = activeSession.archers[currentArcherIndex];
  if (!sessionScores[currentArcher]) {
    initArcherScoreStructure(currentArcher);
  }
  const roundScores = sessionScores[currentArcher][currentRound - 1] || [];
  const archerActiveEnd = getArcherActiveEndIndex(currentArcher, currentRound - 1);

  const headerRow = document.createElement('div');
  headerRow.className = 'sheet-header-row';
  headerRow.innerHTML = `<span></span>`;
  for (let a = 1; a <= activeSession.arrows; a++) {
    headerRow.innerHTML += `<span>${a}</span>`;
  }
  headerRow.innerHTML += `<span>End</span><span>Total</span>`;
  container.appendChild(headerRow);

  let runningTotal = 0;

  for (let e = 0; e < activeSession.ends; e++) {
    const endRow = document.createElement('div');
    const isCurrentActiveEnd = (e === archerActiveEnd);
    endRow.className = `sheet-data-row ${isCurrentActiveEnd ? 'active-end-row' : ''}`;

    let endSubtotal = 0;
    let endHasArrows = false;

    endRow.innerHTML += `<span class="sheet-end-num">${e + 1}</span>`;

    if (!roundScores[e]) {
      roundScores[e] = new Array(activeSession.arrows).fill(null);
    }

    for (let a = 0; a < activeSession.arrows; a++) {
      const arrowVal = roundScores[e][a];
      const isFocusedSlot = (e === targetEndIndex && a === targetArrowIndex);
      
      const isSubmitted = submittedEndsTracker[currentArcher][currentRound - 1]?.has(e);
      const isLocked = !isManualEditModeActive && (isSubmitted || e !== archerActiveEnd);
      
      const slot = document.createElement('div');
      slot.className = `sheet-slot-box ${isFocusedSlot ? 'focused-slot' : ''} ${isLocked ? 'locked-slot' : ''}`;
      slot.textContent = arrowVal !== null ? arrowVal : '';
      slot.dataset.end = e;
      slot.dataset.arrow = a;

      endRow.appendChild(slot);

      if (arrowVal !== null) {
        endSubtotal += getPointValue(arrowVal);
        endHasArrows = true;
      }
    }

    if (endHasArrows || e < currentEnd) runningTotal += endSubtotal;

    endRow.innerHTML += `<span class="sheet-subtotal">${endHasArrows ? endSubtotal : ''}</span>`;
    endRow.innerHTML += `<span class="sheet-running-total">${endHasArrows ? runningTotal : ''}</span>`;

    container.appendChild(endRow);
  }

  if (activeSession.archers.length > 1) renderArcherPillTabs();
  updateSubmitButtonState();
}

function renderDynamicKeypad() {
  const keypad = document.getElementById('scoring-keypad');
  keypad.innerHTML = '';

  const matrices = getMatrices();
  const selectedMatrix = matrices.find(m => m.id === activeSession.matrixId) || DEFAULT_MATRICES[0];

  selectedMatrix.values.forEach(val => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `keypad-btn ${getKeypadColorClass(val)}`;
    btn.textContent = val;
    btn.onclick = () => registerKeypadInput(val);
    keypad.appendChild(btn);
  });
}

function getKeypadColorClass(val) {
  const v = String(val).toUpperCase();
  if (v === 'X' || v === '10' || v === '9') return 'keypad-gold';
  if (v === '8' || v === '7') return 'keypad-red';
  if (v === '6' || v === '5') return 'keypad-blue';
  if (v === '4' || v === '3') return 'keypad-black';
  if (v === '2' || v === '1') return 'keypad-white';
  return 'keypad-miss';
}

function getPointValue(val) {
  const v = String(val).toUpperCase();
  if (v === 'X' || v === '10') return 10;
  if (v === 'M') return 0;
  const num = parseInt(v, 10);
  return isNaN(num) ? 0 : num;
}

function registerKeypadInput(value) {
  const currentArcher = activeSession.archers[currentArcherIndex];
  if (!sessionScores[currentArcher]) {
    initArcherScoreStructure(currentArcher);
  }
  const isSubmitted = submittedEndsTracker[currentArcher][currentRound - 1]?.has(targetEndIndex);
  const archerActiveEnd = getArcherActiveEndIndex(currentArcher, currentRound - 1);

  if (!isManualEditModeActive && (isSubmitted || targetEndIndex !== archerActiveEnd)) {
    return;
  }

  if (targetEndIndex < 0 || targetEndIndex >= activeSession.ends) targetEndIndex = 0;
  if (targetArrowIndex < 0 || targetArrowIndex >= activeSession.arrows) targetArrowIndex = 0;

  if (!sessionScores[currentArcher][currentRound - 1][targetEndIndex]) {
    sessionScores[currentArcher][currentRound - 1][targetEndIndex] = new Array(activeSession.arrows).fill(null);
  }

  sessionScores[currentArcher][currentRound - 1][targetEndIndex][targetArrowIndex] = value;

  if (targetArrowIndex < activeSession.arrows - 1) {
    targetArrowIndex++;
  }

  saveSessionBackupToStorage();
  renderScoresheetTable();
}

function undoLastArrow() {
  const currentArcher = activeSession.archers[currentArcherIndex];
  if (!sessionScores[currentArcher]) return;
  const isSubmitted = submittedEndsTracker[currentArcher][currentRound - 1]?.has(targetEndIndex);
  const archerActiveEnd = getArcherActiveEndIndex(currentArcher, currentRound - 1);

  if (!isManualEditModeActive && (isSubmitted || targetEndIndex !== archerActiveEnd)) {
    return;
  }

  const currentEndScores = sessionScores[currentArcher][currentRound - 1][targetEndIndex];

  if (currentEndScores[targetArrowIndex] !== null) {
    currentEndScores[targetArrowIndex] = null;
  } else if (targetArrowIndex > 0) {
    targetArrowIndex--;
    currentEndScores[targetArrowIndex] = null;
  }

  saveSessionBackupToStorage();
  renderScoresheetTable();
}

function updateSubmitButtonState() {
  const btn = document.getElementById('btn-submit-end-action');
  const currentArcher = activeSession.archers[currentArcherIndex];
  const archerActiveEnd = getArcherActiveEndIndex(currentArcher, currentRound - 1);
  const currentArcherEndSlots = sessionScores[currentArcher]?.[currentRound - 1]?.[archerActiveEnd] || [];
  const isCurrentArcherEndFilled = currentArcherEndSlots.length > 0 && currentArcherEndSlots.every(s => s !== null);
  const isCurrentArcherSubmitted = submittedEndsTracker[currentArcher]?.[currentRound - 1]?.has(archerActiveEnd);

  let allArchersSubmittedFinal = true;
  for (let arch of activeSession.archers) {
    for (let r = 0; r < activeSession.rounds; r++) {
      const submittedCount = submittedEndsTracker[arch]?.[r]?.size || 0;
      if (submittedCount < activeSession.ends) {
        allArchersSubmittedFinal = false;
        break;
      }
    }
  }

  if (allArchersSubmittedFinal) {
    btn.classList.remove('disabled');
    btn.textContent = 'FINISH PRACTICE SESSION 🏁';
  } else if (isCurrentArcherEndFilled && !isCurrentArcherSubmitted) {
    btn.classList.remove('disabled');
    btn.textContent = `SUBMIT END ${archerActiveEnd + 1} (${currentArcher}) ›`;
  } else if (isCurrentArcherSubmitted) {
    btn.classList.add('disabled');
    btn.textContent = `END ${archerActiveEnd + 1} SUBMITTED ✓`;
  } else {
    btn.classList.add('disabled');
    btn.textContent = `SUBMIT END ${archerActiveEnd + 1}`;
  }
}

function finishPracticeSession(isExit = false) {
  stopEndTimer();

  const editBtn = document.getElementById('btn-mode-edit-toggle');
  if (isManualEditModeActive || (editBtn && editBtn.textContent === 'Update')) {
    isManualEditModeActive = false;
    editBtn.classList.remove('active-edit-mode');
    editBtn.classList.add('updated-green-mode');
    editBtn.textContent = 'Updated ✓';

    setTimeout(() => {
      editBtn.classList.remove('updated-green-mode');
      editBtn.textContent = '✏️ Edit';
    }, 1500);
  }

  if (!activeSession) return;

  const completedSession = {
    ...activeSession,
    scores: JSON.parse(JSON.stringify(sessionScores)),
    completedAt: new Date().toISOString()
  };

  let history = [];
  try {
    const saved = localStorage.getItem('assafra_practice_history');
    if (saved) history = JSON.parse(saved);
  } catch (e) {
    history = [];
  }

  const existingIndex = history.findIndex(s => s.sessionId === activeSession.sessionId);
  if (existingIndex !== -1) {
    history[existingIndex] = completedSession;
  } else {
    history.unshift(completedSession);
  }

  localStorage.setItem('assafra_practice_history', JSON.stringify(history));
  localStorage.removeItem('assafra_active_session_backup');

  const savedBadge = document.getElementById('session-saved-badge-permanent');
  if (savedBadge) {
    savedBadge.classList.remove('hidden');
  }

  renderScoresheetTable();

  if (isExit) {
    releaseWakeLock();
    showScreen('screen-home');
  } else {
    openModal('modal-recorded-confirm');
  }
}

function submitCurrentEnd() {
  const btn = document.getElementById('btn-submit-end-action');
  if (btn.classList.contains('disabled')) return;

  const currentArcher = activeSession.archers[currentArcherIndex];
  const archerActiveEnd = getArcherActiveEndIndex(currentArcher, currentRound - 1);

  let allArchersSubmittedFinal = true;
  for (let arch of activeSession.archers) {
    for (let r = 0; r < activeSession.rounds; r++) {
      const submittedCount = submittedEndsTracker[arch]?.[r]?.size || 0;
      if (submittedCount < activeSession.ends) {
        allArchersSubmittedFinal = false;
        break;
      }
    }
  }

  if (allArchersSubmittedFinal) {
    finishPracticeSession();
    return;
  }

  if (!submittedEndsTracker[currentArcher][currentRound - 1]) {
    submittedEndsTracker[currentArcher][currentRound - 1] = new Set();
  }
  submittedEndsTracker[currentArcher][currentRound - 1].add(archerActiveEnd);

  let foundNextArcher = false;
  for (let i = 1; i < activeSession.archers.length; i++) {
    const nextIdx = (currentArcherIndex + i) % activeSession.archers.length;
    const nextName = activeSession.archers[nextIdx];
    const nextActiveEnd = getArcherActiveEndIndex(nextName, currentRound - 1);
    if (!submittedEndsTracker[nextName][currentRound - 1]?.has(nextActiveEnd)) {
      currentArcherIndex = nextIdx;
      foundNextArcher = true;
      break;
    }
  }

  const activeArcherNow = activeSession.archers[currentArcherIndex];
  targetEndIndex = getArcherActiveEndIndex(activeArcherNow, currentRound - 1);
  targetArrowIndex = 0;

  updateScoreHeaderMeta();
  if (activeSession.timer.enabled) resetEndTimer();
  saveSessionBackupToStorage();
  renderScoresheetTable();
}

function jumpToIncompleteEnd() {
  if (pendingIncompleteTarget) {
    closeModal('modal-incomplete-alert');
    currentArcherIndex = pendingIncompleteTarget.archerIndex;
    currentRound = pendingIncompleteTarget.roundIndex + 1;
    targetEndIndex = pendingIncompleteTarget.endIndex;
    
    const slots = sessionScores[pendingIncompleteTarget.archerName][pendingIncompleteTarget.roundIndex][targetEndIndex];
    const firstEmpty = slots.findIndex(s => s === null);
    targetArrowIndex = firstEmpty !== -1 ? firstEmpty : 0;

    isManualEditModeActive = true;
    const editBtn = document.getElementById('btn-mode-edit-toggle');
    editBtn.classList.add('active-edit-mode');
    editBtn.textContent = 'Update';

    updateScoreHeaderMeta();
    renderScoresheetTable();
  }
}

function forceFinishSession() {
  closeModal('modal-incomplete-alert');
  finishPracticeSession();
}

// ==================== MODALS & EXIT PROMPT ====================
function openModal(modalId) {
  document.getElementById(modalId).classList.remove('hidden');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function handleExitSessionPrompt() {
  openModal('modal-exit-prompt');
}

function saveAndExitSession() {
  closeModal('modal-exit-prompt');
  finishPracticeSession(true);
}

function discardAndExitSession() {
  closeModal('modal-exit-prompt');
  localStorage.removeItem('assafra_active_session_backup');
  stopEndTimer();
  releaseWakeLock();
  showScreen('screen-home');
}

function openRoundSwitcherModal() {
  tempSelectedRoundForSwitch = currentRound;
  renderRoundSwitcherList();
  openModal('modal-round-switcher');
}

function renderRoundSwitcherList() {
  const container = document.getElementById('round-modal-list');
  container.innerHTML = '';
  for (let r = 1; r <= activeSession.rounds; r++) {
    const btn = document.createElement('button');
    let cssClass = 'btn-modal-item';
    if (r === tempSelectedRoundForSwitch) {
      cssClass += ' selected-highlight';
    } else if (r === currentRound) {
      cssClass += ' active';
    }
    btn.className = cssClass;
    btn.textContent = `Round ${r}`;
    btn.onclick = () => {
      tempSelectedRoundForSwitch = r;
      renderRoundSwitcherList();
    };
    container.appendChild(btn);
  }
}

function confirmRoundSelection() {
  currentRound = tempSelectedRoundForSwitch;
  currentEnd = 1;
  const currentArcher = activeSession.archers[currentArcherIndex];
  targetEndIndex = getArcherActiveEndIndex(currentArcher, currentRound - 1);
  targetArrowIndex = 0;
  
  document.getElementById('session-saved-badge-permanent').classList.add('hidden');

  updateScoreHeaderMeta();
  renderScoresheetTable();
  closeModal('modal-round-switcher');
}

function addNewRoundToSession() {
  activeSession.rounds++;
  activeSession.archers.forEach(name => {
    if (!sessionScores[name]) initArcherScoreStructure(name);
    sessionScores[name].push([]);
    submittedEndsTracker[name].push(new Set());
    for (let e = 0; e < activeSession.ends; e++) {
      sessionScores[name][activeSession.rounds - 1].push(new Array(activeSession.arrows).fill(null));
    }
  });

  tempSelectedRoundForSwitch = currentRound; 
  renderRoundSwitcherList();
  saveSessionBackupToStorage();
}

function deleteLastRoundFromSession() {
  if (activeSession.rounds <= 1) {
    alert('Cannot delete the only round remaining.');
    return;
  }
  if (confirm(`Delete Round ${activeSession.rounds} permanently?`)) {
    activeSession.rounds--;
    activeSession.archers.forEach(name => {
      if (sessionScores[name]) {
        sessionScores[name].pop();
      }
      if (submittedEndsTracker[name]) {
        submittedEndsTracker[name].pop();
      }
    });

    if (currentRound > activeSession.rounds) {
      currentRound = activeSession.rounds;
    }
    tempSelectedRoundForSwitch = currentRound;
    renderRoundSwitcherList();
    updateScoreHeaderMeta();
    saveSessionBackupToStorage();
    renderScoresheetTable();
  }
}

function openEndManagerModal() {
  endsManagerCount = activeSession.ends;
  document.getElementById('end-manager-count-display').textContent = endsManagerCount;
  openModal('modal-end-manager');
}

function getMaxCompletedEndNumber() {
  let maxCompleted = 0;
  if (!activeSession || !submittedEndsTracker) return 0;

  activeSession.archers.forEach(name => {
    for (let r = 0; r < activeSession.rounds; r++) {
      const tracker = submittedEndsTracker[name] && submittedEndsTracker[name][r];
      if (tracker) {
        tracker.forEach(endIdx => {
          if (endIdx + 1 > maxCompleted) {
            maxCompleted = endIdx + 1;
          }
        });
      }
    }
  });
  return maxCompleted;
}

function adjustEndsCount(delta) {
  const minAllowedEnds = Math.max(1, getMaxCompletedEndNumber());
  const newCount = endsManagerCount + delta;

  if (newCount < minAllowedEnds) {
    alert(`Cannot reduce ends below End ${minAllowedEnds} because scores have already been submitted.`);
    return;
  }

  endsManagerCount = Math.max(minAllowedEnds, Math.min(24, newCount));
  document.getElementById('end-manager-count-display').textContent = endsManagerCount;
}

function applyAdjustedEnds() {
  if (endsManagerCount === activeSession.ends) {
    closeModal('modal-end-manager');
    return;
  }

  const oldEnds = activeSession.ends;
  activeSession.ends = endsManagerCount;

  activeSession.archers.forEach(name => {
    if (!sessionScores[name]) initArcherScoreStructure(name);
    for (let r = 0; r < activeSession.rounds; r++) {
      if (endsManagerCount > oldEnds) {
        for (let e = oldEnds; e < endsManagerCount; e++) {
          if (!sessionScores[name][r]) sessionScores[name][r] = [];
          sessionScores[name][r].push(new Array(activeSession.arrows).fill(null));
        }
      } else {
        sessionScores[name][r] = sessionScores[name][r].slice(0, endsManagerCount);
      }
    }
  });

  const currentArcher = activeSession.archers[currentArcherIndex];
  targetEndIndex = getArcherActiveEndIndex(currentArcher, currentRound - 1);
  targetArrowIndex = 0;

  document.getElementById('session-saved-badge-permanent').classList.add('hidden');

  updateScoreHeaderMeta();
  saveSessionBackupToStorage();
  renderScoresheetTable();
  closeModal('modal-end-manager');
}

// ==================== ADD LATE ARCHER ====================
function openAddLateArcherModal() {
  lateArcherCount = 1;
  updateLateArcherStepperUI();
  openModal('modal-add-late-archer');
}

function adjustLateArcherCount(delta) {
  lateArcherCount = Math.max(1, Math.min(6, lateArcherCount + delta));
  updateLateArcherStepperUI();
}

function updateLateArcherStepperUI() {
  document.getElementById('late-archer-count-display').textContent = lateArcherCount;
  const wrap = document.getElementById('late-archers-inputs-wrap');
  wrap.innerHTML = '';

  const masterList = getArcherHistory();

  for (let i = 1; i <= lateArcherCount; i++) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; flex-direction:column; gap:3px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:6px;';
    
    let optionsHtml = '<option value="">-- Select from Master Archer List --</option>';
    masterList.forEach(mName => {
      if (!activeArchers.includes(mName)) {
        optionsHtml += `<option value="${mName}">${mName}</option>`;
      }
    });

    row.innerHTML = `
      <select class="modal-input late-archer-select" onchange="this.nextElementSibling.value = this.value">
        ${optionsHtml}
      </select>
      <input type="text" class="modal-input late-archer-dynamic-input" placeholder="Or type new archer ${i} name...">
    `;
    wrap.appendChild(row);
  }
}

function confirmAddLateArchers() {
  const inputs = document.querySelectorAll('.late-archer-dynamic-input');
  const selects = document.querySelectorAll('.late-archer-select');
  const namesToAdd = [];

  selects.forEach(sel => {
    const val = sel.value.trim();
    if (val && !activeArchers.includes(val) && !namesToAdd.includes(val)) {
      namesToAdd.push(val);
    }
  });

  inputs.forEach(inp => {
    const val = inp.value.trim();
    if (val && !activeArchers.includes(val) && !namesToAdd.includes(val)) {
      namesToAdd.push(val);
    }
  });

  if (namesToAdd.length === 0) return;

  namesToAdd.forEach(name => {
    activeSession.archers.push(name);
    initArcherScoreStructure(name);
    let history = getArcherHistory();
    if (!history.includes(name)) {
      history.push(name);
      localStorage.setItem('assafra_archers_history', JSON.stringify(history));
    }
  });

  renderArcherPillTabs();
  document.getElementById('scoring-archer-tabs').classList.remove('hidden');
  closeModal('modal-add-late-archer');

  currentArcherIndex = activeSession.archers.length - namesToAdd.length;
  targetEndIndex = 0;
  targetArrowIndex = 0;

  updateScoreHeaderMeta();
  saveSessionBackupToStorage();
  renderScoresheetTable();
}

// ==================== COUNTBACK & TIE-BREAKING LOGIC (ROBUST STATS FIX) ====================
function calculateArcherOverallStats(sessionObj, name) {
  let totalScore = 0;
  let totalArrows = 0;
  let roundScoresList = [];
  
  const ringCounts = {
    "X": 0, "10": 0, "9": 0, "8": 0, "7": 0,
    "6": 0, "5": 0, "4": 0, "3": 0, "2": 0, "1": 0, "M": 0
  };

  const scoresMap = sessionObj.scores || {};
  let archerScores = scoresMap[name];
  if (!archerScores) {
    const keys = Object.keys(scoresMap);
    if (keys.length > 0) {
      archerScores = scoresMap[keys[0]];
    }
  }
  archerScores = archerScores || [];

  const roundsCount = sessionObj.rounds || archerScores.length || 1;
  const endsCount = sessionObj.ends || 6;

  for (let r = 0; r < roundsCount; r++) {
    let roundPts = 0;
    const roundArr = archerScores[r] || [];
    for (let e = 0; e < endsCount; e++) {
      const endArr = roundArr[e] || [];
      endArr.forEach(v => {
        if (v !== null && v !== undefined) {
          const pts = getPointValue(v);
          roundPts += pts;
          totalScore += pts;
          totalArrows++;

          const upperVal = String(v).toUpperCase();
          if (ringCounts.hasOwnProperty(upperVal)) {
            ringCounts[upperVal]++;
          }
        }
      });
    }
    roundScoresList.push(roundPts);
  }

  // Dapatkan matriks semasa untuk menentukan 2 mata tertinggi (menyokong X & nombor secara menurun)
  const matrices = getMatrices ? getMatrices() : [];
  const selMat = matrices.find(m => m.id === sessionObj.matrixId) || { values: ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"] };
  
  const validValues = selMat.values.filter(v => String(v).toUpperCase() !== 'M');
  validValues.sort((a, b) => {
    const ua = String(a).toUpperCase();
    const ub = String(b).toUpperCase();
    if (ua === 'X') return -1;
    if (ub === 'X') return 1;
    return parseInt(ub, 10) - parseInt(ua, 10);
  });

  const topFirstKey = validValues[0] || "10";
  const topSecondKey = validValues[1] || "9";

  const avg = totalArrows > 0 ? (totalScore / totalArrows).toFixed(2) : '0.00';
  return { 
    name: name || "Archer", 
    totalScore, 
    roundScoresList, 
    totalArrows, 
    tensCount: ringCounts["10"], 
    xCount: ringCounts["X"], 
    topFirstKey,
    topFirstCount: ringCounts[topFirstKey] || 0,
    topSecondKey,
    topSecondCount: ringCounts[topSecondKey] || 0,
    missCount: ringCounts["M"],
    ringCounts, 
    avg 
  };
}

function compareArchersCountback(a, b) {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  if (b.xCount !== a.xCount) return b.xCount - a.xCount;
  if (b.tensCount !== a.tensCount) return b.tensCount - a.tensCount;

  const ringsToCheck = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
  for (let ring of ringsToCheck) {
    const diff = (b.ringCounts[ring] || 0) - (a.ringCounts[ring] || 0);
    if (diff !== 0) return diff;
  }

  if (a.missCount !== b.missCount) return a.missCount - b.missCount;
  return 0;
}

function assignRanksWithTies(results) {
  const sorted = [...results].sort(compareArchersCountback);
  
  for (let i = 0; i < sorted.length; i++) {
    const tiedWithPrev = (i > 0 && compareArchersCountback(sorted[i], sorted[i - 1]) === 0);
    const tiedWithNext = (i < sorted.length - 1 && compareArchersCountback(sorted[i], sorted[i + 1]) === 0);

    if (tiedWithPrev) {
      sorted[i].rankDisplay = sorted[i - 1].rankDisplay;
      sorted[i].rankNumber = sorted[i - 1].rankNumber;
    } else if (tiedWithNext) {
      sorted[i].rankDisplay = `T-${i + 1}`;
      sorted[i].rankNumber = i + 1;
    } else {
      sorted[i].rankDisplay = `${i + 1}`;
      sorted[i].rankNumber = i + 1;
    }
  }

  return sorted;
}

function openSummaryModal() {
  const targetSession = activeSession || viewingHistorySession;
  if (!targetSession) return;
  
  if (activeSession && Object.keys(sessionScores).length > 0) {
    targetSession.scores = sessionScores;
  }

  const body = document.getElementById('summary-modal-content');
  if (!body) return;
  body.innerHTML = '';
  
  const metaBadge = document.getElementById('summary-meta-badge');
  const titleEl = document.getElementById('summary-modal-title');
  metaBadge.textContent = `${targetSession.distance}M • ${targetSession.arrows}A x ${targetSession.ends}E x ${targetSession.rounds}R`;
  const modeLabel = targetSession.mode === 'team' ? 'TEAM' : 'PERSONAL';
  titleEl.textContent = `Session Results (${modeLabel})`;

  const archerList = targetSession.archers || Object.keys(targetSession.scores || {});
  const rawResults = archerList.map(name => calculateArcherOverallStats(targetSession, name));
  const results = assignRanksWithTies(rawResults);

  let tableHeaderHtml = `<th>#</th><th>Archer</th>`;
  for (let r = 1; r <= targetSession.rounds; r++) {
    tableHeaderHtml += `<th>R${r}</th>`;
  }
  const sampleRes = results[0] || { topFirstKey: '10', topSecondKey: '9' };
  tableHeaderHtml += `<th>Total</th><th>${sampleRes.topFirstKey}</th><th>${sampleRes.topSecondKey}</th>`;

  let tableHtml = `
    <table class="results-table">
      <thead>
        <tr>${tableHeaderHtml}</tr>
      </thead>
      <tbody>
  `;

  results.forEach((res) => {
    tableHtml += `
      <tr>
        <td><strong>${res.rankDisplay}</strong></td>
        <td style="text-align:left;"><strong>${res.name}</strong></td>
    `;
    res.roundScoresList.forEach(rPts => {
      tableHtml += `<td>${rPts}</td>`;
    });
    tableHtml += `
        <td style="color:#044993; font-size:0.95rem; font-weight:900;">${res.totalScore}</td>
        <td>${res.topFirstCount}</td>
        <td>${res.topSecondCount}</td>
      </tr>
    `;
  });

  tableHtml += `</tbody></table>`;
  body.innerHTML = tableHtml;
  openModal('modal-summary-score');
}

function shareScorecardWhatsApp() {
  const targetSession = activeSession || viewingHistorySession;
  if (!targetSession) return;
  if (activeSession && Object.keys(sessionScores).length > 0) {
    targetSession.scores = sessionScores;
  }
  const archerList = targetSession.archers || Object.keys(targetSession.scores || {});
  const rawResults = archerList.map(name => calculateArcherOverallStats(targetSession, name));
  const results = assignRanksWithTies(rawResults);

  const now = new Date();
  const dateFormatted = formatDateDDMMYYYY(now);
  const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = daysShort[now.getDay()];
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const timeFormatted = `${hours}:${mins}`;

  const modeTitle = targetSession.mode === 'team' ? 'TEAM' : 'PERSONAL';
  const laneInfo = (targetSession.laneEnabled && targetSession.laneNo) ? ` | Lane ${targetSession.laneNo}` : '';

  let msg = `🎯 *Archery Results (${modeTitle})*\n`;
  msg += `${dateFormatted} | ${dayName} | ${timeFormatted}${laneInfo}\n`;
  msg += `${targetSession.distance}m | ${targetSession.arrows}A x ${targetSession.ends}E x ${targetSession.rounds}R\n`;
  msg += `------------------------------------\n\n`;

  results.forEach((r) => {
    msg += `*${r.rankDisplay}. ${r.name}* : ${r.totalScore} pts\n`;
    const roundsStr = r.roundScoresList.map((pts, i) => `R${i + 1}:${pts}`).join(' | ');
    msg += `   └ ${roundsStr} | X:${r.xCount} | 10:${r.tensCount} | Avg:${r.avg}\n\n`;
  });

  msg += `------------------------------------\n`;
  msg += `App: ASSAFRA SCOREBOARD\n`;
  msg += `Loc: ${detectedLocation}`;

  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, '_blank');
}

function saveDetailedResultPDF() {
  const targetSession = activeSession || viewingHistorySession;
  if (!targetSession) return;
  if (activeSession && Object.keys(sessionScores).length > 0) {
    targetSession.scores = sessionScores;
  }
  const printWindow = window.open('', '_blank');
  const archerList = targetSession.archers || Object.keys(targetSession.scores || {});
  const rawResults = archerList.map(name => calculateArcherOverallStats(targetSession, name));
  const results = assignRanksWithTies(rawResults);
  const pdfDate = formatDateDDMMYYYY(targetSession.timestamp.date || new Date());
  const laneInfo = (targetSession.laneEnabled && targetSession.laneNo) ? ` | Lane ${targetSession.laneNo}` : '';

  const matrices = getMatrices();
  const selMat = matrices.find(m => m.id === targetSession.matrixId) || DEFAULT_MATRICES[0];
  const pointOrder = selMat.values;

  const scoresMap = targetSession.scores || {};
  const roundsTotal = targetSession.rounds || 1;
  const endsTotal = targetSession.ends || 6;
  const arrowsTotal = targetSession.arrows || 6;

  let html = `
    <html>
    <head>
      <title>Assafra Archery - Practice Results</title>
      <style>
        body { font-family: sans-serif; padding: 20px; color: #1e293b; }
        h2, h3, h4 { color: #044993; margin: 4px 0; }
        .meta { font-size: 14px; color: #64748b; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: center; }
        th { background: #044993; color: white; }
        .archer-name { text-align: left; font-weight: bold; }
        .archer-title { margin-top: 15px; font-size: 15px; font-weight: bold; color: #0f172a; border-bottom: 2px solid #044993; padding-bottom: 3px; }
      </style>
    </head>
    <body>
      <h2>ASSAFRA SCOREBOARD</h2>
      <h3>Official Detailed Practice Results</h3>
      <div class="meta">Date: ${pdfDate} | Distance: ${targetSession.distance}m | Format: ${targetSession.arrows}A x ${targetSession.ends}E x ${targetSession.rounds}R${laneInfo} | Loc: ${detectedLocation}</div>

      <h4>Ranking Summary</h4>
      <table>
        <tr>
          <th>Rank</th>
          <th>Archer</th>
  `;

  for (let r = 1; r <= targetSession.rounds; r++) {
    html += `<th>R${r}</th>`;
  }
  const sampleResPdf = results[0] || { topFirstKey: '10', topSecondKey: '9' };
  html += `<th>Total Pts</th><th>${sampleResPdf.topFirstKey}</th><th>${sampleResPdf.topSecondKey}</th><th>Avg</th></tr>`;

  results.forEach((r) => {
    html += `<tr><td>${r.rankDisplay}</td><td class="archer-name">${r.name}</td>`;
    r.roundScoresList.forEach(pts => html += `<td>${pts}</td>`);
    html += `<td><strong>${r.totalScore}</strong></td><td>${r.topFirstCount}</td><td>${r.topSecondCount}</td><td>${r.avg}</td></tr>`;
  });

  html += `</table>`;
  html += `<h3>Detailed End Breakdown</h3>`;

  archerList.forEach(name => {
    let archerScores = scoresMap[name];
    if (!archerScores) {
      const keys = Object.keys(scoresMap);
      if (keys.length > 0) archerScores = scoresMap[keys[0]];
    }
    archerScores = archerScores || [];

    html += `<div class="archer-title">${name}</div>`;

    for (let r = 0; r < roundsTotal; r++) {
      if (roundsTotal > 1) {
        html += `<h4>Round ${r + 1}</h4>`;
      }
      html += `<table><tr><th>End</th>`;
      for (let a = 1; a <= arrowsTotal; a++) {
        html += `<th>A${a}</th>`;
      }
      html += `<th>End Pts</th><th>Total</th></tr>`;

      let roundRunningTotal = 0;
      const roundArr = archerScores[r] || [];

      for (let e = 0; e < endsTotal; e++) {
        const endArr = roundArr[e] || new Array(arrowsTotal).fill(null);
        
        const sortedEndArr = [...endArr].sort((v1, v2) => {
          if (v1 === null || v1 === undefined) return 1;
          if (v2 === null || v2 === undefined) return -1;
          const idx1 = pointOrder.indexOf(String(v1).toUpperCase());
          const idx2 = pointOrder.indexOf(String(v2).toUpperCase());
          return (idx1 !== -1 ? idx1 : 99) - (idx2 !== -1 ? idx2 : 99);
        });

        let endSub = 0;
        let endHasArrows = false;

        html += `<tr><td><strong>${e + 1}</strong></td>`;
        for (let a = 0; a < arrowsTotal; a++) {
          const val = sortedEndArr[a];
          html += `<td>${val !== null && val !== undefined ? val : ''}</td>`;
          if (val !== null && val !== undefined) {
            const pts = getPointValue(val);
            endSub += pts;
            endHasArrows = true;
          }
        }

        if (endHasArrows) roundRunningTotal += endSub;
        html += `<td><strong>${endHasArrows ? endSub : ''}</strong></td>`;
        html += `<td><strong>${endHasArrows ? roundRunningTotal : ''}</strong></td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    }
  });

  html += `</body></html>`;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

function promptDeleteCurrentArcher() {
  const select = document.getElementById('select-profile-archer');
  if (!select) return;
  const archerName = select.value;
  if (!archerName) return;

  if (confirm(`Delete archer "${archerName}" and all their associated history records permanently?`)) {
    let history = [];
    try {
      const saved = localStorage.getItem('assafra_practice_history');
      if (saved) history = JSON.parse(saved);
    } catch (e) {
      history = [];
    }

    const updatedHistory = history.filter(s => {
      const archerList = s.archers || Object.keys(s.scores || {});
      return !archerList.includes(archerName);
    });
    localStorage.setItem('assafra_practice_history', JSON.stringify(updatedHistory));

    let masterList = getArcherHistory().filter(n => n !== archerName);
    localStorage.setItem('assafra_archers_history', JSON.stringify(masterList));

    if (getPersonalName() === archerName) {
      localStorage.removeItem('assafra_personal_name');
    }

    alert(`Archer "${archerName}" deleted successfully.`);
    initArcherProfileScreen();
  }
}

function finishPracticeSession(isExit = false) {
  stopEndTimer();

  const editBtn = document.getElementById('btn-mode-edit-toggle');
  if (isManualEditModeActive || (editBtn && editBtn.textContent === 'Update')) {
    isManualEditModeActive = false;
    editBtn.classList.remove('active-edit-mode');
    editBtn.classList.add('updated-green-mode');
    editBtn.textContent = 'Updated ✓';

    setTimeout(() => {
      editBtn.classList.remove('updated-green-mode');
      editBtn.textContent = '✏️ Edit';
    }, 1500);
  }

  if (!activeSession) return;

  const completedSession = {
    ...activeSession,
    scores: JSON.parse(JSON.stringify(sessionScores)),
    completedAt: new Date().toISOString()
  };

  let history = [];
  try {
    const saved = localStorage.getItem('assafra_practice_history');
    if (saved) history = JSON.parse(saved);
  } catch (e) {
    history = [];
  }

  const existingIndex = history.findIndex(s => s.sessionId === activeSession.sessionId);
  if (existingIndex !== -1) {
    history[existingIndex] = completedSession;
  } else {
    history.unshift(completedSession);
  }

  localStorage.setItem('assafra_practice_history', JSON.stringify(history));
  localStorage.removeItem('assafra_active_session_backup');

  const savedBadge = document.getElementById('session-saved-badge-permanent');
  if (savedBadge) {
    savedBadge.classList.remove('hidden');
  }

  renderScoresheetTable();

  if (isExit) {
    releaseWakeLock();
    showScreen('screen-home');
  } else {
    openModal('modal-recorded-confirm');
  }
}

let cachedHistory = [];
let currentHistoryModeFilter = 'all';
let isHistorySelectMode = false;
let selectedSessionIds = new Set();

function loadPracticeHistory() {
  try {
    const saved = localStorage.getItem('assafra_practice_history');
    cachedHistory = saved ? JSON.parse(saved) : [];
  } catch (e) {
    cachedHistory = [];
  }

  cachedHistory.sort((a, b) => new Date(b.completedAt || b.timestamp.raw || 0) - new Date(a.completedAt || a.timestamp.raw || 0));

  populateHistoryFilters();
  filterHistoryList();
}

function populateHistoryFilters() {
  const nameSelect = document.getElementById('select-history-name-filter');
  const dateSelect = document.getElementById('select-history-date-filter');
  const distSelect = document.getElementById('select-history-distance-filter');
  if (!nameSelect || !dateSelect || !distSelect) return;

  const currentNameVal = nameSelect.value;
  const currentDateVal = dateSelect.value;
  const currentDistVal = distSelect.value;

  nameSelect.innerHTML = '<option value="all">All Names</option>';
  dateSelect.innerHTML = '<option value="all">All Dates</option>';
  distSelect.innerHTML = '<option value="all">All Distances</option>';

  const namesSet = new Set();
  const datesSet = new Set();
  const distSet = new Set();

  cachedHistory.forEach(s => {
    const archerList = s.archers || Object.keys(s.scores || {});
    archerList.forEach(a => namesSet.add(a));

    if (s.timestamp && s.timestamp.date) {
      datesSet.add(formatDateDDMMYYYY(s.timestamp.date));
    }
    if (s.distance) {
      distSet.add(s.distance);
    }
  });

  Array.from(namesSet).sort().forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    nameSelect.appendChild(opt);
  });

  Array.from(datesSet).sort().forEach(dt => {
    const opt = document.createElement('option');
    opt.value = dt;
    opt.textContent = dt;
    dateSelect.appendChild(opt);
  });

  Array.from(distSet).sort((a,b)=>a-b).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `${d}M`;
    distSelect.appendChild(opt);
  });

  if (currentNameVal) nameSelect.value = currentNameVal;
  if (currentDateVal) dateSelect.value = currentDateVal;
  if (currentDistVal) distSelect.value = currentDistVal;
}

function clearHistoryFilters() {
  const nameSelect = document.getElementById('select-history-name-filter');
  const dateSelect = document.getElementById('select-history-date-filter');
  const distSelect = document.getElementById('select-history-distance-filter');
  if (nameSelect) nameSelect.value = 'all';
  if (dateSelect) dateSelect.value = 'all';
  if (distSelect) distSelect.value = 'all';
  filterHistoryList();
}

function setHistoryModeFilter(mode) {
  currentHistoryModeFilter = mode;
  document.getElementById('tab-hist-all').classList.toggle('active', mode === 'all');
  document.getElementById('tab-hist-personal').classList.toggle('active', mode === 'personal');
  document.getElementById('tab-hist-team').classList.toggle('active', mode === 'team');
  filterHistoryList();
}

function toggleHistorySelectMode() {
  isHistorySelectMode = !isHistorySelectMode;
  selectedSessionIds.clear();

  const selectBtn = document.getElementById('btn-toggle-select-mode');
  const batchBar = document.getElementById('history-batch-action-bar');

  if (isHistorySelectMode) {
    selectBtn.textContent = 'Cancel';
    selectBtn.classList.add('active-edit-mode');
    batchBar.classList.remove('hidden');
  } else {
    selectBtn.textContent = 'Select';
    selectBtn.classList.remove('active-edit-mode');
    batchBar.classList.add('hidden');
  }

  updateBatchActionBarUI();
  filterHistoryList();
}

function toggleSelectAllHistory(checked) {
  const displayedCheckboxes = document.querySelectorAll('.history-card-checkbox');
  displayedCheckboxes.forEach(cb => {
    cb.checked = checked;
    if (checked) selectedSessionIds.add(cb.dataset.id);
    else selectedSessionIds.delete(cb.dataset.id);
  });
  updateBatchActionBarUI();
}

function toggleSessionSelection(sessionId, checked) {
  if (checked) selectedSessionIds.add(sessionId);
  else selectedSessionIds.delete(sessionId);
  updateBatchActionBarUI();
}

function updateBatchActionBarUI() {
  const countLabel = document.getElementById('label-selected-count');
  const delBtn = document.getElementById('btn-delete-selected-history');
  const selectAllChk = document.getElementById('chk-select-all-history');

  const count = selectedSessionIds.size;
  if (countLabel) countLabel.textContent = `${count} selected`;

  if (delBtn) {
    if (count > 0) delBtn.classList.remove('disabled');
    else delBtn.classList.add('disabled');
  }

  if (selectAllChk) {
    const totalVisible = document.querySelectorAll('.history-card-checkbox').length;
    selectAllChk.checked = totalVisible > 0 && count === totalVisible;
  }
}

function deleteSelectedHistorySessions() {
  if (selectedSessionIds.size === 0) return;

  if (confirm(`Delete ${selectedSessionIds.size} selected session(s) permanently?`)) {
    cachedHistory = cachedHistory.filter(s => !selectedSessionIds.has(s.sessionId));
    localStorage.setItem('assafra_practice_history', JSON.stringify(cachedHistory));
    toggleHistorySelectMode();
    loadPracticeHistory();
  }
}

function filterHistoryList() {
  const nameFilter = document.getElementById('select-history-name-filter')?.value || 'all';
  const dateFilter = document.getElementById('select-history-date-filter')?.value || 'all';
  const dist = document.getElementById('select-history-distance-filter')?.value || 'all';

  const filtered = cachedHistory.filter(s => {
    const formattedDate = formatDateDDMMYYYY(s.timestamp.date);
    const matchMode = (currentHistoryModeFilter === 'all' || s.mode === currentHistoryModeFilter);
    const matchDist = (dist === 'all' || String(s.distance) === dist);
    const sessionArchers = s.archers || Object.keys(s.scores || {});
    const matchName = (nameFilter === 'all' || sessionArchers.includes(nameFilter));
    const matchDate = (dateFilter === 'all' || formattedDate === dateFilter);
    return matchMode && matchDist && matchName && matchDate;
  });

  renderHistoryList(filtered);
}

function renderHistoryList(sessions) {
  const container = document.getElementById('history-sessions-list');
  if (!container) return;
  container.innerHTML = '';

  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="history-empty-state">
        <div style="font-size:2.5rem; margin-bottom:8px;">📊</div>
        No practice sessions found for this filter.<br>Complete a practice session to see it here!
      </div>
    `;
    return;
  }

  sessions.forEach((session) => {
    const archerList = session.archers || Object.keys(session.scores || {});
    const stats = archerList.map(name => calculateArcherOverallStats(session, name));
    const ranked = assignRanksWithTies(stats);
    const winner = ranked[0] || { name: 'Archer', totalScore: 0 };
    const isChecked = selectedSessionIds.has(session.sessionId);
    const displayDate = formatDateDDMMYYYY(session.timestamp.date);

    const card = document.createElement('div');
    card.className = 'history-session-card';
    
    card.onclick = (e) => {
      if (isHistorySelectMode) {
        const chk = card.querySelector('.history-card-checkbox');
        if (chk && e.target !== chk) {
          chk.checked = !chk.checked;
          toggleSessionSelection(session.sessionId, chk.checked);
        }
      } else {
        openHistorySessionSummary(session.sessionId);
      }
    };

    const modeBadgeColor = session.mode === 'team' ? '#6a3bb5' : '#044993';

    card.innerHTML = `
      <div class="history-card-header">
        <div style="display:flex; align-items:center; gap:8px;">
          ${isHistorySelectMode ? `<input type="checkbox" class="history-card-checkbox" data-id="${session.sessionId}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleSessionSelection('${session.sessionId}', this.checked)">` : ''}
          <span class="history-card-dist-badge" style="background:${modeBadgeColor};">${session.distance}M • TF ${session.tfSize}CM</span>
        </div>
        <span class="history-card-date">${displayDate} • ${session.timestamp.time || ''}</span>
      </div>
      <div class="history-card-body">
        <div>
          <span style="font-size:0.7rem; color:#64748b; font-weight:700;">${session.mode === 'team' ? 'TOP ARCHER' : 'ARCHER'}</span>
          <div class="history-card-winner">${session.mode === 'team' ? '👑 ' : '🏹 '}${winner.name}</div>
        </div>
        <div class="history-card-score">${winner.totalScore} <span style="font-size:0.75rem; color:#475569;">pts</span></div>
      </div>
      <div class="history-card-footer">
        <span>${session.arrows}A x ${session.ends}E x ${session.rounds}R • ${session.mode === 'team' ? archerList.length + ' Archers' : 'Personal'}</span>
        ${!isHistorySelectMode ? `<button type="button" class="btn-card-del" onclick="deleteHistorySession(event, '${session.sessionId}')" title="Delete Session">🗑️</button>` : ''}
      </div>
    `;

    container.appendChild(card);
  });
}

function openHistorySessionSummary(sessionId) {
  const session = cachedHistory.find(s => s.sessionId === sessionId);
  if (!session) return;

  viewingHistorySession = session;

  const body = document.getElementById('summary-modal-content');
  body.innerHTML = '';
  document.getElementById('summary-meta-badge').textContent = `${session.distance}M • ${session.arrows}A x ${session.ends}E x ${session.rounds}R`;

  const archerList = session.archers || Object.keys(session.scores || {});
  const rawResults = archerList.map(name => calculateArcherOverallStats(session, name));
  const results = assignRanksWithTies(rawResults);

  let tableHeaderHtml = `<th>#</th><th>Archer</th>`;
  for (let r = 1; r <= session.rounds; r++) tableHeaderHtml += `<th>R${r}</th>`;
  
  const sampleResHist = results[0] || { topFirstKey: '10', topSecondKey: '9' };
  tableHeaderHtml += `<th>Total</th><th>${sampleResHist.topFirstKey}</th><th>${sampleResHist.topSecondKey}</th>`;

  let tableHtml = `<table class="results-table"><thead><tr>${tableHeaderHtml}</tr></thead><tbody>`;

  results.forEach(res => {
    tableHtml += `
      <tr>
        <td><strong>${res.rankDisplay}</strong></td>
        <td style="text-align:left;"><strong>${res.name}</strong></td>
    `;
    res.roundScoresList.forEach(rPts => { tableHtml += `<td>${rPts}</td>`; });
    tableHtml += `
        <td style="color:#044993; font-size:0.95rem; font-weight:900;">${res.totalScore}</td>
        <td>${res.topFirstCount}</td>
        <td>${res.topSecondCount}</td>
      </tr>
    `;
  });

  tableHtml += `</tbody></table>`;
  body.innerHTML = tableHtml;
  openModal('modal-summary-score');
}

function deleteHistorySession(event, sessionId) {
  event.stopPropagation();
  if (confirm('Delete this session record permanently?')) {
    cachedHistory = cachedHistory.filter(s => s.sessionId !== sessionId);
    localStorage.setItem('assafra_practice_history', JSON.stringify(cachedHistory));
    loadPracticeHistory();
  }
}

// ==================== ARCHER PROFILE SCREEN CONTROLLER ====================
function initArcherProfileScreen() {
  const select = document.getElementById('select-profile-archer');
  if (!select) return;
  
  let allHistory = [];
  try {
    const saved = localStorage.getItem('assafra_practice_history');
    allHistory = saved ? JSON.parse(saved) : [];
  } catch (e) {
    allHistory = [];
  }

  const namesSet = new Set();
  const masterList = getArcherHistory();
  const personalName = getPersonalName();
  if (personalName) namesSet.add(personalName);
  masterList.forEach(m => namesSet.add(m));

  allHistory.forEach(s => {
    if (s.scores) {
      Object.keys(s.scores).forEach(n => namesSet.add(n));
    }
    if (s.archers && Array.isArray(s.archers)) {
      s.archers.forEach(name => namesSet.add(name));
    }
  });

  const allNames = Array.from(namesSet).sort();

  select.innerHTML = '';
  allNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  if (allNames.length > 0) {
    select.value = allNames[0];
    loadArcherProfileStats(allNames[0]);
  }
}

function loadArcherProfileStats(archerName) {
  let allHistory = [];
  try {
    const saved = localStorage.getItem('assafra_practice_history');
    allHistory = saved ? JSON.parse(saved) : [];
  } catch (e) {
    allHistory = [];
  }

  const archerSessions = allHistory.filter(s => {
    const archerList = s.archers || Object.keys(s.scores || {});
    return archerList.includes(archerName);
  });

  let totalSessions = archerSessions.length;
  let totalArrows = 0;
  let totalScore = 0;
  let tensCount = 0;
  let xCount = 0;
  let missCount = 0;

  const ringGroupCounts = { gold: 0, red: 0, blue: 0, black: 0, white: 0, miss: 0 };
  const personalBests = {};

  archerSessions.forEach(session => {
    const stats = calculateArcherOverallStats(session, archerName);
    totalArrows += stats.totalArrows;
    totalScore += stats.totalScore;
    tensCount += stats.tensCount;
    xCount += stats.xCount;
    missCount += stats.missCount;

    const rc = stats.ringCounts;
    ringGroupCounts.gold += (rc["X"] || 0) + (rc["10"] || 0) + (rc["9"] || 0);
    ringGroupCounts.red += (rc["8"] || 0) + (rc["7"] || 0);
    ringGroupCounts.blue += (rc["6"] || 0) + (rc["5"] || 0);
    ringGroupCounts.black += (rc["4"] || 0) + (rc["3"] || 0);
    ringGroupCounts.white += (rc["2"] || 0) + (rc["1"] || 0);
    ringGroupCounts.miss += (rc["M"] || 0);

    const pbKey = `${session.distance}M (TF ${session.tfSize}CM)`;
    if (!personalBests[pbKey] || stats.totalScore > personalBests[pbKey].score) {
      personalBests[pbKey] = {
        score: stats.totalScore,
        format: `${session.arrows}A x ${session.ends}E x ${session.rounds}R`,
        date: formatDateDDMMYYYY(session.timestamp.date)
      };
    }
  });

  const overallAvg = totalArrows > 0 ? (totalScore / totalArrows).toFixed(2) : '0.00';

  document.getElementById('prof-stat-sessions').textContent = totalSessions;
  document.getElementById('prof-stat-arrows').textContent = totalArrows;
  document.getElementById('prof-stat-avg').textContent = overallAvg;
  document.getElementById('prof-stat-tens-x').textContent = `${tensCount + xCount} (X:${xCount})`;

  const pbWrap = document.getElementById('prof-pb-table-wrap');
  if (pbWrap) {
    const pbKeys = Object.keys(personalBests);
    if (pbKeys.length === 0) {
      pbWrap.innerHTML = '<span style="font-size:0.75rem; color:#94a3b8;">No scores recorded yet for this archer.</span>';
    } else {
      pbWrap.innerHTML = '';
      pbKeys.forEach(k => {
        const item = personalBests[k];
        const card = document.createElement('div');
        card.className = 'pb-badge-card';
        card.innerHTML = `
          <div>
            <div class="pb-badge-dist">🎯 ${k}</div>
            <div style="font-size:0.7rem; color:#64748b; font-weight:700;">${item.format} • ${item.date}</div>
          </div>
          <div class="pb-badge-score">${item.score} <span style="font-size:0.75rem; color:#475569;">pts</span></div>
        `;
        pbWrap.appendChild(card);
      });
    }
  }

  const barsWrap = document.getElementById('prof-accuracy-bars-wrap');
  if (barsWrap) {
    barsWrap.innerHTML = '';
    const categories = [
      { label: 'Gold (9,10,X)', count: ringGroupCounts.gold, color: '#facc15' },
      { label: 'Red (7,8)', count: ringGroupCounts.red, color: '#ef4444' },
      { label: 'Blue (5,6)', count: ringGroupCounts.blue, color: '#0284c7' },
      { label: 'Black (3,4)', count: ringGroupCounts.black, color: '#0f172a' },
      { label: 'White (1,2)', count: ringGroupCounts.white, color: '#94a3b8' },
      { label: 'Miss (M)', count: ringGroupCounts.miss, color: '#dc2626' }
    ];

    categories.forEach(cat => {
      const pct = totalArrows > 0 ? ((cat.count / totalArrows) * 100).toFixed(1) : '0.0';
      const row = document.createElement('div');
      row.className = 'accuracy-bar-row';
      row.innerHTML = `
        <span class="accuracy-bar-label">${cat.label}</span>
        <div class="accuracy-progress-track">
          <div class="accuracy-progress-fill" style="width:${pct}%; background:${cat.color};"></div>
        </div>
        <span class="accuracy-bar-pct">${pct}%</span>
      `;
      barsWrap.appendChild(row);
    });
  }

  const recentWrap = document.getElementById('prof-recent-sessions-list');
  if (recentWrap) {
    recentWrap.innerHTML = '';
    const recent = archerSessions.slice(0, 5);
    if (recent.length === 0) {
      recentWrap.innerHTML = '<span style="font-size:0.75rem; color:#94a3b8;">No recent sessions.</span>';
    } else {
      recent.forEach(sess => {
        const stats = calculateArcherOverallStats(sess, archerName);
        const card = document.createElement('div');
        card.className = 'history-session-card';
        card.onclick = () => openHistorySessionSummary(sess.sessionId);
        card.innerHTML = `
          <div class="history-card-header">
            <span class="history-card-dist-badge">${sess.distance}M • TF ${sess.tfSize}CM</span>
            <span class="history-card-date">${formatDateDDMMYYYY(sess.timestamp.date)}</span>
          </div>
          <div class="history-card-body">
            <div>
              <span style="font-size:0.7rem; color:#64748b; font-weight:700;">SCORE</span>
              <div class="history-card-winner">${stats.totalScore} pts (Avg: ${stats.avg})</div>
            </div>
            <div class="history-card-score" style="font-size:0.9rem; color:#044993;">X:${stats.xCount} | 10:${stats.tensCount}</div>
          </div>
        `;
        recentWrap.appendChild(card);
      });
    }
  }
}

// ==================== SETTINGS & DATA BACKUP/RESTORE CONTROLLER ====================
function initSettingsScreen() {
  document.getElementById('chk-settings-auto-gps').checked = getAppSetting('auto_gps', true);
  document.getElementById('input-settings-default-location').value = getAppSetting('default_location', 'Putatan, Sabah');
  document.getElementById('chk-settings-sound-enabled').checked = getAppSetting('sound_enabled', true);
}

function toggleAutoGPSSetting(checked) {
  setAppSetting('auto_gps', checked);
  if (checked) fetchCurrentLocation();
  else detectedLocation = getAppSetting('default_location', 'Putatan, Sabah');
}

function saveDefaultLocationSetting(val) {
  const v = val.trim() || 'Putatan, Sabah';
  setAppSetting('default_location', v);
  if (!getAppSetting('auto_gps', true)) {
    detectedLocation = v;
  }
}

function toggleSoundSetting(checked) {
  setAppSetting('sound_enabled', checked);
}

function exportCompleteDatabaseJSON() {
  const backupData = {
    version: "1.0",
    appName: "ASSAFRA SCOREBOARD",
    exportedAt: new Date().toISOString(),
    personalName: getPersonalName(),
    archersHistory: getArcherHistory(),
    presets: getPresets(),
    matrices: getMatrices(),
    practiceHistory: JSON.parse(localStorage.getItem('assafra_practice_history') || '[]'),
    settings: {
      auto_gps: getAppSetting('auto_gps', true),
      default_location: getAppSetting('default_location', 'Putatan, Sabah'),
      sound_enabled: getAppSetting('sound_enabled', true)
    }
  };

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
  const downloadAnchor = document.createElement('a');
  const todayStr = formatDateDDMMYYYY(new Date());
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `assafra_scoreboard_backup_${todayStr}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importCompleteDatabaseJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.appName || !imported.practiceHistory) {
        alert('Invalid backup file format.');
        return;
      }

      if (confirm(`Restore data from backup created on ${formatDateDDMMYYYY(imported.exportedAt)}? This will merge and update your current data.`)) {
        if (imported.personalName) localStorage.setItem('assafra_personal_name', imported.personalName);
        if (imported.archersHistory) localStorage.setItem('assafra_archers_history', JSON.stringify(imported.archersHistory));
        if (imported.presets) localStorage.setItem('assafra_presets', JSON.stringify(imported.presets));
        if (imported.matrices) localStorage.setItem('assaf_matrices', JSON.stringify(imported.matrices));
        if (imported.practiceHistory) localStorage.setItem('assafra_practice_history', JSON.stringify(imported.practiceHistory));

        if (imported.settings) {
          setAppSetting('auto_gps', imported.settings.auto_gps);
          setAppSetting('default_location', imported.settings.default_location);
          setAppSetting('sound_enabled', imported.settings.sound_enabled);
        }

        initSettingsScreen();
        alert('Database restored successfully!');
      }
    } catch (err) {
      alert('Error parsing JSON file. Please ensure the file is valid.');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function promptFactoryReset() {
  const conf1 = confirm('Are you sure you want to perform a FACTORY RESET? All practice history, archers, and custom presets will be erased.');
  if (conf1) {
    const conf2 = prompt('Type RESET to confirm permanent erasure:');
    if (conf2 === 'RESET') {
      localStorage.clear();
      alert('All scoreboard data has been reset to factory defaults.');
      window.location.reload();
    } else {
      alert('Reset cancelled.');
    }
  }
}

// ==================== DIGITAL GIANT TIMER LOGIC ====================
function toggleEndTimer() {
  getAudioContext();
  if (isTimerRunning) pauseEndTimer();
  else startEndTimer();
}

function resetEndTimer() {
  stopEndTimer();
  timerSecondsRemaining = activeSession.timer.secondsPerEnd || 60;
  updateTimerDisplay();
}

function startEndTimer() {
  if (timerSecondsRemaining <= 0) {
    timerSecondsRemaining = activeSession.timer.secondsPerEnd || 60;
  }
  isTimerRunning = true;
  document.getElementById('btn-giant-timer-start').textContent = '⏸ PAUSE';
  playStartSound();

  timerInterval = setInterval(() => {
    timerSecondsRemaining--;
    updateTimerDisplay();

    if (timerSecondsRemaining <= 10 && timerSecondsRemaining > 0) {
      playCountdownBeep();
    }

    if (timerSecondsRemaining <= 0) {
      stopEndTimer();
      document.getElementById('btn-giant-timer-start').textContent = '▶ START';
      playFinishTimerSequence();
      if ('vibrate' in navigator) navigator.vibrate([300, 150, 300, 150, 500]);
    }
  }, 1000);
}

function pauseEndTimer() {
  isTimerRunning = false;
  clearInterval(timerInterval);
  document.getElementById('btn-giant-timer-start').textContent = '▶ RESUME';
}

function stopEndTimer() {
  isTimerRunning = false;
  if (timerInterval) clearInterval(timerInterval);
}

function updateTimerDisplay() {
  const digitsEl = document.getElementById('timer-giant-digits');
  if (!digitsEl) return;
  digitsEl.textContent = timerSecondsRemaining;

  if (timerSecondsRemaining > 20) digitsEl.style.color = '#22c55e';
  else if (timerSecondsRemaining > 10) digitsEl.style.color = '#eab308';
  else digitsEl.style.color = '#ef4444';
}

function promptDeleteCurrentArcher() {
  const select = document.getElementById('select-profile-archer');
  if (!select) return;
  const archerName = select.value;
  if (!archerName) return;

  if (confirm(`Delete archer "${archerName}" and all their associated history records permanently?`)) {
    let history = [];
    try {
      const saved = localStorage.getItem('assafra_practice_history');
      if (saved) history = JSON.parse(saved);
    } catch (e) {
      history = [];
    }

    const updatedHistory = history.filter(s => {
      const archerList = s.archers || Object.keys(s.scores || {});
      return !archerList.includes(archerName);
    });
    localStorage.setItem('assafra_practice_history', JSON.stringify(updatedHistory));

    let masterList = getArcherHistory().filter(n => n !== archerName);
    localStorage.setItem('assafra_archers_history', JSON.stringify(masterList));

    if (getPersonalName() === archerName) {
      localStorage.removeItem('assafra_personal_name');
    }

    alert(`Archer "${archerName}" deleted successfully.`);
    initArcherProfileScreen();
  }
}
function openWhatsAppDirect() {
    // Gantikan nombor di bawah dengan nombor telefon rasmi anda (format antarabangsa tanpa simbol +)
    const phoneNumber = "60192841910"; 
    const message = "Hi, saya ingin memberikan maklum balas mengenai aplikasi Assafra Scoreboard.";
    const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
}