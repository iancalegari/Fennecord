/**
 * Motor DSP baseado em Web Audio API.
 * Suporta reprodução em tempo real, ganho extremo até +200 dB com saturação,
 * equalizador 3 bandas, low-pass, reverb convolucional, eco/delay, velocidade
 * e renderização offline fiel para exportação WAV.
 */

export const DEFAULT_PARAMS = {
  gainDb: 0, // -24 a +200 dB
  clipMode: "hard", // 'hard' | 'fuzz' | 'soft'
  drive: 0, // 0 a 100%
  bassDb: 0, // -12 a +36 dB
  midDb: 0, // -12 a +24 dB
  trebleDb: 0, // -12 a +24 dB
  lowpassHz: 20000, // 400 a 20000 Hz
  reverbMix: 0, // 0 a 100%
  reverbDecay: 2.2, // 0.5 a 6.0 s
  delayMix: 0, // 0 a 80%
  speed: 1.0, // 0.5 a 2.0x
  masterVolume: 0.5, // 0 a 1.0 (proteção auditiva padrão 50%)
};

/**
 * Converte decibéis para ganho linear com limite seguro para float32.
 * @param {number} db
 * @returns {number}
 */
function dbToGain(db) {
  const clamped = Math.max(-60, Math.min(200, db));
  return Math.pow(10, clamped / 20);
}

/**
 * Gera a curva de saturação (WaveShaper) para o modo selecionado.
 * @param {'hard' | 'fuzz' | 'soft'} mode
 * @param {number} drivePercent 0..100
 * @returns {Float32Array}
 */
function createSaturationCurve(mode, drivePercent) {
  const samples = 4096;
  const curve = new Float32Array(samples);
  const driveFactor = 1 + (drivePercent / 100) * 45;

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1; // [-1, 1]
    const driven = x * driveFactor;

    if (mode === "fuzz") {
      // Saturação digital agressiva tendendo à onda quadrada
      const sign = driven >= 0 ? 1 : -1;
      const mag = Math.abs(driven);
      curve[i] = sign * Math.min(1, Math.pow(mag, 0.35));
    } else if (mode === "soft") {
      // Saturação suave estilo analógico (tanh)
      curve[i] = Math.tanh(driven * 1.4);
    } else {
      // Hard clip clássico (áudio estourado)
      curve[i] = Math.max(-1, Math.min(1, driven));
    }
  }

  return curve;
}

/**
 * Gera uma resposta ao impulso (Impulse Response) estéreo sintética para o Reverb.
 * @param {BaseAudioContext} context
 * @param {number} decaySeconds
 * @returns {AudioBuffer}
 */
function createImpulseResponse(context, decaySeconds) {
  const sampleRate = context.sampleRate;
  const duration = Math.max(0.5, Math.min(6.0, decaySeconds));
  const length = Math.floor(sampleRate * duration);
  const impulse = context.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch += 1) {
    const channelData = impulse.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      // Decaimento exponencial com ruído branco estéreo descorrelacionado
      const progress = i / length;
      const envelope = Math.pow(1 - progress, 2.6);
      channelData[i] = (Math.random() * 2 - 1) * envelope;
    }
  }

  return impulse;
}

/**
 * Monta a cadeia de nós DSP em qualquer BaseAudioContext (tempo real ou offline).
 * @param {BaseAudioContext} context
 * @param {typeof DEFAULT_PARAMS} params
 * @param {boolean} bypass
 */
function createDspGraph(context, params, bypass) {
  const input = context.createGain();

  // Equalizador 3 bandas
  const bass = context.createBiquadFilter();
  bass.type = "lowshelf";
  bass.frequency.value = 90;
  bass.gain.value = bypass ? 0 : params.bassDb;

  const mid = context.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1000;
  mid.Q.value = 1.0;
  mid.gain.value = bypass ? 0 : params.midDb;

  const treble = context.createBiquadFilter();
  treble.type = "highshelf";
  treble.frequency.value = 6000;
  treble.gain.value = bypass ? 0 : params.trebleDb;

  // Filtro Low-Pass (efeito abafado)
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = bypass ? 20000 : params.lowpassHz;
  lowpass.Q.value = 0.7;

  // Estágio de ganho extremo (-24 a +200 dB) + Clipper
  const preGain = context.createGain();
  preGain.gain.value = bypass ? 1 : dbToGain(params.gainDb);

  const shaper = context.createWaveShaper();
  shaper.oversample = "2x";
  shaper.curve = bypass
    ? createSaturationCurve("hard", 0)
    : createSaturationCurve(params.clipMode, params.drive);

  // Ramo Dry / Wet do Reverb
  const dryGain = context.createGain();
  const reverbWetGain = context.createGain();
  const convolver = context.createConvolver();
  convolver.buffer = createImpulseResponse(context, params.reverbDecay);

  const reverbRatio = bypass ? 0 : params.reverbMix / 100;
  dryGain.gain.value = 1 - reverbRatio * 0.45;
  reverbWetGain.gain.value = reverbRatio;

  // Ramo de Eco / Delay
  const delayNode = context.createDelay(1.0);
  delayNode.delayTime.value = 0.28;
  const delayFeedback = context.createGain();
  delayFeedback.gain.value = 0.38;
  const delayWetGain = context.createGain();
  delayWetGain.gain.value = bypass ? 0 : params.delayMix / 100;

  // Soma final + Limitador suave + Volume Master
  const postMix = context.createGain();
  const masterGain = context.createGain();
  masterGain.gain.value = params.masterVolume;

  // Conexões da cadeia principal
  input.connect(bass);
  bass.connect(mid);
  mid.connect(treble);
  treble.connect(lowpass);
  lowpass.connect(preGain);
  preGain.connect(shaper);

  // Dry
  shaper.connect(dryGain);
  dryGain.connect(postMix);

  // Reverb
  shaper.connect(convolver);
  convolver.connect(reverbWetGain);
  reverbWetGain.connect(postMix);

  // Delay com feedback
  shaper.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayWetGain);
  delayWetGain.connect(postMix);

  postMix.connect(masterGain);

  return {
    input,
    output: masterGain,
    nodes: {
      bass,
      mid,
      treble,
      lowpass,
      preGain,
      shaper,
      dryGain,
      reverbWetGain,
      convolver,
      delayWetGain,
      masterGain,
    },
  };
}

export class AudioStudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.graph = null;
    this.analyser = null;

    this.params = { ...DEFAULT_PARAMS };
    this.bypass = false;
    this.loop = false;
    this.isPlaying = false;

    this.startedAt = 0;
    this.pausedOffset = 0;
    this.lastDecayApplied = DEFAULT_PARAMS.reverbDecay;
    this.onEnded = null;
  }

  /**
   * Inicializa o AudioContext sob demanda após interação do usuário.
   */
  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.78;

      this.graph = createDspGraph(this.ctx, this.params, this.bypass);
      this.graph.output.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  /**
   * Decodifica um ArrayBuffer de arquivo de áudio para AudioBuffer.
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<AudioBuffer>}
   */
  async loadFromArrayBuffer(arrayBuffer) {
    this.stop();
    this.ensureContext();
    const decoded = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    this.buffer = decoded;
    this.pausedOffset = 0;
    return decoded;
  }

  /**
   * Gera um áudio de demonstração real (batida eletrônica + baixo 808) em memória.
   * @returns {AudioBuffer}
   */
  loadDemoTrack() {
    this.stop();
    this.ensureContext();

    const sampleRate = this.ctx.sampleRate;
    const duration = 8.0; // 8 segundos (4 compassos a 120 BPM)
    const length = Math.floor(sampleRate * duration);
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const beatLen = 0.5; // 120 BPM
    const bassNotes = [55.0, 55.0, 65.41, 49.0]; // A1, A1, C2, G1

    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate;
      const beatIndex = Math.floor(t / beatLen);
      const beatPos = t % beatLen;
      const barIndex = Math.floor(beatIndex / 4) % bassNotes.length;

      // Bumbo 808 com pitch envelope
      let kick = 0;
      if (beatPos < 0.32) {
        const freq = 130 * Math.exp(-beatPos * 18) + 46;
        const env = Math.exp(-beatPos * 7.5);
        kick = Math.sin(2 * Math.PI * freq * beatPos) * env * 0.65;
      }

      // Caixa nos tempos 2 e 4
      let snare = 0;
      if ((beatIndex % 2 === 1) && beatPos < 0.18) {
        const env = Math.exp(-beatPos * 20);
        const noise = Math.sin(i * 12.9898) * 43758.5453;
        const pseudoRand = (noise - Math.floor(noise)) * 2 - 1;
        snare = (pseudoRand * 0.6 + Math.sin(2 * Math.PI * 185 * beatPos) * 0.4) * env * 0.35;
      }

      // Linha de baixo sintetizada
      const bassFreq = bassNotes[barIndex];
      const sub = Math.sin(2 * Math.PI * bassFreq * t) * 0.28;
      const saw = (((t * bassFreq * 2) % 1) * 2 - 1) * 0.1 * Math.exp(-beatPos * 3);

      // Arpejo melódico sutil em estéreo
      const step = Math.floor(t / 0.25) % 4;
      const arpFreqs = [220, 261.63, 329.63, 392.0];
      const stepPos = t % 0.25;
      const arpEnv = Math.exp(-stepPos * 9);
      const arpL = Math.sin(2 * Math.PI * arpFreqs[step] * t) * arpEnv * 0.14;
      const arpR = Math.sin(2 * Math.PI * arpFreqs[(step + 1) % 4] * t) * arpEnv * 0.14;

      left[i] = Math.max(-0.95, Math.min(0.95, kick + snare + sub + saw + arpL));
      right[i] = Math.max(-0.95, Math.min(0.95, kick + snare + sub + saw + arpR));
    }

    this.buffer = buffer;
    this.pausedOffset = 0;
    return buffer;
  }

  /**
   * Inicia ou retoma a reprodução a partir do ponto atual.
   */
  play() {
    if (!this.buffer) return;
    this.ensureContext();
    if (this.isPlaying) return;

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.loop;
    source.playbackRate.value = this.bypass ? 1.0 : this.params.speed;
    source.connect(this.graph.input);

    const offset = Math.max(0, Math.min(this.pausedOffset, this.buffer.duration - 0.01));
    this.startedAt = this.ctx.currentTime;
    this.isPlaying = true;
    this.source = source;

    source.onended = () => {
      if (this.source === source && this.isPlaying) {
        this.isPlaying = false;
        this.source = null;
        this.pausedOffset = 0;
        if (typeof this.onEnded === "function") {
          this.onEnded();
        }
      }
    };

    source.start(0, offset);
  }

  /**
   * Pausa a reprodução mantendo a posição atual.
   */
  pause() {
    if (!this.isPlaying || !this.source) return;
    this.pausedOffset = this.getCurrentTime();
    this.isPlaying = false;

    const oldSource = this.source;
    this.source = null;
    try {
      oldSource.stop();
      oldSource.disconnect();
    } catch {
      // Ignora erro caso o nó já tenha encerrado
    }
  }

  /**
   * Para a reprodução e retorna o cursor ao início.
   */
  stop() {
    if (this.source) {
      const oldSource = this.source;
      this.source = null;
      try {
        oldSource.stop();
        oldSource.disconnect();
      } catch {
        // Ignora erro caso já tenha parado
      }
    }
    this.isPlaying = false;
    this.pausedOffset = 0;
  }

  /**
   * Remove o áudio carregado da memória.
   */
  clear() {
    this.stop();
    this.buffer = null;
  }

  /**
   * Move a posição de reprodução para um instante específico (em segundos do buffer original).
   * @param {number} seconds
   */
  seek(seconds) {
    if (!this.buffer) return;
    const clamped = Math.max(0, Math.min(this.buffer.duration, seconds));
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pause();
    }
    this.pausedOffset = clamped;
    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Retorna o tempo atual da reprodução em segundos do buffer original.
   * @returns {number}
   */
  getCurrentTime() {
    if (!this.buffer) return 0;
    if (!this.isPlaying || !this.ctx) return this.pausedOffset;

    const rate = this.bypass ? 1.0 : this.params.speed;
    const elapsed = (this.ctx.currentTime - this.startedAt) * rate;
    const pos = this.pausedOffset + elapsed;

    if (this.loop) {
      return pos % this.buffer.duration;
    }
    return Math.min(this.buffer.duration, pos);
  }

  /**
   * Retorna a duração total do buffer em segundos.
   * @returns {number}
   */
  getDuration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  /**
   * Atualiza os parâmetros DSP em tempo real.
   * @param {Partial<typeof DEFAULT_PARAMS>} nextParams
   */
  updateParams(nextParams) {
    // Se a velocidade mudar durante a reprodução, recalcula o offset para manter o cursor preciso
    if (this.isPlaying && nextParams.speed !== undefined && nextParams.speed !== this.params.speed) {
      this.pausedOffset = this.getCurrentTime();
      this.startedAt = this.ctx.currentTime;
    }

    this.params = { ...this.params, ...nextParams };
    this.applyGraphParams();
  }

  /**
   * Alterna o modo Bypass (ouvir áudio original sem efeitos).
   * @param {boolean} enabled
   */
  setBypass(enabled) {
    if (this.isPlaying && this.ctx) {
      this.pausedOffset = this.getCurrentTime();
      this.startedAt = this.ctx.currentTime;
    }
    this.bypass = Boolean(enabled);
    this.applyGraphParams();
  }

  /**
   * Ativa ou desativa repetição em loop.
   * @param {boolean} enabled
   */
  setLoop(enabled) {
    this.loop = Boolean(enabled);
    if (this.source) {
      this.source.loop = this.loop;
    }
  }

  /**
   * Aplica todos os parâmetros atuais nos nós ativos do grafo DSP.
   */
  applyGraphParams() {
    if (!this.ctx || !this.graph) return;
    const now = this.ctx.currentTime;
    const { nodes } = this.graph;
    const p = this.params;
    const off = this.bypass;

    nodes.bass.gain.setTargetAtTime(off ? 0 : p.bassDb, now, 0.015);
    nodes.mid.gain.setTargetAtTime(off ? 0 : p.midDb, now, 0.015);
    nodes.treble.gain.setTargetAtTime(off ? 0 : p.trebleDb, now, 0.015);
    nodes.lowpass.frequency.setTargetAtTime(off ? 20000 : p.lowpassHz, now, 0.015);

    const targetGain = off ? 1 : dbToGain(p.gainDb);
    nodes.preGain.gain.setTargetAtTime(targetGain, now, 0.015);
    nodes.shaper.curve = off
      ? createSaturationCurve("hard", 0)
      : createSaturationCurve(p.clipMode, p.drive);

    const reverbRatio = off ? 0 : p.reverbMix / 100;
    nodes.dryGain.gain.setTargetAtTime(1 - reverbRatio * 0.45, now, 0.02);
    nodes.reverbWetGain.gain.setTargetAtTime(reverbRatio, now, 0.02);
    nodes.delayWetGain.gain.setTargetAtTime(off ? 0 : p.delayMix / 100, now, 0.02);
    nodes.masterGain.gain.setTargetAtTime(p.masterVolume, now, 0.015);

    if (Math.abs(p.reverbDecay - this.lastDecayApplied) >= 0.05) {
      nodes.convolver.buffer = createImpulseResponse(this.ctx, p.reverbDecay);
      this.lastDecayApplied = p.reverbDecay;
    }

    if (this.source) {
      this.source.playbackRate.setTargetAtTime(off ? 1.0 : p.speed, now, 0.015);
    }
  }

  /**
   * Renderiza o áudio inteiro offline com todos os efeitos ativos para download WAV.
   * @returns {Promise<AudioBuffer>}
   */
  async renderOffline() {
    if (!this.buffer) {
      throw new Error("Nenhum áudio carregado para exportar.");
    }

    const sampleRate = this.buffer.sampleRate;
    const rate = this.bypass ? 1.0 : this.params.speed;
    const baseDuration = this.buffer.duration / rate;
    // Proteção contra DoS de memória no navegador (limite de 15 minutos renderizados)
    const MAX_RENDER_SECONDS = 15 * 60;
    if (baseDuration > MAX_RENDER_SECONDS) {
      throw new Error("A duração final excede o limite seguro de 15 minutos para exportação no navegador.");
    }
    // Adiciona cauda extra para não cortar o final do reverb/delay
    const tailSeconds = !this.bypass && (this.params.reverbMix > 0 || this.params.delayMix > 0)
      ? Math.min(this.params.reverbDecay, 3.0)
      : 0.15;

    const totalFrames = Math.ceil((baseDuration + tailSeconds) * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = rate;

    // Na exportação, se o masterVolume estiver muito baixo, mantemos pelo menos o valor escolhido pelo usuário
    const exportParams = {
      ...this.params,
      masterVolume: Math.max(0.1, this.params.masterVolume),
    };

    const offlineGraph = createDspGraph(offlineCtx, exportParams, this.bypass);
    source.connect(offlineGraph.input);
    offlineGraph.output.connect(offlineCtx.destination);
    source.start(0);

    return offlineCtx.startRendering();
  }
}
