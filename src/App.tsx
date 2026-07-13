import React, { useState, useRef, useEffect } from 'react';

// 31밴드 전체 마스터 풀
const iso31Bands = [
  '31.5Hz', '40Hz', '50Hz', '63Hz', '80Hz', '100Hz', '125Hz', '160Hz', 
  '200Hz', '250Hz', '315Hz', '400Hz', '500Hz', '630Hz', '800Hz', '1kHz', '1.25kHz', '1.6kHz', 
  '2kHz', '2.5kHz', '3.15kHz', '4kHz', '5kHz', '6.3kHz', '8kHz', '10kHz', '12.5kHz', '16kHz'
];

// EASY 모드 10밴드 구성
const iso10Bands = ['31.5Hz', '63Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];

// 이펙터 목록 정의
const effectorList = ['리버브', '코러스', '페이저', '딜레이', '클리핑', '와와', '플랜저'];

const getFreqRegion = (band: string): 'low' | 'mid' | 'high' => {
  if (band.includes('kHz')) {
    const khz = parseFloat(band.replace('kHz', ''));
    return khz >= 2 ? 'high' : 'mid';
  }
  const hz = parseFloat(band.replace('Hz', ''));
  if (hz <= 200) return 'low';
  return 'mid';
};

const parseFreq = (str: string): number => {
  if (str.endsWith('kHz')) return parseFloat(str.replace('kHz', '')) * 1000;
  return parseFloat(str.replace('Hz', ''));
};

const createHallReverbIR = (ctx: AudioContext, duration = 3, decay = 2) => {
  const length = ctx.sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let i = 0; i < length; i++) {
    const n = i / length;
    impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
    impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
  }
  return impulse;
};

export default function App() {
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');

  // 훈련 대분류 카테고리 탭: 'EQ' | 'SINE' (사인파) | 'EFFECTOR' (이펙터)
  const [activeTab, setActiveTab] = useState<'EQ' | 'SINE' | 'EFFECTOR'>('EQ');

  // 난이도 및 레이아웃 숨김 상태
  const [level, setLevel] = useState<'EASY' | 'HARD' | 'CUSTOM'>('EASY');
  const [isFilterPanelVisible, setIsFilterPanelVisible] = useState<boolean>(true);
  const [isSourcePanelVisible, setIsSourcePanelVisible] = useState<boolean>(true);
  
  // CUSTOM 모드 전환 시 초기 상태를 10밴드 카피본으로 고정
  const [customSelected, setCustomSelected] = useState<string[]>([...iso10Bands]); 
  const [eqMode, setEqMode] = useState<'boost' | 'cut' | 'random'>('boost');
  const [gainAmt, setGainAmt] = useState<'12' | '6'>('12');
  
  // 소스 디폴트 순서 조정 (음원 -> 핑크노이즈)
  const [source, setSource] = useState<'music' | 'pink'>('music');
  
  // 스코어 시스템
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  
  const [feedback, setFeedback] = useState<string>('준비 완료. 아래 [문제재생] 버튼을 누르면 청음이 시작됩니다.');
  const [lastResult, setLastResult] = useState<{ status: 'correct' | 'wrong' | 'idle'; message: string }>({ status: 'idle', message: '' });
  
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBypassActive, setIsBypassActive] = useState<boolean>(false); 
  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  const [selectedEffector, setSelectedEffector] = useState<string | null>(null);
  
  // 타이머 프리뷰 시스템
  const [progress, setProgress] = useState<number>(0);
  const [isPreviewStage, setIsPreviewStage] = useState<boolean>(false);

  // 오답 복습 캐시 메모리
  const [wrongQuestionCache, setWrongQuestionCache] = useState<{
    tab: 'EQ' | 'SINE' | 'EFFECTOR';
    target: string; 
    gain?: number;
    level?: 'EASY' | 'HARD' | 'CUSTOM';
  } | null>(null);
  const [isReplayingWrong, setIsReplayingWrong] = useState<boolean>(false);

  // 파형 오디오 루프 제어
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [loopStart, setLoopStart] = useState<number>(0);
  const [loopEnd, setLoopEnd] = useState<number>(0);
  const [isLoopEnabled, setIsLoopEnabled] = useState<boolean>(true);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState<boolean>(false);

  // Web Audio API 노드 Refs 모음
  const currentAnswerRef = useRef<string | null>(null);
  const currentAppliedGainRef = useRef<number>(0); 
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const oscillatorNodeRef = useRef<OscillatorNode | null>(null);
  
  // 오디오 체인 제어용 필터/이펙트 바이패스 게인 노드
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const effectNodeRef = useRef<AudioNode | null>(null); 
  const eqGainNodeRef = useRef<GainNode | null>(null);
  const bypassGainNodeRef = useRef<GainNode | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const limiterNodeRef = useRef<DynamicsCompressorNode | null>(null); // 최후방 하드웨어 보호 리미터

  const userAudioBufferRef = useRef<AudioBuffer | null>(null);
  const previewSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const timerIdRef = useRef<any>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<'start' | 'end' | null>(null);

  useEffect(() => {
    return () => { 
      if (timerIdRef.current) clearInterval(timerIdRef.current); 
      stopAllAudio();
    };
  }, []);

  const generatePeaks = (buffer: AudioBuffer) => {
    const rawData = buffer.getChannelData(0); 
    const step = Math.ceil(rawData.length / 140); 
    const extractedPeaks: number[] = [];
    for (let i = 0; i < 140; i++) {
      let max = 0;
      for (let j = 0; j < step; j++) {
        const val = Math.abs(rawData[i * step + j] || 0);
        if (val > max) max = val;
      }
      extractedPeaks.push(max);
    }
    setPeaks(extractedPeaks);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopAllAudio();
    setFeedback('🎧 오디오 주파수 분석 및 파형 트랙 빌드를 시작합니다...');
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);
      userAudioBufferRef.current = audioBuffer;
      setAudioDuration(audioBuffer.duration);
      setLoopStart(0);
      setLoopEnd(audioBuffer.duration);
      setUploadedFileName(file.name);
      generatePeaks(audioBuffer);
      setFeedback(`✅ 파형 로드 완료: ${file.name}`);
    } catch (err) {
      setFeedback('❌ 오디오 파일 파싱 실패. 형식을 확인해 주세요.');
    }
  };

  const createPinkNoiseBuffer = (ctx: AudioContext) => {
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

  const getCurrentPool = () => {
    if (level === 'EASY') return iso10Bands;
    if (level === 'HARD') return iso31Bands;
    return [...customSelected].sort((a, b) => parseFreq(a) - parseFreq(b));
  };

  const togglePreviewPlay = () => {
    if (isPreviewPlaying) {
      stopPreviewAudio();
      return;
    }
    if (!userAudioBufferRef.current || !audioCtxRef.current) return;
    stopAudio(); 

    const ctx = audioCtxRef.current;
    
    // 미리듣기 단계에서도 스커 기기 보호용 리미터 강제 삽입
    const internalLimiter = ctx.createDynamicsCompressor();
    internalLimiter.threshold.setValueAtTime(-4, ctx.currentTime);
    internalLimiter.knee.setValueAtTime(0, ctx.currentTime);
    internalLimiter.ratio.setValueAtTime(20, ctx.currentTime);
    internalLimiter.attack.setValueAtTime(0.003, ctx.currentTime);
    internalLimiter.release.setValueAtTime(0.05, ctx.currentTime);
    internalLimiter.connect(ctx.destination);

    const pSource = ctx.createBufferSource();
    pSource.buffer = userAudioBufferRef.current;
    
    if (isLoopEnabled) {
      pSource.loop = true;
      pSource.loopStart = loopStart;
      pSource.loopEnd = loopEnd;
    }

    pSource.connect(internalLimiter);
    pSource.start(0, loopStart);
    previewSourceNodeRef.current = pSource;
    setIsPreviewPlaying(true);
    setFeedback('🎵 [미리듣기] 설정한 구간을 이펙트 없는 오리지널 상태로 모니터링 중입니다. (리미터 활성화)');
  };

  const stopPreviewAudio = () => {
    if (previewSourceNodeRef.current) {
      try { previewSourceNodeRef.current.stop(); } catch(e){}
      previewSourceNodeRef.current.disconnect();
      previewSourceNodeRef.current = null;
    }
    setIsPreviewPlaying(false);
  };

  const stopAllAudio = () => {
    stopAudio();
    stopPreviewAudio();
  };

  // 이펙터 음량 편차 및 오작동 볼륨 펑핑 제어 보정형 이펙트 노드 생성
  const createEffectorNode = (ctx: AudioContext, type: string): AudioNode => {
  const input = ctx.createGain();
  const output = ctx.createGain();
  
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  
  // 기본 볼륨 밸런스: 원음 50% + 이펙터 50% 
  dryGain.gain.value = 0.5;
  wetGain.gain.value = 0.5;

  input.connect(dryGain);
  dryGain.connect(output);

  if (type === '리버브') {
    // 3.5초 홀 리버브 생성
    const duration = 3.5; 
    const decay = 3.0;
    const length = ctx.sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let i = 0; i < length; i++) {
      const n = i / length;
      impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
      impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    
    input.connect(convolver);
    convolver.connect(wetGain);
  } 
  else if (type === '딜레이') {
    const delay = ctx.createDelay();
    delay.delayTime.value = 1.5; // 0.초 딜레이
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4; // 피드백 양
    
    input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    
    delay.connect(wetGain);
  }
  else if (type === '코러스') {
    // 코러스: 짧은 딜레이(30ms)를 LFO로 흔들어줌
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.03;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.005;
    
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();
    
    input.connect(delay);
    delay.connect(wetGain);
  }
  else if (type === '와와') {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 5.0;
    
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.0;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 800;
    
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    
    input.connect(filter);
    filter.connect(wetGain);
    
    // 와와는 효과음이 강해야 명확하므로 비율 조정
    dryGain.gain.value = 0.2; 
    wetGain.gain.value = 0.8; 
  }
  else if (type === '클리핑') {
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(44100);
    for (let i = 0; i < 44100; ++i) {
      const x = (i * 2) / 44100 - 1;
      curve[i] = (53) * x * 20 / (Math.PI + 50 * Math.abs(x));
    }
    shaper.curve = curve;
    
    input.connect(shaper);
    shaper.connect(wetGain);
  }
  else {
    // 이펙터가 없을 경우 원음만 출력
    dryGain.gain.value = 1.0;
    wetGain.gain.value = 0.0;
  }

  // 우회(Intercept) 로직: 기존 코드 호환성을 위해 input에 연결하면 output으로 빠져나가게 만듦
  const originalConnect = input.connect.bind(input);
  (input as any).connect = (destination: any, outputIndex?: number, inputIndex?: number) => {
    if (destination instanceof AudioNode || destination instanceof AudioParam) {
      return output.connect(destination as any, outputIndex, inputIndex);
    }
    return originalConnect(destination);
  };

  return input;
};

  const playAudioCore = async (modeType: 'EQ' | 'SINE' | 'EFFECTOR', target: string, appliedGain: number, targetLevel: 'EASY' | 'HARD' | 'CUSTOM', isReplayMode: boolean) => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtxRef.current;

    currentAnswerRef.current = target;
    currentAppliedGainRef.current = appliedGain;

    // 🚨 [스피커 파손 방지 하드 리미터 탑재] 오디오 목적지 바로 직전에 인터셉트 노드로 생성 및 하드 바인딩
    const safetyLimiter = ctx.createDynamicsCompressor();
    safetyLimiter.threshold.setValueAtTime(-4, ctx.currentTime); // -4dB 초과 신호 압착
    safetyLimiter.knee.setValueAtTime(0, ctx.currentTime);       // 하드 리미팅 적용 고정
    safetyLimiter.ratio.setValueAtTime(20, ctx.currentTime);     // 강력한 리미터 비율 체킹
    safetyLimiter.attack.setValueAtTime(0.003, ctx.currentTime); // 초고속 대응 (3ms)
    safetyLimiter.release.setValueAtTime(0.05, ctx.currentTime); // 50ms 릴리즈
    safetyLimiter.connect(ctx.destination);
    limiterNodeRef.current = safetyLimiter;

    const masterGain = ctx.createGain();
    const fadeDuration = source === 'pink' ? 0.5 : 0.2;
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + fadeDuration);
    
    // 마스터 출력단이 컨텍스트 목적지가 아닌 안전 리미터 노드로 라우팅되도록 설정
    masterGain.connect(safetyLimiter);
    masterGainNodeRef.current = masterGain;

    const eqGain = ctx.createGain();
    const bypassGain = ctx.createGain();
    eqGain.gain.value = 1.0;
    bypassGain.gain.value = 0.0;
    eqGain.connect(masterGain);
    bypassGain.connect(masterGain);
    eqGainNodeRef.current = eqGain;
    bypassGainNodeRef.current = bypassGain;

    setIsPlaying(true);
    setIsBypassActive(false);

    if (modeType === 'SINE') {
      setIsPreviewStage(false);
      setProgress(100);
      
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = parseFreq(target);
      
      const sineVol = ctx.createGain();
      sineVol.gain.value = 0.12; // 사인파 출력 마스터 오버플로우 마진 확보

      osc.connect(sineVol);
      sineVol.connect(eqGain);
      osc.start(0);
      oscillatorNodeRef.current = osc;
      
      setFeedback(`⚡ [순수 사인파 오실레이터] 단일 고정 주파수가 발생 중입니다. 정답 밴드를 맞추어 보세요! (보호막 가동)`);
      return;
    }

    if (modeType === 'EQ') {
      const sourceNode = ctx.createBufferSource();
      if (source === 'pink') {
        sourceNode.buffer = createPinkNoiseBuffer(ctx);
        sourceNode.loop = true;
      } else {
        sourceNode.buffer = userAudioBufferRef.current;
        if (isLoopEnabled) sourceNode.loop = true;
        sourceNode.loopStart = loopStart;
        sourceNode.loopEnd = loopEnd;
      }

      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = parseFreq(target);
      filter.Q.value = targetLevel === 'HARD' || targetLevel === 'CUSTOM' ? 4.3 : 1.0; 
      filter.gain.value = 0; 

      sourceNode.connect(filter);
      filter.connect(eqGain);
      sourceNode.connect(bypassGain);

      if (source === 'music') {
        sourceNode.start(0, loopStart);
      } else {
        sourceNode.start(0);
      }
      sourceNodeRef.current = sourceNode;
      filterNodeRef.current = filter;

      if (isReplayMode) {
        setIsPreviewStage(false);
        setProgress(100);
        filter.gain.setValueAtTime(appliedGain, ctx.currentTime);
        setFeedback(`🔁 [오답 다시듣기] 틀렸던 문제의 변형 사운드(${target})를 재생 중입니다.`);
      } else {
        setIsPreviewStage(true);
        setProgress(0);
        setFeedback(`🎧 원음 프리뷰 가동 중 (${source === 'pink' ? '핑크노이즈 5초' : '음원 8초'})`);

        if (timerIdRef.current) clearInterval(timerIdRef.current);
        let currentMs = 0;
        const totalMs = source === 'pink' ? 5000 : 8000; 
        const intervalMs = 50; 

        timerIdRef.current = setInterval(() => {
          currentMs += intervalMs;
          setProgress(Math.min((currentMs / totalMs) * 100, 100));
          if (currentMs >= totalMs) {
            clearInterval(timerIdRef.current);
            setIsPreviewStage(false);
            setFeedback(`🔊 EQ 변형 프로세서 인입 완료. 주파수 대역을 찾아내 보세요.`);
            if (filterNodeRef.current) {
              filterNodeRef.current.gain.linearRampToValueAtTime(appliedGain, ctx.currentTime + 1.0);
            }
          }
        }, intervalMs);
      }
    }

    if (modeType === 'EFFECTOR') {
      const sourceNode = ctx.createBufferSource();
      if (source === 'pink') {
        sourceNode.buffer = createPinkNoiseBuffer(ctx);
        sourceNode.loop = true;
      } else {
        sourceNode.buffer = userAudioBufferRef.current;
        if (isLoopEnabled) sourceNode.loop = true;
        sourceNode.loopStart = loopStart;
        sourceNode.loopEnd = loopEnd;
      }

      const effectorNode = createEffectorNode(ctx, target);
      
      sourceNode.connect(effectorNode);
      effectorNode.connect(eqGain);
      sourceNode.connect(bypassGain);

      if (source === 'music') {
        sourceNode.start(0, loopStart);
      } else {
        sourceNode.start(0);
      }
      sourceNodeRef.current = sourceNode;
      effectNodeRef.current = effectorNode;

      if (isReplayMode) {
        setIsPreviewStage(false);
        setProgress(100);
        setFeedback(`🔁 [오답 다시듣기] 이펙터 사운드가 즉시 처리되어 흐르는 중입니다.`);
      } else {
        setIsPreviewStage(true);
        setProgress(0);
        eqGain.gain.setValueAtTime(0, ctx.currentTime);
        bypassGain.gain.setValueAtTime(1.0, ctx.currentTime);
        setFeedback(`🎧 이펙트 미적용 원음 모니터링 가동 중 (${source === 'pink' ? '핑크노이즈 5초' : '음원 8초'})`);

        if (timerIdRef.current) clearInterval(timerIdRef.current);
        let currentMs = 0;
        const totalMs = source === 'pink' ? 5000 : 8000; 
        const intervalMs = 50; 

        timerIdRef.current = setInterval(() => {
          currentMs += intervalMs;
          setProgress(Math.min((currentMs / totalMs) * 100, 100));
          if (currentMs >= totalMs) {
            clearInterval(timerIdRef.current);
            setIsPreviewStage(false);
            setFeedback(`🔊 특수 음향 이펙트 가동! 걸려있는 오디오 이펙터를 맞춰 보세요.`);
            if (eqGainNodeRef.current && bypassGainNodeRef.current) {
              eqGainNodeRef.current.gain.setValueAtTime(1.0, ctx.currentTime);
              bypassGainNodeRef.current.gain.setValueAtTime(0, ctx.currentTime);
            }
          }
        }, intervalMs);
      }
    }
  };

  const togglePlayPause = async () => {
    if (isPlaying) {
      stopAudio();
      setIsReplayingWrong(false);
      return;
    }
    stopPreviewAudio(); 
    setIsReplayingWrong(false);

    if (activeTab !== 'SINE' && source === 'music' && !userAudioBufferRef.current) {
      setFeedback('⚠️ 아래 시그널 소스 패널에서 음원 파일을 먼저 업로드해 주세요.');
      return;
    }

    if (activeTab === 'EQ' || activeTab === 'SINE') {
      const pool = getCurrentPool();
      if (pool.length === 0) {
        setFeedback('⚠️ CUSTOM 모드에 지정된 주파수가 없습니다. 대역을 선택해 주세요.');
        return;
      }
      const randomIdx = Math.floor(Math.random() * pool.length);
      const targetBand = pool[randomIdx];

      let calculatedGain = parseFloat(gainAmt);
      if (eqMode === 'cut') calculatedGain = -calculatedGain;
      if (eqMode === 'random') calculatedGain = Math.random() > 0.5 ? calculatedGain : -calculatedGain;

      setWrongQuestionCache(null);
      await playAudioCore(activeTab, targetBand, calculatedGain, level, false);
    } 
    else if (activeTab === 'EFFECTOR') {
      const randomIdx = Math.floor(Math.random() * effectorList.length);
      const targetEffect = effectorList[randomIdx];
      setWrongQuestionCache(null);
      await playAudioCore('EFFECTOR', targetEffect, 0, 'EASY', false);
    }
  };

  // ==========================================
  // [추가 및 확장된 상태 관리 State]
  // ==========================================
  const [randomActualTab, setRandomActualTab] = useState<'EQ' | 'SINE' | 'EFFECTOR'>('EQ');
  const [selectedSign, setSelectedSign] = useState<'+' | '-' | null>(null); // EQ 부호 선택 (+/-)
  const [playbackPosition, setPlaybackPosition] = useState<number>(0); // 실시간 재생 커서 위치 (초)
  
  // 20문제 게임 세션 및 통계 관련 상태
  const [sessionStage, setSessionStage] = useState<'ready' | 'playing' | 'finished'>('ready');
  const [currentQuestionNo, setCurrentQuestionNo] = useState<number>(1);
  const [wrongStats, setWrongStats] = useState<Record<string, number>>({}); // 요소별 오답 횟수 기록
  const [isReviewMode, setIsReviewMode] = useState<boolean>(false);

  // 드래그 앤 드랍 핸들러
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      // 기존 소스코드 내부의 handleFileUpload 로직 호출 또는 파일 주입 프로세스 실행
      // 예: handleFileUpload({ target: { files: [file] } } as any);
    }
  };

  // 실시간 재생 위치 업데이트 애니메이션 루프 (useEffect 연동 필요)
  // 재생 중일 때 sourceNode 오디오 컨텍스트의 currentTime 등을 활용해 setPlaybackPosition 업데이트 수행 가정

  const handleReplayWrongQuestion = async () => {
    if (!wrongQuestionCache) return;
    if (isPlaying) {
      stopAudio();
      if (isReplayingWrong) {
        setIsReplayingWrong(false);
        return;
      }
    }
    stopPreviewAudio();
    setIsReplayingWrong(true);
    await playAudioCore(wrongQuestionCache.tab, wrongQuestionCache.target, wrongQuestionCache.gain || 0, wrongQuestionCache.level || 'EASY', true);
  };

  const toggleBypass = () => {
    if (!isPlaying || !eqGainNodeRef.current || !bypassGainNodeRef.current) return;
    if (isBypassActive) {
      eqGainNodeRef.current.gain.value = 1.0;
      bypassGainNodeRef.current.gain.value = 0.0;
      setIsBypassActive(false);
      if (!isPreviewStage) setFeedback('🔊 현재 사운드: 변형 프로세서 인입 상태');
    } else {
      eqGainNodeRef.current.gain.value = 0.0;
      bypassGainNodeRef.current.gain.value = 1.0;
      setIsBypassActive(true);
      setFeedback('🎧 현재 사운드: 바이패스(Bypass) 순수 오리지널 상태');
    }
  };

  const stopAudio = () => {
    if (timerIdRef.current) clearInterval(timerIdRef.current);
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e){}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (oscillatorNodeRef.current) {
      try { oscillatorNodeRef.current.stop(); } catch(e){}
      oscillatorNodeRef.current.disconnect();
      oscillatorNodeRef.current = null;
    }
    filterNodeRef.current = null;
    effectNodeRef.current = null;
    eqGainNodeRef.current = null;
    bypassGainNodeRef.current = null;
    masterGainNodeRef.current = null;
    limiterNodeRef.current = null;
    setIsPlaying(false);
    setIsPreviewStage(false);
    setIsBypassActive(false);
    setProgress(0);
    setPlaybackPosition(0);
  };

  // 문제 출제 단계 분증 제어 확장 (랜덤 모드 지원)
  const triggerNextQuestion = (forcedTab?: 'EQ' | 'SINE' | 'EFFECTOR') => {
    let targetTab = forcedTab || activeTab;
    
    if (activeTab === 'RANDOM') {
      setSource('music'); // 랜덤모드는 기본 음원 고정
      setLevel('EASY');  // 기본 EASY 모드
      const tabs: ('EQ' | 'SINE' | 'EFFECTOR')[] = ['EQ', 'SINE', 'EFFECTOR'];
      targetTab = tabs[Math.floor(Math.random() * tabs.length)];
      setRandomActualTab(targetTab);
      if (targetTab === 'EQ') {
        const eqModes: ('boost' | 'cut')[] = ['boost', 'cut'];
        setEqMode(eqModes[Math.floor(Math.random() * eqModes.length)]);
      }
    }

    // 통계 복습 모드 시 오답률 높은 풀에서 선별하는 로직 추가 가능
    // 기존의 playAudioCore 세팅 프로세스 호출...
  };

  const handleSubmit = () => {
    if (!currentAnswerRef.current) {
      setFeedback('❌ 활성화된 타겟 문제가 없습니다. 먼저 [문제재생]을 진행해 주세요.');
      return;
    }

    let isCorrect = false;
    let chosenValue = '';
    const effectiveTab = activeTab === 'RANDOM' ? randomActualTab : activeTab;

    // 1. 답안 일치 성향 검증 처리
    if (effectiveTab === 'EQ') {
      if (!selectedBand || !selectedSign) {
        setFeedback('⚠️ 예측하신 주파수 대역과 부호(+/—) 박스를 모두 선택해 주세요.');
        return;
      }
      const targetGain = currentAppliedGainRef.current || 0;
      const correctSign = targetGain >= 0 ? '+' : '-';
      
      isCorrect = (selectedBand === currentAnswerRef.current) && (selectedSign === correctSign);
      chosenValue = `${selectedSign} ${selectedBand}`;
    } else if (effectiveTab === 'SINE') {
      if (!selectedBand) {
        setFeedback('⚠️ 매트릭스 보드에서 예측하신 주파수 대역을 선택해 주세요.');
        return;
      }
      isCorrect = selectedBand === currentAnswerRef.current;
      chosenValue = selectedBand;
    } else {
      if (!selectedEffector) {
        setFeedback('⚠️ 하단 목록에서 예측하신 오디오 이펙터를 지정해 주세요.');
        return;
      }
      isCorrect = selectedEffector === currentAnswerRef.current;
      chosenValue = selectedEffector;
    }

    // 2. 결과 누적 및 오답 통계 연산
    const currentTargetKey = `${effectiveTab}_${currentAnswerRef.current}`;

    if (isCorrect) {
      setScore(prev => ({ correct: prev.correct + 1, total: prev.total + 1 }));
      setStreak(prev => prev + 1);
      setLastResult({
        status: 'correct',
        message: `🎯 정답입니다! 정답 매칭 요소는 [ ${effectiveTab === 'EQ' ? (currentAppliedGainRef.current >= 0 ? '+' : '-') : ''}${currentAnswerRef.current} ] 였습니다.`
      });
      setFeedback('우수한 감각입니다. 다음 훈련 세션을 진행해보세요!');
      setWrongQuestionCache(null);
    } else {
      setScore(prev => ({ ...prev, total: prev.total + 1 }));
      setStreak(0);
      setLastResult({
        status: 'wrong',
        message: `❌ 오답입니다. 선택: ${chosenValue} / 실제 정답: [ ${effectiveTab === 'EQ' ? (currentAppliedGainRef.current >= 0 ? '+' : '-') : ''}${currentAnswerRef.current} ]`
      });
      setFeedback('오답입니다. 하단의 [틀린문제 다시듣기] 버튼으로 차이점을 복습해 보세요.');
      
      // 오답 카운트 누적 통계 연산
      setWrongStats(prev => ({
        ...prev,
        [currentTargetKey]: (prev[currentTargetKey] || 0) + 1
      }));

      setWrongQuestionCache({
        tab: effectiveTab,
        target: currentAnswerRef.current,
        gain: currentAppliedGainRef.current,
        level: level
      });
    }

    // 3. 20문제 게임 라운드 유한 흐름 제어 인터셉터
    if (currentQuestionNo >= 20) {
      setSessionStage('finished');
      setFeedback('🏁 20문항으로 구성된 오디오 매칭 세션이 종료되었습니다. 하단의 성적 분석을 확인하세요.');
      stopAllAudio();
    } else {
      setCurrentQuestionNo(prev => prev + 1);
      stopAllAudio();
      currentAnswerRef.current = null;
      setSelectedBand(null);
      setSelectedSign(null);
      setSelectedEffector(null);
      setIsReplayingWrong(false);
    }
  };

  // 취약점 기준 재시험 세션 셋업 빌더
  const startReviewSession = () => {
    if (Object.keys(wrongStats).length === 0) {
      alert("기록된 오답 데이터가 없어 취약점 세션을 생성할 수 없습니다.");
      return;
    }
    // 오답률이 높은 순서대로 정렬
    const sortedFlaws = Object.entries(wrongStats).sort((a, b) => b[1] - a[1]);
    
    setIsReviewMode(true);
    setCurrentQuestionNo(1);
    setSessionStage('playing');
    setScore({ correct: 0, total: 0 });
    setStreak(0);
    setFeedback('🎯 오답 빈도가 가장 높았던 취약 대역/이펙터 타겟 매칭 재시험이 시작되었습니다.');
    
    // 첫번째 취약 매칭 문제를 트리거하도록 처리 로직 연동 가능
    const [topTargetKey] = sortedFlaws[0];
    const [parsedTab, parsedTarget] = topTargetKey.split('_');
    // 해당 타겟을 기반으로 한 강제 문제 생성 프로세스 핸들링...
  };

  const resetFullSession = () => {
    setSessionStage('ready');
    setCurrentQuestionNo(1);
    setWrongStats({});
    setIsReviewMode(false);
    setScore({ correct: 0, total: 0 });
    setStreak(0);
  };

  // 구역 선택 토글 함수
  const toggleRegion = (region: 'low' | 'mid' | 'high') => {
    const targets = iso31Bands.filter(b => getFreqRegion(b) === region);
    const allSelected = targets.every(b => customSelected.includes(b));
    let nextState: string[];

    if (allSelected) {
      nextState = customSelected.filter(b => getFreqRegion(b) !== region);
    } else {
      const filteredClean = customSelected.filter(b => getFreqRegion(b) !== region);
      nextState = [...filteredClean, ...targets];
    }
    setCustomSelected(nextState.sort((a, b) => parseFreq(a) - parseFreq(b)));
  };

  const handleWaveformTouchStart = (e: React.MouseEvent<HTMLDivElement>, forceType?: 'start' | 'end') => {
    if (audioDuration === 0 || !waveformRef.current) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const currentPercent = Math.max(0, Math.min(clickX / rect.width, 1));
    const targetTime = currentPercent * audioDuration;

    if (forceType) {
      isDraggingRef.current = forceType;
    } else {
      const distToStart = Math.abs(targetTime - loopStart);
      const distToEnd = Math.abs(targetTime - loopEnd);
      isDraggingRef.current = distToStart < distToEnd ? 'start' : 'end';
    }
    updateLoopTime(e);
  };

  const updateLoopTime = (e: MouseEvent | React.MouseEvent) => {
    if (!waveformRef.current || audioDuration === 0 || !isDraggingRef.current) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const clientX = (e as MouseEvent).clientX !== undefined ? (e as MouseEvent).clientX : (e as any).touches?.[0]?.clientX;
    if (!clientX) return;
    
    const currentX = clientX - rect.left;
    const percent = Math.max(0, Math.min(currentX / rect.width, 1));
    const calculatedTime = percent * audioDuration;

    if (isDraggingRef.current === 'start') {
      const nextStart = Math.min(calculatedTime, loopEnd - 0.2);
      setLoopStart(nextStart); 
      // 🛠️ 실시간 루프 반영 피드백: 오디오 버퍼 소스 노드가 열려있을 경우 동적 타임 업데이트 로직 처리 위치
    } else {
      const nextEnd = Math.max(calculatedTime, loopStart + 0.2);
      setLoopEnd(nextEnd);
    }
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        e.preventDefault();
        updateLoopTime(e);
      }
    };
    const handleGlobalMouseUp = () => {
      isDraggingRef.current = null;
    };
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [loopStart, loopEnd, audioDuration]);

  const isDark = themeMode === 'dark';
  const colors = {
    bg: isDark ? '#0d0f12' : '#f5f7fa',     
    cardBg: isDark ? '#14171e' : '#ffffff', 
    textMain: isDark ? '#f1f3f5' : '#1a202c',
    textSub: isDark ? '#a0aec0' : '#4a5568',
    primary: '#1a73e8',
    accent: '#ff922b', 
    border: isDark ? '#252a37' : '#e2e8f0',
    innerBox: isDark ? '#191d26' : '#f7fafc',
    waveformBg: isDark ? '#0a0c10' : '#edf2f7',
    lowFreq: '#ff6b6b',
    midFreq: '#3ea6ff',
    highFreq: '#2ecc71',
    successBg: isDark ? '#152b1e' : '#e6fffa',
    successText: '#2ecc71',
    btnDefault: isDark ? '#1b1f2b' : '#edf2f7'
  };

  return (
    <div style={{ backgroundColor: colors.bg, color: colors.textMain, minHeight: '100vh', padding: '25px 15px', fontFamily: 'system-ui, -apple-system, sans-serif', transition: 'background-color 0.2s ease, color 0.2s ease' }}>
      
      <header style={{ maxWidth: '720px', margin: '0 auto 20px auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ textAlign: 'left' }}>
          <h1 style={{ fontSize: '25px', fontWeight: '900', color: colors.primary, margin: '0 0 3px 0' }}>SSET PRO</h1>
          <p style={{ color: '#7e8794', fontSize: '11px', margin: 0 }}>Acoustic Field Frequency Ear Training System {isReviewMode && '• [복습 세션 모드]'}</p>
        </div>
        <button onClick={() => setThemeMode(isDark ? 'light' : 'dark')} style={{ padding: '8px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', backgroundColor: isDark ? '#222733' : '#e2e8f0', color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: '20px' }}>
          {isDark ? '☀️ 주간 모드' : '🌙 다크 모드'}
        </button>
      </header>

      {/* 대분류 카테고리 셀렉터 탭 (RANDOM 탭 확장 추가) */}
      <nav style={{ maxWidth: '720px', margin: '0 auto 16px auto', display: 'flex', gap: '8px' }}>
        {(['EQ', 'SINE', 'EFFECTOR', 'RANDOM'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { 
              stopAllAudio(); 
              setActiveTab(tab); 
              setWrongQuestionCache(null);
              if(tab === 'RANDOM') { setSource('music'); setLevel('EASY'); }
            }}
            style={{
              flex: 1, padding: '14px 4px', fontSize: '13px', fontWeight: '800', borderRadius: '10px', cursor: 'pointer', border: 'none',
              backgroundColor: activeTab === tab ? (tab === 'RANDOM' ? colors.accent : colors.primary) : colors.cardBg,
              color: activeTab === tab ? 'white' : colors.textSub,
              boxShadow: activeTab === tab ? '0 4px 10px rgba(0,0,0,0.15)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            {tab === 'EQ' ? '🎛️ EQ 목록' : tab === 'SINE' ? '⚡ 사인파 목록' : tab === 'EFFECTOR' ? '🎨 이펙터 목록' : '🎲 RANDOM'}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* 현재 게임 라운드 현황 인디케이터 바 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.cardBg, padding: '12px 16px', borderRadius: '10px', border: `1px solid ${colors.border}`, fontSize: '13px', fontWeight: '700' }}>
          <span style={{ color: colors.textSub }}>🧩 진행 라운드 상태</span>
          <span style={{ color: colors.primary, fontSize: '15px' }}>{currentQuestionNo} / 20 문제</span>
        </div>

        {/* 디지털 출력 현황 피드백 보드 */}
        <div style={{ padding: '15px', backgroundColor: isDark ? '#181c26' : '#eef2f7', borderLeft: `4px solid ${colors.primary}`, borderRadius: '8px', fontSize: '13.5px', fontWeight: '500' }}>
          <div>
            {activeTab === 'RANDOM' && isPlaying && <span style={{ marginRight: '6px', padding: '2px 6px', borderRadius: '4px', backgroundColor: colors.accent, color: 'white', fontSize: '11px', fontWeight: '800' }}>{randomActualTab} 문제 출제됨</span>}
            {feedback}
          </div>
        </div>

        {/* 메인 제어 오디오 스위치 */}
        <section style={{ backgroundColor: colors.cardBg, borderRadius: '12px', padding: '16px', border: `1px solid ${colors.border}` }}>
          <button 
            onClick={togglePlayPause} 
            style={{ 
              position: 'relative', width: '100%', padding: '18px', fontSize: '16px', fontWeight: '800', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', overflow: 'hidden',
              background: isPlaying && isPreviewStage 
                ? `linear-gradient(to right, #0d47a1 ${progress}%, #2c303d ${progress}%)`
                : isPlaying ? '#3b4252' : colors.primary,
              boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
            }}
          >
            <span style={{ position: 'relative', zIndex: 3 }}>
              {isPlaying && !isReplayingWrong ? '■ 문제 정지 및 리셋' : '▶ 문제재생'}
            </span>
          </button>
        </section>

        {/* 재생 시그널 소스 제어판 (사인파 모드 혹은 랜덤모드 분기가 아닐 때 노출) */}
        {activeTab !== 'SINE' && activeTab !== 'RANDOM' && (
          <section style={{ backgroundColor: colors.cardBg, borderRadius: '12px', padding: '18px', border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: isSourcePanelVisible ? `1px solid ${colors.border}` : 'none', paddingBottom: isSourcePanelVisible ? '12px' : '0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ fontWeight: '700', color: colors.textSub }}>🎵 재생 시그널 소스</span>
              </div>
              <button 
                onClick={() => setIsSourcePanelVisible(!isSourcePanelVisible)}
                style={{ padding: '4px 10px', fontSize: '11.5px', fontWeight: '700', backgroundColor: isDark ? '#222733' : '#e2e8f0', color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer' }}
              >
                {isSourcePanelVisible ? '👁️ 소스 가리기' : '👁️ 소스 펼치기'}
              </button>
            </div>

            {isSourcePanelVisible && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* 🛠️ 개선: 와이드 박스 스타일 토글 스위치 인터페이스 디자인 */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => { stopAllAudio(); setSource('music'); }}
                    style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: '700', borderRadius: '8px', border: 'none', cursor: 'pointer', backgroundColor: source === 'music' ? colors.primary : colors.btnDefault, color: source === 'music' ? 'white' : colors.textMain }}
                  >
                    🎶 외부 음원 트랙 소스 가동
                  </button>
                  <button 
                    onClick={() => { stopAllAudio(); setSource('pink'); }}
                    style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: '700', borderRadius: '8px', border: 'none', cursor: 'pointer', backgroundColor: source === 'pink' ? colors.primary : colors.btnDefault, color: source === 'pink' ? 'white' : colors.textMain }}
                  >
                    🔊 핑크 노이즈(Pink Noise) 가동
                  </button>
                </div>

                {source === 'music' && (
                  <div 
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    style={{ padding: '18px', backgroundColor: colors.innerBox, borderRadius: '8px', border: `2px dashed ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '12px', transition: 'all 0.2s ease', textAlign: 'center' }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: colors.textSub, fontWeight: '600' }}>🖥️ 오디오 파일을 여기로 드래그 앤 드롭 하거나 클릭하여 선택하세요.</span>
                      <input type="file" accept="audio/*" onChange={handleFileUpload} style={{ fontSize: '12px', color: colors.textSub, margin: '0 auto' }} />
                      {uploadedFileName && <span style={{ fontSize: '12px', color: colors.primary, fontWeight: '800' }}>✔ 적재 완료: {uploadedFileName}</span>}
                    </div>
                    
                    {peaks.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', fontWeight: '600' }}>
                          <span style={{ color: colors.textMain }}>🎛️ WAVEFORM TRACK (실시간 반영 루프 루프 타임)</span>
                          <span style={{ color: colors.primary }}>{loopStart.toFixed(1)}s ~ {loopEnd.toFixed(1)}s</span>
                        </div>
                        {/* 웨이브폼 컨테이너 및 재생 위치 커서 선 렌더링 */}
                        <div ref={waveformRef} onMouseDown={(e) => handleWaveformTouchStart(e)} style={{ position: 'relative', height: '65px', backgroundColor: colors.waveformBg, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', cursor: 'pointer', overflow: 'visible', border: `1px solid ${colors.border}`, userSelect: 'none' }}>
                          <div style={{ position: 'absolute', left: 0, width: `${(loopStart / audioDuration) * 100}%`, height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.45)', pointerEvents: 'none' }} />
                          <div style={{ position: 'absolute', right: 0, width: `${100 - (loopEnd / audioDuration) * 100}%`, height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.45)', pointerEvents: 'none' }} />
                          <div onMouseDown={(e) => { e.stopPropagation(); handleWaveformTouchStart(e, 'start'); }} style={{ position: 'absolute', left: `${(loopStart / audioDuration) * 100}%`, top: '-2px', width: '6px', height: '69px', backgroundColor: colors.accent, zIndex: 10, cursor: 'ew-resize', borderRadius: '2px' }} />
                          <div onMouseDown={(e) => { e.stopPropagation(); handleWaveformTouchStart(e, 'end'); }} style={{ position: 'absolute', left: `${(loopEnd / audioDuration) * 100}%`, top: '-2px', width: '6px', height: '69px', backgroundColor: '#ff4d4d', zIndex: 10, cursor: 'ew-resize', borderRadius: '2px' }} />
                          
                          {/* 🛠️ 실시간 재생 타임라인 커서 인터페이스 추가 */}
                          {audioDuration > 0 && (
                            <div style={{ position: 'absolute', left: `${(playbackPosition / audioDuration) * 100}%`, top: 0, width: '2px', height: '100%', backgroundColor: '#00ffff', boxShadow: '0 0 6px #00ffff', zIndex: 12, pointerEvents: 'none' }} />
                          )}

                          {peaks.map((peak, idx) => (
                            <div key={idx} style={{ width: '3px', height: `${Math.max(peak * 100, 8)}%`, backgroundColor: idx / peaks.length >= loopStart / audioDuration && idx / peaks.length <= loopEnd / audioDuration ? '#ff922b' : '#94a3b8', borderRadius: '1px' }} />
                          ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          <button onClick={() => setIsLoopEnabled(!isLoopEnabled)} style={{ padding: '6px 12px', fontSize: '11px', fontWeight: '700', backgroundColor: isLoopEnabled ? colors.primary : '#718096', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>🔁 LOOP {isLoopEnabled ? 'ON' : 'OFF'}</button>
                          <button onClick={togglePreviewPlay} style={{ padding: '6px 14px', fontSize: '11px', fontWeight: '700', backgroundColor: isPreviewPlaying ? '#e53e3e' : '#2ecc71', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{isPreviewPlaying ? '■ 정지' : '▶ 구간 미리듣기'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* 난이도 커스텀 조절 조작 패널 (이펙터 및 랜덤 탭이 아닐 때만 노출) */}
        {activeTab !== 'EFFECTOR' && activeTab !== 'RANDOM' && (
          <section style={{ backgroundColor: colors.cardBg, borderRadius: '12px', padding: '18px', border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: isFilterPanelVisible ? `1px solid ${colors.border}` : 'none', paddingBottom: isFilterPanelVisible ? '12px' : '0' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ width: '120px', fontWeight: '700', color: colors.textSub }}>🎯 대역 필터 난이도</span>
              </div>
              <button 
                onClick={() => setIsFilterPanelVisible(!isFilterPanelVisible)}
                style={{ padding: '4px 10px', fontSize: '11.5px', fontWeight: '700', backgroundColor: isDark ? '#222733' : '#e2e8f0', color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer' }}
              >
                {isFilterPanelVisible ? '👁️ 설정 가리기' : '👁️ 설정 펼치기'}
              </button>
            </div>

            {isFilterPanelVisible && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* 🛠️ 개선: 난이도 모드 변경 가로형 박스 버튼 레이아웃화 */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(['EASY', 'HARD', 'CUSTOM'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        stopAllAudio();
                        setLevel(m);
                        if (m === 'CUSTOM') setCustomSelected([...iso10Bands]);
                      }}
                      style={{ flex: 1, padding: '12px', fontSize: '12.5px', fontWeight: '800', border: 'none', borderRadius: '8px', cursor: 'pointer', backgroundColor: level === m ? colors.primary : colors.btnDefault, color: level === m ? 'white' : colors.textMain }}
                    >
                      {m} MODE
                    </button>
                  ))}
                </div>

                {level === 'CUSTOM' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '6px', height: '64px', textAlign: 'center', fontWeight: '700', fontSize: '12px' }}>
                      <div onClick={() => toggleRegion('low')} style={{ flex: 1, backgroundColor: isDark ? '#241919' : '#fff5f5', border: `1px solid ${colors.lowFreq}`, borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}><span style={{ color: colors.lowFreq }}>🔴 LOW</span></div>
                      <div onClick={() => toggleRegion('mid')} style={{ flex: 2, backgroundColor: isDark ? '#181e26' : '#ebf8ff', border: `1px solid ${colors.midFreq}`, borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}><span style={{ color: colors.midFreq }}>🔵 MID</span></div>
                      <div onClick={() => toggleRegion('high')} style={{ flex: 1.5, backgroundColor: isDark ? '#17241b' : '#f0fff4', border: `1px solid ${colors.highFreq}`, borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}><span style={{ color: colors.highFreq }}>🟢 HIGH</span></div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', backgroundColor: colors.waveformBg, padding: '8px', borderRadius: '6px' }}>
                      {iso31Bands.map(b => {
                        const isChecked = customSelected.includes(b);
                        const activeColor = getFreqRegion(b) === 'low' ? colors.lowFreq : getFreqRegion(b) === 'mid' ? colors.midFreq : colors.highFreq;
                        return (
                          <span key={b} style={{ fontSize: '10px', padding: '3px 6px', borderRadius: '4px', backgroundColor: isChecked ? activeColor : (isDark ? '#1e222b' : '#e2e8f0'), color: isChecked ? '#000' : colors.textMain, fontWeight: '700', cursor: 'pointer' }}
                                onClick={() => {
                                  let next = isChecked ? customSelected.filter(x => x !== b) : [...customSelected, b];
                                  setCustomSelected(next.sort((x, y) => parseFreq(x) - parseFreq(y)));
                                }}>{b}</span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === 'EQ' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
                    {/* 🛠️ 개선: EQ 변형 성향 제어 와이드 박스화 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontWeight: '700', color: colors.textSub, fontSize: '12px' }}>⚙️ EQ 변형 성향 스위치</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {(['boost', 'cut', 'random'] as const).map((em) => (
                          <button
                            key={em}
                            onClick={() => setEqMode(em)}
                            style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: '700', border: 'none', borderRadius: '6px', cursor: 'pointer', backgroundColor: eqMode === em ? colors.accent : colors.btnDefault, color: eqMode === em ? 'white' : colors.textMain }}
                          >
                            {em.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 🛠️ 개선: 변형 폭 제어 와이드 박스화 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                      <span style={{ fontWeight: '700', color: colors.textSub, fontSize: '12px' }}>🎚️ 피크 변형 폭(Gain Magnitude)</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {(['12', '6'] as const).map((g) => (
                          <button
                            key={g}
                            onClick={() => setGainAmt(g)}
                            style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: '700', border: 'none', borderRadius: '6px', cursor: 'pointer', backgroundColor: gainAmt === g ? colors.primary : colors.btnDefault, color: gainAmt === g ? 'white' : colors.textMain }}
                          >
                            ±{g} dB 변형 제어
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* 하단 정답 선택 패널 보드 */}
        <section style={{ backgroundColor: colors.cardBg, borderRadius: '12px', padding: '18px', border: `1px solid ${colors.border}` }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: '13px', fontWeight: '700', color: colors.textSub }}>
            {(activeTab === 'EFFECTOR' || (activeTab === 'RANDOM' && randomActualTab === 'EFFECTOR')) ? '🎯 정답 선택 (이펙터 매칭 패널)' : '🎯 정답 선택 (주파수 대역 매트릭스)'}
          </h3>
          
          {(activeTab === 'EFFECTOR' || (activeTab === 'RANDOM' && randomActualTab === 'EFFECTOR')) ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {effectorList.map((eff) => {
                const isSelected = selectedEffector === eff;
                return (
                  <button key={eff} onClick={() => setSelectedEffector(eff)} style={{ padding: '14px 2px', backgroundColor: isSelected ? colors.accent : colors.btnDefault, color: isSelected ? 'white' : colors.textMain, border: `1px solid ${isSelected ? colors.accent : colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                    {eff}
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: level === 'EASY' ? 'repeat(5, 1fr)' : 'repeat(6, 1fr)', gap: '6px' }}>
                {getCurrentPool().map((band) => {
                  const isSelected = selectedBand === band;
                  return (
                    <button key={band} onClick={() => setSelectedBand(band)} style={{ padding: level === 'EASY' ? '14px 2px' : '10px 2px', backgroundColor: isSelected ? colors.primary : colors.btnDefault, color: isSelected ? 'white' : colors.textMain, border: `1px solid ${isSelected ? colors.primary : colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: level === 'EASY' ? '13px' : '11px', fontWeight: '600' }}>
                      {band}
                    </button>
                  );
                })}
              </div>

              {/* 🛠️ 추가 요청 사항: EQ 결과값 부호(+, - / Boost, Cut) 판별 서브 매트릭스 보드 */}
              {(activeTab === 'EQ' || (activeTab === 'RANDOM' && randomActualTab === 'EQ')) && (
                <div style={{ borderTop: `1px dashed ${colors.border}`, paddingTop: '12px' }}>
                  <span style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: colors.textSub, marginBottom: '6px' }}>🎛️ 부스트 / 컷 성향 기동 선택</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => setSelectedSign('+')} 
                      style={{ flex: 1, padding: '14px', fontSize: '15px', fontWeight: '900', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${selectedSign === '+' ? '#ff6b6b' : colors.border}`, backgroundColor: selectedSign === '+' ? '#ff6b6b' : colors.btnDefault, color: selectedSign === '+' ? 'white' : colors.textMain }}
                    >
                      ➕ BOOST (+)
                    </button>
                    <button 
                      onClick={() => setSelectedSign('-')} 
                      style={{ flex: 1, padding: '14px', fontSize: '15px', fontWeight: '900', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${selectedSign === '-' ? '#3ea6ff' : colors.border}`, backgroundColor: selectedSign === '-' ? '#3ea6ff' : colors.btnDefault, color: selectedSign === '-' ? 'white' : colors.textMain }}
                    >
                      ➖ CUT (-)
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 조작 액션 커맨드 컨트롤러 */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={handleSubmit} style={{ width: '100%', padding: '16px', fontSize: '16px', fontWeight: '800', backgroundColor: colors.accent, color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(230,126,34,0.15)' }}>
            🎯 정답 제출
          </button>
          
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={toggleBypass} 
              disabled={!isPlaying || activeTab === 'SINE'}
              style={{ flex: 1, padding: '14px', fontSize: '13px', fontWeight: '700', backgroundColor: !isPlaying || activeTab === 'SINE' ? (isDark ? '#1d222d' : '#e2e8f0') : isBypassActive ? colors.primary : '#4a5568', color: !isPlaying || activeTab === 'SINE' ? (isDark ? '#444d5e' : '#cbd5e0') : 'white', border: 'none', borderRadius: '10px', cursor: isPlaying && activeTab !== 'SINE' ? 'pointer' : 'not-allowed' }}
            >
              {isBypassActive ? '🔊 변형음 전환' : '🎧 원음 듣기 (Bypass)'}
            </button>

            <button 
              onClick={handleReplayWrongQuestion} 
              disabled={!wrongQuestionCache}
              style={{ 
                flex: 1, padding: '14px', fontSize: '13px', fontWeight: '700', 
                backgroundColor: !wrongQuestionCache ? (isDark ? '#1d222d' : '#e2e8f0') : isReplayingWrong ? '#e53e3e' : '#2ecc71', 
                color: !wrongQuestionCache ? (isDark ? '#444d5e' : '#cbd5e0') : 'white', 
                border: 'none', borderRadius: '10px', cursor: wrongQuestionCache ? 'pointer' : 'not-allowed'
              }}
            >
              {isReplayingWrong ? '■ 다시듣기 정지' : '🔁 틀린문제 다시듣기'}
            </button>
          </div>
        </section>

        {/* 성과 지표 알림 창 피드백 */}
        {lastResult.status !== 'idle' && (
          <section style={{ padding: '18px', borderRadius: '12px', border: `1px solid ${lastResult.status === 'correct' ? '#22543d' : '#5c2b2b'}`, backgroundColor: lastResult.status === 'correct' ? colors.successBg : (isDark ? '#2a1a1a' : '#fff5f5'), color: lastResult.status === 'correct' ? colors.successText : '#ff6b6b' }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '14.5px', fontWeight: '700' }}>
              {lastResult.status === 'correct' ? '🎉 탁월한 청각 매칭 성능입니다!' : '🤔 정밀 청음 복습 필요'}
            </h4>
            <p style={{ margin: 0, fontSize: '14.5px', fontWeight: '700' }}>{lastResult.message}</p>
          </section>
        )}

        {/* 🛠️ 추가 요청 사항: 20문항 종료 후 오답 기반 통계 리포트 및 복습 세션 진입 UI */}
        {sessionStage === 'finished' && (
          <section style={{ padding: '18px', backgroundColor: isDark ? '#1e2230' : '#ebf4ff', borderRadius: '12px', border: `1px solid ${colors.primary}`, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: colors.primary }}>📊 20문항 오디오 트레이닝 통계 리포트</h4>
            <div style={{ fontSize: '13px', color: colors.textMain }}>
              {Object.keys(wrongStats).length > 0 ? (
                <div>
                  <p style={{ margin: '0 0 8px 0' }}>가장 오답률이 높은 핵심 취약 구간 목록:</p>
                  <ul style={{ paddingLeft: '20px', margin: 0 }}>
                    {Object.entries(wrongStats).sort((a,b) => b[1]-a[1]).map(([key, count]) => (
                      <li key={key} style={{ marginBottom: '4px' }}>
                        <span style={{ fontWeight: '700', color: '#ff6b6b' }}>[{key.split('_')[0]}] {key.split('_')[1]} 대역/요소</span> — 총 {count}회 오답 검출
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p style={{ margin: 0, color: colors.successText, fontWeight: '700' }}>🥇 감탄스럽습니다! 20문항 중 오답이 존재하지 않는 완벽한 청음 스코어입니다.</p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button onClick={startReviewSession} disabled={Object.keys(wrongStats).length === 0} style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: '800', backgroundColor: colors.accent, color: 'white', border: 'none', borderRadius: '6px', cursor: Object.keys(wrongStats).length > 0 ? 'pointer' : 'not-allowed' }}>
                🔄 취약 대역 집중 재시험 (20문항)
              </button>
              <button onClick={resetFullSession} style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: '800', backgroundColor: '#718096', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                🆕 새 트레이닝 정규 세션 시작
              </button>
            </div>
          </section>
        )}

        <footer style={{ display: 'flex', justifyContent: 'space-between', padding: '2px', fontSize: '12px', fontWeight: '600', color: colors.textSub }}>
          <div>종합 청음율: <span style={{ color: colors.primary, fontWeight: '700' }}>{score.correct}</span> / {score.total} ({score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0}%)</div>
          <div>현재 연승 레코드: <span style={{ color: colors.accent, fontWeight: '700' }}>🔥 {streak}</span></div>
        </footer>

      </main>
    </div>
  );
}