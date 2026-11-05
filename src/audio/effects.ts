// 소리 만들기 담당: 핑크노이즈, 리버브 잔향, 각종 이펙터

export const createHallReverbIR = (ctx: AudioContext, duration = 3, decay = 2) => {
  const length = ctx.sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let i = 0; i < length; i++) {
    const n = i / length;
    impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
    impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
  }
  return impulse;
};

export const createPinkNoiseBuffer = (ctx: AudioContext) => {
  const sampleRate = ctx.sampleRate || 44100;
  const bufferSize = sampleRate * 2; 
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);
  let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    data[i] *= 0.12;
    b6 = white * 0.115926;
  }
  return buffer;
};


// ───────── 이펙터 만들기 ─────────
// 각 이펙터는 input(입력) → [dry(원음) + wet(효과음)] → output(출력) 구조
// 이펙터에 넘겨주는 추가 정보 (levelDb: 음원의 평균 크기)
export type EffectOptions = { levelDb?: number };

// ───────── 직접 만든 컴프레서 (AudioWorklet) ─────────
const compressorWorkletCode = `
class SsetCompressor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -20 },
      { name: 'ratio', defaultValue: 8 },
      { name: 'attack', defaultValue: 0.001 },
      { name: 'release', defaultValue: 0.35 },
      { name: 'makeup', defaultValue: 0 },
    ];
  }
  constructor() {
    super();
    this.det = 0;
    this.env = 0;
    // 평균적으로 줄어든 양을 천천히(약 3초) 따라가서 전체 볼륨만 원래대로 맞춤 (펌핑 느낌은 그대로 남음)
    this.avgGr = 6;
    this.frames = 0;
    // 2ms 미리보기(룩어헤드): 소리를 살짝 늦게 내보내서 '빠른 어택'이 첫 타격까지 확실히 잡도록
    this.look = Math.round(0.002 * sampleRate);
    this.buf = [new Float32Array(this.look + 1), new Float32Array(this.look + 1)];
    this.pos = 0;
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    // 입력이 잠깐 끊겨도 바로 꺼지지 않고, 2초 넘게 아무 입력이 없을 때만 정리
    if (!inp || inp.length === 0) {
      this.idle = (this.idle || 0) + 128;
      return this.idle < sampleRate * 2;
    }
    this.idle = 0;
    const th = p.threshold[0], ratio = p.ratio[0], mk = p.makeup[0];
    const aA = Math.exp(-1 / (p.attack[0] * sampleRate));
    const aR = Math.exp(-1 / (p.release[0] * sampleRate));
    const aD = Math.exp(-1 / (0.01 * sampleRate));
    // 처음 1초는 빠르게(0.3초), 그 뒤로는 천천히(3초) 볼륨을 맞춤
    const aM = Math.exp(-1 / ((this.frames < sampleRate ? 0.3 : 3.0) * sampleRate));
    this.frames += inp[0].length;
    const n = inp[0].length;
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let c = 0; c < inp.length; c++) { const v = inp[c][i]; if (v * v > x) x = v * v; }
      this.det = Math.max(x, aD * this.det); // 피크를 바로 잡고(빠른 어택) 짧게 유지
      const over = 10 * Math.log10(this.det + 1e-12) - th;
      const gr = over > 0 ? over * (1 - 1 / ratio) : 0;
      this.env = gr > this.env ? aA * this.env + (1 - aA) * gr : aR * this.env + (1 - aR) * gr;
      this.avgGr = aM * this.avgGr + (1 - aM) * this.env;
      const g = Math.pow(10, (mk + this.avgGr - this.env) / 20);
      for (let c = 0; c < out.length; c++) {
        const ring = this.buf[c] || this.buf[0];
        const delayed = ring[this.pos];
        ring[this.pos] = (inp[c] || inp[0])[i];
        out[c][i] = delayed * g;
      }
      this.pos = (this.pos + 1) % (this.look + 1);
    }
    return true;
  }
}
registerProcessor('sset-compressor', SsetCompressor);
`;

const workletReady = new WeakSet<BaseAudioContext>();

// 오디오 장치를 처음 켤 때 한 번 불러오기
export const loadEffectWorklets = async (ctx: BaseAudioContext) => {
  if (workletReady.has(ctx) || !ctx.audioWorklet) return;
  const url = URL.createObjectURL(new Blob([compressorWorkletCode], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
    workletReady.add(ctx);
  } finally {
    URL.revokeObjectURL(url);
  }
};

// 음원(구간)의 평균 크기(dB) 재기
export const measureLevelDb = (buffer: AudioBuffer, start = 0, end = buffer.duration) => {
  const data = buffer.getChannelData(0);
  const from = Math.max(0, Math.floor(start * buffer.sampleRate));
  const to = Math.min(data.length, Math.floor(end * buffer.sampleRate));
  let sum = 0;
  let count = 0;
  for (let i = from; i < to; i += 4) { sum += data[i] * data[i]; count++; }
  return count > 0 ? 10 * Math.log10(sum / count + 1e-12) : -18;
};

export type FxUnit = { input: GainNode; output: GainNode; lfos: OscillatorNode[] };

export const createEffectorUnit = (ctx: AudioContext, type: string, opts: EffectOptions = {}): FxUnit => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const lfos: OscillatorNode[] = [];

  input.connect(dryGain);
  dryGain.connect(output);
  wetGain.connect(output);

  // 흔들림(LFO) 발생기 만들기
  const makeLfo = (freq: number, depthAmount: number, waveType: OscillatorType = 'sine') => {
    const lfo = ctx.createOscillator();
    lfo.type = waveType;
    lfo.frequency.value = freq;
    const depth = ctx.createGain();
    depth.gain.value = depthAmount;
    lfo.connect(depth);
    lfo.start();
    lfos.push(lfo);
    return depth;
  };

  if (type === '리버브') {
    // (기존 설정 유지)
    const convolver = ctx.createConvolver();
    convolver.buffer = createHallReverbIR(ctx, 2.2, 2.5);
    const preDelay = ctx.createDelay();
    preDelay.delayTime.value = 0.35;
    input.connect(preDelay);
    preDelay.connect(convolver);
    convolver.connect(wetGain);
    dryGain.gain.value = 1.0;
    wetGain.gain.value = 0.5;
  }
  else if (type === '딜레이') {
    // (기존 설정 유지)
    const delay = ctx.createDelay(2.0);
    delay.delayTime.value = 0.5;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.18;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3200;
    input.connect(delay);
    delay.connect(lowpass);
    lowpass.connect(feedback);
    feedback.connect(delay);
    delay.connect(wetGain);
    dryGain.gain.value = 1.0;
    wetGain.gain.value = 0.55;
  }
  else if (type === '클리핑') {
    // (기존 설정 유지)
    const preGain = ctx.createGain();
    preGain.gain.value = 10.0;
    const shaper = ctx.createWaveShaper();
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = i * 2 / samples - 1;
      curve[i] = Math.tanh(4.0 * x);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    const postGain = ctx.createGain();
    postGain.gain.value = 0.85;
    input.connect(preGain);
    preGain.connect(shaper);
    shaper.connect(postGain);
    postGain.connect(wetGain);
    dryGain.gain.value = 0.0;
    wetGain.gain.value = 0.3;
  }
  else if (type === '코러스') {
    // [개선] 좌/우로 벌어지는 2보이스 스테레오 코러스 → 소리가 넓고 출렁이게
    const voices = [
      { base: 0.020, depth: 0.0030, rate: 0.8, pan: -1 },
      { base: 0.026, depth: 0.0035, rate: 1.1, pan: 1 },
    ];
    voices.forEach(v => {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = v.base;
      makeLfo(v.rate, v.depth).connect(delay.delayTime);
      const panner = ctx.createStereoPanner();
      panner.pan.value = v.pan;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.45;
      input.connect(delay);
      delay.connect(voiceGain);
      voiceGain.connect(panner);
      panner.connect(wetGain);
    });
    dryGain.gain.value = 0.7;
    wetGain.gain.value = 1.0;
  }
  else if (type === '플랜저') {
    // [개선] 원음:효과음 1:1 + 강한 피드백 + 넓은 스윕 → "슈우웅" 제트기 소리가 확실하게
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.0025;
    makeLfo(0.3, 0.002, 'triangle').connect(delay.delayTime);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.75;
    input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wetGain);
    dryGain.gain.value = 0.6;
    wetGain.gain.value = 0.6;
  }
  else if (type === '페이저') {
    // [개선] 올패스 필터 8단 + 원음:효과음 1:1 → 깊은 홈(노치)이 위아래로 쓸고 다님
    // (기존에는 주파수가 음수로 내려가 효과가 거의 사라지는 문제가 있었음)
    const stages: BiquadFilterNode[] = [];
    const sweep = makeLfo(0.45, 1800, 'triangle'); // ±1.5옥타브 (약 280Hz ~ 2.3kHz)
    for (let i = 0; i < 8; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = 800;
      ap.Q.value = 0.7;
      sweep.connect(ap.detune);
      if (i === 0) input.connect(ap); else stages[i - 1].connect(ap);
      stages.push(ap);
    }
    stages[stages.length - 1].connect(wetGain);
    dryGain.gain.value = 0.75;
    wetGain.gain.value = 0.75;
  }
  else if (type === '와와') {
    // [개선] 사람 목소리 "와-와-" 범위(약 450Hz ~ 1.8kHz)를 리듬감 있게 쓸고 다니는 오토 와우
    // (기존에는 쓸어주는 폭이 너무 커서 필터가 대부분 0Hz에 붙어 있었음)
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 5;
    makeLfo(1.8, 1200, 'triangle').connect(filter.detune);
    input.connect(filter);
    filter.connect(wetGain);
    dryGain.gain.value = 0.35;
    wetGain.gain.value = 4.2;
  }
  else if (type === '컴프레서') {
    // [개선] 직접 만든 컴프레서: Ratio 8:1, 빠른 어택(1ms + 2ms 룩어헤드), 릴리즈 350ms
    // 음원 평균 크기보다 4dB 낮은 곳을 스레숄드로 잡아서, 킥/스네어가 칠 때마다
    // 소리가 꾹 눌렸다가 천천히 다시 올라오는 "펌핑"이 확실히 느껴지게 함
    // (볼륨 보상은 아주 천천히 평균만 맞춰서, 순간순간 눌리는 느낌은 그대로 들림)
    const levelDb = opts.levelDb ?? -18;
    const threshold = Math.max(-50, Math.min(-6, levelDb - 4));
    if (workletReady.has(ctx)) {
      const comp = new AudioWorkletNode(ctx, 'sset-compressor', { outputChannelCount: [2] });
      comp.parameters.get('threshold')!.value = threshold;
      comp.parameters.get('ratio')!.value = 8;
      comp.parameters.get('attack')!.value = 0.001;
      comp.parameters.get('release')!.value = 0.35;
      comp.parameters.get('makeup')!.value = 1; // 평균 볼륨은 자동으로 원음과 비슷하게 맞춰짐
      input.connect(comp);
      comp.connect(wetGain);
    } else {
      // (예전 브라우저용 예비 방식)
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = threshold;
      comp.knee.value = 0;
      comp.ratio.value = 8;
      comp.attack.value = 0.001;
      comp.release.value = 0.35;
      input.connect(comp);
      comp.connect(wetGain);
    }
    dryGain.gain.value = 0.0;
    wetGain.gain.value = 1.0;
  }
  else {
    dryGain.gain.value = 1.0;
    wetGain.gain.value = 0.0;
  }

  return { input, output, lfos };
};

// "딜레이+리버브" 처럼 여러 개면 순서대로 이어 붙이기
export const createEffectorChain = (ctx: AudioContext, target: string, opts: EffectOptions = {}): FxUnit => {
  const names = target.split('+');
  const units = names.map(n => createEffectorUnit(ctx, n, opts));
  for (let i = 0; i < units.length - 1; i++) {
    units[i].output.connect(units[i + 1].input);
  }
  return {
    input: units[0].input,
    output: units[units.length - 1].output,
    lfos: units.flatMap(u => u.lfos),
  };
};
