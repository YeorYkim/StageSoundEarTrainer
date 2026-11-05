// 청음 프로그램에서 쓰는 주파수 목록, 이펙터 목록, 작은 도우미 함수 모음

// 31밴드 전체 마스터 풀
export const iso31Bands = [
  '31.5Hz', '40Hz', '50Hz', '63Hz', '80Hz', '100Hz', '125Hz', '160Hz', 
  '200Hz', '250Hz', '315Hz', '400Hz', '500Hz', '630Hz', '800Hz', '1kHz', '1.25kHz', '1.6kHz', 
  '2kHz', '2.5kHz', '3.15kHz', '4kHz', '5kHz', '6.3kHz', '8kHz', '10kHz', '12.5kHz', '16kHz'
];

// CUSTOM 모드에서만 고를 수 있는 극저역/극고역 밴드
export const customOnlyBands = ['31.5Hz', '16kHz'];

// EASY 모드 8밴드 구성 (31.5Hz, 16kHz 제외)
export const iso10Bands = ['63Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz'];

// HARD 모드 밴드 구성 (31.5Hz, 16kHz 제외)
export const hardBands = iso31Bands.filter(b => !customOnlyBands.includes(b));

// 이펙터 목록 정의 (화면 표시 순서)
export const effectorList = ['리버브', '코러스', '페이저', '딜레이', '클리핑', '와와', '플랜저', '컴프레서'];

// 이펙터 2개를 섞을 때 연결 순서 (실제 페달보드/랙 순서와 비슷하게)
export const effectChainOrder = ['컴프레서', '클리핑', '와와', '페이저', '플랜저', '코러스', '딜레이', '리버브'];

// 이펙터 정답을 항상 같은 순서의 문자열로 만들기 (예: "딜레이+리버브")
export const toEffectorKey = (list: string[]) =>
  [...list].sort((a, b) => effectChainOrder.indexOf(a) - effectChainOrder.indexOf(b)).join('+');

export const pickRandom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const formatTime = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
};

export type QuestionTab = 'EQ' | 'SINE' | 'EFFECTOR';

export const getFreqRegion = (band: string): 'low' | 'mid' | 'high' => {
  if (band.includes('kHz')) {
    const khz = parseFloat(band.replace('kHz', ''));
    return khz >= 2 ? 'high' : 'mid';
  }
  const hz = parseFloat(band.replace('Hz', ''));
  if (hz <= 200) return 'low';
  return 'mid';
};

export const parseFreq = (str: string): number => {
  if (str.endsWith('kHz')) return parseFloat(str.replace('kHz', '')) * 1000;
  return parseFloat(str.replace('Hz', ''));
};
