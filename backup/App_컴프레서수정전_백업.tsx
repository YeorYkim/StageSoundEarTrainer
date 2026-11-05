import React, { useState, useRef, useEffect } from 'react';
import {
  iso31Bands, iso10Bands, hardBands, effectorList, toEffectorKey, pickRandom,
  formatTime, getFreqRegion, parseFreq,
} from './audio/constants';
import type { QuestionTab } from './audio/constants';
import { createPinkNoiseBuffer, createEffectorChain } from './audio/effects';

export default function App() {
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');

  // 훈련 대분류 카테고리 탭: 'EQ' | 'SINE' | 'EFFECTOR' | 'RANDOM'
  const [activeTab, setActiveTab] = useState<'EQ' | 'SINE' | 'EFFECTOR' | 'RANDOM'>('EQ');

  // 난이도 및 레이아웃 숨김 상태
  const [level, setLevel] = useState<'EASY' | 'HARD' | 'CUSTOM'>('EASY');
  const [isFilterPanelVisible, setIsFilterPanelVisible] = useState<boolean>(true);
  const [isSourcePanelVisible, setIsSourcePanelVisible] = useState<boolean>(true);
  
  // CUSTOM 모드 전환 시 초기 상태를 10밴드 카피본으로 고정
  const [customSelected, setCustomSelected] = useState<string[]>([...iso10Bands]); 
  // 기본 셋팅: EASY 모드 + BOOST + 12dB
  const [eqMode, setEqMode] = useState<'boost' | 'cut' | 'random'>('boost');

  // 이펙터 난이도 (EASY: 1개, HARD: 2개 섞임)
  const [effLevel, setEffLevel] = useState<'EASY' | 'HARD'>('EASY');

  // 미리듣기 모드 (채점 없이 소리 들어보기) / 미리듣기 중 원음 비교
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [previewBypass, setPreviewBypass] = useState<boolean>(false);

  // 지금 나온 문제의 실제 종류 (RANDOM 모드에서도 실제 종류를 기록)
  const [questionTab, setQuestionTab] = useState<QuestionTab | null>(null);
  const [gainAmt, setGainAmt] = useState<'12' | '6'>('12');
  
  // 소스 디폴트 순서 조정 (음원 -> 핑크노이즈)
  const [source, setSource] = useState<'music' | 'pink'>('music');
  
  // 스코어 시스템
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  
  const [feedback, setFeedback] = useState<string>('준비 완료. 아래 [문제 재생] 버튼을 누르면 청음이 시작됩니다.');
  const [lastResult, setLastResult] = useState<{ status: 'correct' | 'wrong' | 'idle'; message: string }>({ status: 'idle', message: '' });
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isBypassActive, setIsBypassActive] = useState<boolean>(false); 
  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  
  const [selectedEffectors, setSelectedEffectors] = useState<string[]>([]);
  // RANDOM 모드에서는 '사인파' 선택지도 있음
  const [selectedSign, setSelectedSign] = useState<'+' | '-' | 'sine' | null>(null);
  
  // 타이머 프리뷰 및 3초 Mute 카운트다운 시스템
  const [progress, setProgress] = useState<number>(0);
  const [isPreviewStage, setIsPreviewStage] = useState<boolean>(false);
  const [isProblemStage, setIsProblemStage] = useState<boolean>(false);
  const [muteCountdown, setMuteCountdown] = useState<number>(0);
  const [isMuteCounting, setIsMuteCounting] = useState<boolean>(false);

  // 4초 후 자동 다음 문제 재생 시작 옵션 (기본 ON)
  const [autoNext, setAutoNext] = useState<boolean>(true);

  // 정답 제출 및 초기 신호 세팅 락 상태
  const [isSubmitLocked, setIsSubmitLocked] = useState<boolean>(false);

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 오디오 체인 제어용 필터/이펙트 바이패스 게인 노드
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const effectNodeRef = useRef<AudioNode | null>(null); 
  const eqGainNodeRef = useRef<GainNode | null>(null);
  const bypassGainNodeRef = useRef<GainNode | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const limiterNodeRef = useRef<DynamicsCompressorNode | null>(null);

  const userAudioBufferRef = useRef<AudioBuffer | null>(null);
  const previewSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const timerIdRef = useRef<any>(null);
  const muteTimerIdRef = useRef<any>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<'start' | 'end' | null>(null);
  const touchDragRef = useRef<"start" | "end" | null>(null);

  // 자동 다음 문제 타이머 추적용 Ref
  const autoNextTimerRef = useRef<any>(null);

  // 이펙터 안의 LFO(흔들림 발생기) 등 정지가 필요한 노드 모음
  const activeLfosRef = useRef<OscillatorNode[]>([]);
  // 문제 구간에서 음원을 루프 시작점부터 다시 틀기 위한 함수
  const restartSourceRef = useRef<(() => void) | null>(null);
  // 같은 문제가 연속으로 나오지 않게 직전 문제 기억
  const lastQuestionKeyRef = useRef<string>('');

  // 미리듣기 회로
  const previewSlotInRef = useRef<GainNode | null>(null);
  const previewOutRef = useRef<GainNode | null>(null);
  const previewLimiterRef = useRef<DynamicsCompressorNode | null>(null);
  const previewProcNodeRef = useRef<AudioNode | null>(null);
  const previewLfosRef = useRef<OscillatorNode[]>([]);
  const previewBufferRef = useRef<AudioBuffer | null>(null);
  const previewIsMusicRef = useRef<boolean>(false);
  const sineToneRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  // 재생 커서 잡고 움직이기
  const seekQuizRef = useRef<((pos: number) => void) | null>(null);
  const scrubRef = useRef<{ lastSeek: number; x: number } | null>(null);

  // 재생 위치 표시 막대 (아이폰처럼 세로 막대)
  const playheadRef = useRef<{ pos: number; last: number; loop: boolean } | null>(null);
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const playheadTimeElRef = useRef<HTMLSpanElement | null>(null);

  // State Closure를 예방하기 위한 Dynamic Refs 정의
  const isLoopEnabledRef = useRef<boolean>(isLoopEnabled);
  const loopStartRef = useRef<number>(loopStart);
  const loopEndRef = useRef<number>(loopEnd);

  useEffect(() => {
    isLoopEnabledRef.current = isLoopEnabled;
  }, [isLoopEnabled]);

  useEffect(() => {
    loopStartRef.current = loopStart;
  }, [loopStart]);

  useEffect(() => {
    loopEndRef.current = loopEnd;
  }, [loopEnd]);

  // 루프 설정을 문제 재생 중인 음원 + 미리듣기 음원 모두에 실시간 반영
  const getMusicNodes = () => {
    const list: AudioBufferSourceNode[] = [];
    if (sourceNodeRef.current && sourceNodeRef.current.buffer === userAudioBufferRef.current) list.push(sourceNodeRef.current);
    if (previewSourceNodeRef.current) list.push(previewSourceNodeRef.current);
    return list;
  };

  useEffect(() => {
    getMusicNodes().forEach(n => { n.loop = isLoopEnabled; });
    if (playheadRef.current) playheadRef.current.loop = isLoopEnabled;
  }, [isLoopEnabled]);

  useEffect(() => {
    getMusicNodes().forEach(n => { n.loopStart = loopStart; });
  }, [loopStart]);

  useEffect(() => {
    getMusicNodes().forEach(n => { n.loopEnd = loopEnd; });
  }, [loopEnd]);

  // 재생 위치 막대를 화면 새로고침 주기에 맞춰 부드럽게 이동
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const ph = playheadRef.current;
      const ctx = audioCtxRef.current;
      const el = playheadElRef.current;
      const timeEl = playheadTimeElRef.current;
      const duration = userAudioBufferRef.current?.duration || 0;
      let visiblePos: number | null = null;

      if (ph && ctx && duration > 0) {
        const now = ctx.currentTime;
        let pos = ph.pos + (now - ph.last);
        ph.last = now;
        if (ph.loop) {
          const ls = loopStartRef.current;
          const le = loopEndRef.current;
          const len = le - ls;
          if (len > 0 && pos >= le) pos = ls + ((pos - le) % len);
        }
        ph.pos = pos;
        if (pos <= duration) visiblePos = pos;
      }

      if (el) {
        if (visiblePos !== null) {
          el.style.display = 'block';
          el.style.left = `${(visiblePos / duration) * 100}%`;
        } else {
          el.style.display = 'none';
        }
      }
      if (timeEl) {
        timeEl.textContent = visiblePos !== null ? `▶ ${formatTime(visiblePos)}` : '';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startPlayhead = (offset: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    playheadRef.current = { pos: offset, last: ctx.currentTime, loop: isLoopEnabledRef.current };
  };

  useEffect(() => {
    const resumeAudioOnVisibility = async () => {
      if (document.visibilityState === 'visible' && audioCtxRef.current) {
        if (audioCtxRef.current.state === 'suspended') {
          try {
            await audioCtxRef.current.resume();
          } catch (e) {
            console.warn("Visibility change resume failed:", e);
          }
        }
      }
    };
    
    document.addEventListener('visibilitychange', resumeAudioOnVisibility);
    window.addEventListener('focus', resumeAudioOnVisibility);

    return () => { 
      document.removeEventListener('visibilitychange', resumeAudioOnVisibility);
      window.removeEventListener('focus', resumeAudioOnVisibility);
      if (timerIdRef.current) clearInterval(timerIdRef.current); 
      if (muteTimerIdRef.current) clearInterval(muteTimerIdRef.current);
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      stopAllAudio();
    };
  }, []);

  const ensureAudioContext = async (): Promise<AudioContext> => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx;
  };

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

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement> | { target: { files: FileList } }
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const ctx = await ensureAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      userAudioBufferRef.current = audioBuffer;

      setAudioDuration(audioBuffer.duration);
      setLoopStart(0);
      setLoopEnd(audioBuffer.duration);
      setUploadedFileName(file.name);
      generatePeaks(audioBuffer);
      setSource("music");
      setFeedback(` ${file.name} 불러오기 완료`);
    } catch (err) {
      console.error(err);
      setFeedback(" 이 기기에서 지원하지 않는 음원입니다.");
    }
  };

  const getCurrentPool = () => {
    if (level === 'EASY') return iso10Bands;
    if (level === 'HARD') return hardBands;
    return [...customSelected].sort((a, b) => parseFreq(a) - parseFreq(b));
  };

  // ───────── 미리듣기 (채점 없이 소리만 들어보기) ─────────
  // 지금 선택된 버튼에 맞는 "미리듣기 효과"를 계산
  type PreviewProc =
    | { kind: 'none' }
    | { kind: 'eq'; band: string; gain: number; q: number }
    | { kind: 'fx'; key: string };

  const getPreviewProc = (): PreviewProc => {
    if (!isPreviewMode || previewBypass) return { kind: 'none' };
    if ((activeTab === 'EFFECTOR' || activeTab === 'RANDOM') && selectedEffectors.length > 0) {
      return { kind: 'fx', key: toEffectorKey(selectedEffectors) };
    }
    if ((activeTab === 'EQ' || activeTab === 'RANDOM') && selectedBand && selectedSign !== 'sine') {
      const mag = parseFloat(gainAmt);
      let sign = 1;
      if (activeTab === 'RANDOM' || eqMode === 'random') sign = selectedSign === '-' ? -1 : 1;
      else sign = eqMode === 'cut' ? -1 : 1;
      return { kind: 'eq', band: selectedBand, gain: sign * mag, q: level === 'EASY' ? 1.0 : 4.3 };
    }
    return { kind: 'none' };
  };

  const describePreviewProc = (proc: PreviewProc) => {
    if (proc.kind === 'eq') return `${proc.gain >= 0 ? '+' : ''}${proc.gain}dB @ ${proc.band} 적용 중`;
    if (proc.kind === 'fx') return `${proc.key.split('+').join(' + ')} 적용 중`;
    return '원음 재생 중 (선택한 효과 없음)';
  };

  // 미리듣기 회로에 효과 끼우기 (재생 중에 바꾸면 살짝 페이드하며 교체)
  const applyPreviewProc = (proc: PreviewProc, withFade: boolean) => {
    const ctx = audioCtxRef.current;
    const slot = previewSlotInRef.current;
    const out = previewOutRef.current;
    if (!ctx || !slot || !out) return;

    const swap = () => {
      if (previewSlotInRef.current !== slot) return; // 그 사이 정지됨
      slot.disconnect();
      previewLfosRef.current.forEach(l => { try { l.stop(); } catch (e) {} l.disconnect(); });
      previewLfosRef.current = [];
      if (previewProcNodeRef.current) {
        try { previewProcNodeRef.current.disconnect(); } catch (e) {}
        previewProcNodeRef.current = null;
      }

      if (proc.kind === 'eq') {
        const f = ctx.createBiquadFilter();
        f.type = 'peaking';
        f.frequency.value = parseFreq(proc.band);
        f.Q.value = proc.q;
        f.gain.value = proc.gain;
        slot.connect(f);
        f.connect(out);
        previewProcNodeRef.current = f;
      } else if (proc.kind === 'fx') {
        const chain = createEffectorChain(ctx, proc.key);
        slot.connect(chain.input);
        chain.output.connect(out);
        previewLfosRef.current = chain.lfos;
        previewProcNodeRef.current = chain.output;
      } else {
        slot.connect(out);
      }
    };

    if (!withFade) { swap(); return; }
    const g = out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + 0.03);
    setTimeout(() => {
      swap();
      if (previewOutRef.current !== out) return;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(0, ctx.currentTime);
      g.linearRampToValueAtTime(1, ctx.currentTime + 0.05);
    }, 40);
  };

  // 미리듣기 음원을 원하는 위치(offset)부터 재생
  const startPreviewSourceAt = (offset: number) => {
    const ctx = audioCtxRef.current;
    const slot = previewSlotInRef.current;
    const buffer = previewBufferRef.current;
    if (!ctx || !slot || !buffer) return;
    const isMusic = previewIsMusicRef.current;

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    if (isMusic) {
      node.loop = isLoopEnabledRef.current;
      node.loopStart = loopStartRef.current;
      node.loopEnd = loopEndRef.current;
    } else {
      node.loop = true;
    }
    node.connect(slot);
    node.start(0, offset);
    node.onended = () => {
      if (previewSourceNodeRef.current === node) stopPreviewAudio();
    };

    const old = previewSourceNodeRef.current;
    previewSourceNodeRef.current = node;
    if (old) {
      try { old.stop(); } catch (e) {}
      old.disconnect();
    }
    if (isMusic) startPlayhead(offset);
  };

  const startPreview = async () => {
    stopAudio();
    stopPreviewAudio();
    // RANDOM에서 '사인파'를 듣던 중이면 사인파는 끄고 음원 미리듣기로
    if (sineToneRef.current) {
      stopSinePreview();
      if (selectedSign === 'sine') setSelectedSign(null);
      if (activeTab === 'SINE') setSelectedBand(null);
    }

    let ctx: AudioContext;
    try { ctx = await ensureAudioContext(); } catch (e) { return; }

    const isMusic = source === 'music';
    const buffer = isMusic ? userAudioBufferRef.current : createPinkNoiseBuffer(ctx);
    if (!buffer) {
      setFeedback(' 아래 시그널 소스 패널에서 음원 파일을 먼저 업로드해 주세요.');
      return;
    }

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.05;
    limiter.connect(ctx.destination);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.1);
    out.connect(limiter);
    const slot = ctx.createGain();

    previewLimiterRef.current = limiter;
    previewOutRef.current = out;
    previewSlotInRef.current = slot;
    previewBufferRef.current = buffer;
    previewIsMusicRef.current = isMusic;

    const proc = getPreviewProc();
    applyPreviewProc(proc, false);
    startPreviewSourceAt(isMusic ? loopStartRef.current : 0);
    setIsPreviewPlaying(true);
    setFeedback(isPreviewMode
      ? ` [미리듣기] ${describePreviewProc(proc)}. 재생 중에 버튼을 바꾸면 바로 반영돼요.`
      : ' [미리듣기] 설정한 구간을 이펙트 없는 오리지널 상태로 모니터링 중입니다.');
  };

  const togglePreviewPlay = async () => {
    if (isPreviewPlaying) {
      stopPreviewAudio();
      return;
    }
    await startPreview();
  };

  const stopPreviewAudio = () => {
    const ctx = audioCtxRef.current;
    const node = previewSourceNodeRef.current;
    const out = previewOutRef.current;
    const limiter = previewLimiterRef.current;
    const slot = previewSlotInRef.current;
    const lfos = previewLfosRef.current;
    previewSourceNodeRef.current = null;
    previewOutRef.current = null;
    previewLimiterRef.current = null;
    previewSlotInRef.current = null;
    previewProcNodeRef.current = null;
    previewLfosRef.current = [];

    if (node || out) {
      if (ctx && out) {
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
        out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
      }
      setTimeout(() => {
        if (node) { try { node.stop(); } catch (e) {} node.disconnect(); }
        lfos.forEach(l => { try { l.stop(); } catch (e) {} l.disconnect(); });
        if (slot) slot.disconnect();
        if (out) out.disconnect();
        if (limiter) limiter.disconnect();
      }, 90);
      playheadRef.current = null;
    }
    setIsPreviewPlaying(false);
    setPreviewBypass(false);
  };

  // 사인파 미리듣기 (버튼 누르면 그 주파수, 다시 누르면 꺼짐)
  const startSinePreview = async (band: string) => {
    let ctx: AudioContext;
    try { ctx = await ensureAudioContext(); } catch (e) { return; }
    const freq = parseFreq(band);
    if (sineToneRef.current) {
      sineToneRef.current.osc.frequency.setValueAtTime(freq, ctx.currentTime);
      return;
    }
    stopAudio();
    stopPreviewAudio();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    sineToneRef.current = { osc, gain };
  };

  const stopSinePreview = () => {
    const tone = sineToneRef.current;
    const ctx = audioCtxRef.current;
    if (!tone || !ctx) return;
    sineToneRef.current = null;
    tone.gain.gain.cancelScheduledValues(ctx.currentTime);
    tone.gain.gain.setValueAtTime(tone.gain.gain.value, ctx.currentTime);
    tone.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
    setTimeout(() => {
      try { tone.osc.stop(); } catch (e) {}
      tone.osc.disconnect();
      tone.gain.disconnect();
    }, 70);
  };

  // 선택이 바뀌면 재생 중인 미리듣기에 바로 반영
  const previewProcKey = JSON.stringify(getPreviewProc());
  useEffect(() => {
    if (!previewSlotInRef.current) return;
    const proc = getPreviewProc();
    applyPreviewProc(proc, true);
    if (isPreviewMode) setFeedback(` [미리듣기] ${describePreviewProc(proc)}.`);
  }, [previewProcKey]);

  // 사인파 미리듣기 대상 (사인파 목록, 또는 RANDOM에서 '사인파' 선택 시)
  const sinePreviewBand =
    isPreviewMode && selectedBand && (activeTab === 'SINE' || (activeTab === 'RANDOM' && selectedSign === 'sine'))
      ? selectedBand
      : null;
  useEffect(() => {
    if (sinePreviewBand) {
      startSinePreview(sinePreviewBand);
      setFeedback(` [미리듣기] 사인파 ${sinePreviewBand} 재생 중. 같은 버튼을 다시 누르면 꺼져요.`);
    } else {
      if (sineToneRef.current && isPreviewMode) setFeedback(' [미리듣기] 사인파를 껐어요.');
      stopSinePreview();
    }
  }, [sinePreviewBand]);

  // 미리듣기 모드 켜기/끄기
  const togglePreviewMode = () => {
    const next = !isPreviewMode;
    clearCurrentQuestion(next
      ? ' 🎧 미리듣기 모드: 채점 없이 버튼을 눌러 소리를 들어볼 수 있어요.'
      : ' 문제 모드로 돌아왔어요. [문제 재생]을 눌러주세요.');
    setPreviewBypass(false);
    setIsPreviewMode(next);
  };

  // ───────── 재생 커서 잡고 움직이기 (그 위치로 노래 이동) ─────────
  const seekTo = (pos: number) => {
    if (previewSourceNodeRef.current && previewIsMusicRef.current) {
      startPreviewSourceAt(pos);
      return;
    }
    if (seekQuizRef.current) seekQuizRef.current(pos);
  };

  const scrubAt = (clientX: number, final: boolean) => {
    const wf = waveformRef.current;
    const duration = userAudioBufferRef.current?.duration || 0;
    const scrub = scrubRef.current;
    if (!wf || duration === 0 || !scrub) return;
    const rect = wf.getBoundingClientRect();
    let pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
    if (isLoopEnabledRef.current) {
      pos = Math.max(loopStartRef.current, Math.min(pos, loopEndRef.current - 0.05));
    } else {
      pos = Math.min(pos, duration - 0.05);
    }
    scrub.x = clientX;
    const ctx = audioCtxRef.current;
    if (playheadRef.current && ctx) {
      playheadRef.current.pos = pos;
      playheadRef.current.last = ctx.currentTime;
    }
    const now = performance.now();
    if (final || now - scrub.lastSeek > 120) {
      scrub.lastSeek = now;
      seekTo(pos);
    }
  };

  useEffect(() => {
    const move = (e: MouseEvent) => { if (scrubRef.current) { e.preventDefault(); scrubAt(e.clientX, false); } };
    const up = (e: MouseEvent) => { if (scrubRef.current) { scrubAt(e.clientX, true); scrubRef.current = null; } };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const stopAllAudio = () => {
    stopAudio();
    stopPreviewAudio();
    stopSinePreview();
    if (muteTimerIdRef.current) {
      clearInterval(muteTimerIdRef.current);
      muteTimerIdRef.current = null;
    }
    setIsMuteCounting(false);
  };

  const resetProblemState = () => {
    clearCurrentQuestion('소스 트랙이 변경되어 활성화된 문제가 초기화되었습니다.');
  };

  // 지금 문제를 없애고 처음 상태로 (난이도/소스 변경 시)
  const clearCurrentQuestion = (message: string) => {
    stopAllAudio();
    currentAnswerRef.current = null;
    setQuestionTab(null);
    setSelectedBand(null);
    setSelectedEffectors([]);
    setSelectedSign(null);
    setIsReplayingWrong(false);
    setIsSubmitLocked(false);
    setWrongQuestionCache(null);
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setFeedback(message);
  };

  // 정답을 사람이 읽기 좋은 글자로
  const describeAnswer = (tab: QuestionTab, target: string, gain: number) => {
    if (tab === 'EQ') return `${gain >= 0 ? '+' : '-'}${target}`;
    if (tab === 'EFFECTOR') return target.split('+').join(' + ');
    return target;
  };

  const tabLabel = (tab: QuestionTab) => (tab === 'EQ' ? 'EQ' : tab === 'SINE' ? '사인파' : '이펙터');

  // ───────── 재생 핵심 ─────────
  const playAudioCore = async (modeType: QuestionTab, target: string, appliedGain: number, targetLevel: 'EASY' | 'HARD' | 'CUSTOM', isReplayMode: boolean) => {
    stopAudio();
    if (muteTimerIdRef.current) {
      clearInterval(muteTimerIdRef.current);
      muteTimerIdRef.current = null;
    }
    setIsMuteCounting(false);
    setIsProblemStage(false);

    let ctx: AudioContext;
    try {
      ctx = await ensureAudioContext();
    } catch (err) {
      console.error("AudioContext initialization failed:", err);
      setFeedback("오디오 장치를 활성화하지 못했습니다. 화면을 한 번 터치한 후 다시 시도해 주세요.");
      setIsSubmitLocked(false);
      return;
    }

    if (!isReplayMode) {
      currentAnswerRef.current = target;
      currentAppliedGainRef.current = appliedGain;
      setQuestionTab(modeType);
      setIsReplayingWrong(false);
    } else {
      setIsReplayingWrong(true);
    }

    const safetyLimiter = ctx.createDynamicsCompressor();
    safetyLimiter.threshold.setValueAtTime(-4, ctx.currentTime);
    safetyLimiter.knee.setValueAtTime(0, ctx.currentTime);
    safetyLimiter.ratio.setValueAtTime(20, ctx.currentTime);
    safetyLimiter.attack.setValueAtTime(0.003, ctx.currentTime);
    safetyLimiter.release.setValueAtTime(0.05, ctx.currentTime);
    safetyLimiter.connect(ctx.destination);
    limiterNodeRef.current = safetyLimiter;

    const masterGain = ctx.createGain();
    // Fade-in 적용 (0에서 시작해 0.15초 동안 1.0으로 램프)
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.15);
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
    setIsSubmitLocked(false);
    setIsBypassActive(false);
    setSessionStage('playing');

    if (modeType === 'SINE') {
      setIsPreviewStage(false);
      setIsProblemStage(false);
      setProgress(100);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = parseFreq(target);
      const sineVol = ctx.createGain();
      sineVol.gain.value = 0.12;
      osc.connect(sineVol);
      sineVol.connect(eqGain);
      osc.start(0);
      oscillatorNodeRef.current = osc;

      setFeedback(isReplayMode
        ? ` [오답 다시듣기] 사인파(${target}) 재생 중.`
        : ' [순수 사인파] 단일 주파수 발생 중. 주파수를 고르고 정답 제출! (안 고르고 누르면 소리가 멈춰요)');
      setIsSubmitLocked(false);
      return;
    }

    // ── 음원(또는 핑크노이즈) 준비 ──
    const isMusic = source === 'music';
    const sourceBuffer = isMusic ? userAudioBufferRef.current : createPinkNoiseBuffer(ctx);
    if (!sourceBuffer) {
      setFeedback(' 아래 시그널 소스 패널에서 음원 파일을 먼저 업로드해 주세요.');
      stopAudio();
      return;
    }

    // ── 변형(EQ 또는 이펙터) 회로 준비 ──
    let processInput: AudioNode;
    let filter: BiquadFilterNode | null = null;
    if (modeType === 'EQ') {
      filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = parseFreq(target);
      filter.Q.value = targetLevel === 'HARD' || targetLevel === 'CUSTOM' ? 4.3 : 1.0;
      filter.gain.value = 0;
      filter.connect(eqGain);
      filterNodeRef.current = filter;
      processInput = filter;
    } else {
      const chain = createEffectorChain(ctx, target);
      chain.output.connect(eqGain);
      activeLfosRef.current = chain.lfos;
      effectNodeRef.current = chain.input;
      processInput = chain.input;
    }

    // 음원을 원하는 위치부터 틀어주는 함수 (기본: 루프 시작점 → 원음/문제 모두 같은 지점에서 시작)
    const startSourceAt = (startOffset?: number) => {
      const old = sourceNodeRef.current;
      if (old) {
        try { old.stop(); } catch (e) {}
        old.disconnect();
      }
      const node = ctx.createBufferSource();
      node.buffer = sourceBuffer;
      if (isMusic) {
        node.loop = isLoopEnabledRef.current;
        node.loopStart = loopStartRef.current;
        node.loopEnd = loopEndRef.current;
      } else {
        node.loop = true;
      }
      node.connect(processInput);
      node.connect(bypassGain);
      const offset = isMusic ? (startOffset ?? loopStartRef.current) : 0;
      node.start(0, offset);
      sourceNodeRef.current = node;
      if (isMusic) startPlayhead(offset); else playheadRef.current = null;
    };
    const startSourceAtLoopStart = () => startSourceAt();
    restartSourceRef.current = startSourceAtLoopStart;
    seekQuizRef.current = isMusic ? (pos: number) => startSourceAt(pos) : null;
    startSourceAtLoopStart();

    // 변형된 소리로 바꾸기 / 원음으로 바꾸기
    const applyProcessed = () => {
      if (modeType === 'EQ' && filterNodeRef.current) {
        filterNodeRef.current.gain.setValueAtTime(appliedGain, ctx.currentTime);
      } else {
        bypassGain.gain.setValueAtTime(0, ctx.currentTime);
        eqGain.gain.setValueAtTime(1, ctx.currentTime);
        setIsBypassActive(false);
      }
    };
    if (modeType === 'EFFECTOR') {
      // 원음 구간에서는 이펙터를 거치지 않은 원음만
      eqGain.gain.setValueAtTime(0, ctx.currentTime);
      bypassGain.gain.setValueAtTime(1, ctx.currentTime);
    }

    if (isReplayMode) {
      applyProcessed();
      setProgress(100);
      setIsPreviewStage(false);
      setIsProblemStage(false);
      setFeedback(modeType === 'EQ'
        ? ` [오답 다시듣기] 변형 사운드(${describeAnswer('EQ', target, appliedGain)}) 재생 중.`
        : ` [오답 다시듣기] 이펙터(${describeAnswer('EFFECTOR', target, 0)}) 재생 중.`);
      setIsSubmitLocked(false);
      return;
    }

    // ── 1단계: 원음 듣기 ──
    const intervalMs = 50;
    const previewMs = isMusic ? 10000 : 5000;
    const problemMs = modeType === 'EFFECTOR' && !isMusic ? 5000 : 10000;
    const label = modeType === 'EQ' ? '정답 대역 분석을 위해' : '이펙터 적용을 위해';

    setIsPreviewStage(true);
    setIsProblemStage(false);
    setProgress(0);
    setFeedback(` 원음 청음 중 (${previewMs / 1000}초)`);

    let currentMs = 0;
    if (timerIdRef.current) clearInterval(timerIdRef.current);
    timerIdRef.current = setInterval(() => {
      currentMs += intervalMs;
      setProgress(Math.min((currentMs / previewMs) * 100, 100));
      if (currentMs < previewMs) return;

      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
      setIsPreviewStage(false);

      // ── 2단계: 3초 음소거 ──
      setIsMuteCounting(true);
      setMuteCountdown(3);
      if (masterGainNodeRef.current) {
        const g = masterGainNodeRef.current.gain;
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(g.value, ctx.currentTime);
        g.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
      }
      setFeedback(` ${label} 3초간 음소거됩니다... (3)`);

      let count = 3;
      muteTimerIdRef.current = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setMuteCountdown(count);
          setFeedback(` ${label} 3초간 음소거됩니다... (${count})`);
          return;
        }
        clearInterval(muteTimerIdRef.current);
        muteTimerIdRef.current = null;
        setIsMuteCounting(false);
        if (!masterGainNodeRef.current) return; // 그 사이 정지됨

        // ── 3단계: 문제 재생 (원음과 같은 지점부터 다시 시작) ──
        setIsProblemStage(true);
        startSourceAtLoopStart();
        applyProcessed();
        const g = masterGainNodeRef.current.gain;
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(0, ctx.currentTime);
        g.linearRampToValueAtTime(1.0, ctx.currentTime + 0.15);

        setFeedback(modeType === 'EQ'
          ? ` 문제 재생 중 (${problemMs / 1000}초)! 변형된 오디오 트랙을 듣고 정답을 선택 후 제출하세요.`
          : ` 문제 재생 중 (${problemMs / 1000}초)! 이펙터가 적용된 오디오 트랙을 듣고 정답을 선택하세요.`);
        setIsSubmitLocked(false);

        let elapsed = 0;
        if (timerIdRef.current) clearInterval(timerIdRef.current);
        timerIdRef.current = setInterval(() => {
          elapsed += intervalMs;
          setProgress(Math.min((elapsed / problemMs) * 100, 100));
          if (elapsed < problemMs) return;
          clearInterval(timerIdRef.current);
          timerIdRef.current = null;
          if (masterGainNodeRef.current) {
            const mg = masterGainNodeRef.current.gain;
            mg.cancelScheduledValues(ctx.currentTime);
            mg.setValueAtTime(mg.value, ctx.currentTime);
            mg.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
          }
          setTimeout(() => {
            stopAudio();
            setFeedback(' 문제 재생이 끝났습니다. 정답을 선택하고 [정답 제출]을 눌러주세요.');
          }, 200);
        }, intervalMs);
      }, 1000);
    }, intervalMs);
  };

  // ───────── 문제 만들기 ─────────
  const buildQuestion = (forcedTab?: QuestionTab, forcedTarget?: string):
    { tab: QuestionTab; target: string; gain: number } | { error: string } => {

    let tab: QuestionTab;
    if (forcedTab) tab = forcedTab;
    else if (activeTab === 'RANDOM') {
      // RANDOM: EQ 40% / 이펙터 40% / 사인파 20%
      const r = Math.random();
      tab = r < 0.4 ? 'EQ' : r < 0.8 ? 'EFFECTOR' : 'SINE';
    } else tab = activeTab;

    const makeOne = (): { tab: QuestionTab; target: string; gain: number } | { error: string } => {
      if (tab === 'EFFECTOR') {
        if (forcedTarget) return { tab, target: forcedTarget, gain: 0 };
        if (effLevel === 'EASY') return { tab, target: pickRandom(effectorList), gain: 0 };
        const a = pickRandom(effectorList);
        const b = pickRandom(effectorList.filter(x => x !== a));
        return { tab, target: toEffectorKey([a, b]), gain: 0 };
      }
      const pool = getCurrentPool();
      if (pool.length === 0) return { error: ' CUSTOM 모드에 지정된 주파수가 없습니다. 대역을 선택해 주세요.' };
      const target = forcedTarget || pickRandom(pool);
      if (tab === 'SINE') return { tab, target, gain: 0 };

      let gain = parseFloat(gainAmt);
      const mode = activeTab === 'RANDOM' ? 'random' : eqMode;
      if (mode === 'cut') gain = -gain;
      if (mode === 'random' && Math.random() < 0.5) gain = -gain;
      return { tab, target, gain };
    };

    // 직전 문제와 똑같은 문제는 피하기 (최대 6번 다시 뽑기)
    let q = makeOne();
    for (let i = 0; i < 6 && !forcedTarget && !('error' in q); i++) {
      const key = `${q.tab}_${q.target}_${Math.sign(q.gain)}`;
      if (key !== lastQuestionKeyRef.current) break;
      q = makeOne();
    }
    if (!('error' in q)) lastQuestionKeyRef.current = `${q.tab}_${q.target}_${Math.sign(q.gain)}`;
    return q;
  };

  // 새 문제 시작 (문제 재생 버튼 / 자동 다음 문제 / 재시험 공통)
  const startNewQuestion = async (forcedTab?: QuestionTab, forcedTarget?: string) => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    stopAllAudio();

    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      try {
        await audioCtxRef.current.resume();
      } catch (e) {
        setFeedback('화면 잠금 등으로 오디오 가동이 차단되었습니다. 아래 [문제 재생] 버튼을 눌러주세요.');
        setIsSubmitLocked(false);
        setIsPlaying(false);
        return;
      }
    }

    const needsSource = (forcedTab || activeTab) !== 'SINE';
    if (needsSource && source === 'music' && !userAudioBufferRef.current) {
      setFeedback(' 아래 시그널 소스 패널에서 음원 파일을 먼저 업로드해 주세요.');
      return;
    }

    setSelectedBand(null);
    setSelectedEffectors([]);
    setSelectedSign(null);
    setWrongQuestionCache(null);
    setIsSubmitLocked(true);

    const q = buildQuestion(forcedTab, forcedTarget);
    if ('error' in q) {
      setFeedback(q.error);
      setIsSubmitLocked(false);
      return;
    }
    await playAudioCore(q.tab, q.target, q.gain, level, false);
  };

  const togglePlayPause = async () => {
    if (isPlaying) {
      stopAudio();
      return;
    }
    if (isSubmitLocked) return;
    if (sessionStage === 'finished') {
      resetFullSession();
    }
    await startNewQuestion();
  };

  const [sessionStage, setSessionStage] = useState<'ready' | 'playing' | 'finished'>('ready');
  const [currentQuestionNo, setCurrentQuestionNo] = useState<number>(1);
  const [wrongStats, setWrongStats] = useState<Record<string, number>>({}); 
  const [isReviewMode, setIsReviewMode] = useState<boolean>(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload({ target: { files: e.dataTransfer.files } } as any);
    }
  };
  
  const handleReplayWrongQuestion = async () => {
    if (!wrongQuestionCache) return;

    setAutoNext(false);
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }

    if (isPlaying) {
      stopAllAudio();
      if (isReplayingWrong) {
        setIsReplayingWrong(false);
        return;
      }
    }

    stopPreviewAudio();
    setIsReplayingWrong(true);
    setIsPreviewStage(false);
    setIsProblemStage(false);

    await playAudioCore(
      wrongQuestionCache.tab,
      wrongQuestionCache.target,
      wrongQuestionCache.gain || 0,
      wrongQuestionCache.level || 'EASY',
      true
    );
  };

  const toggleBypass = async () => {
    if (!isPlaying || !eqGainNodeRef.current || !bypassGainNodeRef.current) return;

    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      try { await audioCtxRef.current.resume(); } catch(e){}
    }

    if (isBypassActive) {
      eqGainNodeRef.current.gain.value = 1.0;
      bypassGainNodeRef.current.gain.value = 0.0;
      setIsBypassActive(false);
      if (!isPreviewStage && !isMuteCounting && !isProblemStage) setFeedback(' 현재 사운드: 변형 프로세서 인입 상태');
    } else {
      eqGainNodeRef.current.gain.value = 0.0;
      bypassGainNodeRef.current.gain.value = 1.0;
      setIsBypassActive(true);
      setFeedback(' 현재 사운드: 바이패스(Bypass) 순수 오리지널 상태');
    }
  };

  const stopAudio = () => {
    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
    if (muteTimerIdRef.current) {
      clearInterval(muteTimerIdRef.current);
      muteTimerIdRef.current = null;
    }
    setIsMuteCounting(false);
    // Fade-out 적용 후 정지
    if (masterGainNodeRef.current && audioCtxRef.current) {
      try {
        const ctx = audioCtxRef.current;
        const g = masterGainNodeRef.current;
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
      } catch(e){}
    }

    const currentSource = sourceNodeRef.current;
    const currentOsc = oscillatorNodeRef.current;
    const currentMaster = masterGainNodeRef.current;
    const currentLimiter = limiterNodeRef.current;
    const currentLfos = activeLfosRef.current;
    activeLfosRef.current = [];

    setTimeout(() => {
      if (currentSource) {
        try { currentSource.stop(); } catch(e){}
        currentSource.disconnect();
      }
      if (currentOsc) {
        try { currentOsc.stop(); } catch(e){}
        currentOsc.disconnect();
      }
      currentLfos.forEach(l => {
        try { l.stop(); } catch(e){}
        l.disconnect();
      });
      if (currentMaster) currentMaster.disconnect();
      if (currentLimiter) currentLimiter.disconnect();
    }, 150);

    sourceNodeRef.current = null;
    oscillatorNodeRef.current = null;
    filterNodeRef.current = null;
    effectNodeRef.current = null;
    eqGainNodeRef.current = null;
    bypassGainNodeRef.current = null;
    masterGainNodeRef.current = null;
    limiterNodeRef.current = null;
    restartSourceRef.current = null;
    seekQuizRef.current = null;
    if (!previewSourceNodeRef.current) playheadRef.current = null;
    setIsPlaying(false);
    setIsPreviewStage(false);
    setIsProblemStage(false);
    setIsBypassActive(false);
    setProgress(0);
    setIsSubmitLocked(false);
  };

  const triggerNextQuestion = (forcedTab?: QuestionTab, forcedTarget?: string) =>
    startNewQuestion(forcedTab, forcedTarget);

  const handleSubmit = () => {
    const answer = currentAnswerRef.current;
    const qTab = questionTab;
    if (!answer || !qTab) {
      setFeedback(' 먼저 문제를 재생해 주세요.');
      return;
    }

    const gain = currentAppliedGainRef.current;
    const isRandom = activeTab === 'RANDOM';
    const needEff = effLevel === 'EASY' ? 1 : 2;
    let isCorrect = false;
    let chosenValue = '';

    if (isRandom) {
      // RANDOM: 무엇을 골랐는지에 따라 판정 (어떤 종류의 문제인지 힌트를 주지 않음)
      if (selectedEffectors.length > 0) {
        if (selectedEffectors.length < needEff) {
          setFeedback(`이펙터를 ${needEff}개 선택하세요.`);
          return;
        }
        const key = toEffectorKey(selectedEffectors);
        isCorrect = qTab === 'EFFECTOR' && key === answer;
        chosenValue = `[이펙터] ${key.split('+').join(' + ')}`;
      } else if (selectedBand) {
        if (!selectedSign) {
          setFeedback('BOOST / CUT / 사인파 중 하나를 선택하세요.');
          return;
        }
        if (selectedSign === 'sine') {
          isCorrect = qTab === 'SINE' && selectedBand === answer;
          chosenValue = `[사인파] ${selectedBand}`;
        } else {
          const correctSign = gain >= 0 ? '+' : '-';
          isCorrect = qTab === 'EQ' && selectedBand === answer && selectedSign === correctSign;
          chosenValue = `[EQ] ${selectedSign}${selectedBand}`;
        }
      } else {
        if (qTab === 'SINE' && isPlaying) {
          stopAudio();
          setFeedback(' 소리를 멈췄어요. 정답을 선택한 뒤 [정답 제출]을 눌러주세요.');
          return;
        }
        setFeedback('이펙터 또는 주파수를 선택하세요.');
        return;
      }
    } else if (qTab === 'EQ') {
      if (!selectedBand) {
        setFeedback('주파수를 선택하세요.');
        return;
      }
      if (eqMode === 'random') {
        if (selectedSign !== '+' && selectedSign !== '-') {
          setFeedback('BOOST / CUT을 선택하세요.');
          return;
        }
        const correctSign = gain >= 0 ? '+' : '-';
        isCorrect = selectedBand === answer && selectedSign === correctSign;
        chosenValue = `${selectedSign}${selectedBand}`;
      } else {
        isCorrect = selectedBand === answer;
        chosenValue = selectedBand;
      }
    } else if (qTab === 'SINE') {
      if (!selectedBand) {
        // 주파수를 고르지 않고 [정답 제출]을 누르면 소리만 멈춤
        if (isPlaying) {
          stopAudio();
          setFeedback(' 소리를 멈췄어요. 주파수를 선택한 뒤 [정답 제출]을 눌러주세요.');
        } else {
          setFeedback('주파수를 선택하세요.');
        }
        return;
      }
      isCorrect = selectedBand === answer;
      chosenValue = selectedBand;
    } else {
      if (selectedEffectors.length < needEff) {
        setFeedback(needEff === 1 ? '이펙터를 선택하세요.' : '이펙터를 2개 선택하세요.');
        return;
      }
      const key = toEffectorKey(selectedEffectors);
      isCorrect = key === answer;
      chosenValue = key.split('+').join(' + ');
    }

    setSelectedBand(null);
    setSelectedSign(null);
    setSelectedEffectors([]);

    const correctText = isRandom
      ? `[${tabLabel(qTab)}] ${describeAnswer(qTab, answer, gain)}`
      : describeAnswer(qTab, answer, gain);
    const currentTargetKey = `${qTab}_${answer}`;
    const effectiveTab = qTab;

    if (isCorrect) {
      setScore(prev => ({ correct: prev.correct + 1, total: prev.total + 1 }));
      setStreak(prev => prev + 1);
      setLastResult({
        status: 'correct',
        message: ` 정답입니다! 정답은 [ ${correctText} ] 였습니다.`
      });
      setFeedback('우수한 감각입니다. 다음 훈련 세션을 진행해보세요!');
      setWrongQuestionCache(null);
    } else {
      setScore(prev => ({ ...prev, total: prev.total + 1 }));
      setStreak(0);
      setLastResult({
        status: 'wrong',
        message: ` 오답입니다. 선택: ${chosenValue} / 실제 정답: [ ${correctText} ]`
      });
      setFeedback('오답입니다. 하단의 [틀린문제 다시듣기] 버튼으로 차이점을 복습해 보세요.');
      
      setWrongStats(prev => ({
        ...prev,
        [currentTargetKey]: (prev[currentTargetKey] || 0) + 1
      }));

      setWrongQuestionCache({
        tab: effectiveTab,
        target: answer,
        gain: gain,
        level: level
      });
    }

    if (currentQuestionNo >= 20) {
      setSessionStage('finished');
      setFeedback(' 20문항 오디오 매칭 세션이 종료되었습니다. 하단의 성적 분석을 확인하세요.');
      stopAllAudio();
      setIsSubmitLocked(false);
      
      currentAnswerRef.current = null;
      setSelectedBand(null);
      setSelectedSign(null);
      setSelectedEffectors([]);
      setQuestionTab(null);
      setIsReplayingWrong(false);
      setIsPreviewStage(false);
      setIsProblemStage(false);
    } else {
      setCurrentQuestionNo(prev => prev + 1);
      stopAllAudio();
      currentAnswerRef.current = null;
      setSelectedBand(null);
      setSelectedSign(null);
      setSelectedEffectors([]);
      setQuestionTab(null);
      setIsReplayingWrong(false);
      setIsPreviewStage(false);
      setIsProblemStage(false);
      setIsSubmitLocked(false);

      if (autoNext) {
        if (autoNextTimerRef.current) {
          clearTimeout(autoNextTimerRef.current);
        }
        autoNextTimerRef.current = setTimeout(() => {
          triggerNextQuestion();
        }, 4000);
      }
    }
  };

  const startReviewSession = async () => {
    if (Object.keys(wrongStats).length === 0) {
      alert("기록된 오답 데이터가 없습니다.");
      return;
    }
    const sortedFlaws = Object.entries(wrongStats).sort((a, b) => b[1] - a[1]);
    
    setIsReviewMode(true);
    setCurrentQuestionNo(1);
    setSessionStage('playing');
    setScore({ correct: 0, total: 0 });
    setStreak(0);
    setFeedback(' 오답 빈도가 높았던 취약 대역/이펙터 재시험 시작.');
    
    const [topTargetKey] = sortedFlaws[0];
    const [parsedTab, parsedTarget] = topTargetKey.split('_') as ['EQ' | 'SINE' | 'EFFECTOR', string];
    
    setActiveTab(parsedTab);
    setTimeout(() => {
      triggerNextQuestion(parsedTab, parsedTarget);
    }, 300);
  };

  const resetFullSession = () => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    setSessionStage('ready');
    setCurrentQuestionNo(1);
    setWrongStats({});
    setIsReviewMode(false);
    setScore({ correct: 0, total: 0 });
    setStreak(0);
    setIsSubmitLocked(false);
  };

  // 이펙터 보기 선택 (EASY: 1개, HARD: 최대 2개)
  const toggleEffectorChoice = (eff: string) => {
    setSelectedEffectors(prev => {
      if (effLevel === 'EASY') return prev[0] === eff ? [] : [eff];
      if (prev.includes(eff)) return prev.filter(x => x !== eff);
      if (prev.length >= 2) return [prev[1], eff];
      return [...prev, eff];
    });
  };

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
  // 원음 듣기(Bypass) 버튼: 문제 중에는 문제 소리, 미리듣기 모드에서는 미리듣기 소리에 적용
  const bypassDisabled = isPreviewMode
    ? !isPreviewPlaying
    : (!isPlaying || activeTab === 'SINE' || questionTab === 'SINE');
  const bypassOn = isPreviewMode ? previewBypass : isBypassActive;
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
          <p style={{ color: '#7e8794', fontSize: '11px', margin: 0 }}>Acoustic Field Frequency Ear Training System {isReviewMode && ' [복습 세션 모드]'}</p>
        </div>
        <button onClick={() => setThemeMode(isDark ? 'light' : 'dark')} style={{ padding: '8px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', backgroundColor: isDark ? '#222733' : '#e2e8f0', color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: '20px' }}>
          {isDark ? ' 주간 모드' : ' 다크 모드'}
        </button>
      </header>

      {/* 대분류 카테고리 셀렉터 탭 */}
      <nav style={{ maxWidth: '720px', margin: '0 auto 16px auto', display: 'flex', gap: '8px' }}>
        {(['EQ', 'SINE', 'EFFECTOR', 'RANDOM'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { 
              stopAllAudio(); 
              setActiveTab(tab); 
              setWrongQuestionCache(null);
              setSelectedBand(null);
              setSelectedEffectors([]);
              setSelectedSign(null);
              resetFullSession();
              currentAnswerRef.current = null;
              setQuestionTab(null);
              setIsReplayingWrong(false);
              setLastResult({ status: 'idle', message: '' });
              setFeedback('준비 완료. 아래 [문제 재생] 버튼을 누르면 청음이 시작됩니다.');
            }}
            style={{
              flex: 1, padding: '14px 4px', fontSize: '13px', fontWeight: '800', borderRadius: '10px', border: 'none',
              backgroundColor: activeTab === tab ? (tab === 'RANDOM' ? colors.accent : colors.primary) : colors.cardBg,
              color: activeTab === tab ? 'white' : colors.textSub,
              boxShadow: activeTab === tab ? '0 4px 10px rgba(0,0,0,0.15)' : 'none',
              cursor: 'pointer'
            }}
          >
            {tab === 'EQ' ? ' EQ 목록' : tab === 'SINE' ? ' 사인파 목록' : tab === 'EFFECTOR' ? ' 이펙터 목록' : ' RANDOM'}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* 미리듣기 모드 스위치 */}
        <button
          onClick={togglePreviewMode}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', width: '100%',
            padding: '12px 16px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
            border: `1px solid ${isPreviewMode ? '#2ecc71' : colors.border}`,
            backgroundColor: isPreviewMode ? (isDark ? '#152b1e' : '#e6fffa') : colors.cardBg, color: colors.textMain
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '13.5px', fontWeight: '800' }}>🎧 미리듣기 모드 {isPreviewMode ? 'ON' : 'OFF'}</span>
            <span style={{ fontSize: '11.5px', color: colors.textSub, fontWeight: '600' }}>
              {!isPreviewMode
                ? '켜면 채점 없이 주파수·이펙터 소리를 들어볼 수 있어요'
                : activeTab === 'SINE'
                  ? '주파수 버튼을 누르면 그 소리가 나요. 다시 누르면 꺼져요'
                  : '버튼을 고르고 ▶ 미리듣기 재생을 누르세요. 재생 중에 바꾸면 바로 반영돼요'}
            </span>
          </span>
          <span style={{ width: '44px', height: '24px', borderRadius: '12px', backgroundColor: isPreviewMode ? '#2ecc71' : '#4a5568', position: 'relative', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: '3px', left: isPreviewMode ? '23px' : '3px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'white', transition: 'left 0.15s ease' }} />
          </span>
        </button>
        
        {/* 진행 라운드 상태 */}
        {!isPreviewMode && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.cardBg, padding: '12px 16px', borderRadius: '10px', border: `1px solid ${colors.border}`, fontSize: '13px', fontWeight: '700' }}>
          <span style={{ color: colors.textSub }}> 진행 라운드 상태</span>
          <span style={{ color: colors.primary, fontSize: '15px' }}>{currentQuestionNo} / 20 문제</span>
        </div>}

        {/* 재생 시그널 소스 제어판 */}
        {activeTab !== 'SINE' && (
          <section style={{ backgroundColor: colors.cardBg, borderRadius: '12px', padding: '18px', border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: isSourcePanelVisible ? `1px solid ${colors.border}` : 'none', paddingBottom: isSourcePanelVisible ? '12px' : '0' }}>
              <span style={{ fontWeight: '700', color: colors.textSub }}> 재생 시그널 소스</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: colors.textSub, cursor: 'pointer', fontWeight: '700' }}>
                  <input 
                    type="checkbox" 
                    checked={autoNext} 
                    onChange={(e) => setAutoNext(e.target.checked)} 
                    style={{ cursor: 'pointer' }}
                  />
                  4초 후 자동 다음 문제
                </label>
                <button 
                  onClick={() => setIsSourcePanelVisible(!isSourcePanelVisible)}
                  style={{ padding: '4px 10px', fontSize: '11.5px', fontWeight: '700', backgroundColor: isDark ? '#222733' : '#e2e8f0', color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer' }}
                >
                  {isSourcePanelVisible ? ' 소스 가리기' : ' 소스 펼치기'}
                </button>
              </div>
            </div>

            {isSourcePanelVisible && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => { setSource('music'); resetProblemState(); }}
                    style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: '700', borderRadius: '8px', border: 'none', backgroundColor: source === 'music' ? colors.primary : colors.btnDefault, color: source === 'music' ? 'white' : colors.textMain, cursor: 'pointer' }}
                  >
                     외부 음원 트랙
                  </button>
                  <button 
                    onClick={() => { setSource('pink'); resetProblemState(); }}
                    style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: '700', borderRadius: '8px', border: 'none', backgroundColor: source === 'pink' ? colors.primary : colors.btnDefault, color: source === 'pink' ? 'white' : colors.textMain, cursor: 'pointer' }}
                  >
                     핑크 노이즈
                  </button>
                </div>

                {source === 'music' && (
                  <div 
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    style={{ padding: '18px', backgroundColor: colors.innerBox, borderRadius: '8px', border: `2px dashed ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'center' }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: colors.textSub, fontWeight: '600' }}> 오디오 파일을 드래그 앤 드롭 하거나 선택하세요.</span>
                      <button
                        onClick={async () => {
                          try { await ensureAudioContext(); } catch (e) {}
                          fileInputRef.current?.click();
                        }}
                        style={{ padding: "10px 18px", borderRadius: "8px", border: "none", cursor: "pointer", backgroundColor: colors.primary, color: "white", fontWeight: "700" }}
                      >
                         음원 선택
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*,.wav,.mp3,.aac,.m4a,.ogg"
                        onChange={handleFileUpload}
                        style={{ display: "none" }}
                      />
                      {uploadedFileName && <span style={{ fontSize: '12px', color: colors.primary, fontWeight: '800' }}> 적재 완료: {uploadedFileName}</span>}
                    </div>
                    
                    {peaks.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', fontWeight: '600' }}>
                          <span style={{ color: colors.textMain }}> WAVEFORM TRACK (실시간 반영 루프 타임)</span>
                          <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <span ref={playheadTimeElRef} style={{ color: colors.textMain, fontWeight: '800', fontVariantNumeric: 'tabular-nums' }} />
                            <span style={{ color: colors.primary }}>{loopStart.toFixed(1)}s ~ {loopEnd.toFixed(1)}s</span>
                          </span>
                        </div>
                        <div 
                          ref={waveformRef} 
                          onMouseDown={(e) => handleWaveformTouchStart(e)} 
                          onTouchStart={(e) => {
                            e.preventDefault();
                            const touch = e.touches[0];
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = touch.clientX - rect.left;
                            const t = Math.max(0, Math.min(audioDuration, (x / rect.width) * audioDuration));
                            touchDragRef.current = Math.abs(t - loopStart) < Math.abs(t - loopEnd) ? "start" : "end";
                          }}
                          onTouchMove={(e) => {
                            e.preventDefault();
                            if (!touchDragRef.current) return;
                            const touch = e.touches[0];
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = touch.clientX - rect.left;
                            const t = Math.max(0, Math.min(audioDuration, (x / rect.width) * audioDuration));
                            if (touchDragRef.current === "start") {
                              setLoopStart(Math.min(t, loopEnd - 0.2));
                            } else {
                              setLoopEnd(Math.max(t, loopStart + 0.2));
                            }
                          }}
                          onTouchEnd={() => { touchDragRef.current = null; }}
                          style={{ position: 'relative', height: '65px', backgroundColor: colors.waveformBg, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', cursor: 'pointer', overflow: 'visible', border: `1px solid ${colors.border}`, userSelect: 'none', touchAction: 'none' }}
                        >
                          <div style={{ position: 'absolute', left: 0, width: `${(loopStart / (audioDuration || 1)) * 100}%`, height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.45)', pointerEvents: 'none' }} />
                          <div style={{ position: 'absolute', right: 0, width: `${100 - (loopEnd / (audioDuration || 1)) * 100}%`, height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.45)', pointerEvents: 'none' }} />
                          <div onMouseDown={(e) => { e.stopPropagation(); handleWaveformTouchStart(e, 'start'); }} style={{ position: 'absolute', left: `${(loopStart / (audioDuration || 1)) * 100}%`, top: '-2px', width: '6px', height: '69px', backgroundColor: colors.accent, zIndex: 10, cursor: 'ew-resize', borderRadius: '2px' }} />
                          <div onMouseDown={(e) => { e.stopPropagation(); handleWaveformTouchStart(e, 'end'); }} style={{ position: 'absolute', left: `${(loopEnd / (audioDuration || 1)) * 100}%`, top: '-2px', width: '6px', height: '69px', backgroundColor: '#ff4d4d', zIndex: 10, cursor: 'ew-resize', borderRadius: '2px' }} />
                          
                          {/* 현재 재생 위치 (아이폰처럼 흰색 세로 막대 + 위쪽 동그라미) */}
                          <div
                            ref={playheadElRef}
                            style={{ position: 'absolute', top: '-8px', bottom: '-6px', width: '0px', zIndex: 12, pointerEvents: 'none', display: 'none' }}
                          >
                            <div style={{ position: 'absolute', left: '-1.5px', top: '8px', bottom: '0', width: '3px', backgroundColor: isDark ? '#ffffff' : '#111827', borderRadius: '2px', boxShadow: '0 0 6px rgba(255,255,255,0.7)', pointerEvents: 'none' }} />
                            <div style={{ position: 'absolute', left: '-7px', top: '0', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: isDark ? '#ffffff' : '#111827', boxShadow: '0 0 6px rgba(0,0,0,0.4)', pointerEvents: 'none' }} />
                            {/* 손가락/마우스로 잡는 영역 (막대보다 넓게) */}
                            <div
                              title="잡고 좌우로 움직이면 그 위치로 이동"
                              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); scrubRef.current = { lastSeek: 0, x: e.clientX }; }}
                              onTouchStart={(e) => { e.stopPropagation(); scrubRef.current = { lastSeek: 0, x: e.touches[0].clientX }; }}
                              onTouchMove={(e) => { e.stopPropagation(); e.preventDefault(); scrubAt(e.touches[0].clientX, false); }}
                              onTouchEnd={(e) => { e.stopPropagation(); if (scrubRef.current) { scrubAt(scrubRef.current.x, true); scrubRef.current = null; } }}
                              style={{ position: 'absolute', left: '-12px', top: '0', bottom: '0', width: '24px', pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }}
                            />
                          </div>

                          {peaks.map((peak, idx) => (
                            <div key={idx} style={{ width: '3px', height: `${Math.max(peak * 100, 8)}%`, backgroundColor: idx / peaks.length >= loopStart / (audioDuration || 1) && idx / peaks.length <= loopEnd / (audioDuration || 1) ? '#ff922b' : '#94a3b8', borderRadius: '1px' }} />
                          ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          <button onClick={() => setIsLoopEnabled(!isLoopEnabled)} style={{ padding: '6px 12px', fontSize: '11px', fontWeight: '700', backgroundColor: isLoopEnabled ? colors.primary : '#718096', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}> LOOP {isLoopEnabled ? 'ON' : 'OFF'}</button>
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

        {/* 난이도 커스텀 조절 조작 패널 */}
        {activeTab !== 'EFFECTOR' && (
          <section style={{ backgroundColor: colors.cardBg, borderRadius: '12px', padding: '18px', border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: isFilterPanelVisible ? `1px solid ${colors.border}` : 'none', paddingBottom: isFilterPanelVisible ? '12px' : '0' }}>
              <span style={{ fontWeight: '700', color: colors.textSub }}> 대역 필터 난이도</span>
              <button 
                onClick={() => setIsFilterPanelVisible(!isFilterPanelVisible)}
                style={{ padding: '4px 10px', fontSize: '11.5px', fontWeight: '700', backgroundColor: isDark ? '#222733' : '#e2e8f0', color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer' }}
              >
                {isFilterPanelVisible ? ' 설정 가리기' : ' 설정 펼치기'}
              </button>
            </div>

            {isFilterPanelVisible && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(['EASY', 'HARD', 'CUSTOM'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setLevel(m);
                        // EASY 기본 셋팅: BOOST + 12dB
                        if (m === 'EASY') { setEqMode('boost'); setGainAmt('12'); }
                        if (m === 'CUSTOM') setCustomSelected([...iso10Bands]);
                        clearCurrentQuestion(`${m} MODE로 변경되었습니다. [문제 재생]을 눌러주세요.`);
                      }}
                      style={{ flex: 1, padding: '12px', fontSize: '12.5px', fontWeight: '800', border: 'none', borderRadius: '8px', backgroundColor: level === m ? colors.primary : colors.btnDefault, color: level === m ? 'white' : colors.textMain, cursor: 'pointer' }}
                    >
                      {m} MODE
                    </button>
                  ))}
                </div>

                <span style={{ fontSize: '11.5px', color: colors.textSub }}>
                  {level === 'EASY' ? 'EASY: 63Hz ~ 8kHz 8개 대역 (넓은 Q)' : level === 'HARD' ? 'HARD: 40Hz ~ 12.5kHz 1/3옥타브 대역 (좁은 Q)' : 'CUSTOM: 원하는 대역만 골라서 연습 (31.5Hz·16kHz는 여기서만 선택 가능)'}
                </span>

                {level === 'CUSTOM' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '6px', height: '64px', textAlign: 'center', fontWeight: '700', fontSize: '12px' }}>
                      <div onClick={() => toggleRegion('low')} style={{ flex: 1, backgroundColor: isDark ? '#241919' : '#fff5f5', border: `1px solid ${colors.lowFreq}`, borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}><span style={{ color: colors.lowFreq }}> LOW</span></div>
                      <div onClick={() => toggleRegion('mid')} style={{ flex: 2, backgroundColor: isDark ? '#181e26' : '#ebf8ff', border: `1px solid ${colors.midFreq}`, borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}><span style={{ color: colors.midFreq }}> MID</span></div>
                      <div onClick={() => toggleRegion('high')} style={{ flex: 1.5, backgroundColor: isDark ? '#17241b' : '#f0fff4', border: `1px solid ${colors.highFreq}`, borderRadius: '6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}><span style={{ color: colors.highFreq }}> HIGH</span></div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', backgroundColor: colors.waveformBg, padding: '8px', borderRadius: '6px' }}>
                      {iso31Bands.map(b => {
                        const isChecked = customSelected.includes(b);
                        const activeColor = getFreqRegion(b) === 'low' ? colors.lowFreq : getFreqRegion(b) === 'mid' ? colors.midFreq : colors.highFreq;
                        return (
                          <button
                            key={b}
                            onClick={() => {
                              let next: string[];
                              if (isChecked) {
                                next = customSelected.filter(x => x !== b);
                                if (next.length === 0) next = [b];
                              } else {
                                next = [...customSelected, b];
                              }
                              setCustomSelected(next.sort((x, y) => parseFreq(x) - parseFreq(y)));
                            }}
                            style={{
                              fontSize: '10px', padding: '3px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                              backgroundColor: isChecked ? activeColor : (isDark ? '#1e222b' : '#e2e8f0'),
                              color: isChecked ? '#000' : colors.textMain, fontWeight: '700'
                            }}
                          >
                            {b}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(activeTab === 'EQ' || activeTab === 'RANDOM') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
                    {activeTab === 'EQ' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={{ fontWeight: '700', color: colors.textSub, fontSize: '12px' }}> EQ 변형 성향 스위치</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {(['random', 'boost', 'cut'] as const).map((m) => (
                            <button
                              key={m}
                              onClick={() => setEqMode(m)}
                              style={{
                                flex: 1, padding: '10px', fontSize: '12px', fontWeight: '700', border: 'none', borderRadius: '6px',
                                backgroundColor: eqMode === m ? colors.accent : colors.btnDefault, color: eqMode === m ? 'white' : colors.textMain,
                                cursor: 'pointer'
                              }}
                            >
                              {m.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                      <span style={{ fontWeight: '700', color: colors.textSub, fontSize: '12px' }}> 피크 변형 폭(Gain Magnitude)</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {(['12', '6'] as const).map((g) => (
                          <button
                            key={g}
                            onClick={() => setGainAmt(g)}
                            style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: '700', border: 'none', borderRadius: '6px', backgroundColor: gainAmt === g ? colors.primary : colors.btnDefault, color: gainAmt === g ? 'white' : colors.textMain, cursor: 'pointer' }}
                          >
                            {g} dB
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

        {/* 이펙터 난이도 패널 */}
        {(activeTab === 'EFFECTOR' || activeTab === 'RANDOM') && (
          <section style={{ backgroundColor: colors.cardBg, borderRadius: '12px', padding: '18px', border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <span style={{ fontWeight: '700', color: colors.textSub }}> 이펙터 난이도</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['EASY', 'HARD'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setEffLevel(m);
                    clearCurrentQuestion(m === 'EASY'
                      ? '이펙터 EASY MODE: 이펙터 1개가 적용됩니다. [문제 재생]을 눌러주세요.'
                      : '이펙터 HARD MODE: 이펙터 2개가 섞여서 나옵니다. 2개를 골라 제출하세요.');
                  }}
                  style={{ flex: 1, padding: '12px', fontSize: '12.5px', fontWeight: '800', border: 'none', borderRadius: '8px', backgroundColor: effLevel === m ? colors.accent : colors.btnDefault, color: effLevel === m ? 'white' : colors.textMain, cursor: 'pointer' }}
                >
                  {m} MODE
                </button>
              ))}
            </div>
            <span style={{ fontSize: '11.5px', color: colors.textSub }}>
              {effLevel === 'EASY' ? 'EASY: 이펙터 1개 맞히기' : 'HARD: 랜덤으로 섞인 이펙터 2개를 모두 맞히기'}
            </span>
          </section>
        )}

        {/* 정답 선택 패널 보드 */}
        <section style={{ backgroundColor: colors.cardBg, borderRadius: '12px', padding: '18px', border: `1px solid ${colors.border}` }}>
         <h3 style={{ margin: '0 0 14px 0', fontSize: '13px', fontWeight: '700', color: isPreviewMode ? '#2ecc71' : colors.textSub }}>
           {isPreviewMode ? ' 🎧 미리듣기 선택 (채점하지 않아요)' : activeTab === 'RANDOM' ? ' 정답 선택 (EQ · 사인파 · 이펙터 통합 매칭 패널)' : (activeTab === 'EFFECTOR' ? (effLevel === 'HARD' ? ' 정답 선택 (이펙터 2개를 고르세요)' : ' 정답 선택 (이펙터 매칭 패널)') : ' 정답 선택 (주파수 대역 매트릭스)')}
         </h3>
         
         {activeTab === 'RANDOM' ? (
           <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
             <div>
               <span style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: colors.textSub, marginBottom: '6px' }}> 이펙터 보기 선택 {effLevel === 'HARD' ? '(2개 선택)' : ''}</span>
               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                 {effectorList.map((eff) => {
                   const isSelected = selectedEffectors.includes(eff);
                   return (
                     <button 
                       key={eff} 
                       onClick={() => { toggleEffectorChoice(eff); setSelectedBand(null); setSelectedSign(null); }} 
                       style={{ padding: '14px 2px', backgroundColor: isSelected ? colors.accent : colors.btnDefault, color: isSelected ? 'white' : colors.textMain, border: `1px solid ${isSelected ? colors.accent : colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}
                     >
                       {eff}
                     </button>
                   );
                 })}
               </div>
             </div>
      
             <div style={{ borderTop: `1px dashed ${colors.border}`, paddingTop: '16px' }}>
               <span style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: colors.textSub, marginBottom: '6px' }}> 주파수 대역 보기 선택</span>
               <div style={{ display: 'grid', gridTemplateColumns: level === 'EASY' ? 'repeat(4, 1fr)' : 'repeat(6, 1fr)', gap: '6px' }}>
                 {getCurrentPool().map((band) => {
                   const isSelected = selectedBand === band;
                   return (
                     <button 
                       key={band} 
                       onClick={() => { setSelectedBand(prev => (prev === band ? null : band)); setSelectedEffectors([]); }} 
                       style={{ padding: level === 'EASY' ? '14px 2px' : '10px 2px', backgroundColor: isSelected ? colors.primary : colors.btnDefault, color: isSelected ? 'white' : colors.textMain, border: `1px solid ${isSelected ? colors.primary : colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: level === 'EASY' ? '13px' : '11px', fontWeight: '600' }}
                     >
                       {band}
                     </button>
                   );
                 })}
               </div>
        
               <div style={{ borderTop: `1px dashed ${colors.border}`, paddingTop: '12px', marginTop: '12px' }}>
                 <span style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: colors.textSub, marginBottom: '6px' }}>
                  주파수 선택 시 필수 : 부스트(+) / 컷(-) / 사인파 중 선택
                 </span>
                 <div style={{ display: 'flex', gap: '8px' }}>
                   <button
                     onClick={() => { setSelectedSign(prev => (prev === '+' ? null : '+')); setSelectedEffectors([]); }}
                     style={{
                       flex: 1, padding: '14px', fontSize: '15px', fontWeight: '900', borderRadius: '8px', cursor: 'pointer',
                       border: `1px solid ${selectedSign === '+' ? '#ff6b6b' : colors.border}`,
                       backgroundColor: selectedSign === '+' ? '#ff6b6b' : colors.btnDefault, color: selectedSign === '+' ? 'white' : colors.textMain
                     }}
                   >
                     BOOST (+)
                   </button>
                   <button
                     onClick={() => { setSelectedSign(prev => (prev === '-' ? null : '-')); setSelectedEffectors([]); }}
                     style={{
                       flex: 1, padding: '14px', fontSize: '15px', fontWeight: '900', borderRadius: '8px', cursor: 'pointer',
                       border: `1px solid ${selectedSign === '-' ? '#3ea6ff' : colors.border}`,
                       backgroundColor: selectedSign === '-' ? '#3ea6ff' : colors.btnDefault, color: selectedSign === '-' ? 'white' : colors.textMain
                     }}
                   >
                     CUT (-)
                   </button>
                   <button
                     onClick={() => { setSelectedSign(prev => (prev === 'sine' ? null : 'sine')); setSelectedEffectors([]); }}
                     style={{
                       flex: 1, padding: '14px', fontSize: '15px', fontWeight: '900', borderRadius: '8px', cursor: 'pointer',
                       border: `1px solid ${selectedSign === 'sine' ? '#2ecc71' : colors.border}`,
                       backgroundColor: selectedSign === 'sine' ? '#2ecc71' : colors.btnDefault, color: selectedSign === 'sine' ? 'white' : colors.textMain
                     }}
                   >
                     사인파
                   </button>
                 </div>
               </div>
             </div>
           </div>
         ) : (
           activeTab === 'EFFECTOR' ? (
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
               {effectorList.map((eff) => {
                 const isSelected = selectedEffectors.includes(eff);
                 return (
                   <button key={eff} onClick={() => toggleEffectorChoice(eff)} style={{ padding: '14px 2px', backgroundColor: isSelected ? colors.accent : colors.btnDefault, color: isSelected ? 'white' : colors.textMain, border: `1px solid ${isSelected ? colors.accent : colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                     {eff}
                   </button>
                 );
               })}
             </div>
           ) : (
             <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
               <div style={{ display: 'grid', gridTemplateColumns: level === 'EASY' ? 'repeat(4, 1fr)' : 'repeat(6, 1fr)', gap: '6px' }}>
                 {getCurrentPool().map((band) => {
                   const isSelected = selectedBand === band;
                   return (
                     <button key={band} onClick={() => setSelectedBand(prev => (prev === band ? null : band))} style={{ padding: level === 'EASY' ? '14px 2px' : '10px 2px', backgroundColor: isSelected ? colors.primary : colors.btnDefault, color: isSelected ? 'white' : colors.textMain, border: `1px solid ${isSelected ? colors.primary : colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: level === 'EASY' ? '13px' : '11px', fontWeight: '600' }}>
                       {band}
                     </button>
                   );
                 })}
               </div>
       
               {activeTab === 'EQ' && eqMode === 'random' && (
                 <div style={{ borderTop: `1px dashed ${colors.border}`, paddingTop: '12px' }}>
                   <span style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: colors.textSub, marginBottom: '6px' }}> 부스트 / 컷 성향 기동 선택</span>
                   <div style={{ display: 'flex', gap: '8px' }}>
                     <button 
                       onClick={() => setSelectedSign(prev => (prev === '+' ? null : '+'))} 
                       style={{ flex: 1, padding: '14px', fontSize: '15px', fontWeight: '900', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${selectedSign === '+' ? '#ff6b6b' : colors.border}`, backgroundColor: selectedSign === '+' ? '#ff6b6b' : colors.btnDefault, color: selectedSign === '+' ? 'white' : colors.textMain }}
                     >
                        BOOST (+)
                     </button>
                     <button 
                       onClick={() => setSelectedSign(prev => (prev === '-' ? null : '-'))} 
                       style={{ flex: 1, padding: '14px', fontSize: '15px', fontWeight: '900', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${selectedSign === '-' ? '#3ea6ff' : colors.border}`, backgroundColor: selectedSign === '-' ? '#3ea6ff' : colors.btnDefault, color: selectedSign === '-' ? 'white' : colors.textMain }}
                     >
                        CUT (-)
                     </button>
                   </div>
                 </div>
               )}
             </div>
           )
         )}
       </section>

        {/* 조작 액션 커맨드 컨트롤러 */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isPreviewMode ? (
            activeTab === 'SINE' ? (
              <button
                onClick={() => setSelectedBand(null)}
                disabled={!selectedBand}
                style={{
                  width: '100%', padding: '18px', fontSize: '16px', fontWeight: '800', color: 'white', border: 'none', borderRadius: '10px',
                  backgroundColor: selectedBand ? '#e53e3e' : '#2c303d', cursor: selectedBand ? 'pointer' : 'not-allowed', opacity: selectedBand ? 1 : 0.6
                }}
              >
                {selectedBand ? `■ ${selectedBand} 소리 끄기` : '🎧 위에서 주파수 버튼을 눌러보세요'}
              </button>
            ) : (
              <button
                onClick={togglePreviewPlay}
                style={{
                  width: '100%', padding: '18px', fontSize: '16px', fontWeight: '800', color: 'white', border: 'none', borderRadius: '10px',
                  backgroundColor: isPreviewPlaying ? '#e53e3e' : '#2ecc71', cursor: 'pointer'
                }}
              >
                {isPreviewPlaying ? '■ 미리듣기 정지' : '▶ 미리듣기 재생'}
              </button>
            )
          ) : !currentAnswerRef.current ? (
            <button 
              disabled={isSubmitLocked}
              onClick={togglePlayPause} 
              style={{ 
                width: '100%', padding: '18px', fontSize: '16px', fontWeight: '800', color: 'white', border: 'none', borderRadius: '10px',
                backgroundColor: isSubmitLocked ? '#2c303d' : colors.primary, boxShadow: isSubmitLocked ? 'none' : '0 4px 12px rgba(26,115,232,0.2)',
                cursor: isSubmitLocked ? 'not-allowed' : 'pointer',
                opacity: isSubmitLocked ? 0.6 : 1
              }}
            >
               {isSubmitLocked ? ' 오디오 생성 중...' : '▶ 문제 재생 (Play)'}
            </button>
          ) : (
            <button 
              onClick={isPreviewStage || isMuteCounting || isProblemStage ? togglePlayPause : handleSubmit} 
              style={{ 
                position: 'relative', width: '100%', padding: '18px', fontSize: '16px', fontWeight: '800', color: 'white', border: 'none', borderRadius: '10px', overflow: 'hidden',
                background: isPlaying && (isPreviewStage || isProblemStage)
                  ? `linear-gradient(to right, #0d47a1 ${progress}%, #2c303d ${progress}%)`
                  : (isMuteCounting ? '#d97706' : colors.accent),
                cursor: 'pointer'
              }}
            >
              <span style={{ position: 'relative', zIndex: 3 }}>
                {isMuteCounting ? ` 3초 음소거 카운트다운 (${muteCountdown}초)...` : (isPlaying && (isPreviewStage || isProblemStage) ? '■ 문제 재생 중' : '정답 제출')}
              </span>
            </button>
          )}
          
          {/* 안내 문구 (지금 상태 / 해야 할 일) */}
          <div style={{ fontSize: '12px', fontWeight: '600', color: colors.textSub, textAlign: 'center', minHeight: '16px', padding: '2px 4px' }}>
            {feedback.trim()}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={isPreviewMode ? () => setPreviewBypass(v => !v) : toggleBypass} 
              disabled={bypassDisabled}
              style={{ flex: 1, padding: '14px', fontSize: '13px', fontWeight: '700', backgroundColor: bypassDisabled ? (isDark ? '#1d222d' : '#e2e8f0') : bypassOn ? colors.primary : '#4a5568', color: bypassDisabled ? (isDark ? '#444d5e' : '#cbd5e0') : 'white', border: 'none', borderRadius: '10px', cursor: bypassDisabled ? 'not-allowed' : 'pointer' }}
            >
              {bypassOn ? ' 변형음 전환' : ' 원음 듣기 (Bypass)'}
            </button>

            <button 
              onClick={handleReplayWrongQuestion} 
              disabled={!wrongQuestionCache || isPreviewMode}
              style={{ 
                flex: 1, padding: '14px', fontSize: '13px', fontWeight: '700', 
                backgroundColor: !wrongQuestionCache ? (isDark ? '#1d222d' : '#e2e8f0') : isReplayingWrong ? '#e53e3e' : '#2ecc71', 
                color: !wrongQuestionCache ? (isDark ? '#444d5e' : '#cbd5e0') : 'white', 
                border: 'none', borderRadius: '10px', cursor: wrongQuestionCache ? 'pointer' : 'not-allowed'
              }}
            >
              {isReplayingWrong ? '■ 다시듣기 정지' : ' 틀린문제 다시듣기'}
            </button>
          </div>
        </section>

        {/* 성과 지표 알림 창 피드백 */}
        {lastResult.status !== 'idle' && (
          <section style={{ padding: '18px', borderRadius: '12px', border: `1px solid ${lastResult.status === 'correct' ? '#22543d' : '#5c2b2b'}`, backgroundColor: lastResult.status === 'correct' ? colors.successBg : (isDark ? '#2a1a1a' : '#fff5f5'), color: lastResult.status === 'correct' ? colors.successText : '#ff6b6b' }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '14.5px', fontWeight: '700' }}>
              {lastResult.status === 'correct' ? ' 탁월한 청각 매칭 성능입니다!' : ' 정밀 청음 복습 필요'}
            </h4>
            <p style={{ margin: 0, fontSize: '14.5px', fontWeight: '700' }}>{lastResult.message}</p>
          </section>
        )}

        {/* 20문항 종료 후 오답 통계 리포트 */}
        {sessionStage === 'finished' && (
          <section style={{ padding: '18px', backgroundColor: isDark ? '#1e2230' : '#ebf4ff', borderRadius: '12px', border: `1px solid ${colors.primary}`, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: colors.primary }}> 20문항 오디오 트레이닝 통계 리포트</h4>
            <div style={{ fontSize: '13px', color: colors.textMain }}>
              {Object.keys(wrongStats).length > 0 ? (
                <div>
                  <p style={{ margin: '0 0 8px 0' }}>가장 오답률이 높은 취약 구간 목록:</p>
                  <ul style={{ paddingLeft: '20px', margin: 0 }}>
                    {Object.entries(wrongStats).sort((a,b) => b[1]-a[1]).map(([key, count]) => (
                      <li key={key} style={{ marginBottom: '4px' }}>
                        <span style={{ fontWeight: '700', color: '#ff6b6b' }}>[{key.split('_')[0]}] {key.split('_')[1]} 대역/요소</span>  총 {count}회 오답 검출
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p style={{ margin: 0, color: colors.successText, fontWeight: '700' }}> 완벽한 청음 스코어입니다!</p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button onClick={startReviewSession} disabled={Object.keys(wrongStats).length === 0} style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: '800', backgroundColor: colors.accent, color: 'white', border: 'none', borderRadius: '6px', cursor: Object.keys(wrongStats).length > 0 ? 'pointer' : 'not-allowed' }}>
                 취약 대역 집중 재시험
              </button>
              <button onClick={resetFullSession} style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: '800', backgroundColor: '#718096', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                 새 트레이닝 정규 세션 시작
              </button>
            </div>
          </section>
        )}

        <footer style={{ display: 'flex', justifyContent: 'space-between', padding: '2px', fontSize: '12px', fontWeight: '600', color: colors.textSub }}>
          <div>종합 청음율: <span style={{ color: colors.primary, fontWeight: '700' }}>{score.correct}</span> / {score.total} ({score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0}%)</div>
          <div>현재 연승 레코드: <span style={{ color: colors.accent, fontWeight: '700' }}> {streak}</span></div>
        </footer>

      </main>
    </div>
  );
}