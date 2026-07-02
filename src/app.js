const STORAGE_KEY = "ritmo-turno-settings-v1";
const SETTINGS_VERSION = 2;
const LIMITS = {
  turnSeconds: { min: 10, max: 300 },
  finalWarningSeconds: { min: 1 },
  extraSeconds: { min: 5, max: 150 },
  milestoneSeconds: { min: 1 }
};

const DEFAULT_MILESTONE_ALERTS = [
  { id: "milestone-1", enabled: false, secondsRemaining: 45 },
  { id: "milestone-2", enabled: false, secondsRemaining: 30 }
];

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  turnSeconds: 60,
  finalWarningSeconds: 15,
  extraSeconds: 20,
  finalWarningEnabled: true,
  autoRestartTurn: true,
  pauseWhenAwayFromMainScreen: true,
  keepScreenAwake: true,
  volume: 0.8,
  milestoneAlerts: DEFAULT_MILESTONE_ALERTS
};

const dom = {
  timerView: document.querySelector("#timerView"),
  settingsView: document.querySelector("#settingsView"),
  settingsButton: document.querySelector("#settingsButton"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  countdown: document.querySelector("#countdown"),
  progressFill: document.querySelector("#progressFill"),
  timerRing: document.querySelector(".timer-ring"),
  toggleButton: document.querySelector("#toggleButton"),
  toggleIcon: document.querySelector("#toggleIcon"),
  toggleText: document.querySelector("#toggleText"),
  resetButton: document.querySelector("#resetButton"),
  extraButton: document.querySelector("#extraButton"),
  extraAmountLabel: document.querySelector("#extraAmountLabel"),
  statusText: document.querySelector("#statusText"),
  phaseLabel: document.querySelector("#phaseLabel"),
  turnLabel: document.querySelector("#turnLabel"),
  summaryTurn: document.querySelector("#summaryTurn"),
  summaryWarning: document.querySelector("#summaryWarning"),
  summaryExtra: document.querySelector("#summaryExtra"),
  turnSecondsInput: document.querySelector("#turnSecondsInput"),
  warningSecondsInput: document.querySelector("#warningSecondsInput"),
  extraSecondsInput: document.querySelector("#extraSecondsInput"),
  warningSecondsHint: document.querySelector("#warningSecondsHint"),
  milestoneOneToggle: document.querySelector("#milestoneOneToggle"),
  milestoneTwoToggle: document.querySelector("#milestoneTwoToggle"),
  milestoneOneInput: document.querySelector("#milestoneOneInput"),
  milestoneTwoInput: document.querySelector("#milestoneTwoInput"),
  milestoneOneHint: document.querySelector("#milestoneOneHint"),
  milestoneTwoHint: document.querySelector("#milestoneTwoHint"),
  warningToggle: document.querySelector("#warningToggle"),
  wakeToggle: document.querySelector("#wakeToggle"),
  volumeSlider: document.querySelector("#volumeSlider"),
  volumeValue: document.querySelector("#volumeValue")
};

const state = {
  settings: loadSettings(),
  remainingMs: 0,
  deadline: 0,
  intervalId: 0,
  handoffId: 0,
  isRunning: false,
  isHandoff: false,
  cycle: 1,
  lastWarningSecond: null,
  lastMilestoneSecond: null,
  audioContext: null,
  audioReady: false,
  wakeLock: null,
  status: "Toca iniciar para activar el sonido."
};

state.remainingMs = state.settings.turnSeconds * 1000;

syncSettingsControls();
bindEvents();
render();
registerServiceWorker();

function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return normalizeSettings({});
    }

    return normalizeSettings(JSON.parse(stored));
  } catch {
    return normalizeSettings({});
  }
}

function normalizeSettings(settings) {
  const turnSeconds = sanitizeSeconds(
    settings.turnSeconds,
    DEFAULT_SETTINGS.turnSeconds,
    LIMITS.turnSeconds.min,
    LIMITS.turnSeconds.max
  );
  const maxWarningSeconds = getMaxWarningSeconds(turnSeconds);
  const finalWarningSeconds = sanitizeSeconds(
    settings.finalWarningSeconds,
    DEFAULT_SETTINGS.finalWarningSeconds,
    LIMITS.finalWarningSeconds.min,
    maxWarningSeconds
  );
  const extraSeconds = sanitizeSeconds(
    settings.extraSeconds,
    DEFAULT_SETTINGS.extraSeconds,
    LIMITS.extraSeconds.min,
    LIMITS.extraSeconds.max
  );
  const milestoneAlerts = normalizeMilestoneAlerts(settings.milestoneAlerts, turnSeconds);

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    version: SETTINGS_VERSION,
    turnSeconds,
    finalWarningSeconds,
    extraSeconds,
    volume: clamp(Number(settings.volume ?? DEFAULT_SETTINGS.volume), 0, 1),
    finalWarningEnabled: Boolean(
      settings.finalWarningEnabled ?? DEFAULT_SETTINGS.finalWarningEnabled
    ),
    keepScreenAwake: Boolean(settings.keepScreenAwake ?? DEFAULT_SETTINGS.keepScreenAwake),
    milestoneAlerts
  };
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function bindEvents() {
  dom.toggleButton.addEventListener("click", () => {
    if (state.isRunning) {
      pauseTimer("Pausado.");
      return;
    }

    startTimer();
  });

  dom.resetButton.addEventListener("click", resetTurn);
  dom.extraButton.addEventListener("click", addExtraTime);
  dom.settingsButton.addEventListener("click", openSettings);
  dom.closeSettingsButton.addEventListener("click", closeSettings);

  dom.turnSecondsInput.addEventListener("input", () => updateTurnSeconds(false));
  dom.turnSecondsInput.addEventListener("change", () => updateTurnSeconds(true));
  dom.turnSecondsInput.addEventListener("blur", () => updateTurnSeconds(true));
  dom.warningSecondsInput.addEventListener("input", () => updateWarningSeconds(false));
  dom.warningSecondsInput.addEventListener("change", () => updateWarningSeconds(true));
  dom.warningSecondsInput.addEventListener("blur", () => updateWarningSeconds(true));
  dom.extraSecondsInput.addEventListener("input", () => updateExtraSeconds(false));
  dom.extraSecondsInput.addEventListener("change", () => updateExtraSeconds(true));
  dom.extraSecondsInput.addEventListener("blur", () => updateExtraSeconds(true));
  dom.milestoneOneToggle.addEventListener("change", () => updateMilestoneEnabled(0));
  dom.milestoneTwoToggle.addEventListener("change", () => updateMilestoneEnabled(1));
  dom.milestoneOneInput.addEventListener("input", () => updateMilestoneSeconds(0, false));
  dom.milestoneOneInput.addEventListener("change", () => updateMilestoneSeconds(0, true));
  dom.milestoneOneInput.addEventListener("blur", () => updateMilestoneSeconds(0, true));
  dom.milestoneTwoInput.addEventListener("input", () => updateMilestoneSeconds(1, false));
  dom.milestoneTwoInput.addEventListener("change", () => updateMilestoneSeconds(1, true));
  dom.milestoneTwoInput.addEventListener("blur", () => updateMilestoneSeconds(1, true));

  dom.warningToggle.addEventListener("change", () => {
    state.settings.finalWarningEnabled = dom.warningToggle.checked;
    state.lastWarningSecond = null;
    saveSettings();
    render();
  });

  dom.wakeToggle.addEventListener("change", () => {
    state.settings.keepScreenAwake = dom.wakeToggle.checked;
    saveSettings();

    if (state.isRunning && state.settings.keepScreenAwake) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    render();
  });

  dom.volumeSlider.addEventListener("input", () => {
    state.settings.volume = Number(dom.volumeSlider.value) / 100;
    dom.volumeValue.textContent = String(Math.round(state.settings.volume * 100));
    saveSettings();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.settings.pauseWhenAwayFromMainScreen) {
      pauseTimer("Pausado al salir de la pantalla.");
    } else if (!document.hidden && state.isRunning && state.settings.keepScreenAwake) {
      requestWakeLock();
    }
  });

  window.addEventListener("pagehide", () => {
    if (state.settings.pauseWhenAwayFromMainScreen) {
      pauseTimer("Pausado al salir de la pantalla.");
    }
  });
}

function startTimer() {
  clearHandoff();
  unlockAudio()
    .then(() => {
      if (state.isRunning) {
        state.status = state.audioReady
          ? "Turno en marcha."
          : "Turno en marcha sin sonido activo.";
        render();
      }
    })
    .catch(() => {
      state.audioReady = false;
    });

  if (state.remainingMs <= 0) {
    state.remainingMs = state.settings.turnSeconds * 1000;
  }

  state.deadline = performance.now() + state.remainingMs;
  state.isRunning = true;
  state.isHandoff = false;
  state.status = state.audioReady ? "Turno en marcha." : "Turno en marcha sin sonido activo.";

  window.clearInterval(state.intervalId);
  state.intervalId = window.setInterval(tick, 100);

  if (state.settings.keepScreenAwake) {
    requestWakeLock();
  }

  tick();
}

function pauseTimer(message = "Pausado.") {
  if (state.isRunning) {
    state.remainingMs = Math.max(0, state.deadline - performance.now());
  }

  state.isRunning = false;
  state.status = message;
  window.clearInterval(state.intervalId);
  releaseWakeLock();
  clearHandoff();
  render();
}

function resetTurn() {
  const shouldContinue = state.isRunning;
  pauseTimer("Turno reiniciado.");
  state.remainingMs = state.settings.turnSeconds * 1000;
  state.lastWarningSecond = null;
  state.lastMilestoneSecond = null;
  state.isHandoff = false;

  if (shouldContinue) {
    startTimer();
  } else {
    render();
  }
}

function addExtraTime() {
  clearHandoff();

  const extraMs = state.settings.extraSeconds * 1000;
  if (state.isRunning) {
    state.deadline += extraMs;
    state.remainingMs = Math.max(0, state.deadline - performance.now());
  } else {
    state.remainingMs += extraMs;
  }

  if (secondsRemaining() > state.settings.finalWarningSeconds) {
    state.lastWarningSecond = null;
  }

  state.status = `Se sumaron ${state.settings.extraSeconds} segundos.`;
  playSound("extra");
  render();
}

function tick() {
  state.remainingMs = Math.max(0, state.deadline - performance.now());

  if (state.remainingMs <= 0) {
    finishTurn();
    return;
  }

  if (!handleMilestoneAlert()) {
    handleFinalWarning();
  }
  render();
}

function handleMilestoneAlert() {
  const remaining = secondsRemaining();
  const matchingAlert = state.settings.milestoneAlerts.find(
    (alert) => alert.enabled && alert.secondsRemaining === remaining
  );

  if (!matchingAlert) {
    state.lastMilestoneSecond = null;
    return false;
  }

  if (state.lastMilestoneSecond !== remaining) {
    state.lastMilestoneSecond = remaining;
    playSound("milestone");
  }

  return true;
}

function handleFinalWarning() {
  if (!state.settings.finalWarningEnabled) {
    return;
  }

  const remaining = secondsRemaining();
  if (remaining <= 0 || remaining > state.settings.finalWarningSeconds) {
    return;
  }

  if (state.lastWarningSecond !== remaining) {
    state.lastWarningSecond = remaining;
    playSound("warning");
  }
}

function finishTurn() {
  window.clearInterval(state.intervalId);
  state.remainingMs = 0;
  state.isRunning = false;
  state.isHandoff = true;
  state.lastWarningSecond = null;
  state.lastMilestoneSecond = null;
  state.status = "Fin de turno.";
  releaseWakeLock();
  playSound("end");
  render();

  if (!state.settings.autoRestartTurn) {
    return;
  }

  state.handoffId = window.setTimeout(() => {
    if (document.hidden && state.settings.pauseWhenAwayFromMainScreen) {
      state.isHandoff = false;
      state.status = "Pausado al salir de la pantalla.";
      render();
      return;
    }

    state.cycle += 1;
    state.remainingMs = state.settings.turnSeconds * 1000;
    state.lastMilestoneSecond = null;
    state.isHandoff = false;
    startTimer();
  }, 1100);
}

function clearHandoff() {
  if (state.handoffId) {
    window.clearTimeout(state.handoffId);
    state.handoffId = 0;
  }
}

function openSettings() {
  pauseTimer("Pausado en ajustes.");
  dom.timerView.hidden = true;
  dom.settingsView.hidden = false;
}

function closeSettings() {
  commitSettingsInputs();
  dom.settingsView.hidden = true;
  dom.timerView.hidden = false;
  render();
}

function commitSettingsInputs() {
  updateTurnSeconds(true);
  updateWarningSeconds(true);
  updateExtraSeconds(true);
  updateMilestoneSeconds(0, true);
  updateMilestoneSeconds(1, true);
}

function updateTurnSeconds(shouldClamp) {
  const nextTurnSeconds = getInputSeconds(
    dom.turnSecondsInput,
    state.settings.turnSeconds,
    LIMITS.turnSeconds.min,
    LIMITS.turnSeconds.max,
    shouldClamp
  );

  if (nextTurnSeconds === null) {
    return;
  }

  const nextWarningSeconds = sanitizeSeconds(
    state.settings.finalWarningSeconds,
    DEFAULT_SETTINGS.finalWarningSeconds,
    LIMITS.finalWarningSeconds.min,
    getMaxWarningSeconds(nextTurnSeconds)
  );

  if (
    nextTurnSeconds === state.settings.turnSeconds &&
    nextWarningSeconds === state.settings.finalWarningSeconds
  ) {
    syncSettingsControls();
    return;
  }

  state.settings.turnSeconds = nextTurnSeconds;
  state.settings.finalWarningSeconds = nextWarningSeconds;
  state.settings.milestoneAlerts = normalizeMilestoneAlerts(
    state.settings.milestoneAlerts,
    nextTurnSeconds
  );
  state.remainingMs = nextTurnSeconds * 1000;
  state.lastWarningSecond = null;
  state.lastMilestoneSecond = null;
  state.status = "Duración actualizada. Turno reiniciado.";
  saveSettings();
  syncSettingsControls();
  render();
}

function updateWarningSeconds(shouldClamp) {
  const nextWarningSeconds = getInputSeconds(
    dom.warningSecondsInput,
    state.settings.finalWarningSeconds,
    LIMITS.finalWarningSeconds.min,
    getMaxWarningSeconds(state.settings.turnSeconds),
    shouldClamp
  );

  if (nextWarningSeconds === null) {
    return;
  }

  if (nextWarningSeconds === state.settings.finalWarningSeconds) {
    syncSettingsControls();
    return;
  }

  state.settings.finalWarningSeconds = nextWarningSeconds;
  state.lastWarningSecond = null;
  state.status = "Tramo final actualizado.";
  saveSettings();
  syncSettingsControls();
  render();
}

function updateExtraSeconds(shouldClamp) {
  const nextExtraSeconds = getInputSeconds(
    dom.extraSecondsInput,
    state.settings.extraSeconds,
    LIMITS.extraSeconds.min,
    LIMITS.extraSeconds.max,
    shouldClamp
  );

  if (nextExtraSeconds === null) {
    return;
  }

  if (nextExtraSeconds === state.settings.extraSeconds) {
    syncSettingsControls();
    return;
  }

  state.settings.extraSeconds = nextExtraSeconds;
  state.status = "Tiempo extra actualizado.";
  saveSettings();
  syncSettingsControls();
  render();
}

function updateMilestoneEnabled(index) {
  const alert = state.settings.milestoneAlerts[index];
  const toggle = getMilestoneToggle(index);

  alert.enabled = toggle.checked;
  state.lastMilestoneSecond = null;
  state.status = alert.enabled
    ? `Alerta puntual ${index + 1} activada.`
    : `Alerta puntual ${index + 1} desactivada.`;
  saveSettings();
  syncSettingsControls();
  render();
}

function updateMilestoneSeconds(index, shouldClamp) {
  const alerts = state.settings.milestoneAlerts;
  const input = getMilestoneInput(index);
  const maxMilestoneSeconds = getMaxMilestoneSeconds(state.settings.turnSeconds);
  const nextSeconds = getInputSeconds(
    input,
    alerts[index].secondsRemaining,
    LIMITS.milestoneSeconds.min,
    maxMilestoneSeconds,
    shouldClamp
  );

  if (nextSeconds === null) {
    return;
  }

  const otherIndex = index === 0 ? 1 : 0;
  const distinctSeconds = getDistinctMilestoneSecond(
    nextSeconds,
    alerts[otherIndex].secondsRemaining,
    maxMilestoneSeconds
  );

  if (distinctSeconds === alerts[index].secondsRemaining) {
    syncSettingsControls();
    return;
  }

  alerts[index].secondsRemaining = distinctSeconds;
  state.lastMilestoneSecond = null;
  state.status = `Alerta puntual ${index + 1} actualizada.`;
  saveSettings();
  syncSettingsControls();
  render();
}

function syncSettingsControls() {
  const maxWarningSeconds = getMaxWarningSeconds(state.settings.turnSeconds);
  const maxMilestoneSeconds = getMaxMilestoneSeconds(state.settings.turnSeconds);
  const milestoneOne = state.settings.milestoneAlerts[0];
  const milestoneTwo = state.settings.milestoneAlerts[1];

  dom.turnSecondsInput.value = String(state.settings.turnSeconds);
  dom.warningSecondsInput.value = String(state.settings.finalWarningSeconds);
  dom.warningSecondsInput.max = String(maxWarningSeconds);
  dom.warningSecondsHint.textContent = `1 a ${maxWarningSeconds} segundos`;
  dom.extraSecondsInput.value = String(state.settings.extraSeconds);
  dom.milestoneOneToggle.checked = milestoneOne.enabled;
  dom.milestoneTwoToggle.checked = milestoneTwo.enabled;
  dom.milestoneOneInput.value = String(milestoneOne.secondsRemaining);
  dom.milestoneTwoInput.value = String(milestoneTwo.secondsRemaining);
  dom.milestoneOneInput.max = String(maxMilestoneSeconds);
  dom.milestoneTwoInput.max = String(maxMilestoneSeconds);
  dom.milestoneOneHint.textContent = `1 a ${maxMilestoneSeconds}, distinto de alerta 2`;
  dom.milestoneTwoHint.textContent = `1 a ${maxMilestoneSeconds}, distinto de alerta 1`;
  dom.warningToggle.checked = state.settings.finalWarningEnabled;
  dom.wakeToggle.checked = state.settings.keepScreenAwake;
  dom.volumeSlider.value = String(Math.round(state.settings.volume * 100));
  dom.volumeValue.textContent = String(Math.round(state.settings.volume * 100));
}

function render() {
  const remaining = secondsRemaining();
  const totalMs = state.settings.turnSeconds * 1000;
  const progress = totalMs > 0 ? clamp(state.remainingMs / totalMs, 0, 1) : 0;
  const angle = `${Math.round(progress * 360)}deg`;
  const phase = getPhase(remaining);

  document.documentElement.dataset.phase = phase;
  dom.countdown.textContent = formatTime(remaining);
  dom.progressFill.style.transform = `scaleX(${progress})`;
  dom.timerRing.style.setProperty("--progress-angle", angle);
  dom.turnLabel.textContent = `Ciclo ${state.cycle}`;
  dom.phaseLabel.textContent = phaseLabel(phase);
  dom.statusText.textContent = state.status;
  dom.summaryTurn.textContent = `${state.settings.turnSeconds} s`;
  dom.summaryWarning.textContent = state.settings.finalWarningEnabled
    ? `${state.settings.finalWarningSeconds} s`
    : "Inactiva";
  dom.summaryExtra.textContent = `+${state.settings.extraSeconds} s`;
  dom.extraAmountLabel.textContent = `+${state.settings.extraSeconds}`;

  if (state.isRunning) {
    dom.toggleIcon.textContent = "Ⅱ";
    dom.toggleText.textContent = "Pausar";
  } else {
    dom.toggleIcon.textContent = "▶";
    dom.toggleText.textContent = state.remainingMs < totalMs ? "Continuar" : "Iniciar";
  }
}

function getPhase(remaining) {
  if (state.isHandoff || remaining <= 0) {
    return "ended";
  }

  if (
    state.settings.finalWarningEnabled &&
    remaining <= state.settings.finalWarningSeconds &&
    remaining > 0
  ) {
    return "warning";
  }

  return "normal";
}

function phaseLabel(phase) {
  if (phase === "ended") {
    return "Cambio";
  }

  if (phase === "warning") {
    return "Tramo final";
  }

  if (state.isRunning) {
    return "En marcha";
  }

  return "Listo";
}

function secondsRemaining() {
  return Math.ceil(state.remainingMs / 1000);
}

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function unlockAudio() {
  if (state.audioReady) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  state.audioContext = state.audioContext || new AudioContextClass();

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }

  state.audioReady = state.audioContext.state === "running";
}

function playSound(type) {
  if (!state.audioReady || !state.audioContext || state.settings.volume <= 0) {
    return;
  }

  const now = state.audioContext.currentTime;
  const volume = state.settings.volume;

  if (type === "warning") {
    beep(now, 720, 0.08, volume * 0.28, "square");
    return;
  }

  if (type === "extra") {
    beep(now, 520, 0.07, volume * 0.22, "sine");
    beep(now + 0.08, 740, 0.09, volume * 0.2, "sine");
    return;
  }

  if (type === "milestone") {
    beep(now, 880, 0.09, volume * 0.26, "triangle");
    beep(now + 0.1, 660, 0.11, volume * 0.24, "triangle");
    return;
  }

  beep(now, 280, 0.16, volume * 0.36, "sawtooth");
  beep(now + 0.15, 180, 0.22, volume * 0.42, "sawtooth");
}

function beep(startTime, frequency, duration, volume, wave) {
  const oscillator = state.audioContext.createOscillator();
  const gain = state.audioContext.createGain();

  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(state.audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.hidden) {
    return;
  }

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    });
  } catch {
    state.wakeLock = null;
  }
}

function releaseWakeLock() {
  if (!state.wakeLock) {
    return;
  }

  state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}

function getMaxWarningSeconds(turnSeconds) {
  return Math.max(LIMITS.finalWarningSeconds.min, Math.floor(turnSeconds / 2));
}

function getMaxMilestoneSeconds(turnSeconds) {
  return Math.max(LIMITS.milestoneSeconds.min, turnSeconds - 1);
}

function normalizeMilestoneAlerts(alerts, turnSeconds) {
  const maxMilestoneSeconds = getMaxMilestoneSeconds(turnSeconds);
  const sourceAlerts = DEFAULT_MILESTONE_ALERTS.map((defaultAlert, index) => ({
    ...defaultAlert,
    ...(Array.isArray(alerts) ? alerts[index] : {})
  }));
  const firstSeconds = sanitizeSeconds(
    sourceAlerts[0].secondsRemaining,
    DEFAULT_MILESTONE_ALERTS[0].secondsRemaining,
    LIMITS.milestoneSeconds.min,
    maxMilestoneSeconds
  );
  const secondSeconds = getDistinctMilestoneSecond(
    sanitizeSeconds(
      sourceAlerts[1].secondsRemaining,
      DEFAULT_MILESTONE_ALERTS[1].secondsRemaining,
      LIMITS.milestoneSeconds.min,
      maxMilestoneSeconds
    ),
    firstSeconds,
    maxMilestoneSeconds
  );

  return [
    {
      id: DEFAULT_MILESTONE_ALERTS[0].id,
      enabled: Boolean(sourceAlerts[0].enabled),
      secondsRemaining: firstSeconds
    },
    {
      id: DEFAULT_MILESTONE_ALERTS[1].id,
      enabled: Boolean(sourceAlerts[1].enabled),
      secondsRemaining: secondSeconds
    }
  ];
}

function getDistinctMilestoneSecond(preferredSecond, reservedSecond, maxMilestoneSeconds) {
  if (preferredSecond !== reservedSecond) {
    return preferredSecond;
  }

  if (preferredSecond > LIMITS.milestoneSeconds.min) {
    return preferredSecond - 1;
  }

  if (preferredSecond < maxMilestoneSeconds) {
    return preferredSecond + 1;
  }

  return preferredSecond;
}

function getMilestoneInput(index) {
  return index === 0 ? dom.milestoneOneInput : dom.milestoneTwoInput;
}

function getMilestoneToggle(index) {
  return index === 0 ? dom.milestoneOneToggle : dom.milestoneTwoToggle;
}

function getInputSeconds(input, fallback, min, max, shouldClamp) {
  if (input.value.trim() === "") {
    return shouldClamp ? fallback : null;
  }

  if (shouldClamp) {
    return sanitizeSeconds(input.value, fallback, min, max);
  }

  const parsed = Number(input.value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.round(parsed);
  if (rounded < min) {
    return null;
  }

  return Math.min(rounded, max);
}

function sanitizeSeconds(value, fallback, min, max) {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return clamp(safeValue, min, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
