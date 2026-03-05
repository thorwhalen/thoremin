import { useCallback, useRef, useEffect } from 'react';

const CHROMATIC_SCALE = Array.from({ length: 128 }, (_, i) => i);

function midiToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function getMagneticFrequency(x: number, p: number, scale: number[]) {
  if (scale.length < 2) return midiToFreq(scale[0] || 60);

  const midiMin = scale[0];
  const midiMax = scale[scale.length - 1];
  
  // 1. Base linear mapping: x (0-1) -> continuous MIDI note
  const v = midiMin + x * (midiMax - midiMin);
  
  if (p === 0) return midiToFreq(v);
  
  // 2. Find surrounding scale notes
  let n_a = scale[0];
  let n_b = scale[scale.length - 1];
  
  for (let i = 0; i < scale.length - 1; i++) {
    if (v >= scale[i] && v <= scale[i+1]) {
      n_a = scale[i];
      n_b = scale[i+1];
      break;
    }
  }
  
  // Prevent division by zero if scale has duplicate notes or v is exactly an integer
  if (n_a === n_b) {
    return midiToFreq(n_a);
  }
  
  // 3. Calculate fractional distance 't'
  const _t = (v - n_a) / (n_b - n_a);

  // 4. Apply Magnetic shape
  let tMapped: number;
  if (p === 1) {
    tMapped = _t < 0.5 ? 0 : 1;
  } else {
    const u = 2 * _t - 1;
    const sign = u >= 0 ? 1 : -1;
    tMapped = 0.5 + 0.5 * sign * Math.pow(Math.abs(u), 1 - p);
  }
  
  const vMapped = n_a + tMapped * (n_b - n_a);
  return midiToFreq(vMapped);
}

export type InstrumentType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface VoiceSettings {
  instrument: InstrumentType;
  scale: number[];
  magnetism: number;
}

interface Voice {
  oscillator: OscillatorNode;
  gainNode: GainNode;
  active: boolean;
  instrument: InstrumentType;
}

export function useAudioEngine() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const masterGainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      masterGainRef.current = audioCtxRef.current.createGain();
      masterGainRef.current.gain.setValueAtTime(0.2, audioCtxRef.current.currentTime);
      masterGainRef.current.connect(audioCtxRef.current.destination);
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const updateVoice = useCallback((id: number, x: number, y: number, isPresent: boolean, settings: VoiceSettings) => {
    if (!audioCtxRef.current || !masterGainRef.current) return;

    let voice = voicesRef.current.get(id);

    if (isPresent) {
      if (!voice) {
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        
        osc.type = settings.instrument;
        gain.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
        
        osc.connect(gain);
        gain.connect(masterGainRef.current);
        osc.start();

        voice = {
          oscillator: osc,
          gainNode: gain,
          active: true,
          instrument: settings.instrument
        };
        voicesRef.current.set(id, voice);
      }

      // Update instrument if changed
      if (voice.instrument !== settings.instrument) {
        voice.oscillator.type = settings.instrument;
        voice.instrument = settings.instrument;
      }

      // Map X to frequency using Magnetic Pitch Mapper
      const targetFreq = getMagneticFrequency(x, settings.magnetism, settings.scale);
      
      voice.oscillator.frequency.setTargetAtTime(targetFreq, audioCtxRef.current.currentTime, 0.03);
      
      // Map Y to volume (0 to 1, inverted since Y=0 is top)
      const volume = (1 - y) * 0.5;
      voice.gainNode.gain.setTargetAtTime(volume, audioCtxRef.current.currentTime, 0.1);

      voice.active = true;
    } else if (voice) {
      voice.gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
      voice.active = false;
    }
  }, []);


  // Cleanup inactive voices
  useEffect(() => {
    const interval = setInterval(() => {
      if (!audioCtxRef.current) return;
      voicesRef.current.forEach((voice, id) => {
        if (!voice.active && voice.gainNode.gain.value < 0.01) {
          voice.oscillator.stop();
          voice.oscillator.disconnect();
          voice.gainNode.disconnect();
          voicesRef.current.delete(id);
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return { initAudio, updateVoice };
}
