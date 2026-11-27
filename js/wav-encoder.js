/**
 * Codificadores de exportação 100% client-side (WAV PCM 16-bit e MP3 via @breezystack/lamejs).
 * Converte um AudioBuffer renderizado em Blob pronto para download.
 */

import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * Escreve uma string ASCII no DataView a partir de um deslocamento.
 * @param {DataView} view
 * @param {number} offset
 * @param {string} text
 */
function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Converte um canal Float32Array [-1, 1] para Int16Array com clamping seguro.
 * @param {Float32Array} floatData
 * @returns {Int16Array}
 */
function floatToInt16(floatData) {
  const result = new Int16Array(floatData.length);
  for (let i = 0; i < floatData.length; i += 1) {
    let sample = floatData[i];
    if (!Number.isFinite(sample)) sample = 0;
    sample = Math.max(-1, Math.min(1, sample));
    result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return result;
}

/**
 * Converte um AudioBuffer em Blob no formato WAV (PCM 16-bit).
 * @param {AudioBuffer} audioBuffer
 * @returns {Blob}
 */
export function encodeAudioBufferToWav(audioBuffer) {
  const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const dataByteLength = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  // Cabeçalho RIFF / WAVE
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(view, 8, "WAVE");

  // Subchunk fmt
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Tamanho do subchunk PCM
  view.setUint16(20, 1, true); // Formato 1 = PCM linear
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // Bits por amostra

  // Subchunk data
  writeString(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  // Obtém os dados dos canais
  const channels = [];
  for (let ch = 0; ch < numChannels; ch += 1) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  // Intercala e converte amostras float [-1, 1] para int16
  let offset = 44;
  for (let i = 0; i < numFrames; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      let sample = channels[ch][i];
      if (!Number.isFinite(sample)) sample = 0;
      sample = Math.max(-1, Math.min(1, sample));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Converte um AudioBuffer em Blob no formato MP3 (192 kbps por padrão).
 * @param {AudioBuffer} audioBuffer
 * @param {number} kbps
 * @returns {Blob}
 */
export function encodeAudioBufferToMp3(audioBuffer, kbps = 192) {
  const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;
  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps);

  const leftInt16 = floatToInt16(audioBuffer.getChannelData(0));
  const rightInt16 = numChannels > 1
    ? floatToInt16(audioBuffer.getChannelData(1))
    : leftInt16;

  const blockSize = 1152;
  const mp3Chunks = [];

  for (let i = 0; i < leftInt16.length; i += blockSize) {
    const leftSlice = leftInt16.subarray(i, i + blockSize);
    const mp3buf = numChannels > 1
      ? encoder.encodeBuffer(leftSlice, rightInt16.subarray(i, i + blockSize))
      : encoder.encodeBuffer(leftSlice);
    if (mp3buf.length > 0) {
      mp3Chunks.push(mp3buf);
    }
  }

  const endBuf = encoder.flush();
  if (endBuf.length > 0) {
    mp3Chunks.push(endBuf);
  }

  return new Blob(mp3Chunks, { type: "audio/mpeg" });
}

/**
 * Sanitiza o nome do arquivo original para gerar um nome seguro de download.
 * @param {string} originalName
 * @param {'wav' | 'mp3'} format
 * @returns {string}
 */
export function buildSafeOutputFilename(originalName, format = "wav") {
  const safeExt = format === "mp3" ? "mp3" : "wav";
  const base = (originalName || "audio-editado")
    .replace(/\.[^/.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return `${base || "audio"}-fennecord.${safeExt}`;
}
