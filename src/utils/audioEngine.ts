// Web Audio & IndexedDB Custom Sound Engine

const DB_NAME = 'AngelTimeAudioDB';
const STORE_NAME = 'custom_sounds';

// IndexedDB Helper for persistent custom audio storage
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCustomSound(file: File): Promise<{ name: string; size: number }> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const soundData = {
      name: file.name,
      type: file.type || 'audio/mpeg',
      blob: file,
      updatedAt: Date.now()
    };
    const req = store.put(soundData, 'user_adhan');
    req.onsuccess = () => resolve({ name: file.name, size: file.size });
    req.onerror = () => reject(req.error);
  });
}

export async function getCustomSound(): Promise<{ name: string; url: string } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('user_adhan');
      req.onsuccess = () => {
        const result = req.result;
        if (result && result.blob) {
          const url = URL.createObjectURL(result.blob);
          resolve({ name: result.name, url });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function deleteCustomSound(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete('user_adhan');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {}
}

// Universal Web Audio Player with Real Gain Control
class AudioEngine {
  private ctx: AudioContext | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private currentGainNode: GainNode | null = null;
  private currentSourceNode: MediaElementAudioSourceNode | null = null;
  private isPlaying = false;
  private onEndedCallback: (() => void) | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public play(url: string, volumePercent: number, onEnded?: () => void) {
    this.stop();

    try {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = url;
      audio.preload = 'auto';
      
      const vol = Math.max(0, Math.min(1, volumePercent / 100));
      audio.volume = vol; // Standard HTML5 volume

      const ctx = this.getContext();
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(vol, ctx.currentTime);

      // Connect HTMLAudio to GainNode for iOS / Android / Desktop hardware bypass
      try {
        const source = ctx.createMediaElementSource(audio);
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        this.currentSourceNode = source;
      } catch (e) {
        // Fallback directly to standard audio
      }

      this.currentAudioElement = audio;
      this.currentGainNode = gainNode;
      this.isPlaying = true;
      this.onEndedCallback = onEnded || null;

      audio.onended = () => {
        this.isPlaying = false;
        if (this.onEndedCallback) {
          this.onEndedCallback();
        }
      };

      audio.play().catch((err) => {
        console.warn('Audio play request failed:', err);
        this.isPlaying = false;
        if (this.onEndedCallback) {
          this.onEndedCallback();
        }
      });
    } catch (e) {
      console.error('Audio engine playback error:', e);
    }
  }

  public setVolume(volumePercent: number) {
    const vol = Math.max(0, Math.min(1, volumePercent / 100));
    if (this.currentGainNode && this.ctx) {
      try {
        this.currentGainNode.gain.setValueAtTime(vol, this.ctx.currentTime);
      } catch (e) {}
    }
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.volume = vol;
      } catch (e) {}
    }
  }

  public stop() {
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.currentTime = 0;
      } catch (e) {}
      this.currentAudioElement = null;
    }
    this.currentGainNode = null;
    this.currentSourceNode = null;
    this.isPlaying = false;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}

export const globalAudioEngine = new AudioEngine();
