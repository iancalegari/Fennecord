/**
 * Controlador principal da interface do editor Áudio Estourado.
 * Gerencia upload, presets, controles DSP, visualizadores Canvas e exportação WAV.
 */

import { AudioStudioEngine, DEFAULT_PARAMS } from "./audio-engine.js";
import {
  encodeAudioBufferToWav,
  encodeAudioBufferToMp3,
  buildSafeOutputFilename,
} from "./wav-encoder.js";

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

const PRESETS = {
  clean: {
    label: "Original",
    params: { ...DEFAULT_PARAMS },
  },
  estourado: {
    label: "Áudio Estourado (+120 dB)",
    params: {
      gainDb: 120,
      clipMode: "hard",
      drive: 45,
      bassDb: 18,
      midDb: 4,
      trebleDb: 6,
      lowpassHz: 18000,
      reverbMix: 0,
      reverbDecay: 2.0,
      delayMix: 0,
      speed: 1.0,
    },
  },
  max200: {
    label: "Estouro Máximo (+200 dB)",
    params: {
      gainDb: 200,
      clipMode: "fuzz",
      drive: 100,
      bassDb: 36,
      midDb: 12,
      trebleDb: 14,
      lowpassHz: 20000,
      reverbMix: 12,
      reverbDecay: 1.8,
      delayMix: 0,
      speed: 1.0,
    },
  },
  bassboost: {
    label: "Bass Boosted",
    params: {
      gainDb: 24,
      clipMode: "soft",
      drive: 25,
      bassDb: 28,
      midDb: -2,
      trebleDb: 3,
      lowpassHz: 16500,
      reverbMix: 8,
      reverbDecay: 1.5,
      delayMix: 0,
      speed: 1.0,
    },
  },
  slowed: {
    label: "Slowed + Reverb",
    params: {
      gainDb: 2,
      clipMode: "soft",
      drive: 0,
      bassDb: 6,
      midDb: 0,
      trebleDb: -3,
      lowpassHz: 14000,
      reverbMix: 58,
      reverbDecay: 4.4,
      delayMix: 12,
      speed: 0.82,
    },
  },
  muffled: {
    label: "Festa no Banheiro",
    params: {
      gainDb: -3,
      clipMode: "soft",
      drive: 4,
      bassDb: 18,
      midDb: -6,
      trebleDb: -5,
      lowpassHz: 400,
      reverbMix: 100,
      reverbDecay: 1.9,
      delayMix: 9,
      speed: 1.0,
    },
  },
};

const engine = new AudioStudioEngine();
let currentFileName = "";
let waveformPeaks = [];
let isSeeking = false;
let rafId = null;

// Referências dos elementos da interface
const el = {
  fileInput: document.getElementById("audio-file-input"),
  btnHeaderUpload: document.getElementById("btn-header-upload"),
  btnWaveformUpload: document.getElementById("btn-waveform-upload"),
  btnWaveformDemo: document.getElementById("btn-waveform-demo"),
  btnClearAudio: document.getElementById("btn-clear-audio"),
  fileInfoBar: document.getElementById("file-info-bar"),
  fileName: document.getElementById("file-name"),
  fileMeta: document.getElementById("file-meta"),

  waveformStage: document.getElementById("waveform-stage"),
  waveformCanvas: document.getElementById("waveform-canvas"),
  waveformEmpty: document.getElementById("waveform-empty"),
  spectrumCanvas: document.getElementById("spectrum-canvas"),
  heroAmbientCanvas: document.getElementById("hero-ambient-canvas"),

  currentTime: document.getElementById("current-time"),
  totalTime: document.getElementById("total-time"),
  peakDb: document.getElementById("peak-db"),
  vuProgress: document.getElementById("vu-progress"),
  clipBadge: document.getElementById("clip-badge"),
  gainZoneTag: document.getElementById("gain-zone-tag"),
  hearingWarning: document.getElementById("hearing-warning"),
  hearingWarningText: document.getElementById("hearing-warning-text"),

  btnOpenPrivacy: document.getElementById("btn-open-privacy"),
  btnClosePrivacy: document.getElementById("btn-close-privacy"),
  privacyDialog: document.getElementById("privacy-dialog"),

  btnPlay: document.getElementById("btn-play"),
  iconPlay: document.getElementById("icon-play"),
  labelPlay: document.getElementById("label-play"),
  btnStop: document.getElementById("btn-stop"),
  btnLoop: document.getElementById("btn-loop"),
  btnBypass: document.getElementById("btn-bypass"),
  btnReset: document.getElementById("btn-reset"),
  ctrlExportFormat: document.getElementById("ctrl-export-format"),
  btnExport: document.getElementById("btn-export"),
  iconExport: document.getElementById("icon-export"),
  labelExport: document.getElementById("label-export"),

  presetButtons: Array.from(document.querySelectorAll(".preset-btn")),
  toastRegion: document.getElementById("toast-region"),

  // Controles DSP
  ctrlGain: document.getElementById("ctrl-gain"),
  valGain: document.getElementById("val-gain"),
  ctrlClipMode: document.getElementById("ctrl-clip-mode"),
  ctrlDrive: document.getElementById("ctrl-drive"),
  valDrive: document.getElementById("val-drive"),
  ctrlBass: document.getElementById("ctrl-bass"),
  valBass: document.getElementById("val-bass"),
  ctrlMid: document.getElementById("ctrl-mid"),
  valMid: document.getElementById("val-mid"),
  ctrlTreble: document.getElementById("ctrl-treble"),
  valTreble: document.getElementById("val-treble"),
  ctrlLowpass: document.getElementById("ctrl-lowpass"),
  valLowpass: document.getElementById("val-lowpass"),
  ctrlReverbMix: document.getElementById("ctrl-reverb-mix"),
  valReverbMix: document.getElementById("val-reverb-mix"),
  ctrlReverbDecay: document.getElementById("ctrl-reverb-decay"),
  valReverbDecay: document.getElementById("val-reverb-decay"),
  ctrlDelayMix: document.getElementById("ctrl-delay-mix"),
  valDelayMix: document.getElementById("val-delay-mix"),
  ctrlSpeed: document.getElementById("ctrl-speed"),
  valSpeed: document.getElementById("val-speed"),
  ctrlMaster: document.getElementById("ctrl-master"),
  valMaster: document.getElementById("val-master"),
};

/**
 * Formata segundos no padrão MM:SS.d.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

/**
 * Exibe uma notificação temporária na interface.
 * @param {string} message
 * @param {'info' | 'error'} type
 */
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "toast-error" : ""}`;
  if (type === "error") {
    toast.setAttribute("role", "alert");
  }
  const icon = document.createElement("span");
  icon.className = "material-icons";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = type === "error" ? "error_outline" : "check_circle";

  const text = document.createElement("span");
  text.textContent = message;

  toast.append(icon, text);
  el.toastRegion.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 4200);
}

/**
 * Habilita ou desabilita os botões do transporte conforme existência de áudio.
 * @param {boolean} hasAudio
 */
function setTransportEnabled(hasAudio) {
  el.btnPlay.disabled = !hasAudio;
  el.btnStop.disabled = !hasAudio;
  el.btnLoop.disabled = !hasAudio;
  el.btnBypass.disabled = !hasAudio;
  el.btnReset.disabled = !hasAudio;
  el.btnExport.disabled = !hasAudio;
  if (el.ctrlExportFormat) {
    el.ctrlExportFormat.disabled = !hasAudio;
  }
  el.waveformEmpty.hidden = hasAudio;
}

/**
 * Atualiza o rótulo do botão de exportação conforme o formato escolhido.
 */
function syncExportButtonLabel() {
  const format = el.ctrlExportFormat?.value === "wav" ? "WAV" : "MP3";
  el.labelExport.textContent = `Baixar ${format}`;
}

/**
 * Atualiza o estado visual do botão Play/Pause.
 */
function syncPlayButton() {
  if (engine.isPlaying) {
    el.iconPlay.textContent = "pause";
    el.labelPlay.textContent = "Pausar";
  } else {
    el.iconPlay.textContent = "play_arrow";
    el.labelPlay.textContent = "Reproduzir";
  }
}

/**
 * Pré-calcula os picos da forma de onda para renderização rápida no Canvas.
 * @param {AudioBuffer} buffer
 * @param {number} barCount
 */
function computeWaveformPeaks(buffer, barCount = 160) {
  const channelData = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channelData.length / barCount));
  const peaks = new Array(barCount);

  for (let i = 0; i < barCount; i += 1) {
    let maxAmp = 0;
    const start = i * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    for (let j = start; j < end; j += 1) {
      const val = Math.abs(channelData[j]);
      if (val > maxAmp) maxAmp = val;
    }
    peaks[i] = maxAmp;
  }

  waveformPeaks = peaks;
}

/**
 * Desenha a forma de onda completa + indicador de saturação + playhead.
 */
function drawWaveform() {
  const canvas = el.waveformCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0A0A0C";
  ctx.fillRect(0, 0, width, height);

  // Linha central de referência
  ctx.strokeStyle = "rgba(243, 241, 234, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  if (!waveformPeaks.length || !engine.buffer) return;

  const duration = engine.getDuration();
  const progress = duration > 0 ? engine.getCurrentTime() / duration : 0;
  const gainVisualBoost = engine.bypass
    ? 1
    : Math.min(6, Math.pow(10, Math.max(0, engine.params.gainDb) / 40));

  const barStep = width / waveformPeaks.length;
  const barWidth = Math.max(2, barStep - 2);

  for (let i = 0; i < waveformPeaks.length; i += 1) {
    const x = i * barStep;
    const amp = Math.min(1, waveformPeaks[i] * gainVisualBoost);
    const barHeight = Math.max(4, amp * (height - 24));
    const y = (height - barHeight) / 2;
    const isPlayed = i / waveformPeaks.length <= progress;

    if (isPlayed) {
      ctx.fillStyle = "#F3F1EA";
    } else if (!engine.bypass && amp >= 0.96 && engine.params.gainDb >= 24) {
      // Destaque laranja intenso quando o sinal está estourando
      ctx.fillStyle = "#FF7A33";
    } else {
      ctx.fillStyle = "#FF4D00";
    }

    ctx.fillRect(x, y, barWidth, barHeight);
  }

  // Playhead vertical
  const playheadX = Math.max(1, Math.min(width - 1, progress * width));
  ctx.fillStyle = "#F3F1EA";
  ctx.fillRect(playheadX - 1, 0, 2, height);
}

/**
 * Desenha as barras segmentadas sutis no fundo direito da Hero (reagem ao áudio quando tocando).
 */
function drawHeroAmbient(freqData) {
  const canvas = el.heroAmbientCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  const cols = 22;
  const colGap = 10;
  const colW = (width - colGap * (cols - 1)) / cols;
  const segH = 8;
  const segGap = 5;
  const maxSegs = Math.floor((height - 24) / (segH + segGap));
  const nowSec = performance.now() / 1000;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (let c = 0; c < cols; c += 1) {
    let level;
    if (freqData && engine.isPlaying) {
      const idx = Math.min(freqData.length - 1, Math.floor((c / cols) * freqData.length * 0.75));
      level = 0.2 + (freqData[idx] / 255) * 0.8;
    } else {
      // Silhueta orgânica de equalizador em repouso (como na estética hardware)
      const phase = reducedMotion ? 0 : nowSec * 0.65;
      const base = 0.28 + 0.34 * Math.abs(Math.sin(c * 0.42 + 0.9)) + 0.22 * Math.abs(Math.cos(c * 0.19 - phase));
      level = Math.min(0.92, Math.max(0.16, base));
    }

    const activeSegs = Math.max(2, Math.round(level * maxSegs));
    const x = c * (colW + colGap);

    for (let s = 0; s < activeSegs; s += 1) {
      const y = height - (s + 1) * (segH + segGap);
      const fade = 1 - s / (maxSegs + 2);
      if (freqData && engine.isPlaying && s >= activeSegs - 2) {
        ctx.fillStyle = "rgba(255, 77, 0, 0.22)";
      } else {
        ctx.fillStyle = `rgba(243, 241, 234, ${(0.045 + fade * 0.055).toFixed(3)})`;
      }
      ctx.fillRect(x, y, colW, segH);
    }
  }
}

/**
 * Desenha o analisador de espectro FFT e atualiza o medidor VU em tempo real.
 */
function drawSpectrumAndMeter() {
  const canvas = el.spectrumCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0A0A0C";
  ctx.fillRect(0, 0, width, height);

  if (!engine.analyser || !engine.isPlaying) {
    // Desenha barras sutis em repouso na cor laranja sinal
    const idleBars = 36;
    const gap = 3;
    const barW = (width - gap * (idleBars - 1)) / idleBars;
    for (let i = 0; i < idleBars; i += 1) {
      const idleH = 6 + Math.round(Math.abs(Math.sin(i * 0.55)) * 10);
      ctx.fillStyle = "rgba(255, 77, 0, 0.48)";
      ctx.fillRect(i * (barW + gap), height - idleH, barW, idleH);
    }
    el.vuProgress.value = 0;
    el.peakDb.textContent = "-∞ dBFS";
    drawHeroAmbient(null);
    return;
  }

  const freqData = new Uint8Array(engine.analyser.frequencyBinCount);
  engine.analyser.getByteFrequencyData(freqData);
  drawHeroAmbient(freqData);

  const bars = 40;
  const step = Math.max(1, Math.floor(freqData.length / bars));
  const gap = 3;
  const barW = (width - gap * (bars - 1)) / bars;

  for (let i = 0; i < bars; i += 1) {
    const value = freqData[i * step] / 255;
    const barH = Math.max(4, value * (height - 10));
    ctx.fillStyle = value > 0.85 ? "#F3F1EA" : "#FF4D00";
    ctx.fillRect(i * (barW + gap), height - barH, barW, barH);
  }

  // Calcula nível de pico no domínio do tempo
  const timeData = new Float32Array(engine.analyser.fftSize);
  engine.analyser.getFloatTimeDomainData(timeData);
  let peak = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const abs = Math.abs(timeData[i]);
    if (abs > peak) peak = abs;
  }

  const db = peak > 0.00001 ? 20 * Math.log10(peak) : -Infinity;
  const meterPercent = Number.isFinite(db)
    ? Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
    : 0;

  el.vuProgress.value = Number(meterPercent.toFixed(1));
  el.peakDb.textContent = Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : "-∞ dBFS";
}

/**
 * Loop principal de animação dos medidores e da linha do tempo.
 */
function renderLoop() {
  el.currentTime.textContent = formatTime(engine.getCurrentTime());
  drawWaveform();
  drawSpectrumAndMeter();
  rafId = window.requestAnimationFrame(renderLoop);
}

/**
 * Atualiza todos os rótulos, badges de status e alertas de proteção auditiva.
 */
function syncUiFromParams() {
  const p = engine.params;

  el.ctrlGain.value = String(p.gainDb);
  el.valGain.textContent = `${p.gainDb > 0 ? "+" : ""}${p.gainDb} dB`;
  el.gainZoneTag.textContent = `${p.gainDb > 0 ? "+" : ""}${p.gainDb} dB`;

  el.ctrlClipMode.value = p.clipMode;
  el.ctrlDrive.value = String(p.drive);
  el.valDrive.textContent = `${p.drive}%`;

  el.ctrlBass.value = String(p.bassDb);
  el.valBass.textContent = `${p.bassDb > 0 ? "+" : ""}${p.bassDb} dB`;

  el.ctrlMid.value = String(p.midDb);
  el.valMid.textContent = `${p.midDb > 0 ? "+" : ""}${p.midDb} dB`;

  el.ctrlTreble.value = String(p.trebleDb);
  el.valTreble.textContent = `${p.trebleDb > 0 ? "+" : ""}${p.trebleDb} dB`;

  el.ctrlLowpass.value = String(p.lowpassHz);
  el.valLowpass.textContent = p.lowpassHz >= 1000
    ? `${(p.lowpassHz / 1000).toFixed(1)} kHz`
    : `${p.lowpassHz} Hz`;

  el.ctrlReverbMix.value = String(p.reverbMix);
  el.valReverbMix.textContent = `${p.reverbMix}%`;

  el.ctrlReverbDecay.value = String(p.reverbDecay);
  el.valReverbDecay.textContent = `${Number(p.reverbDecay).toFixed(1)} s`;

  el.ctrlDelayMix.value = String(p.delayMix);
  el.valDelayMix.textContent = `${p.delayMix}%`;

  el.ctrlSpeed.value = String(p.speed);
  el.valSpeed.textContent = `${Number(p.speed).toFixed(2)}x`;

  const masterPct = Math.round(p.masterVolume * 100);
  el.ctrlMaster.value = String(masterPct);
  el.valMaster.textContent = `${masterPct}%`;

  // Badge de status de clipping / saturação
  el.clipBadge.classList.remove("status-clean", "status-hot", "status-clip");
  if (engine.bypass) {
    el.clipBadge.textContent = "ORIGINAL";
    el.clipBadge.classList.add("status-clean");
  } else if (p.gainDb >= 60) {
    el.clipBadge.textContent = "ESTOURADO";
    el.clipBadge.classList.add("status-clip");
  } else if (p.gainDb >= 12 || p.drive >= 35) {
    el.clipBadge.textContent = "SATURADO";
    el.clipBadge.classList.add("status-hot");
  } else {
    el.clipBadge.textContent = "LIMPO";
    el.clipBadge.classList.add("status-clean");
  }

  // Aviso permanente de proteção auditiva com destaque em ganhos extremos
  const isHighGain = !engine.bypass && p.gainDb >= 24;
  el.hearingWarning.classList.toggle("is-alert", isHighGain);
  if (el.hearingWarningText) {
    el.hearingWarningText.textContent = isHighGain
      ? "Ganho extremo ativo! Mantenha o Volume Master baixo para proteger seus ouvidos."
      : "Mantenha o Volume Master baixo ao aumentar o ganho para proteger seus ouvidos.";
  }
}

/**
 * Marca visualmente o preset ativo ou limpa a seleção ao editar manualmente.
 * @param {string | null} presetKey
 */
function setActivePresetButton(presetKey) {
  el.presetButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === presetKey);
  });
}

/**
 * Processa o carregamento de um arquivo enviado pelo usuário.
 * @param {File} file
 */
async function handleAudioFile(file) {
  if (!file) return;

  if (file.size === 0) {
    showToast("O arquivo selecionado está vazio.", "error");
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    showToast("Arquivo muito grande. O limite máximo é de 100 MB.", "error");
    return;
  }

  const isAudioMime = file.type.startsWith("audio/");
  const isAudioExt = /\.(mp3|wav|ogg|m4a|flac|webm|aac)$/i.test(file.name);
  if (!isAudioMime && !isAudioExt) {
    showToast("Formato não suportado. Envie MP3, WAV, OGG, M4A ou FLAC.", "error");
    return;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await engine.loadFromArrayBuffer(arrayBuffer);
    onAudioLoaded(file.name, buffer);
    showToast(`Áudio carregado: ${file.name}`);
  } catch {
    showToast("Não foi possível decodificar este arquivo. Verifique se é um áudio válido.", "error");
  }
}

/**
 * Atualiza a interface após carregar qualquer AudioBuffer (arquivo ou demo).
 * @param {string} name
 * @param {AudioBuffer} buffer
 */
function onAudioLoaded(name, buffer) {
  currentFileName = name;
  computeWaveformPeaks(buffer);
  setTransportEnabled(true);
  syncPlayButton();

  const channelsLabel = buffer.numberOfChannels === 1 ? "Mono" : "Estéreo";
  const rateKhz = (buffer.sampleRate / 1000).toFixed(1);
  el.fileName.textContent = name;
  el.fileMeta.textContent = `${formatTime(buffer.duration)} · ${rateKhz} kHz · ${channelsLabel}`;
  el.fileInfoBar.hidden = false;

  el.currentTime.textContent = "00:00.0";
  el.totalTime.textContent = formatTime(buffer.duration);
  drawWaveform();
}

/**
 * Converte a posição do ponteiro na waveform em tempo de seek.
 * @param {PointerEvent} event
 */
function seekFromPointer(event) {
  if (!engine.buffer) return;
  const rect = el.waveformStage.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  engine.seek(ratio * engine.getDuration());
  el.currentTime.textContent = formatTime(engine.getCurrentTime());
  drawWaveform();
}

/**
 * Exporta o áudio processado no formato selecionado (MP3 ou WAV).
 */
async function handleExportAudio() {
  if (!engine.buffer) return;

  const format = el.ctrlExportFormat?.value === "wav" ? "wav" : "mp3";
  el.btnExport.disabled = true;
  if (el.ctrlExportFormat) el.ctrlExportFormat.disabled = true;
  el.iconExport.textContent = "hourglass_top";
  el.labelExport.textContent = format === "mp3" ? "Codificando MP3..." : "Renderizando WAV...";

  try {
    const renderedBuffer = await engine.renderOffline();
    const audioBlob = format === "mp3"
      ? encodeAudioBufferToMp3(renderedBuffer, 192)
      : encodeAudioBufferToWav(renderedBuffer);
    const filename = buildSafeOutputFilename(currentFileName, format);
    const sizeMb = (audioBlob.size / (1024 * 1024)).toFixed(2);

    const url = URL.createObjectURL(audioBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);

    showToast(`Download concluído: ${filename} (${sizeMb} MB)`);
  } catch (err) {
    const safeMsg = err instanceof Error && err.message.includes("15 minutos")
      ? err.message
      : `Falha ao renderizar o arquivo ${format.toUpperCase()}. Tente reduzir a duração ou o reverb.`;
    showToast(safeMsg, "error");
  } finally {
    el.btnExport.disabled = !engine.buffer;
    if (el.ctrlExportFormat) el.ctrlExportFormat.disabled = !engine.buffer;
    el.iconExport.textContent = "download";
    syncExportButtonLabel();
  }
}

/**
 * Inicializa todos os listeners de eventos da aplicação.
 */
function bindEvents() {
  engine.onEnded = () => {
    syncPlayButton();
  };

  // Botões de upload (Cabeçalho e área da Forma de Onda)
  el.btnHeaderUpload.addEventListener("click", () => el.fileInput.click());
  el.btnWaveformUpload?.addEventListener("click", (event) => {
    event.stopPropagation();
    el.fileInput.click();
  });
  el.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) handleAudioFile(file);
    el.fileInput.value = "";
  });

  // Drag & Drop direto na área da Forma de Onda
  ["dragenter", "dragover"].forEach((evt) => {
    el.waveformStage.addEventListener(evt, (event) => {
      event.preventDefault();
      el.waveformStage.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    el.waveformStage.addEventListener(evt, (event) => {
      event.preventDefault();
      el.waveformStage.classList.remove("is-dragover");
    });
  });

  el.waveformStage.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) handleAudioFile(file);
  });

  // Carregar áudio de teste embutido
  el.btnWaveformDemo?.addEventListener("click", (event) => {
    event.stopPropagation();
    const buffer = engine.loadDemoTrack();
    onAudioLoaded("beat-teste-120bpm.wav", buffer);
    showToast("Áudio de teste carregado! Experimente o preset Áudio Estourado.");
  });

  // Remover áudio
  el.btnClearAudio.addEventListener("click", () => {
    engine.clear();
    currentFileName = "";
    waveformPeaks = [];
    el.fileInfoBar.hidden = true;
    el.currentTime.textContent = "00:00.0";
    el.totalTime.textContent = "00:00.0";
    setTransportEnabled(false);
    syncPlayButton();
    drawWaveform();
    showToast("Áudio removido da mesa.");
  });

  // Modal de Privacidade & LGPD
  if (el.btnOpenPrivacy && el.privacyDialog) {
    el.btnOpenPrivacy.addEventListener("click", () => {
      if (typeof el.privacyDialog.showModal === "function") {
        el.privacyDialog.showModal();
      }
    });

    el.btnClosePrivacy?.addEventListener("click", () => {
      el.privacyDialog.close();
    });

    el.privacyDialog.addEventListener("click", (event) => {
      if (event.target === el.privacyDialog) {
        el.privacyDialog.close();
      }
    });
  }

  // Transporte
  el.btnPlay.addEventListener("click", () => {
    if (engine.isPlaying) {
      engine.pause();
    } else {
      engine.play();
    }
    syncPlayButton();
  });

  el.btnStop.addEventListener("click", () => {
    engine.stop();
    syncPlayButton();
    drawWaveform();
  });

  el.btnLoop.addEventListener("click", () => {
    const next = !engine.loop;
    engine.setLoop(next);
    el.btnLoop.setAttribute("aria-pressed", String(next));
    showToast(next ? "Loop ativado." : "Loop desativado.");
  });

  el.btnBypass.addEventListener("click", () => {
    const next = !engine.bypass;
    engine.setBypass(next);
    el.btnBypass.setAttribute("aria-pressed", String(next));
    syncUiFromParams();
    showToast(next ? "Ouvindo áudio original (sem efeitos)." : "Efeitos reativados.");
  });

  el.btnReset.addEventListener("click", () => {
    engine.setBypass(false);
    el.btnBypass.setAttribute("aria-pressed", "false");
    engine.updateParams({ ...DEFAULT_PARAMS });
    setActivePresetButton("clean");
    syncUiFromParams();
    showToast("Todos os efeitos foram resetados.");
  });

  el.btnExport.addEventListener("click", handleExportAudio);
  el.ctrlExportFormat?.addEventListener("change", syncExportButtonLabel);

  // Seek interativo na Waveform
  el.waveformStage.addEventListener("pointerdown", (event) => {
    if (!engine.buffer) return;
    isSeeking = true;
    el.waveformStage.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  });

  el.waveformStage.addEventListener("pointermove", (event) => {
    if (!isSeeking) return;
    seekFromPointer(event);
  });

  el.waveformStage.addEventListener("pointerup", (event) => {
    if (!isSeeking) return;
    isSeeking = false;
    el.waveformStage.releasePointerCapture(event.pointerId);
  });

  // Presets rápidos
  el.presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.preset;
      const preset = PRESETS[key];
      if (!preset) return;

      engine.setBypass(false);
      el.btnBypass.setAttribute("aria-pressed", "false");
      engine.updateParams(preset.params);
      setActivePresetButton(key);
      syncUiFromParams();
      showToast(`Preset aplicado: ${preset.label}`);
    });
  });

  // Controles deslizantes e seletores DSP
  const bindRange = (inputEl, paramKey, parser = Number) => {
    inputEl.addEventListener("input", () => {
      engine.updateParams({ [paramKey]: parser(inputEl.value) });
      setActivePresetButton(null);
      syncUiFromParams();
    });
  };

  bindRange(el.ctrlGain, "gainDb", Number);
  bindRange(el.ctrlDrive, "drive", Number);
  bindRange(el.ctrlBass, "bassDb", Number);
  bindRange(el.ctrlMid, "midDb", Number);
  bindRange(el.ctrlTreble, "trebleDb", Number);
  bindRange(el.ctrlLowpass, "lowpassHz", Number);
  bindRange(el.ctrlReverbMix, "reverbMix", Number);
  bindRange(el.ctrlReverbDecay, "reverbDecay", Number);
  bindRange(el.ctrlDelayMix, "delayMix", Number);
  bindRange(el.ctrlSpeed, "speed", Number);

  el.ctrlClipMode.addEventListener("change", () => {
    engine.updateParams({ clipMode: el.ctrlClipMode.value });
    setActivePresetButton(null);
    syncUiFromParams();
  });

  el.ctrlMaster.addEventListener("input", () => {
    engine.updateParams({ masterVolume: Number(el.ctrlMaster.value) / 100 });
    syncUiFromParams();
  });

  // Atalhos de teclado (fora de campos de entrada)
  window.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (!engine.buffer) return;

    if (event.code === "Space") {
      event.preventDefault();
      el.btnPlay.click();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      el.btnStop.click();
    } else if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      el.btnBypass.click();
    } else if (event.key.toLowerCase() === "l") {
      event.preventDefault();
      el.btnLoop.click();
    }
  });
}

// Inicialização da aplicação
syncUiFromParams();
setTransportEnabled(false);
bindEvents();
if (!rafId) {
  rafId = window.requestAnimationFrame(renderLoop);
}
