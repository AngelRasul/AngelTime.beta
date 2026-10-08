import { SURAH_NAMES } from "./utils/surahNames";
import { motion, AnimatePresence, useMotionValue, useTransform, useAnimation, PanInfo, useDragControls } from "motion/react";
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Globe, Moon, Sunrise, Sun, Sunset, MoonStar, Settings, Search, ChevronLeft, BookOpen, Clock, MapPin, X, Loader2, Check, SunMedium, CloudSun, Compass, BookText, CloudMoon, Eclipse, Aperture, Bell, BellOff, Volume2, VolumeX, ChevronDown, ChevronUp } from 'lucide-react';
import { globalAudioEngine } from './utils/audioEngine';


// --- Utils ---
const triggerHaptic = () => { 
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(40);
  }
};

const detectSystemTimeFormat = (): '12h' | '24h' => {
  try {
    // 1. Try checking via toLocaleTimeString()
    const testDate = new Date(2020, 0, 1, 13, 0, 0);
    const timeStr = testDate.toLocaleTimeString();
    if (timeStr.includes('13')) {
      return '24h';
    }
    if (/am|pm/i.test(timeStr)) {
      return '12h';
    }

    // 2. Try checking via navigator.languages or default Intl format
    const locales = (typeof navigator !== 'undefined' && navigator.languages && navigator.languages.length > 0)
      ? Array.from(navigator.languages)
      : [undefined];

    for (const loc of locales) {
      try {
        const str = new Intl.DateTimeFormat(loc, { hour: 'numeric' }).format(testDate);
        if (str.includes('13')) return '24h';
        if (/am|pm/i.test(str)) return '12h';
      } catch (e) {}
    }

    // 3. Try checking resolvedOptions
    const resolved = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    if (resolved.hour12 === false || resolved.hourCycle === 'h23' || resolved.hourCycle === 'h24') {
      return '24h';
    }
    if (resolved.hour12 === true || resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12') {
      return '12h';
    }

    // Default to 24h as standard
    return '24h';
  } catch (e) {
    return '24h';
  }
};

// --- API Helpers ---
const getFlagEmoji = (countryCode: string) => {
  if (!countryCode) return '';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

const getUtcOffset = (timezone: string) => {
  if (!timezone) return '';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' });
    const parts = formatter.formatToParts(new Date());
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value;
    return offsetPart ? offsetPart.replace('GMT', 'UTC') : '';
  } catch (e) {
    return '';
  }
};


const fetchGeocoding = async (query: string, lang: string = "ru") => {
  try {
    const meteoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=20&language=${lang}`);
    if (!meteoRes.ok) throw new Error('Network response was not ok');
    const meteoData = await meteoRes.json();
    
    const rawResults = Array.isArray(meteoData?.results) ? meteoData.results : [];
    const seen = new Set();
    const deduped = [];
    
    const getTypeFromFeatureCode = (code: string) => {
      if (!code) return "Город";
      if (code.startsWith("PPLC") || code.startsWith("PPLA")) return lang === 'ru' ? "Город" : "City";
      if (code === "PPLX" || code === "PPL") return lang === 'ru' ? "Поселок" : "Town";
      return lang === 'ru' ? "Деревня" : "Village";
    };
    
    for (const item of rawResults) {
      if (!item) continue;
      
      if (item.feature_code && !item.feature_code.startsWith('PPL')) continue;
      
      const key = `${item.name}-${item.admin1 || ''}-${item.country || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push({
          name: item.name,
          type: getTypeFromFeatureCode(item.feature_code),
          region: item.admin1 || item.admin2 || '',
          country: item.country,
          country_code: item.country_code,
          timezone: item.timezone,
          lat: item.latitude,
          lng: item.longitude,
          population: item.population || 0
        });
      }
    }
    
    deduped.sort((a, b) => b.population - a.population);
    return { query, results: deduped.slice(0, 10) };
  } catch (error) {
    console.error(error);
    return { results: [] };
  }
};

const getLocalDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPrayerMethod = (country: string) => {
  const c = country.toLowerCase();
  if (c.includes('россия') || c.includes('russia')) return 14; // DUM RF
  if (c.includes('turkey') || c.includes('турция')) return 13;
  if (c.includes('egypt') || c.includes('египет')) return 5;
  if (c.includes('saudi') || c.includes('саудовская')) return 4;
  if (c.includes('united arab emirates') || c.includes('оаэ')) return 8;
  if (c.includes('kuwait') || c.includes('кувейт')) return 9;
  if (c.includes('qatar') || c.includes('катар')) return 10;
  if (c.includes('singapore') || c.includes('сингапур')) return 11;
  if (c.includes('france') || c.includes('франция')) return 12;
  if (c.includes('malaysia') || c.includes('малайзия')) return 17;
  // CIS Countries (MWL)
  if (c.includes('казахстан') || c.includes('kazakhstan') || c.includes('узбекистан') || c.includes('uzbekistan') || c.includes('киргизия') || c.includes('kyrgyzstan') || c.includes('таджикистан') || c.includes('tajikistan') || c.includes('туркменистан') || c.includes('turkmenistan') || c.includes('азербайджан') || c.includes('azerbaijan')) return 3;
  // North America (ISNA)
  if (c.includes('usa') || c.includes('сша') || c.includes('canada') || c.includes('канада')) return 2;
  return 3; // MWL as default for Europe/others
};

const fetchPrayerTimes = async (lat: number, lng: number, country: string) => {
  try {
    const method = getPrayerMethod(country);
    const res = await fetch(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=${method}`);
    if (!res.ok) throw new Error('Network response was not ok');
    const json = await res.json();
    return { data: json?.data };
  } catch (error) {
    console.error(error);
    return null;
  }
};

const fetchSurahsList = async () => {
  const url = 'https://api.alquran.cloud/v1/surah';
  try {
    if ('caches' in window) {
       const cache = await caches.open('angeltime-quran-cache');
       const cachedRes = await cache.match(url);
       if (cachedRes) return await cachedRes.json();
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    if ('caches' in window) {
       const cache = await caches.open('angeltime-quran-cache');
       cache.put(url, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    }
    return data;
  } catch (error) {
    console.error(error);
    return { data: [] };
  }
};

import { I18N, LangType, LANGUAGES } from './i18n';

const fetchSurahContent = async (id: number, lang: LangType, signal?: AbortSignal) => {
  const editionMap: Record<string, string> = {
    ru: 'ru.kuliev'
  };
  const edition = editionMap[lang] || 'ru.kuliev';
  const url = `https://api.alquran.cloud/v1/surah/${id}/editions/quran-uthmani,${edition}`;
  
  try {
    if ('caches' in window) {
       const cache = await caches.open('angeltime-quran-cache');
       const cachedRes = await cache.match(url);
       if (cachedRes) return await cachedRes.json();
    }
    
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    
    if ('caches' in window && data && data.data) {
       try {
         const cache = await caches.open('angeltime-quran-cache');
         cache.put(url, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
       } catch (e) {
         console.warn('Cache error:', e);
       }
    }
    return data;
  } catch (error) {
    if (error.name !== 'AbortError') console.error(error);
    return { data: [] };
  }
};

// --- Translations & I18n ---

const LanguageContext = React.createContext<{ 
  t: (key: keyof typeof I18N.ru) => string, 
  lang: LangType,
  appLang: string, 
  setAppLang: (l: string) => void 
}>({ 
  t: (k) => I18N.ru[k], 
  lang: 'ru',
  appLang: 'ru',
  setAppLang: () => {} 
});

function useTranslation() {
  return React.useContext(LanguageContext);
}

// --- Error Boundary ---

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<any, any> {
  public state = { hasError: false, error: null };
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black text-black dark:text-white p-4 transition-colors duration-300">
          <div className="text-center max-w-sm">
            <h1 className="text-2xl font-bold tracking-tight mb-2">Что-то пошло не так</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">{(this.state.error as any)?.message || 'Произошла непредвиденная ошибка.'}</p>
            <button onClick={() => window.location.reload()} className="px-6 py-3 bg-black dark:bg-white text-white dark:text-black rounded-full font-bold text-sm tracking-wide transition-opacity hover:opacity-80">
              Перезагрузить приложение
            </button>
          </div>
        </div>
      );
    }
    // @ts-ignore
    return this.props.children;
  }
}

const QuranLoader = ({ size = 220 }: { size?: number }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const startTime = performance.now();
    const cycleDuration = 3000; // 3 seconds cycle

    const keyframes = [
      // 0:00: 8-lobed rosette
      (a: number) => 46 + 6 * Math.cos(8 * a),
      // 0:01: Diagonal oval
      (a: number) => 42 + 20 * Math.cos(2 * (a - Math.PI / 4)),
      // 0:02: 10-lobed rosette
      (a: number) => 46 + 5 * Math.cos(10 * a + 0.2),
      // 0:03: 5-lobed pentagon
      (a: number) => 45 + 10 * Math.cos(5 * (a - 0.2)),
      // 0:04: 8-lobed rosette
      (a: number) => 46 + 6 * Math.cos(8 * a),
      // 0:05: 4-lobed asymmetrical blob
      (a: number) => 44 + 8 * Math.cos(4 * a + 0.5) + 3 * Math.sin(2 * a),
      // 0:06: 12-lobed flower
      (a: number) => 47 + 4 * Math.cos(12 * a),
      // 0:07: Vertical oval
      (a: number) => 42 + 18 * Math.cos(2 * (a - Math.PI / 2)),
      // 0:08: 5-lobed pentagon tilted
      (a: number) => 45 + 10 * Math.cos(5 * (a + 0.4)),
      // 0:09: Back to 8-lobed rosette
      (a: number) => 46 + 6 * Math.cos(8 * a),
    ];

    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const baseW = 240;
    const baseH = 240;
    canvas.width = baseW * dpr;
    canvas.height = baseH * dpr;
    ctx.scale(dpr, dpr);

    const cx = baseW / 2;
    const cy = baseH / 2;

    const render = (now: number) => {
      const elapsed = now - startTime;
      const progress = (elapsed % cycleDuration) / cycleDuration;

      ctx.clearRect(0, 0, baseW, baseH);

      // Outer circle (soft lilac/purple)
      ctx.beginPath();
      ctx.arc(cx, cy, 90, 0, Math.PI * 2);
      ctx.fillStyle = '#F7BDCF';
      ctx.fill();

      // Compute current morph
      const totalStages = keyframes.length - 1;
      const stageProgress = (progress % 1) * totalStages;
      const stageIdx = Math.floor(stageProgress);
      const nextIdx = (stageIdx + 1) % keyframes.length;
      const frac = stageProgress - stageIdx;

      // Cosine easing (smoother, perfectly matches video's fluid motion)
      const ease = (1 - Math.cos(frac * Math.PI)) / 2;

      const f1 = keyframes[stageIdx];
      const f2 = keyframes[nextIdx];

      const N = 72;
      const points = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const r1 = f1(a);
        const r2 = f2(a);
        const r = r1 * (1 - ease) + r2 * ease;
        points.push({
          x: cx + r * Math.cos(a),
          y: cy + r * Math.sin(a),
        });
      }

      // Draw smooth closed shape
      ctx.beginPath();
      ctx.moveTo((points[0].x + points[N - 1].x) / 2, (points[0].y + points[N - 1].y) / 2);
      for (let i = 0; i < N; i++) {
        const next = points[(i + 1) % N];
        const midX = (points[i].x + next.x) / 2;
        const midY = (points[i].y + next.y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }
      ctx.closePath();
      ctx.fillStyle = '#5A283F';
      ctx.fill();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div 
      className="flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <canvas 
        ref={canvasRef} 
        style={{ width: size, height: size }}
      />
    </div>
  );
};

// --- Components ---

const Switch = ({ 
  checked, 
  onChange, 
  activeTrackClass = 'bg-[#B85878] border-transparent', 
  activeKnobClass = 'bg-white dark:bg-[#20151A]' 
}: { 
  checked: boolean; 
  onChange: (v: boolean) => void; 
  activeTrackClass?: string; 
  activeKnobClass?: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={(e) => {
      e.stopPropagation();
      triggerHaptic();
      onChange(!checked);
    }}
    className={`w-[52px] h-[32px] rounded-full p-1 flex items-center transition-all duration-300 border-2 shrink-0 ${
      checked 
        ? `${activeTrackClass}` 
        : 'bg-transparent border-[#8E757E] dark:border-[#A68E96]'
    }`}
  >
    <div
      className={`rounded-full transition-all duration-300 flex items-center justify-center ${
        checked 
          ? `w-6 h-6 translate-x-[20px] ${activeKnobClass} text-black dark:text-[#F2B3C5] shadow-sm` 
          : 'w-4 h-4 translate-x-0.5 bg-[#8E757E] dark:bg-[#A68E96]'
      }`}
    >
      {checked && (
        <Moon className="w-3.5 h-3.5 fill-current" strokeWidth={2} />
      )}
    </div>
  </button>
);

const MaterialYouSlider = ({
  value,
  onChange,
  onPreview
}: {
  value: number;
  onChange: (val: number) => void;
  onPreview?: () => void;
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);

  const updateFromPosition = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const rawPct = Math.min(100, Math.max(0, (x / rect.width) * 100));
    // Snap to steps of 5 (e.g. 0, 5, 10, 15...)
    const pct = Math.round(rawPct / 5) * 5;
    onChange(pct);
  }, [onChange]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    triggerHaptic();
    updateFromPosition(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) {
      updateFromPosition(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) {
      isDragging.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      if (onPreview) onPreview();
    }
  };

  // Discrete dots along the track representing 10% steps
  const dots = [10, 20, 30, 40, 50, 60, 70, 80, 90];

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative w-full h-10 flex items-center cursor-pointer select-none touch-none py-1"
    >
      {/* Pill Track */}
      <div className="absolute inset-0 rounded-full flex items-center overflow-hidden bg-[#F6DFE7] dark:bg-[#36242D]">
        {/* Filled portion */}
        <div
          className="h-full bg-[#B85878] transition-[width] duration-75 ease-out rounded-l-full"
          style={{ width: `${value}%` }}
        />
        {/* Unfilled portion */}
        <div
          className="h-full flex-1 bg-[#F6DFE7] dark:bg-[#36242D] rounded-r-full"
        />
      </div>

      {/* Vertical handle separator line */}
      <div
        className="absolute w-[6px] bg-white rounded-full z-20 pointer-events-none transition-all duration-75 ease-out shadow-md border border-stone-200/50"
        style={{ 
          // Adjust position so the center of the handle aligns perfectly with the fill boundary
          // while keeping the handle strictly inside the track bounds at 0% and 100%
          left: `calc(${Math.min(100, Math.max(0, value))}% - 3px)`,
          marginLeft: value <= 0 ? '3px' : value >= 100 ? '-3px' : '0',
          // Shrink the height when at the very edges to fit inside the pill's rounded corners
          top: (value <= 2 || value >= 98) ? '4px' : '-2px',
          bottom: (value <= 2 || value >= 98) ? '4px' : '-2px',
        }}
      />

      {/* Subtle Step Dots */}
      {dots.map((dotPct) => {
        const isFilled = dotPct <= value;
        return (
          <div
            key={dotPct}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full z-10 pointer-events-none transition-colors duration-100 ${
              isFilled
                ? 'bg-white/95'
                : 'bg-[#6D3A50] dark:bg-[#F2B3C5] opacity-75'
            }`}
            style={{ left: `${dotPct}%` }}
          />
        );
      })}
    </div>
  );
};

export default function App() {
  const [appLang, setAppLang] = useState('ru');

  useEffect(() => {
    const savedLang = localStorage.getItem('angelTimeAppLanguage');
    if (savedLang === 'ru') setAppLang(savedLang);
  }, []);

  const handleSetAppLang = (l: string) => {
    setAppLang('ru');
    localStorage.setItem('angelTimeAppLanguage', 'ru');
  };

  const getActiveLanguage = (): LangType => {
    return 'ru';
  };

  const activeLang = getActiveLanguage();
  const t = (key: keyof typeof I18N.ru) => (I18N as any)[activeLang]?.[key] || I18N.ru[key] || key;

  return (
    <ErrorBoundary>
      <LanguageContext.Provider value={{ t, lang: activeLang, appLang, setAppLang: handleSetAppLang }}>
        <AppContent />
      </LanguageContext.Provider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const { t } = useTranslation();
  // Global State
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [timeFormatMode, setTimeFormatMode] = useState<'auto' | '24h' | '12h'>(() => {
    const saved = localStorage.getItem('angelTimeFormatSetting');
    if (saved === 'auto' || saved === '24h' || saved === '12h') return saved;
    return '24h'; // default to 24h unless user changes or system auto is selected
  });
  const [systemFormat, setSystemFormat] = useState<'24h' | '12h'>(detectSystemTimeFormat);
  const timeFormat = timeFormatMode === 'auto' ? systemFormat : timeFormatMode;

  const handleSetTimeFormatMode = (mode: 'auto' | '24h' | '12h') => {
    setTimeFormatMode(mode);
    localStorage.setItem('angelTimeFormatSetting', mode);
  };
  const [location, setLocation] = useState<{city: string, country: string, lat: number, lng: number} | null>(null);
  const [tab, setTab] = useState<'prayers' | 'quran'>('prayers');
  const [screen, setScreen] = useState<'main' | 'location' | 'settings'>('main');
  const [streak, setStreak] = useState(0);
  const [lastReadDate, setLastReadDate] = useState('');
  const [azanVolume, setAzanVolume] = useState<number>(() => {
    const saved = localStorage.getItem('angelTimeAzanVolume');
    return saved !== null ? parseInt(saved, 10) : 0;
  });
  useEffect(() => {
    localStorage.setItem('angelTimeAzanVolume', azanVolume.toString());
  }, [azanVolume]);

  // Quran Global State
  const [surahs, setSurahs] = useState<any[]>([]);
  const [surahsLoading, setSurahsLoading] = useState(true);

  // Prayer Timings Global State
  const [timings, setTimings] = useState<Record<string, string> | null>(null);
  const [timingsLoading, setTimingsLoading] = useState(true);
  const [timingsError, setTimingsError] = useState<string | null>(null);

  // Keep system time format synchronized with device phone settings
  useEffect(() => {
    const updateTimeFormat = () => {
      setSystemFormat(detectSystemTimeFormat());
    };
    updateTimeFormat();
    window.addEventListener('focus', updateTimeFormat);
    document.addEventListener('visibilitychange', updateTimeFormat);
    return () => {
      window.removeEventListener('focus', updateTimeFormat);
      document.removeEventListener('visibilitychange', updateTimeFormat);
    };
  }, []);

  // Initialize from LocalStorage and Fetch Surahs
  useEffect(() => {
    const savedTheme = localStorage.getItem('angelTimeTheme') as 'light' | 'dark' | null;
    if (savedTheme) setTheme(savedTheme);
    
    // Clear any obsolete manual timeFormat override so phone system settings are strictly respected
    localStorage.removeItem('angelTimeFormat');
    
    const savedLocation = localStorage.getItem('angelTimeLocation');
    if (savedLocation) { try { setLocation(JSON.parse(savedLocation)); } catch (e) { localStorage.removeItem("angelTimeLocation"); } }

    const savedStreak = parseInt(localStorage.getItem('angelTimeStreak') || '0', 10);
    const savedLastDate = localStorage.getItem('angelTimeLastReadDate') || '';
    
    let currentStreak = savedStreak;
    let currentLastDate = savedLastDate;
    
    if (!currentLastDate) {
      const oldDataStr = localStorage.getItem('angelTimeStreakData');
      if (oldDataStr) {
        try {
          const oldData = JSON.parse(oldDataStr);
          currentStreak = oldData.count || 0;
          currentLastDate = oldData.lastDate || '';
          localStorage.setItem('angelTimeStreak', currentStreak.toString());
          localStorage.setItem('angelTimeLastReadDate', currentLastDate);
          localStorage.removeItem('angelTimeStreakData');
        } catch(e) {}
      }
    }

    const today = getLocalDateString();
    
    if (currentLastDate) {
       const lastDateObj = new Date(currentLastDate);
       const todayObj = new Date(today);
       const diffTime = todayObj.getTime() - lastDateObj.getTime();
       const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
       
       if (diffDays > 1) {
          currentStreak = 0;
          localStorage.setItem('angelTimeStreak', '0');
       }
    }
    
    setStreak(currentStreak);
    setLastReadDate(currentLastDate);

    fetchSurahsList()
      .then(res => {
        setSurahs(res.data);
        setSurahsLoading(false);
      })
      .catch(() => setSurahsLoading(false));
  }, []);

  // Fetch Timings when location changes
  useEffect(() => {
    let isMounted = true;
    if (!location) {
      setTimingsLoading(false);
      return;
    }
    setTimingsLoading(true);
    setTimingsError(null);
    fetchPrayerTimes(location.lat, location.lng, location.country)
      .then(res => {
        if (isMounted) {
          if (res && res.data && res.data.timings) {
             const cleanTimings: Record<string, string> = {};
             for (const [k, v] of Object.entries(res.data.timings)) {
                cleanTimings[k] = (v as string).split(' ')[0];
             }
             setTimings(cleanTimings);
          } else {
             setTimingsError(t('loadingError'));
          }
          setTimingsLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          setTimingsError(t('loadingError'));
          setTimingsLoading(false);
        }
      });
    return () => { isMounted = false; };
  }, [location?.lat, location?.lng, location?.country]);

  // Update Theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('angelTimeTheme', theme);
  }, [theme]);

  // Update Streak
  useEffect(() => {
    // Cleanup legacy localStorage cache to free up quota
    setTimeout(() => {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('angelTime_surah_')) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {}
    }, 1000);
  }, []);

  const incrementStreak = useCallback(() => {
    setLastReadDate(prevLastDate => {
      setStreak(prevStreak => {
         const today = getLocalDateString();
         if (prevLastDate === today) return prevStreak;
         
         let newStreak = prevStreak;
         if (prevLastDate) {
            const lastDateObj = new Date(prevLastDate);
            const todayObj = new Date(today);
            const diffTime = todayObj.getTime() - lastDateObj.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays === 1) {
               newStreak += 1;
            } else if (diffDays > 1) {
               newStreak = 1;
            }
         } else {
            newStreak = 1;
         }
         
         localStorage.setItem('angelTimeStreak', newStreak.toString());
         localStorage.setItem('angelTimeLastReadDate', today);

         // Track daily reading history for the chart
         try {
           const historyStr = localStorage.getItem('angelTimeReadingHistory');
           const history: Record<string, number> = historyStr ? JSON.parse(historyStr) : {};
           history[today] = (history[today] || 0) + 1;
           localStorage.setItem('angelTimeReadingHistory', JSON.stringify(history));
         } catch (e) {}

         return newStreak;
      });
      return getLocalDateString();
    });
  }, []);

  return (
    <div className={`${theme === 'dark' ? 'dark' : ''}`}>
      <div className="min-h-screen bg-[#FCF6F8] dark:bg-[#1B1317] text-black dark:text-[#F5E9ED] transition-colors duration-300 font-sans selection:bg-pink-200 selection:text-pink-900 dark:selection:bg-pink-950 dark:selection:text-pink-100">
        {screen === 'main' && (
          <>
            <div className={tab === 'prayers' ? "h-[100dvh] flex flex-col justify-between overflow-hidden select-none touch-none" : "min-h-screen flex flex-col"}>
              <header className="shrink-0 bg-[#FCF6F8]/80 dark:bg-[#1B1317]/80 backdrop-blur-xl flex items-center justify-between px-6 pt-3 pb-2 transition-colors duration-300">
                <h1 className="text-2xl font-bold tracking-tight">
                  Angels' Time
                </h1>
                <button 
                  onClick={() => setScreen('settings')} 
                  className="p-3 bg-white dark:bg-[#291D23] rounded-full hover:shadow-md active:scale-95 transition-all duration-200 border border-stone-100 dark:border-stone-800 shadow-sm shrink-0 flex items-center justify-center"
                >
                  <Settings className="w-6 h-6 text-black dark:text-[#F2B3C5]" strokeWidth={2} />
                </button>
              </header>

              <main className={`max-w-2xl mx-auto px-4 w-full ${tab === 'prayers' ? 'flex-1 flex flex-col min-h-0 pb-[120px] pt-1' : 'pb-[90px] pt-1'}`}>
                {tab === 'prayers' && (
                  <PrayerScreen 
                    location={location} 
                    timings={timings}
                    timingsLoading={timingsLoading}
                    timingsError={timingsError}
                    timeFormat={timeFormat}
                    azanVolume={azanVolume}
                    azanSoundUrl={'./adhan.mp3'}
                    onOpenLocation={() => setScreen('location')} 
                  />
                )}
                {tab === 'quran' && (
                  <QuranScreen streak={streak} onReadSurah={incrementStreak} surahs={surahs} loading={surahsLoading} />
                )}
              </main>

              <div className="fixed bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 z-30 w-full max-w-[340px] px-4 pointer-events-auto pb-safe">
                <div className="bg-white/95 dark:bg-[#291D23]/95 rounded-full p-1.5 flex justify-between shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-stone-100/50 dark:border-[#3A2931]/50 backdrop-blur-2xl">
                  <button 
                    onClick={() => {
                      triggerHaptic();
                      setTab('prayers');
                    }} 
                    className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-full transition-all duration-300 ${
                      tab === 'prayers' 
                        ? 'bg-[#B85878] text-white shadow-sm' 
                        : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 bg-transparent'
                    }`}
                  >
                    <Clock className="w-5 h-5" strokeWidth={tab === 'prayers' ? 2.5 : 2} />
                    <span className={`text-[17px] tracking-wide ${tab === 'prayers' ? 'font-bold' : 'font-semibold'}`}>{t('prayers')}</span>
                  </button>
                  <button 
                    onClick={() => {
                      triggerHaptic();
                      setTab('quran');
                    }} 
                    className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-full transition-all duration-300 ${
                      tab === 'quran' 
                        ? 'bg-[#B85878] text-white shadow-sm' 
                        : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 bg-transparent'
                    }`}
                  >
                    <BookOpen className="w-5 h-5" strokeWidth={tab === 'quran' ? 2.5 : 2} />
                    <span className={`text-[17px] tracking-wide ${tab === 'quran' ? 'font-bold' : 'font-semibold'}`}>{t('quran')}</span>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {screen === 'location' && (
          <LocationSearch 
            onClose={() => setScreen('main')} 
            onSelect={(loc) => {
              setLocation(loc);
              localStorage.setItem('angelTimeLocation', JSON.stringify(loc));
              setScreen('main');
            }} 
          />
        )}

        {screen === 'settings' && (
          <SettingsScreen 
            theme={theme} 
            setTheme={setTheme} 
            azanVolume={azanVolume}
            setAzanVolume={setAzanVolume}
            azanSoundUrl={'./adhan.mp3'}
            onClose={() => setScreen('main')} 
          />
        )}
      </div>
    </div>
  );
}


function ShowAllPrayersModal({ 
  onClose, PRAYER_MAP, t, timingsError, timings, formatTime, 
  azanSounds, setAzanSounds, notifications, setNotifications
}: any) {
  const dragControls = useDragControls();
  
  const handleDragEnd = (_event: any, info: PanInfo) => {
    // If pulled down enough (distance or speed), close the modal
    if (info.offset.y > 55 || info.velocity.y > 350) {
      triggerHaptic();
      onClose();
    }
  };

  return (
    <motion.div 
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[100] bg-[#FCF6F8] dark:bg-[#1B1317] flex flex-col justify-between select-none overflow-hidden touch-none"
      drag="y"
      dragControls={dragControls}
      dragListener={true}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.5 }}
      onDragEnd={handleDragEnd}
    >
      {/* Top spacer / drag handle area */}
      <div 
        className="pt-3 pb-1 flex justify-center shrink-0 w-full cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => dragControls.start(e)}
      >
        <div className="w-12 h-1.5 bg-stone-300 dark:bg-stone-700 rounded-full opacity-60"></div>
      </div>
      
      {/* Cards container - exactly 6 cards fitting strictly on one screen with NO scroll */}
      <div className="flex-1 flex flex-col justify-evenly px-4 sm:px-6 pb-4 sm:pb-6 max-w-lg mx-auto w-full overflow-hidden gap-1 sm:gap-1.5 pt-2">
        {PRAYER_MAP.map((prayer: any) => (
          <div key={prayer.id} className="flex items-center justify-between p-3.5 sm:p-4 bg-white dark:bg-[#291D23] shadow-sm border border-stone-100 dark:border-[#3A2931] rounded-[28px] sm:rounded-[32px] transition-all duration-200 w-full">
            <div className="flex items-center gap-4 sm:gap-5 pointer-events-none">
              <div className={`p-3.5 sm:p-4 rounded-full ${prayer.colorClass}`}>
                <prayer.icon className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={2.5} />
              </div>
              <div>
                <div className="font-bold text-lg sm:text-xl tracking-tight mb-0.5">{t(prayer.id as any)}</div>
                <div className="font-semibold text-base text-stone-500 dark:text-stone-400">
                  {timingsError ? '--:--' : timings ? formatTime(timings[prayer.id]) : <div className="h-4 w-12 bg-stone-200 dark:bg-stone-800 rounded animate-pulse" />}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic();
                  const isCurrentlyOn = azanSounds[prayer.id];
                  setAzanSounds((prev: any) => ({ ...prev, [prayer.id]: !isCurrentlyOn }));
                }}
                className={`p-3 sm:p-3.5 rounded-full transition-colors ${azanSounds[prayer.id] ? prayer.colorClass : 'text-stone-400 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700'}`}
                title="Азан"
              >
                {azanSounds[prayer.id] ? <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} /> : <VolumeX className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} />}
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic();
                  const isCurrentlyOn = notifications[prayer.id];
                  setNotifications((prev: any) => ({ ...prev, [prayer.id]: !isCurrentlyOn }));
                }}
                className={`p-3 sm:p-3.5 rounded-full transition-colors ${notifications[prayer.id] ? prayer.colorClass : 'text-stone-400 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700'}`}
              >
                {notifications[prayer.id] ? <Bell className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} /> : <BellOff className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.5} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// --- Prayer Screen ---


const PRAYER_MAP = [
  { id: 'Fajr', name: 'Фаджр', icon: Moon, colorClass: 'bg-[#B85878] text-white', switchTrack: 'bg-[#B85878] border-[#B85878]', switchKnob: 'bg-white' },
  { id: 'Sunrise', name: 'Восход', icon: Sunrise, colorClass: 'bg-[#B85878] text-white', switchTrack: 'bg-[#B85878] border-[#B85878]', switchKnob: 'bg-white' },
  { id: 'Dhuhr', name: 'Зухр', icon: Sun, colorClass: 'bg-[#B85878] text-white', switchTrack: 'bg-[#B85878] border-[#B85878]', switchKnob: 'bg-white' },
  { id: 'Asr', name: 'Аср', icon: CloudSun, colorClass: 'bg-[#B85878] text-white', switchTrack: 'bg-[#B85878] border-[#B85878]', switchKnob: 'bg-white' },
  { id: 'Maghrib', name: 'Магриб', icon: Sunset, colorClass: 'bg-[#B85878] text-white', switchTrack: 'bg-[#B85878] border-[#B85878]', switchKnob: 'bg-white' },
  { id: 'Isha', name: 'Иша', icon: MoonStar, colorClass: 'bg-[#B85878] text-white', switchTrack: 'bg-[#B85878] border-[#B85878]', switchKnob: 'bg-white' },
];

function PrayerScreen({ location, timings, timingsLoading, timingsError, timeFormat, azanVolume = 0, azanSoundUrl = './adhan.mp3', onOpenLocation }: { 
  location: { city: string, country: string, lat: number, lng: number } | null, 
  timings: Record<string, string> | null,
  timingsLoading: boolean,
  timingsError: string | null,
  timeFormat: '12h' | '24h',
  azanVolume?: number,
  azanSoundUrl?: string,
  onOpenLocation: () => void 
}) {
  const { t } = useTranslation();
  const [showAllPrayers, setShowAllPrayers] = useState(() => {
    const saved = localStorage.getItem('angelTimeShowAllPrayers');
    return saved === 'true';
  });
  useEffect(() => {
    localStorage.setItem('angelTimeShowAllPrayers', String(showAllPrayers));
    
    if (showAllPrayers) {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    }
    
    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, [showAllPrayers]);

  const [notifications, setNotifications] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('angelTimeNotifications');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        localStorage.removeItem('angelTimeNotifications');
      }
    }
    return {
      Fajr: false, Sunrise: false, Dhuhr: false, Asr: false, Maghrib: false, Isha: false
    };
  });

  useEffect(() => {
    localStorage.setItem('angelTimeNotifications', JSON.stringify(notifications));
  }, [notifications]);

  const [azanSounds, setAzanSounds] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('angelTimeAzanSounds');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        localStorage.removeItem('angelTimeAzanSounds');
      }
    }
    return {
      Fajr: false, Sunrise: false, Dhuhr: false, Asr: false, Maghrib: false, Isha: false
    };
  });

  useEffect(() => {
    localStorage.setItem('angelTimeAzanSounds', JSON.stringify(azanSounds));
  }, [azanSounds]);
  
  const [nextPrayer, setNextPrayer] = useState<{id: string, diff: string, hours: number, mins: number, secs: number} | null>(null);

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    if (timeFormat === '24h') return timeStr;
    
    const [hours, mins] = timeStr.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${mins.toString().padStart(2, '0')} ${ampm}`;
  };

  const lastNotified = useRef<Record<string, number>>({});
  
  // Calculate Next Prayer and Countdown
  useEffect(() => {
    if (!timings) return;

    const calculate = () => {
      const now = new Date();
      let nextP = null;
      let minDiff = Infinity;

      for (const p of PRAYER_MAP) {
        if (p.id === 'Sunrise') continue;
        const timeStr = timings[p.id];
        if (!timeStr) continue;
        
        const [hours, mins] = timeStr.split(':').map(Number);
        const prayerTime = new Date();
        prayerTime.setHours(hours, mins, 0, 0);
        
        let diff = prayerTime.getTime() - now.getTime();
        
        if (diff < 0) {
          prayerTime.setDate(prayerTime.getDate() + 1);
          diff = prayerTime.getTime() - now.getTime();
        }

        if (diff < minDiff) {
          minDiff = diff;
          nextP = p.id;
        }
      }

      if (nextP) {
        const h = Math.floor((minDiff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((minDiff / 1000 / 60) % 60);
        const s = Math.floor((minDiff / 1000) % 60);
        
        const formattedDiff = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        
        setNextPrayer({ id: nextP, diff: formattedDiff, hours: h, mins: m, secs: s });
      }
    };

    calculate(); // Initial call
    const interval = setInterval(() => {
      calculate();
      
      // Notification trigger logic
      if ('Notification' in window && Notification.permission === 'granted') {
        const now = new Date();
        const PRAYER_TEXTS: Record<string, string> = {
          Fajr: "Намаз лучше сна",
          Sunrise: "Время восхода солнца",
          Dhuhr: "Время полуденной молитвы. Пусть Аллах примет ваш намаз",
          Asr: "Время послеполуденной молитвы. Отвлекитесь от мирского",
          Maghrib: "Время вечерней молитвы. Завершите день с благодарностью",
          Isha: "Время ночной молитвы. Мир вам и покой"
        };
        
        PRAYER_MAP.forEach(p => {
          const isNotif = notifications[p.id];
          const isSound = azanSounds[p.id];
          
          if (isNotif || isSound) {
            const timeStr = timings[p.id];
            if (!timeStr) return;
            const [hours, mins] = timeStr.split(':').map(Number);
            
            // If current time exactly matches prayer minute
            if (now.getHours() === hours && now.getMinutes() === mins) {
              const dayStr = now.toDateString();
              const key = p.id + '-' + dayStr;
              
              if (!lastNotified.current[key]) {
                lastNotified.current[key] = now.getTime();
                
                // Play Azan audio if enabled (except Sunrise)
                if (isSound && p.id !== 'Sunrise') {
                  try {
                    globalAudioEngine.play(azanSoundUrl || './adhan.mp3', azanVolume ?? 0);
                  } catch (e) {
                    console.log('Audio playback error:', e);
                  }
                }
                
                // Show notification if enabled
                if (isNotif) {
                  const title = t(p.id.toLowerCase()) || p.name;
                  const body = PRAYER_TEXTS[p.id] || "Время намаза";
                  
                  try {
                    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                      navigator.serviceWorker.ready.then(registration => {
                        (registration as any).showNotification(title, {
                          body,
                          icon: '/vite.svg',
                          badge: '/vite.svg',
                          vibrate: [200, 100, 200]
                        });
                      });
                    } else {
                      new Notification(title, { body, icon: '/vite.svg' });
                    }
                  } catch (e) {
                    try {
                      new Notification(title, { body, icon: '/vite.svg' });
                    } catch (err) {}
                  }
                }
              }
            }
          }
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [timings, notifications, azanSounds]);

  if (!location) {
    return (
      <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center pt-20 pb-10 px-4 text-center">
        <div className="w-24 h-24 bg-[#B85878] text-white rounded-[24px] flex items-center justify-center mb-6 shadow-sm">
          <MapPin className="w-10 h-10 text-white" strokeWidth={2.2} />
        </div>
        <h2 className="text-2xl font-bold mb-6 tracking-tight text-stone-900 dark:text-white">{t('welcome')}</h2>
        <button 
          onClick={() => {
            triggerHaptic();
            onOpenLocation();
          }}
          className="px-8 py-4 bg-[#B85878] text-white rounded-[28px] font-bold shadow-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-2"
        >
          <Search className="w-5 h-5 text-white" />
          {t('chooseCity')}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col justify-start gap-3 sm:gap-4 pt-0 pb-0 max-w-md mx-auto w-full animate-in fade-in duration-500">
      <button 
        onClick={() => {
          triggerHaptic();
          onOpenLocation();
        }}
        className="w-full flex items-center gap-4 bg-[#B85878] text-white rounded-[24px] sm:rounded-[28px] p-3 transition-all duration-200 hover:opacity-95 active:scale-[0.98] shrink-0 shadow-sm"
      >
        <div className="w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center bg-white/20 rounded-full shrink-0">
          <MapPin className="w-6 h-6 sm:w-7 sm:h-7 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex-1 text-left min-w-0 pr-4">
          <div className="font-extrabold text-xl sm:text-2xl tracking-tight truncate text-white">
            {location.city}
          </div>
          <div className="text-sm sm:text-base font-bold text-white/80 truncate">
            {location.country.split(', ').filter(part => part.toLowerCase() !== location.city.toLowerCase()).join(', ') || location.country}
          </div>
        </div>
      </button>

      {timingsError ? (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-[24px] p-6 text-center font-medium">
          {timingsError}
        </div>
      ) : (
        <div className="flex flex-col items-center filter drop-shadow-sm mt-1 sm:mt-2">
          <div className="bg-[#B85878] text-white w-full rounded-[28px] sm:rounded-[32px] py-8 sm:py-10 px-4 flex flex-col items-center justify-center text-center relative z-10 shadow-sm">
            <h2 className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.25em] mb-4 sm:mb-5 text-white/80">
              {t('untilNextPrayer')}
            </h2>
            
            <div className="text-3xl sm:text-4xl font-extrabold mb-2 sm:mb-3 tracking-tight h-10 sm:h-12 flex items-center justify-center gap-3 text-white">
              {nextPrayer ? (
                <>
                  {(() => {
                    const prayerData = PRAYER_MAP.find(p => p.id === nextPrayer.id);
                    if (prayerData) {
                      const Icon = prayerData.icon;
                      return (
                        <div className="flex items-center justify-center shrink-0">
                          <Icon className="w-7 h-7 sm:w-8 sm:h-8 text-white" strokeWidth={2.5} />
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <span>{t(nextPrayer.id as any)}</span>
                </>
              ) : timings ? '...' : <div className="h-10 w-32 bg-white/20 rounded-lg animate-pulse" />}
            </div>
            
            <div className="text-[4.5rem] sm:text-[5.5rem] leading-none font-extrabold tracking-tighter tabular-nums h-[76px] sm:h-[90px] flex items-center justify-center text-white drop-shadow-sm">
              {nextPrayer ? nextPrayer.diff : timings ? '00:00:00' : <div className="h-16 w-56 sm:w-64 bg-white/20 rounded-xl animate-pulse" />}
            </div>
            
            <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.25em] text-white/80 mt-3 sm:mt-4">
              {t('timeLeft')}
            </div>
          </div>
          
          <button 
            onClick={() => {
              triggerHaptic();
              setShowAllPrayers(true);
            }}
            className="flex items-center gap-2.5 px-8 pt-5 pb-2.5 bg-[#A34766] text-white rounded-b-[24px] sm:rounded-b-[28px] font-extrabold text-lg sm:text-xl hover:opacity-90 active:scale-95 transition-all -mt-4 z-0 shadow-sm"
          >
            {t('showAll') || 'Показать все'}
            <ChevronDown className="w-6 h-6 sm:w-7 sm:h-7 text-white" strokeWidth={3} />
          </button>
        </div>
      )}

      <AnimatePresence>
        {showAllPrayers && (
          <ShowAllPrayersModal
            onClose={() => setShowAllPrayers(false)}
            PRAYER_MAP={PRAYER_MAP}
            t={t}
            timingsError={timingsError}
            timings={timings}
            formatTime={formatTime}
            azanSounds={azanSounds}
            setAzanSounds={setAzanSounds}
            notifications={notifications}
            setNotifications={setNotifications}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Quran Screen ---

interface SurahType {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
}

const QuranScreen = React.memo(function QuranScreen({ streak: _streak, onReadSurah, surahs, loading }: { streak?: number; onReadSurah: () => void; surahs: SurahType[]; loading: boolean }) {
  const { t, lang } = useTranslation();
  const [activeSurah, setActiveSurah] = useState<number | null>(null);
  const [initialAyah, setInitialAyah] = useState<number | null>(null);
  const [lastReadSurah, setLastReadSurah] = useState<number | null>(() => {
    const saved = localStorage.getItem('lastReadSurah');
    return saved ? parseInt(saved, 10) : null;
  });
  const [lastReadAyah, setLastReadAyah] = useState<number | null>(() => {
    const savedSurah = localStorage.getItem('lastReadSurah');
    if (savedSurah) {
      const savedAyah = localStorage.getItem(`lastReadAyah_${savedSurah}`) || localStorage.getItem('lastReadAyah');
      return savedAyah ? parseInt(savedAyah, 10) : null;
    }
    return null;
  });

  const handleCloseSurah = useCallback(() => {
    setActiveSurah(null);
    setInitialAyah(null);
    const savedSurah = localStorage.getItem('lastReadSurah');
    if (savedSurah) {
      const sNum = parseInt(savedSurah, 10);
      setLastReadSurah(sNum);
      const savedAyah = localStorage.getItem(`lastReadAyah_${sNum}`) || localStorage.getItem('lastReadAyah');
      setLastReadAyah(savedAyah ? parseInt(savedAyah, 10) : null);
    }
  }, []);

  const handleOpenSurah = (surahNumber: number, targetAyah?: number | null) => {
    triggerHaptic();
    setActiveSurah(surahNumber);
    setLastReadSurah(surahNumber);
    localStorage.setItem('lastReadSurah', surahNumber.toString());

    const ayahToRestore = targetAyah !== undefined 
      ? targetAyah 
      : (() => {
          const s = localStorage.getItem(`lastReadAyah_${surahNumber}`);
          return s ? parseInt(s, 10) : 1;
        })();

    setInitialAyah(ayahToRestore);
    if (ayahToRestore) {
      setLastReadAyah(ayahToRestore);
    }
  };

  const safeSurahs = Array.isArray(surahs) ? surahs : [];
  const filteredSurahs = safeSurahs.filter(s => s && s.number);

  const SURAH_COLOR = 'bg-[#B85878] text-white shadow-sm';

  return (
    <div className="animate-in fade-in duration-500">
      {lastReadSurah && safeSurahs.length > 0 && !loading && (
        <button 
          onClick={() => {
            const savedAyah = localStorage.getItem(`lastReadAyah_${lastReadSurah}`) || localStorage.getItem('lastReadAyah');
            const ayahNum = savedAyah ? parseInt(savedAyah, 10) : 1;
            handleOpenSurah(lastReadSurah, ayahNum);
          }}
          className="w-full mb-4 flex items-center gap-4 bg-white dark:bg-[#36242D] rounded-[28px] sm:rounded-[32px] p-3 transition-all duration-200 hover:opacity-90 active:scale-[0.98] shrink-0 text-left"
        >
          <div className="w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center bg-[#B85878] text-white rounded-full shrink-0 shadow-sm">
            <BookOpen className="w-6 h-6 sm:w-7 sm:h-7 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex-1 text-left min-w-0 pr-2">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-stone-500 dark:text-[#E8B2C3] mb-0.5">{t('continueReading')}</div>
            <div className="font-extrabold text-xl sm:text-2xl tracking-tight truncate text-black dark:text-[#FCEEF3]">
              {safeSurahs.find(s => s.number === lastReadSurah) ? 
                (SURAH_NAMES[lang]?.[lastReadSurah - 1] || safeSurahs.find(s => s.number === lastReadSurah)!.englishName)
                : `${t('surahPrefix')} ${lastReadSurah}`}
            </div>
            {lastReadAyah && lastReadAyah > 0 && (
              <div className="text-sm sm:text-base font-bold text-stone-500 dark:text-[#E8B2C3] truncate">
                {lang === 'ru' ? `Аят ${lastReadAyah}` : `Ayah ${lastReadAyah}`}
              </div>
            )}
          </div>
          <ChevronLeft className="w-6 h-6 sm:w-7 sm:h-7 text-stone-500 dark:text-[#E8B2C3] opacity-60 rotate-180 shrink-0 mr-3" strokeWidth={2.5} />
        </button>
      )}

      {loading ? (
        <QuranLoader />
      ) : (
        <div className="bg-white dark:bg-[#36242D] rounded-[28px] overflow-hidden">
          {filteredSurahs.map((surah, index) => {
            const colorClass = SURAH_COLOR;
            return (
            <button 
              key={surah.number} 
              onClick={() => handleOpenSurah(surah.number)} 
              className={`w-full flex items-center justify-between p-5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors duration-200 active:bg-black/[0.06] dark:active:bg-white/[0.06] ${
                index !== filteredSurahs.length - 1 ? 'border-b border-black/[0.03] dark:border-white/[0.03]' : ''
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-sm font-bold ${colorClass}`}>
                  {surah.number}
                </div>
                <div>
                  <div className="font-bold text-base tracking-tight mb-0.5">{surah.englishName}</div>
                  <div className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                    {lang === 'ru' ? (SURAH_NAMES['ru']?.[surah.number - 1] || surah.englishNameTranslation) : '######'}
                  </div>
                </div>
              </div>
              <div className="font-bold text-xl text-right leading-relaxed font-arabic" dir="rtl">{surah.name}</div>
            </button>
            );
          })}
        </div>
      )}

      {activeSurah && (
        <SurahReader 
          surahId={activeSurah} 
          onClose={handleCloseSurah} 
          onReadSurah={onReadSurah}
          initialAyahNumber={initialAyah}
        />
      )}
    </div>
  );
});

// --- Colorized Arabic Helper ---

function ColorizedArabic({ text }: { text: string }) {
  // Split the text to isolate Arabic diacritics (harakat/tashkeel)
  const parts = text.split(/([\u064B-\u065F\u0670\u06D6-\u06ED]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/[\u064B-\u065F\u0670\u06D6-\u06ED]/.test(part)) {
          return <span key={i} className="text-amber-600 dark:text-amber-400 opacity-90">{part}</span>;
        }
        return <span key={i} className="text-black dark:text-[#F5E9ED]">{part}</span>;
      })}
    </>
  );
}

// --- Surah Reader Screen ---

const SurahReader = React.memo(function SurahReader({ 
  surahId, 
  onClose, 
  onReadSurah,
  initialAyahNumber
}: { 
  surahId: number; 
  onClose: () => void; 
  onReadSurah: () => void;
  initialAyahNumber?: number | null;
}) {
  const { t, lang } = useTranslation();
  const [data, setData] = useState<{arabic: any[], translation: any[], metadata: any} | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [activeAyah, setActiveAyah] = useState<number>(() => {
    if (initialAyahNumber && initialAyahNumber > 0) return initialAyahNumber;
    const saved = localStorage.getItem(`lastReadAyah_${surahId}`);
    return saved ? parseInt(saved, 10) : 1;
  });

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const ayahElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const isProgrammaticScrollRef = useRef(false);
  const hasRestoredPositionRef = useRef(false);

  // Smooth scroll to a target Ayah and update reading state
  const scrollToAyah = useCallback((ayahNum: number, smooth: boolean = true) => {
    const el = ayahElementsRef.current.get(ayahNum) || document.getElementById(`ayah-${ayahNum}`);
    if (el) {
      isProgrammaticScrollRef.current = true;
      setActiveAyah(ayahNum);
      localStorage.setItem(`lastReadAyah_${surahId}`, ayahNum.toString());
      localStorage.setItem('lastReadAyah', ayahNum.toString());
      localStorage.setItem('lastReadSurah', surahId.toString());

      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
      
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, smooth ? 600 : 80);
    }
  }, [surahId]);

  // Click handler for direct Ayah tap
  const handleAyahClick = (ayahNum: number) => {
    triggerHaptic();
    scrollToAyah(ayahNum, true);
  };

  // Exit handler to ensure current Ayah is saved before closing
  const handleExit = () => {
    if (activeAyah) {
      localStorage.setItem(`lastReadAyah_${surahId}`, activeAyah.toString());
      localStorage.setItem('lastReadAyah', activeAyah.toString());
      localStorage.setItem('lastReadSurah', surahId.toString());
    }
    onClose();
  };

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    setLoading(true);
    
    fetchSurahContent(surahId, lang, controller.signal)
      .then((res) => {
        if (isMounted) {
          const dataArray = Array.isArray(res?.data) ? res.data : [];
          const arabic = dataArray.find((e: any) => e?.edition?.identifier === 'quran-uthmani');
          const translation = dataArray.find((e: any) => e?.edition?.identifier !== 'quran-uthmani') || arabic;
          
          if (arabic) {
            setData({
              arabic: arabic.ayahs || [],
              translation: (translation && translation.ayahs) ? translation.ayahs : [],
              metadata: arabic
            });
            setLoading(false);
            onReadSurah();
          } else {
            if (isMounted) {
              setLoading(false);
              setError(true);
            }
          }
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoading(false);
          setError(true);
        }
      });
    return () => { isMounted = false; controller.abort(); };
  }, [surahId, onReadSurah, lang]);

  // Restore scroll position when data finishes loading
  useEffect(() => {
    if (!loading && data && data.arabic && data.arabic.length > 0 && !hasRestoredPositionRef.current) {
      hasRestoredPositionRef.current = true;
      const target = (initialAyahNumber && initialAyahNumber > 0)
        ? initialAyahNumber
        : (() => {
            const s = localStorage.getItem(`lastReadAyah_${surahId}`);
            return s ? parseInt(s, 10) : 1;
          })();

      if (target && target > 1) {
        setActiveAyah(target);
        const timer = setTimeout(() => {
          scrollToAyah(target, true);
        }, 150);
        return () => clearTimeout(timer);
      }
    }
  }, [loading, data, initialAyahNumber, surahId, scrollToAyah]);

  // Track the visible reading Ayah on scroll
  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    const container = scrollContainerRef.current;
    if (!container || !data?.arabic || data.arabic.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    // Reader's optimal eye focus zone: approx 36% down the viewport
    const focusY = containerRect.top + containerRect.height * 0.36;

    let closestAyah = activeAyah;
    let minDistance = Infinity;

    ayahElementsRef.current.forEach((el, ayahNum) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();

      // Check if the focus line intersects this Ayah card
      if (rect.top <= focusY && rect.bottom >= focusY) {
        closestAyah = ayahNum;
        minDistance = 0;
      } else if (minDistance !== 0) {
        const centerY = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(centerY - focusY);
        if (dist < minDistance) {
          minDistance = dist;
          closestAyah = ayahNum;
        }
      }
    });

    if (closestAyah && closestAyah !== activeAyah) {
      setActiveAyah(closestAyah);
      localStorage.setItem(`lastReadAyah_${surahId}`, closestAyah.toString());
      localStorage.setItem('lastReadAyah', closestAyah.toString());
      localStorage.setItem('lastReadSurah', surahId.toString());
    }
  }, [activeAyah, data, surahId]);

  const onScrollThrottled = () => {
    window.requestAnimationFrame(handleScroll);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-[#FCF6F8] dark:bg-[#1B1317] text-black dark:text-[#F5E9ED] flex flex-col animate-in slide-in-from-bottom duration-300">
        <header className="sticky top-0 z-10 bg-[#FCF6F8]/90 dark:bg-[#1B1317]/90 backdrop-blur-xl flex items-center justify-between p-4 px-6 border-b border-stone-100 dark:border-[#3A2931] shrink-0">
          <button onClick={handleExit} className="p-3 bg-stone-100 dark:bg-[#291D23] rounded-full hover:bg-stone-200 dark:hover:bg-[#312128] transition-colors">
            <ChevronLeft className="w-6 h-6" strokeWidth={2.5} />
          </button>
        </header>
      </div>
    );
  }

  const totalAyahs = data?.metadata?.numberOfAyahs || data?.arabic?.length || 1;
  const progressPercent = Math.min(100, Math.max(3, (activeAyah / totalAyahs) * 100));

  return (
    <div className="fixed inset-0 z-50 bg-[#FCF6F8] dark:bg-[#1B1317] text-black dark:text-[#F5E9ED] flex flex-col animate-in slide-in-from-bottom duration-300">
      <header className="sticky top-0 z-10 bg-[#FCF6F8]/95 dark:bg-[#1B1317]/95 backdrop-blur-xl border-b border-stone-100 dark:border-[#3A2931] shrink-0">
        <div className="flex items-center justify-between p-4 px-6">
          <button 
            onClick={handleExit} 
            className="p-3 bg-stone-100 dark:bg-[#291D23] rounded-full hover:bg-stone-200 dark:hover:bg-[#312128] transition-colors active:scale-95"
          >
            <ChevronLeft className="w-6 h-6" strokeWidth={2.5} />
          </button>
          <div className="ml-4 flex-1 text-left">
            <h1 className="text-xl font-bold tracking-tight leading-tight">
              {data ? data.metadata.englishName : t('loading')}
            </h1>
            {data && (
              <div className="text-xs font-semibold text-black dark:text-[#F2B3C5]">
                {lang === 'ru' ? `Аят ${activeAyah} из ${totalAyahs}` : `Ayah ${activeAyah} / ${totalAyahs}`}
              </div>
            )}
          </div>
        </div>
        {/* Reading progress indicator bar */}
        {data && (
          <div className="w-full bg-stone-200/50 dark:bg-stone-800/60 h-1 overflow-hidden">
            <div 
              className="bg-[#B85878] h-1 transition-all duration-300 ease-out rounded-r-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </header>
      
      <div 
        ref={scrollContainerRef}
        onScroll={onScrollThrottled}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
        {error || !data ? (
          <div className="flex flex-col justify-center items-center py-40 h-full gap-4 text-center px-6">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-2">
              <span className="text-2xl font-bold">!</span>
            </div>
            <h3 className="text-xl font-bold text-stone-800 dark:text-stone-200">{t('loadingError') || 'Failed to load'}</h3>
            <p className="text-stone-500 dark:text-stone-400">Could not load the Surah. Please check your connection and try again.</p>
            <button onClick={handleExit} className="mt-4 px-6 py-2 bg-stone-200 dark:bg-stone-800 rounded-full font-semibold hover:bg-stone-300 dark:hover:bg-stone-700 transition-colors">
              Close
            </button>
          </div>
        ) : (
          <div className="w-full">
            {/* Header info */}
            <div className="max-w-2xl mx-auto px-6 pt-6 pb-2 mb-2">
              <div className="text-center">
                <h2 className="text-3xl md:text-4xl font-bold mb-2 leading-tight text-black dark:text-[#F6DBE4] font-arabic">{data.metadata.name}</h2>
                <div className="text-base md:text-lg font-semibold text-stone-500 dark:text-stone-400">
                  {lang === 'ru' ? (SURAH_NAMES['ru']?.[surahId - 1] || data.metadata.englishNameTranslation) : '######'}
                </div>
                <div className="mt-4 py-1.5 px-5 bg-[#F2B3C5]/40 text-black dark:bg-[#F2B3C5]/20 dark:text-[#F6DBE4] rounded-full inline-block font-bold text-xs md:text-sm tracking-widest uppercase shadow-sm">
                  {t('verses')} {data.metadata.numberOfAyahs}
                </div>
              </div>
            </div>

            {/* Ayahs list with active reading focus */}
            <div className="max-w-2xl mx-auto px-3 md:px-5 space-y-3 pb-8">
              {data.arabic.map((ayah: any, idx: number) => {
                const ayahNum = ayah?.numberInSurah;
                const isActive = activeAyah === ayahNum;

                return (
                  <div 
                    key={idx}
                    id={`ayah-${ayahNum}`}
                    ref={(el) => {
                      if (el) ayahElementsRef.current.set(ayahNum, el);
                      else ayahElementsRef.current.delete(ayahNum);
                    }}
                    onClick={() => handleAyahClick(ayahNum)}
                    className={`p-5 md:p-6 rounded-[28px] transition-all duration-300 ease-out cursor-pointer ${
                      isActive 
                        ? 'bg-[#F8E3EB] dark:bg-[#3B2631] shadow-md ring-2 ring-[#EDAEC1]/60 dark:ring-[#F2B3C5]/40 scale-[1.01]' 
                        : 'bg-transparent ring-1 ring-transparent opacity-80 hover:opacity-100 hover:bg-stone-50/70 dark:hover:bg-white/5'
                    }`}
                  >
                    {/* Top status bar for Ayah */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                          isActive 
                            ? 'bg-[#B85878] text-white shadow-sm scale-110' 
                            : 'bg-[#F2B3C5]/35 text-stone-700 dark:text-[#F6DBE4]'
                        }`}>
                          {ayahNum}
                        </span>
                        {isActive && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#B85878] text-white text-[11px] font-bold tracking-wide uppercase shadow-sm animate-in fade-in duration-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            {lang === 'ru' ? 'Текущий аят' : '######'}
                          </span>
                        )}
                      </div>

                      <div className="text-xs font-semibold text-stone-400 dark:text-stone-500">
                        {ayahNum} / {totalAyahs}
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 items-center text-center">
                      <div 
                        className={`text-2xl md:text-3xl leading-[2.8rem] md:leading-[3.4rem] font-medium font-arabic px-2 md:px-4 transition-colors duration-300 ${
                          isActive 
                            ? 'text-black dark:text-[#FFFFFF]' 
                            : 'text-black/90 dark:text-[#F5E9ED]/90'
                        }`} 
                        dir="rtl"
                      >
                        <ColorizedArabic text={ayah?.text} />
                      </div>
                      
                      <div className={`text-base md:text-lg leading-relaxed max-w-2xl px-2 md:px-4 transition-colors duration-300 ${
                        isActive 
                          ? 'font-medium text-stone-900 dark:text-stone-100' 
                          : 'font-normal text-stone-600 dark:text-stone-300'
                      }`}>
                        {lang === 'ru' ? data?.translation?.[idx]?.text : '######'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="h-28 w-full" />
          </div>
        )}
      </div>
    </div>
  );
});

// --- Location Search Screen ---

function LocationSearch({ onClose, onSelect }: { onClose: () => void; onSelect: (loc: {city: string, country: string, lat: number, lng: number}) => void }) {
  const { t, lang } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
        fetchGeocoding(query, lang)
          .then(res => {
            setResults(res.results || []);
            setLoading(false);
          })
        .catch(() => {
          setLoading(false);
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="fixed inset-0 z-50 bg-[#FCF6F8] dark:bg-[#1B1317] text-black dark:text-[#F5E9ED] animate-in slide-in-from-bottom duration-300">
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 p-4 sm:p-6 pt-6 sm:pt-8 pointer-events-none">
        <div className="flex-1 relative flex items-center pointer-events-auto">
          <Search className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-black dark:text-white pointer-events-none z-10" strokeWidth={3} />
          <input 
            type="text" 
            autoFocus
            placeholder="Местоположение" 
            className="w-full pl-12 sm:pl-14 pr-12 py-3.5 sm:py-4 bg-white/70 dark:bg-[#291D23]/70 backdrop-blur-2xl rounded-full font-bold text-black dark:text-white outline-none text-xl placeholder:text-black/40 dark:placeholder:text-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-black/5 dark:border-white/10 transition-all"
            value={query} 
            onChange={e => setQuery(e.target.value)} 
          />
          {query.length > 0 && (
            <button 
              onClick={() => setQuery('')}
              className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center bg-black dark:bg-white rounded-full text-white dark:text-black active:scale-90 transition-transform z-10"
            >
              <X className="w-4 h-4" strokeWidth={3.5} />
            </button>
          )}
        </div>
        <button 
          onClick={onClose}
          className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center bg-white/70 dark:bg-[#291D23]/70 backdrop-blur-2xl border border-black/5 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.06)] rounded-full text-black dark:text-white shrink-0 active:scale-95 transition-transform pointer-events-auto"
        >
          <X className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={2.5} />
        </button>
      </div>
      
      <div className="absolute inset-0 overflow-y-auto px-6 pb-6 pt-[104px] sm:pt-[116px] space-y-4">
        {loading && (
          <div className="flex justify-center py-10">
             <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
          </div>
        )}
        
        {!loading && results.length === 0 && query.trim().length >= 2 && (
          <div className="text-center py-10 text-stone-500 font-medium">{t('nothingFound')}</div>
        )}

        {!loading && results.map((item: any, idx: number) => (
          <button 
            key={idx} 
            onClick={() => {
              triggerHaptic();
              onSelect({
                city: item.name, 
                country: item.region ? `${item.region}, ${item.country}` : item.country || '',
                lat: item.lat || item.latitude,
                lng: item.lng || item.longitude
              });
            }}
            className="w-full text-left p-6 sm:p-7 bg-white dark:bg-[#291D23] rounded-[32px] hover:bg-stone-50 dark:hover:bg-[#35252D] transition-all duration-200 flex flex-col shadow-[0_8px_24px_rgba(0,0,0,0.04)] dark:shadow-none border border-transparent dark:border-white/5 active:scale-[0.97]"
          >
            <div className="flex items-start justify-between w-full mb-1">
              <span className="font-extrabold text-[28px] sm:text-[32px] tracking-tight text-stone-900 dark:text-white leading-none">
                {item.name}
              </span>
              <div className="shrink-0 text-2xl sm:text-3xl leading-none ml-4" aria-hidden="true">
                {item.flag || getFlagEmoji(item.country_code)}
              </div>
            </div>
            
            {item.type && (
              <span className="text-[14px] font-extrabold uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-4">
                {item.type}
              </span>
            )}
            
            {item.region && item.region.toLowerCase() !== (item.name || '').toLowerCase() && (
              <span className="font-bold text-[20px] sm:text-[22px] text-stone-700 dark:text-stone-200 leading-tight mb-2">
                {item.region}
              </span>
            )}
            
            <div className="flex flex-wrap items-center gap-x-2.5 text-[15px] sm:text-[16px] font-bold text-stone-500 dark:text-stone-400 mt-auto">
              <span className="truncate max-w-[200px]">{item.country}</span>
              {item.timezone && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-300 dark:bg-stone-600 shrink-0"></span>
                  <span className="shrink-0">{item.timezone.startsWith('UTC') ? item.timezone : getUtcOffset(item.timezone)}</span>
                </>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Settings Screen ---

const ALL_LANGUAGES = [
  { code: 'ru', name: 'Русский' }
];



const LANGUAGE_FLAGS: Record<string, string> = {
  en: '🇬🇧',
  ru: '🇷🇺',
};

const getLanguageName = (code: string, displayLang: string) => {
  try {
    // Show in native language
    const displayName = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return displayName ? displayName.charAt(0).toUpperCase() + displayName.slice(1) : code.toUpperCase();
  } catch (e) {
    return code.toUpperCase();
  }
};

function SettingsScreen({ 
  theme, 
  setTheme, 
  azanVolume = 0,
  setAzanVolume,
  azanSoundUrl = './adhan.mp3',
  onClose 
}: { 
  theme: 'light' | 'dark', 
  setTheme: (t: 'light' | 'dark') => void, 
  azanVolume: number,
  setAzanVolume: (v: number) => void,
  azanSoundUrl: string,
  onClose: () => void 
}) {
  const { t, lang, appLang, setAppLang } = useTranslation();
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  useEffect(() => {
    return () => {
      globalAudioEngine.stop();
    };
  }, []);

  const handleTogglePreview = () => {
    triggerHaptic();
    if (isPlayingPreview) {
      globalAudioEngine.stop();
      setIsPlayingPreview(false);
    } else {
      let targetVolume = azanVolume;
      if (targetVolume === 0) {
        targetVolume = 50;
        setAzanVolume(50);
        globalAudioEngine.setVolume(50);
      }
      globalAudioEngine.play(azanSoundUrl, targetVolume, () => {
        setIsPlayingPreview(false);
      });
      setIsPlayingPreview(true);
    }
  };

  const handleVolumeChange = (newVal: number) => {
    if (isPlayingPreview) {
      globalAudioEngine.stop();
      setIsPlayingPreview(false);
    }
    setAzanVolume(newVal);
    globalAudioEngine.setVolume(newVal);
  };

  const displayCode = appLang === 'auto' ? 'AUTO' : lang.toUpperCase();

  return (
    <div className="fixed inset-0 z-50 bg-[#FCF6F8] dark:bg-[#1B1317] text-black dark:text-[#F5E9ED] h-[100dvh] flex flex-col justify-between select-none overflow-hidden touch-none animate-in slide-in-from-right duration-300">
      <header className="flex items-center py-3 px-5 border-b border-stone-200/60 dark:border-stone-800/60 shrink-0 bg-[#FCF6F8] dark:bg-[#1B1317]">
        <button 
          onClick={onClose} 
          className="w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center bg-[#F1D8E1] dark:bg-[#49313C] text-black dark:text-[#F4BCCB] rounded-full hover:bg-[#E8C9D4] dark:hover:bg-[#563A47] active:scale-95 transition-all shadow-sm"
        >
          <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={3} />
        </button>
        <h1 className="text-xl font-bold tracking-tight ml-4">{t('settings')}</h1>
      </header>
      
      <div className="flex-1 flex flex-col justify-start p-3 sm:p-5 max-w-lg mx-auto w-full overflow-hidden pb-safe">
        {/* Compact Settings Group pinned to the top */}
        <div className="flex flex-col gap-1.5 sm:gap-2 w-full">
          {/* Material You Volume Slider for Azan */}
          <div className="p-3.5 sm:p-4 bg-white dark:bg-[#291D23] rounded-[24px] sm:rounded-[28px] shadow-sm transition-all duration-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0 w-full">
                <button 
                  onClick={handleTogglePreview}
                  className={`w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full shrink-0 active:scale-90 transition-all duration-200 ${
                    isPlayingPreview 
                      ? 'bg-[#B85878] text-white shadow-md ring-4 ring-[#B85878]/30' 
                      : 'bg-[#B85878]/15 dark:bg-[#36242D] text-[#B85878] dark:text-[#F2B3C5] hover:bg-[#B85878]/25'
                  }`}
                  title={isPlayingPreview ? (t('stop') || 'Остановить') : (t('preview') || 'Прослушать')}
                >
                  {isPlayingPreview ? (
                    <Volume2 className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" strokeWidth={2.2} />
                  ) : (
                    <VolumeX className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.2} />
                  )}
                </button>
                <div className="min-w-0 flex-1 py-0.5 pr-2">
                  <span className="font-bold text-base sm:text-lg tracking-tight block text-stone-800 dark:text-stone-100 whitespace-normal break-words leading-tight">
                    {t('azanVolume')}
                  </span>
                  <span className="font-semibold text-stone-500 dark:text-stone-400 text-xs sm:text-sm block mt-0.5">
                    {azanVolume}%
                  </span>
                </div>
              </div>
            </div>
            <div className="pt-0.5 px-1">
              <MaterialYouSlider
                value={azanVolume}
                onChange={handleVolumeChange}
              />
            </div>
          </div>

          {/* Dark Theme Card */}
          <div className="flex items-center gap-3 p-3.5 sm:p-4 bg-white dark:bg-[#291D23] rounded-[24px] sm:rounded-[28px] shadow-sm transition-all duration-200">
            <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center bg-[#F4DFE6] dark:bg-[#36242D] rounded-full text-black dark:text-[#F2B3C5] shrink-0">
              {theme === 'dark' ? <MoonStar className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.2} /> : <Sun className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.2} />}
            </div>
            <div className="flex-1 min-w-0 py-0.5">
              <span className="font-bold text-base sm:text-lg tracking-tight block text-stone-800 dark:text-stone-100 whitespace-normal break-words leading-tight">{t('darkTheme')}</span>
              <span className="font-semibold text-stone-500 dark:text-stone-400 text-xs sm:text-sm block leading-snug mt-0.5">{theme === 'dark' ? t('turnOff') : t('turnOn')}</span>
            </div>
            <div className="pr-1">
              <Switch checked={theme === 'dark'} onChange={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
            </div>
          </div>

          {/* Language Selection Card */}
          <label className="relative w-full flex items-center gap-3 p-3.5 sm:p-4 bg-white dark:bg-[#291D23] rounded-[24px] sm:rounded-[28px] shadow-sm hover:bg-stone-50 dark:hover:bg-[#312128] transition-colors active:scale-[0.98] text-left cursor-pointer">
            <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center bg-[#F4DFE6] dark:bg-[#36242D] rounded-full text-black dark:text-[#F2B3C5] shrink-0">
              <Globe className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0 py-0.5">
              <span className="font-bold text-base sm:text-lg tracking-tight block text-stone-800 dark:text-stone-100 whitespace-normal break-words leading-tight">{t('appLanguage')}</span>
              <span className="font-semibold text-stone-500 dark:text-stone-400 text-xs sm:text-sm block truncate mt-0.5">
                {appLang === 'auto' ? t('autoSelected') : t('manualSelected')}
              </span>
            </div>
            <div className="px-3.5 py-2 sm:px-4 sm:py-2.5 bg-[#F4DFE6] text-black dark:bg-[#36242D] dark:text-[#F6DBE4] rounded-full font-bold text-xs sm:text-sm tracking-widest shadow-sm shrink-0 flex items-center gap-1 mr-0 sm:mr-1">
              {displayCode}
              <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 opacity-60" strokeWidth={2.5} />
            </div>
            <select 
              value={appLang}
              onChange={(e) => {
                triggerHaptic();
                setAppLang(e.target.value);
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer appearance-none"
            >
              {ALL_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

