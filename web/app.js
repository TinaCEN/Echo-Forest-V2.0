const canvas = document.querySelector("#forestCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
const waveCanvas = document.querySelector("#waveCanvas");
const waveCtx = waveCanvas.getContext("2d");

const recordButton = document.querySelector("#recordButton");
const plantButton = document.querySelector("#plantButton");
const clearButton = document.querySelector("#clearButton");
const saveButton = document.querySelector("#saveButton");
const styleSelect = document.querySelector("#styleSelect");
const backgroundPicker = document.querySelector("#backgroundPicker");
const sensitivitySlider = document.querySelector("#sensitivitySlider");
const statusText = document.querySelector("#statusText");
const volumeMeter = document.querySelector("#volumeMeter");
const energyMeter = document.querySelector("#energyMeter");
const pitchMeter = document.querySelector("#pitchMeter");

const palette = {
  bark: ["#5f3f2f", "#75523b", "#3d2c22", "#8a6245"],
  leaf: ["#2f7d57", "#5a9d55", "#91a844", "#d6a23c", "#c45d6a", "#6f8f55"],
  blossom: ["#f0a6b5", "#f6c5ca", "#d97887", "#fff0f2"],
  ink: ["#14231a", "#263527", "#4c5a4a"],
  neon: ["#00c2a8", "#4b7bec", "#ff5d8f", "#ffd166", "#7bd88f"]
};

const treeTypes = ["willow", "maple", "pine", "oak", "cherry"];
const state = {
  trees: [],
  audio: null,
  running: false,
  dragging: null,
  pointer: { x: 0, y: 0 },
  features: {
    volume: 0,
    energy: 0,
    pitch: 0,
    brightness: 0,
    flux: 0,
    waveform: new Float32Array(256)
  },
  backgroundColor: "#eaf3ed",
  lastPlant: 0,
  ground: 0,
  dpr: 1,
  width: 0,
  height: 0
};

class AudioEngine {
  constructor() {
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.timeData = null;
    this.freqData = null;
    this.previousFreq = null;
    this.mockPhase = 0;
    this.usingMock = false;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.usingMock = true;
      return;
    }

    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    this.source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    this.source.connect(this.analyser);
    this.timeData = new Float32Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.previousFreq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.usingMock = false;
  }

  read() {
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.timeData);
      this.analyser.getByteFrequencyData(this.freqData);
      return this.extractFeatures(this.timeData, this.freqData);
    }
    return this.mockFeatures();
  }

  extractFeatures(timeData, freqData) {
    let sum = 0;
    let peak = 0;
    for (const sample of timeData) {
      const abs = Math.abs(sample);
      sum += sample * sample;
      if (abs > peak) peak = abs;
    }

    const rms = Math.sqrt(sum / timeData.length);
    let weighted = 0;
    let total = 0;
    let high = 0;
    let flux = 0;
    for (let i = 0; i < freqData.length; i += 1) {
      const value = freqData[i] / 255;
      weighted += value * i;
      total += value;
      if (i > freqData.length * 0.38) high += value;
      flux += Math.max(0, value - this.previousFreq[i] / 255);
      this.previousFreq[i] = freqData[i];
    }

    const pitch = total > 0 ? weighted / total / freqData.length : 0;
    const brightness = total > 0 ? high / total : 0;
    const energy = clamp(rms * Number(sensitivitySlider.value) * 4.5, 0, 1);
    return {
      volume: clamp(peak * Number(sensitivitySlider.value), 0, 1),
      energy,
      pitch: clamp(pitch * 1.8, 0, 1),
      brightness: clamp(brightness * 2.3, 0, 1),
      flux: clamp(flux / freqData.length * 9, 0, 1),
      waveform: timeData
    };
  }

  mockFeatures() {
    this.mockPhase += 0.035;
    const waveform = new Float32Array(256);
    const base = 0.35 + Math.sin(this.mockPhase * 1.4) * 0.18;
    for (let i = 0; i < waveform.length; i += 1) {
      waveform[i] =
        Math.sin(i * 0.14 + this.mockPhase * 12) * base * 0.45 +
        Math.sin(i * 0.043 + this.mockPhase * 5) * 0.12;
    }
    return {
      volume: clamp(base + Math.sin(this.mockPhase * 3) * 0.2, 0, 1),
      energy: clamp(base + Math.sin(this.mockPhase * 2.1) * 0.22, 0, 1),
      pitch: clamp(0.48 + Math.sin(this.mockPhase * 0.9) * 0.34, 0, 1),
      brightness: clamp(0.45 + Math.cos(this.mockPhase * 1.2) * 0.25, 0, 1),
      flux: clamp(0.35 + Math.sin(this.mockPhase * 4.5) * 0.24, 0, 1),
      waveform
    };
  }
}

class Tree {
  constructor(x, y, features, index) {
    this.id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    this.x = x;
    this.y = y;
    this.seed = Math.random() * 10000;
    this.type = treeTypes[index % treeTypes.length];
    this.birth = performance.now();
    this.growth = 0;
    this.ageOffset = Math.random() * 10;
    this.height = lerp(110, Math.min(330, state.height * 0.5), features.energy);
    this.width = lerp(6, 20, features.volume);
    this.branchCount = Math.round(lerp(5, 16, features.energy));
    this.leafDensity = lerp(0.45, 1.75, Math.max(features.brightness, features.flux));
    this.spread = lerp(42, 150, features.pitch);
    this.hueShift = features.pitch;
    this.dragDx = 0;
    this.dragDy = 0;
    this.crown = [];
    this.branches = [];
    this.makeStructure();
  }

  makeStructure() {
    const rand = seeded(this.seed);
    this.branches = [];
    const branchTotal = this.type === "pine" ? 18 : this.branchCount;
    for (let i = 0; i < branchTotal; i += 1) {
      const t = branchTotal === 1 ? 0 : i / (branchTotal - 1);
      const side = i % 2 === 0 ? -1 : 1;
      let angle = -Math.PI / 2 + side * lerp(0.25, 1.1, rand()) + (rand() - 0.5) * 0.35;
      let level = lerp(0.22, 0.9, t);
      let length = this.spread * lerp(0.46, 1.05, rand()) * (1 - t * 0.25);

      if (this.type === "willow") {
        angle = -Math.PI / 2 + side * lerp(0.18, 0.62, rand());
        length = this.spread * lerp(0.55, 1.15, rand());
        level = lerp(0.32, 0.96, t);
      }

      if (this.type === "pine") {
        angle = side * lerp(0.05, 0.82, rand()) + Math.PI;
        length = this.spread * (1 - t * 0.78) * lerp(0.65, 1.15, rand());
        level = lerp(0.16, 0.96, t);
      }

      this.branches.push({ level, angle, length, phase: rand() * Math.PI * 2, side });
    }

    this.crown = [];
    const leaves = Math.round(this.branchCount * this.leafDensity * 8);
    for (let i = 0; i < leaves; i += 1) {
      this.crown.push({
        branch: Math.floor(rand() * this.branches.length),
        offset: rand(),
        r: lerp(2.4, 7.5, rand()),
        spin: rand() * Math.PI * 2,
        tone: rand()
      });
    }
  }

  contains(x, y) {
    return x > this.x - this.spread * 1.1 &&
      x < this.x + this.spread * 1.1 &&
      y > this.y - this.height * 1.15 &&
      y < this.y + 32;
  }

  draw(now, features) {
    const life = (now - this.birth) / 2600;
    this.growth = Math.min(1, easeOutCubic(life));
    const wind = Math.sin(now * 0.0014 + this.ageOffset) * (3 + features.energy * 16);
    const pulse = 1 + features.energy * 0.06;
    const style = styleSelect.value;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(pulse, pulse);

    const trunkHeight = this.height * Math.min(1, this.growth / 0.42);
    const topX = wind * 0.22;
    const topY = -trunkHeight;
    drawTaperedLine(0, 0, topX, topY, this.width * 1.35, this.width * 0.45, randomFrom(palette.bark, this.seed), style);

    if (this.growth > 0.18) {
      this.drawBranches(now, features, wind, style);
    }

    if (this.growth > 0.5) {
      this.drawLeaves(now, features, wind, style);
    }

    ctx.restore();
  }

  drawBranches(now, features, wind, style) {
    const branchGrowth = clamp((this.growth - 0.18) / 0.82, 0, 1);
    for (const branch of this.branches) {
      if (branchGrowth < branch.level * 0.74) continue;
      const localGrowth = clamp((branchGrowth - branch.level * 0.42) / 0.58, 0, 1);
      const startY = -this.height * branch.level * this.growth;
      const startX = wind * branch.level * 0.34;
      const sway = Math.sin(now * 0.0019 + branch.phase) * (2 + features.volume * 9) * branch.level;
      const length = branch.length * easeOutCubic(localGrowth);
      let endX = startX + Math.cos(branch.angle) * length + sway;
      let endY = startY + Math.sin(branch.angle) * length * 0.62;

      if (this.type === "willow") {
        endY = startY + Math.abs(Math.sin(branch.angle)) * length * 0.9 + localGrowth * 18;
      }

      if (this.type === "pine") {
        endY = startY + Math.abs(Math.sin(branch.angle)) * length * 0.18;
      }

      const color = this.type === "pine" ? "#2e6142" : randomFrom(palette.bark, this.seed + branch.level * 31);
      drawStyledLine(startX, startY, endX, endY, Math.max(1, this.width * (0.34 + (1 - branch.level) * 0.24)), color, style);

      if (this.type !== "pine" && localGrowth > 0.64 && branch.length > 58) {
        const splitA = branch.angle + branch.side * 0.42;
        const splitB = branch.angle - branch.side * 0.28;
        drawStyledLine(endX, endY, endX + Math.cos(splitA) * length * 0.28, endY + Math.sin(splitA) * length * 0.22, Math.max(1, this.width * 0.18), color, style);
        drawStyledLine(endX, endY, endX + Math.cos(splitB) * length * 0.22, endY + Math.sin(splitB) * length * 0.18, Math.max(1, this.width * 0.16), color, style);
      }
    }
  }

  drawLeaves(now, features, wind, style) {
    const leafGrowth = easeOutCubic(clamp((this.growth - 0.5) / 0.5, 0, 1));
    const maxLeaves = Math.floor(this.crown.length * leafGrowth);

    for (let i = 0; i < maxLeaves; i += 1) {
      const leaf = this.crown[i];
      const branch = this.branches[leaf.branch] || this.branches[0];
      const sway = Math.sin(now * 0.0024 + leaf.spin) * (2 + features.energy * 8);
      const baseY = -this.height * branch.level * this.growth;
      let x = Math.cos(branch.angle) * branch.length * leaf.offset + sway + wind * branch.level * 0.25;
      let y = baseY + Math.sin(branch.angle) * branch.length * leaf.offset * 0.6;

      if (this.type === "willow") {
        y += branch.length * leaf.offset * 0.55;
        x *= 0.62;
      }

      if (this.type === "pine") {
        y = baseY + Math.abs(Math.sin(branch.angle)) * branch.length * leaf.offset * 0.12;
      }

      const jitter = seeded(this.seed + i * 17);
      x += (jitter() - 0.5) * this.spread * 0.34;
      y += (jitter() - 0.5) * 20;

      let colorSet = palette.leaf;
      if (this.type === "cherry") colorSet = palette.blossom;
      if (this.type === "pine") colorSet = ["#1f5a3f", "#2f7d57", "#173d2c"];
      if (style === "neon") colorSet = palette.neon;
      if (style === "ink") colorSet = palette.ink;

      const color = colorSet[Math.floor(leaf.tone * colorSet.length) % colorSet.length];
      const size = leaf.r * (0.8 + features.volume * 0.5);
      drawLeaf(x, y, size, leaf.spin + now * 0.001, color, style, this.type);
    }
  }
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const rect = canvas.getBoundingClientRect();
  state.width = Math.max(1, rect.width);
  state.height = Math.max(1, rect.height);
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  state.ground = state.height * 0.82;

  const waveRect = waveCanvas.getBoundingClientRect();
  waveCanvas.width = Math.round(waveRect.width * state.dpr);
  waveCanvas.height = Math.round(waveRect.height * state.dpr);
  waveCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  state.trees.forEach((tree) => {
    tree.y = Math.min(tree.y, state.ground + 20);
  });
}

function drawBackground(now) {
  const background = hexToRgb(state.backgroundColor) || { r: 234, g: 243, b: 237 };
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, mixRgb(background, { r: 255, g: 253, b: 247 }, 0.64));
  gradient.addColorStop(0.58, rgbToCss(background));
  gradient.addColorStop(1, mixRgb(background, { r: 47, g: 125, b: 87 }, 0.2));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.strokeStyle = "rgba(47, 125, 87, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i += 1) {
    const y = state.ground + i * 9 + Math.sin(now * 0.001 + i) * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(state.width * 0.25, y - 9, state.width * 0.75, y + 9, state.width, y - 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaveform() {
  const width = waveCanvas.clientWidth;
  const height = waveCanvas.clientHeight;
  const data = state.features.waveform;
  waveCtx.clearRect(0, 0, width, height);
  waveCtx.fillStyle = "#17211b";
  waveCtx.fillRect(0, 0, width, height);
  waveCtx.strokeStyle = state.running ? "#7bd88f" : "#d6a23c";
  waveCtx.lineWidth = 2;
  waveCtx.beginPath();
  for (let i = 0; i < data.length; i += 1) {
    const x = i / (data.length - 1) * width;
    const y = height * 0.5 + data[i] * height * 0.38;
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
  }
  waveCtx.stroke();
}

function tick(now) {
  if (state.running && state.audio) {
    state.features = state.audio.read();
    const shouldPlant = state.features.energy > 0.55 && now - state.lastPlant > lerp(2600, 900, state.features.flux);
    if (shouldPlant && state.trees.length < 18) {
      plantFromAudio();
      state.lastPlant = now;
    }
  } else {
    state.features.volume *= 0.94;
    state.features.energy *= 0.93;
    state.features.pitch *= 0.98;
  }

  volumeMeter.value = state.features.volume;
  energyMeter.value = state.features.energy;
  pitchMeter.value = state.features.pitch;

  drawBackground(now);
  state.trees.sort((a, b) => a.y - b.y).forEach((tree) => tree.draw(now, state.features));
  drawWaveform();
  requestAnimationFrame(tick);
}

async function toggleRecording() {
  if (state.running) {
    state.running = false;
    state.audio?.stop();
    state.audio = null;
    recordButton.setAttribute("aria-pressed", "false");
    statusText.textContent = "录音已停止";
    return;
  }

  try {
    state.audio = new AudioEngine();
    await state.audio.start();
    state.running = true;
    recordButton.setAttribute("aria-pressed", "true");
    statusText.textContent = state.audio.usingMock ? "模拟声音模式" : "实时收音中";
  } catch (error) {
    state.audio = new AudioEngine();
    state.audio.usingMock = true;
    state.running = true;
    recordButton.setAttribute("aria-pressed", "true");
    statusText.textContent = "麦克风不可用，已切换模拟声音";
  }
}

function plantFromAudio(x = null, y = null) {
  const margin = Math.min(90, state.width * 0.12);
  const px = x ?? lerp(margin, state.width - margin, Math.random());
  const py = y ?? (state.ground + Math.random() * 20 - 8);
  const tree = new Tree(px, py, state.features, state.trees.length);
  state.trees.push(tree);
  if (state.trees.length > 24) state.trees.shift();
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const pointer = event.touches?.[0] || event.changedTouches?.[0] || event;
  return {
    x: pointer.clientX - rect.left,
    y: pointer.clientY - rect.top
  };
}

function onPointerDown(event) {
  event.preventDefault();
  const point = pointerPosition(event);
  state.pointer = point;
  const tree = [...state.trees].reverse().find((candidate) => candidate.contains(point.x, point.y));
  if (tree) {
    state.dragging = tree;
    tree.dragDx = point.x - tree.x;
    tree.dragDy = point.y - tree.y;
    canvas.classList.add("dragging");
  } else {
    plantFromAudio(point.x, Math.min(point.y, state.ground + 28));
  }
}

function onPointerMove(event) {
  if (!state.dragging) return;
  event.preventDefault();
  const point = pointerPosition(event);
  state.dragging.x = clamp(point.x - state.dragging.dragDx, 28, state.width - 28);
  state.dragging.y = clamp(point.y - state.dragging.dragDy, state.height * 0.35, state.ground + 36);
}

function onPointerUp() {
  state.dragging = null;
  canvas.classList.remove("dragging");
}

function saveImage() {
  const link = document.createElement("a");
  link.download = `echo-forest-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function drawStyledLine(x1, y1, x2, y2, width, color, style) {
  if (style === "dots") {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.floor(distance / 7));
    ctx.fillStyle = color;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = lerp(x1, x2, t);
      const y = lerp(y1, y2, t);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, width * (0.45 + t * 0.2)), 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  if (style === "mosaic") {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.floor(distance / 10));
    ctx.fillStyle = color;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const size = Math.max(3, width * 1.2);
      ctx.fillRect(lerp(x1, x2, t) - size / 2, lerp(y1, y2, t) - size / 2, size, size);
    }
    return;
  }

  drawTaperedLine(x1, y1, x2, y2, width, width * 0.45, color, style);
}

function drawTaperedLine(x1, y1, x2, y2, widthA, widthB, color, style) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const nx = Math.sin(angle);
  const ny = -Math.cos(angle);
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = style === "ink" ? 0.82 : 1;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * widthA * 0.5, y1 + ny * widthA * 0.5);
  ctx.lineTo(x2 + nx * widthB * 0.5, y2 + ny * widthB * 0.5);
  ctx.lineTo(x2 - nx * widthB * 0.5, y2 - ny * widthB * 0.5);
  ctx.lineTo(x1 - nx * widthA * 0.5, y1 - ny * widthA * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLeaf(x, y, size, angle, color, style, type) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.globalAlpha = style === "ink" ? 0.76 : 0.95;

  if (style === "dots") {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.75, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === "mosaic") {
    ctx.fillRect(-size * 0.65, -size * 0.65, size * 1.3, size * 1.3);
  } else if (type === "cherry") {
    for (let i = 0; i < 5; i += 1) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.55, size * 0.45, size * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === "pine") {
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.2);
    ctx.lineTo(size * 0.34, size * 1.1);
    ctx.lineTo(-size * 0.34, size * 1.1);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.55, size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 253, 247, 0.38)";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.78);
    ctx.lineTo(0, size * 0.8);
    ctx.stroke();
  }

  ctx.restore();
}

function seeded(seed) {
  let value = Math.sin(seed) * 10000;
  return () => {
    value = Math.sin(value) * 10000;
    return value - Math.floor(value);
  };
}

function randomFrom(items, seed) {
  return items[Math.floor(Math.abs(Math.sin(seed)) * items.length) % items.length];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

function hexToRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16)
  };
}

function rgbToCss({ r, g, b }) {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

function mixRgb(a, b, amount) {
  return rgbToCss({
    r: lerp(a.r, b.r, amount),
    g: lerp(a.g, b.g, amount),
    b: lerp(a.b, b.b, amount)
  });
}

recordButton.addEventListener("click", toggleRecording);
plantButton.addEventListener("click", () => plantFromAudio());
clearButton.addEventListener("click", () => {
  state.trees = [];
});
saveButton.addEventListener("click", saveImage);
backgroundPicker.addEventListener("input", (event) => {
  state.backgroundColor = event.target.value;
});

if (window.PointerEvent) {
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
} else {
  canvas.addEventListener("touchstart", onPointerDown, { passive: false });
  canvas.addEventListener("touchmove", onPointerMove, { passive: false });
  canvas.addEventListener("touchend", onPointerUp);
}

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 250));

resize();
plantFromAudio(state.width * 0.36, state.ground + 6);
plantFromAudio(state.width * 0.58, state.ground + 2);
requestAnimationFrame(tick);
