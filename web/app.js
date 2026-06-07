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
const meterPanel = document.querySelector("#meterPanel");
const meterPanelBody = document.querySelector("#meterPanelBody");
const panelToggleButton = document.querySelector("#panelToggleButton");
const panelToggleIcon = document.querySelector("#panelToggleIcon");
const volumeMeter = document.querySelector("#volumeMeter");
const energyMeter = document.querySelector("#energyMeter");
const pitchMeter = document.querySelector("#pitchMeter");

const palette = {
  bark: ["#5f3f2f", "#75523b", "#3d2c22", "#8a6245"],
  leaf: ["#2f7d57", "#5a9d55", "#91a844", "#d6a23c", "#c45d6a", "#6f8f55"],
  blossom: ["#f0a6b5", "#f6c5ca", "#d97887", "#fff0f2"],
  ink: ["#14231a", "#263527", "#4c5a4a"],
  neon: ["#00c2a8", "#4b7bec", "#ff5d8f", "#ffd166", "#7bd88f"],
  mosaic: {
    trunk: ["#ef3f35", "#ffb000", "#1e9bf0", "#34b95a", "#f7d13d", "#8d55ff", "#ff64c7"],
    leaf: ["#1db954", "#58c95e", "#0d8b36", "#f9d423", "#ef3f35", "#1e9bf0"],
    willow: ["#0f8f3c", "#26b24d", "#50d06d", "#f7d13d", "#1e9bf0"],
    plane: ["#26b24d", "#7bd75d", "#f7d13d", "#ef3f35", "#1e9bf0", "#ffb000"],
    maple: ["#ef3f35", "#ff7518", "#f7d13d", "#1e9bf0", "#34b95a"],
    pine: ["#0b6f2a", "#16963c", "#2fc85b", "#0e5225", "#f7d13d"],
    peach: ["#ff63b5", "#ff9bd0", "#f03f7c", "#ffd95a", "#34b95a", "#1e9bf0"],
    oak: ["#1fa447", "#48c15d", "#f7d13d", "#ef3f35", "#1e9bf0"],
    cherry: ["#ff64c7", "#ff9bd8", "#ef3f35", "#f7d13d", "#1e9bf0"],
    ginkgo: ["#f7d13d", "#ffb000", "#ffd95a", "#58c95e", "#1e9bf0"],
    cypress: ["#0b6f2a", "#14973d", "#31c95c", "#79d96a", "#f7d13d"]
  }
};

const treeTypes = ["willow", "pine", "peach", "plane", "maple", "oak", "ginkgo", "cypress", "cherry"];
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
  backgroundColor: "#eeeeea",
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
    const shapeRand = seeded(this.seed + index * 97);
    const energy = Math.max(features.energy, 0.36);
    const volume = Math.max(features.volume, 0.32);
    const pitch = Math.max(features.pitch, 0.42);
    const colorActivity = Math.max(features.brightness, features.flux, 0.46);
    const thinTree = shapeRand() < 0.34 || this.type === "willow" || this.type === "cypress" || this.type === "peach";
    const heightScale = lerp(0.76, 1.18, shapeRand()) * (this.type === "pine" || this.type === "cypress" ? 1.12 : 1);
    const widthScale = thinTree ? lerp(0.52, 0.82, shapeRand()) : lerp(0.92, 1.38, shapeRand());
    const branchScale = thinTree ? lerp(0.58, 0.86, shapeRand()) : lerp(0.86, 1.18, shapeRand());
    this.height = lerp(145, Math.min(380, state.height * 0.58), energy) * heightScale;
    this.width = lerp(8, 22, volume) * widthScale;
    this.branchCount = Math.round(lerp(8, 20, energy) * (thinTree ? 1.12 : 0.98));
    this.leafDensity = lerp(0.9, 2.2, colorActivity);
    this.spread = lerp(68, 180, pitch) * lerp(0.78, 1.18, shapeRand());
    this.branchSlimness = branchScale;
    this.mosaicUnit = Math.round(lerp(10, 17, Math.max(volume, energy)) * lerp(0.82, 1.12, shapeRand()));
    this.mosaicShift = Math.floor(features.pitch * palette.mosaic.trunk.length);
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
    const branchTotal = this.type === "pine" || this.type === "cypress"
      ? 22
      : this.type === "plane"
        ? Math.round(this.branchCount * 1.35)
        : this.type === "peach" || this.type === "cherry"
          ? Math.round(this.branchCount * 1.2)
          : this.type === "willow"
            ? Math.round(this.branchCount * 1.45)
          : this.branchCount;
    for (let i = 0; i < branchTotal; i += 1) {
      const t = branchTotal === 1 ? 0 : i / (branchTotal - 1);
      const side = i % 2 === 0 ? -1 : 1;
      let angle = -Math.PI / 2 + side * lerp(0.25, 1.1, rand()) + (rand() - 0.5) * 0.35;
      let level = lerp(0.22, 0.9, t);
      let length = this.spread * lerp(0.46, 1.05, rand()) * (1 - t * 0.25);

      if (this.type === "willow") {
        angle = -Math.PI / 2 + side * lerp(0.1, 0.48, rand());
        length = this.spread * lerp(0.72, 1.42, rand()) * (1 - t * 0.12);
        level = lerp(0.24, 0.98, t);
      }

      if (this.type === "pine") {
        angle = side === -1 ? Math.PI + lerp(0.04, 0.28, rand()) : -lerp(0.04, 0.28, rand());
        length = this.spread * (1 - t * 0.72) * lerp(0.72, 1.24, rand());
        level = lerp(0.12, 0.98, t);
      }

      if (this.type === "peach") {
        angle = -Math.PI / 2 + side * lerp(0.36, 1.2, rand()) + (rand() - 0.5) * 0.28;
        length = this.spread * lerp(0.62, 1.24, rand()) * (1 - t * 0.08);
        level = lerp(0.24, 0.94, t);
      }

      if (this.type === "plane") {
        angle = -Math.PI / 2 + side * lerp(0.48, 1.32, rand());
        length = this.spread * lerp(0.85, 1.38, rand()) * (1 - t * 0.12);
        level = lerp(0.28, 0.95, t);
      }

      if (this.type === "ginkgo") {
        angle = -Math.PI / 2 + side * lerp(0.22, 1.08, rand());
        length = this.spread * lerp(0.55, 1.18, rand()) * (0.68 + t * 0.32);
        level = lerp(0.36, 0.96, t);
      }

      if (this.type === "cypress") {
        angle = -Math.PI / 2 + side * lerp(0.12, 0.34, rand());
        length = this.spread * lerp(0.25, 0.64, rand()) * (1 - t * 0.38);
        level = lerp(0.12, 0.98, t);
      }

      this.branches.push({ level, angle, length, phase: rand() * Math.PI * 2, side });
    }

    this.crown = [];
    const leafMultiplier = {
      willow: 15,
      plane: 14,
      pine: 10,
      peach: 14,
      cherry: 12,
      ginkgo: 13,
      cypress: 11
    }[this.type] || 9;
    const leaves = Math.round(Math.min(260, this.branchCount * this.leafDensity * leafMultiplier));
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

    if (style === "mosaic") {
      this.drawMosaicTree(now, features, wind, trunkHeight);
      ctx.restore();
      return;
    }

    drawTaperedLine(0, 0, topX, topY, this.width * 1.35, this.width * 0.45, randomFrom(palette.bark, this.seed), style);

    if (this.growth > 0.18) {
      this.drawBranches(now, features, wind, style);
    }

    if (this.growth > 0.5) {
      this.drawLeaves(now, features, wind, style);
    }

    ctx.restore();
  }

  drawMosaicTree(now, features, wind, trunkHeight) {
    const unit = this.mosaicUnit * (0.9 + features.energy * 0.18);
    this.drawMosaicTrunk(trunkHeight, wind, unit);

    if (this.growth > 0.18) {
      this.drawMosaicBranches(now, features, wind, unit);
    }

    if (this.growth > 0.5) {
      this.drawMosaicLeaves(now, features, wind, unit);
    }

    if (this.growth > 0.68) {
      this.drawMosaicAccentTwigs(now, features, wind, unit);
    }
  }

  drawMosaicTrunk(trunkHeight, wind, unit) {
    const rows = Math.max(5, Math.floor(trunkHeight / (unit * 0.72)));
    const colorSet = palette.mosaic.trunk;
    for (let i = 0; i <= rows; i += 1) {
      const t = i / rows;
      const y = -trunkHeight * t;
      const centerX = wind * 0.18 * t + Math.sin(this.seed + t * 8) * unit * 0.08;
      const isBroad = this.type === "plane" || this.type === "oak";
      const columns = isBroad && t < 0.36 ? 2 : (this.width > 13 && t < 0.52 ? 2 : 1);
      const size = unit * lerp(1.12, 0.74, t);
      for (let col = 0; col < columns; col += 1) {
        const offset = (col - (columns - 1) / 2) * unit * 0.74;
        const color = colorSet[(i + col + this.mosaicShift) % colorSet.length];
        drawMosaicBlock(centerX + offset, y, size, color, this.seed + i * 19 + col);
      }
    }
  }

  drawMosaicBranches(now, features, wind, unit) {
    const branchGrowth = clamp((this.growth - 0.18) / 0.82, 0, 1);
    for (let i = 0; i < this.branches.length; i += 1) {
      const branch = this.branches[i];
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

      if (this.type === "pine" || this.type === "cypress") {
        endY = startY + Math.abs(Math.sin(branch.angle)) * length * 0.18;
      }

      if (this.type === "plane") {
        endY = startY + Math.sin(branch.angle) * length * 0.46;
      }

      if (this.type === "peach") {
        endY = startY + Math.sin(branch.angle) * length * 0.5 - unit * 0.2;
      }

      if (this.type === "ginkgo") {
        endY = startY + Math.sin(branch.angle) * length * 0.38 - unit * 0.4;
      }

      const branchPalette = this.type === "pine" || this.type === "cypress"
        ? palette.mosaic[this.type]
        : palette.mosaic.trunk;
      drawMosaicBlockLine(
        startX,
        startY,
        endX,
        endY,
        unit * lerp(0.36, 0.74, 1 - branch.level) * this.branchSlimness,
        branchPalette,
        this.seed + i * 41
      );

      if (this.type === "willow" && localGrowth > 0.42) {
        const strandCount = i % 3 === 0 ? 2 : 1;
        for (let strand = 0; strand < strandCount; strand += 1) {
          const strandOffset = (strand - (strandCount - 1) / 2) * unit * 0.9;
          const strandX = endX + strandOffset + Math.sin(now * 0.0017 + branch.phase + strand) * unit * 0.28;
          const strandY = endY + length * lerp(0.34, 0.62, (i % 5) / 4);
          drawMosaicBlockLine(endX + strandOffset * 0.35, endY, strandX, strandY, unit * 0.28, palette.mosaic.willow, this.seed + i * 83 + strand);
        }
      }

      if (this.type !== "pine" && this.type !== "cypress" && localGrowth > 0.62 && branch.length > 58) {
        const splitA = branch.angle + branch.side * 0.44;
        const splitB = branch.angle - branch.side * 0.3;
        const twigScale = this.type === "peach" ? 0.3 : 0.24;
        drawMosaicBlockLine(endX, endY, endX + Math.cos(splitA) * length * 0.3, endY + Math.sin(splitA) * length * twigScale, unit * 0.28 * this.branchSlimness, branchPalette, this.seed + i * 53);
        drawMosaicBlockLine(endX, endY, endX + Math.cos(splitB) * length * 0.24, endY + Math.sin(splitB) * length * 0.18, unit * 0.24 * this.branchSlimness, branchPalette, this.seed + i * 67);
      }

      if (this.type === "peach" && localGrowth > 0.5 && i % 2 === 0) {
        const blossomFork = branch.angle + branch.side * lerp(0.38, 0.72, (i % 5) / 4);
        drawMosaicBlockLine(endX, endY, endX + Math.cos(blossomFork) * length * 0.34, endY + Math.sin(blossomFork) * length * 0.22, unit * 0.22, palette.mosaic.peach, this.seed + i * 97);
      }

      if ((this.type === "pine" || this.type === "cypress") && i % 2 === 0 && localGrowth > 0.55) {
        const shelf = branch.side === -1 ? Math.PI : 0;
        const shelfLength = length * lerp(0.18, 0.34, 1 - branch.level);
        drawMosaicBlockLine(endX, endY, endX + Math.cos(shelf) * shelfLength, endY + unit * 0.24, unit * 0.22, branchPalette, this.seed + i * 109);
      }
    }
  }

  drawMosaicLeaves(now, features, wind, unit) {
    const leafGrowth = easeOutCubic(clamp((this.growth - 0.5) / 0.5, 0, 1));
    const maxLeaves = Math.floor(this.crown.length * leafGrowth);
    const colorSet = palette.mosaic[this.type] || palette.mosaic.leaf;

    for (let i = 0; i < maxLeaves; i += 1) {
      const leaf = this.crown[i];
      const branch = this.branches[leaf.branch] || this.branches[0];
      const sway = Math.sin(now * 0.0024 + leaf.spin) * (2 + features.energy * 8);
      const baseY = -this.height * branch.level * this.growth;
      let x = Math.cos(branch.angle) * branch.length * leaf.offset + sway + wind * branch.level * 0.25;
      let y = baseY + Math.sin(branch.angle) * branch.length * leaf.offset * 0.6;

      if (this.type === "willow") {
        y += branch.length * leaf.offset * 0.72;
        x *= 0.56;
      }

      if (this.type === "pine" || this.type === "cypress") {
        y = baseY + Math.abs(Math.sin(branch.angle)) * branch.length * leaf.offset * 0.12;
      }

      if (this.type === "peach") {
        x += (Math.sin(leaf.spin) * this.spread * 0.18) * leaf.offset;
        y -= this.height * 0.04 + Math.cos(leaf.spin) * unit * 0.8;
      }

      const jitter = seeded(this.seed + i * 17);
      x += (jitter() - 0.5) * this.spread * (this.type === "cypress" ? 0.16 : 0.38);
      y += (jitter() - 0.5) * (this.type === "plane" ? 44 : 22);

      if (this.type === "plane" || this.type === "oak") {
        x += (jitter() - 0.5) * this.spread * 0.38;
        y -= this.height * 0.06;
      }

      if (this.type === "ginkgo") {
        x += (jitter() - 0.5) * this.spread * 0.5;
        y -= this.height * 0.12 * leaf.offset;
      }

      if (this.type === "cypress") {
        x *= 0.44;
        y -= unit * 0.4;
      }

      const color = colorSet[(Math.floor(leaf.tone * colorSet.length) + i + this.mosaicShift) % colorSet.length];
      const size = unit * lerp(0.52, this.type === "peach" ? 1.18 : 1.38, leaf.tone) * (0.9 + features.volume * 0.22);
      drawMosaicLeafBlock(x, y, size, color, this.seed + i * 29, this.type);

      if (this.type === "willow" && i % 5 === 0) {
        drawMosaicBlockLine(x, y - size * 0.25, x + Math.sin(leaf.spin) * unit * 0.45, y + size * 1.75, size * 0.42, colorSet, this.seed + i * 31);
      }
    }
  }

  drawMosaicAccentTwigs(now, features, wind, unit) {
    const branchGrowth = clamp((this.growth - 0.18) / 0.82, 0, 1);
    const spacing = this.type === "willow" ? 2 : 3;
    for (let i = 0; i < this.branches.length; i += 1) {
      if (i % spacing !== 0) continue;
      const branch = this.branches[i];
      if (branchGrowth < branch.level * 0.82) continue;

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

      if (this.type === "pine" || this.type === "cypress") {
        endY = startY + Math.abs(Math.sin(branch.angle)) * length * 0.18;
      }

      if (this.type === "plane") {
        endY = startY + Math.sin(branch.angle) * length * 0.46;
      }

      if (this.type === "peach") {
        endY = startY + Math.sin(branch.angle) * length * 0.5 - unit * 0.2;
      }

      if (this.type === "ginkgo") {
        endY = startY + Math.sin(branch.angle) * length * 0.38 - unit * 0.4;
      }

      const midX = lerp(startX, endX, this.type === "willow" ? 0.76 : 0.58);
      const midY = lerp(startY, endY, this.type === "willow" ? 0.48 : 0.66);

      if (this.type === "willow") {
        drawMosaicBlockLine(midX, midY, endX + Math.sin(branch.phase) * unit * 0.45, endY + length * 0.48, unit * 0.18, palette.mosaic.willow, this.seed + i * 127);
      } else if (this.type === "pine" || this.type === "cypress") {
        drawMosaicBlockLine(midX, midY, endX, endY + unit * 0.18, unit * 0.18, palette.mosaic[this.type], this.seed + i * 131);
      } else if (this.type === "peach") {
        drawMosaicBlockLine(midX, midY, endX, endY, unit * 0.2, palette.mosaic.peach, this.seed + i * 137);
      } else {
        drawMosaicBlockLine(midX, midY, endX, endY, unit * 0.18 * this.branchSlimness, palette.mosaic.trunk, this.seed + i * 139);
      }
    }
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

      if (this.type === "pine" || this.type === "cypress") {
        endY = startY + Math.abs(Math.sin(branch.angle)) * length * 0.18;
      }

      const color = this.type === "pine" || this.type === "cypress" ? "#2e6142" : randomFrom(palette.bark, this.seed + branch.level * 31);
      drawStyledLine(startX, startY, endX, endY, Math.max(1, this.width * this.branchSlimness * (0.3 + (1 - branch.level) * 0.22)), color, style);

      if (this.type !== "pine" && this.type !== "cypress" && localGrowth > 0.64 && branch.length > 58) {
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

      if (this.type === "pine" || this.type === "cypress") {
        y = baseY + Math.abs(Math.sin(branch.angle)) * branch.length * leaf.offset * 0.12;
      }

      const jitter = seeded(this.seed + i * 17);
      x += (jitter() - 0.5) * this.spread * 0.34;
      y += (jitter() - 0.5) * 20;

      let colorSet = palette.leaf;
      if (this.type === "cherry" || this.type === "peach") colorSet = palette.blossom;
      if (this.type === "pine" || this.type === "cypress") colorSet = ["#1f5a3f", "#2f7d57", "#173d2c"];
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
  ctx.fillStyle = rgbToCss(background);
  ctx.fillRect(0, 0, state.width, state.height);
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

function setMeterPanelCollapsed(collapsed) {
  meterPanel.classList.toggle("is-collapsed", collapsed);
  meterPanelBody.hidden = collapsed;
  panelToggleButton.setAttribute("aria-expanded", String(!collapsed));
  panelToggleButton.setAttribute("aria-label", collapsed ? "展开数据面板" : "折叠数据面板");
  panelToggleButton.title = collapsed ? "展开数据面板" : "折叠数据面板";
  panelToggleIcon.textContent = collapsed ? "⌃" : "⌄";
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

function drawMosaicBlockLine(x1, y1, x2, y2, unit, colors, seed) {
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(2, Math.floor(distance / Math.max(4, unit * 0.72)));
  const rand = seeded(seed);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const nx = Math.sin(angle);
  const ny = -Math.cos(angle);

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const color = Array.isArray(colors) ? colors[(i + Math.floor(rand() * colors.length)) % colors.length] : colors;
    const jitter = (rand() - 0.5) * unit * 0.28;
    const size = unit * lerp(0.78, 1.18, rand());
    drawMosaicBlock(
      lerp(x1, x2, t) + nx * jitter,
      lerp(y1, y2, t) + ny * jitter,
      size,
      color,
      seed + i * 11
    );
  }
}

function drawMosaicLeafBlock(x, y, size, color, seed, type) {
  drawMosaicBlock(x, y, size, color, seed);

  const rand = seeded(seed + 73);
  const chips = type === "plane" || type === "oak" || type === "peach" ? 2 : (type === "willow" || type === "cherry" ? 1 : 0);
  const accentSet = palette.mosaic[type] || palette.mosaic.leaf;
  for (let i = 0; i < chips; i += 1) {
    if (rand() < 0.24) continue;
    const chipSize = size * lerp(0.28, 0.52, rand());
    const chipColor = accentSet[Math.floor(rand() * accentSet.length) % accentSet.length];
    drawMosaicBlock(
      x + (rand() - 0.5) * size * 2.1,
      y + (rand() - 0.5) * size * 1.8,
      chipSize,
      chipColor,
      seed + i * 101
    );
  }
}

function drawMosaicBlock(x, y, size, color, seed) {
  const s = Math.max(3, size);
  const half = s / 2;
  const rand = seeded(seed);
  const px = Math.round((x + (rand() - 0.5) * 0.7) * 2) / 2;
  const py = Math.round((y + (rand() - 0.5) * 0.7) * 2) / 2;

  ctx.save();
  ctx.translate(px, py);
  ctx.fillStyle = "rgba(23, 33, 27, 0.14)";
  ctx.fillRect(-half + s * 0.1, -half + s * 0.14, s, s);

  ctx.fillStyle = color;
  ctx.fillRect(-half, -half, s, s);

  ctx.fillStyle = "rgba(255, 255, 255, 0.26)";
  ctx.fillRect(-half, -half, s, Math.max(1, s * 0.14));
  ctx.fillRect(-half, -half, Math.max(1, s * 0.12), s);

  ctx.strokeStyle = "rgba(23, 33, 27, 0.26)";
  ctx.lineWidth = Math.max(0.65, s * 0.045);
  ctx.strokeRect(-half, -half, s, s);

  if (s >= 6.5) {
    const cols = s >= 12 ? 2 : 1;
    const rows = s >= 12 ? 2 : 1;
    const stepX = s / (cols + 1);
    const stepY = s / (rows + 1);
    const radius = s * (cols === 2 ? 0.115 : 0.16);
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 1; col <= cols; col += 1) {
        const cx = -half + stepX * col;
        const cy = -half + stepY * row;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
        ctx.fill();
        ctx.strokeStyle = "rgba(23, 33, 27, 0.22)";
        ctx.lineWidth = Math.max(0.5, radius * 0.28);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
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
  } else if (type === "cherry" || type === "peach") {
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
panelToggleButton.addEventListener("click", () => {
  setMeterPanelCollapsed(!meterPanel.classList.contains("is-collapsed"));
});
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
[
  [0.24, 10],
  [0.38, 2],
  [0.52, 8],
  [0.65, -4],
  [0.78, 6],
  [0.88, 0]
].forEach(([x, y]) => {
  plantFromAudio(state.width * x, state.ground + y);
});
requestAnimationFrame(tick);
