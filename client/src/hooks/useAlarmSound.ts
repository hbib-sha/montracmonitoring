import { useEffect, useRef } from 'react';

/**
 * Plays an alarm sound while `active` is true.
 * Tries /alarm.mp3 first (drop a file into client/public/).
 * Falls back to a generated two-tone beep via Web Audio API.
 * Stops automatically when `active` becomes false.
 */
export function useAlarmSound(active: boolean): void {
  const prevActiveRef = useRef(false);
  const audioRef      = useRef<HTMLAudioElement | null>(null);
  const stopToneRef   = useRef<(() => void) | null>(null);

  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;

    if (active && !wasActive) {
      startAlarm();
    }
    if (!active && wasActive) {
      stopAlarm();
    }
  }, [active]);

  // Clean up if the component unmounts while alarm is active
  useEffect(() => () => stopAlarm(), []);

  function startAlarm() {
    const audio = new Audio('/alarm.mp3');
    audio.loop = true;
    audio.play()
      .then(() => {
        audioRef.current = audio;
      })
      .catch(() => {
        // MP3 missing or blocked — fall back to Web Audio
        stopToneRef.current = buildTone();
      });
  }

  function stopAlarm() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (stopToneRef.current) {
      stopToneRef.current();
      stopToneRef.current = null;
    }
  }
}

/** Generates a repeating two-tone industrial alarm (880 Hz / 660 Hz). */
function buildTone(): () => void {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }

  if (ctx.state === 'suspended') ctx.resume();

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.connect(ctx.destination);

  let stopped = false;
  let osc: OscillatorNode | null = null;
  let timer: ReturnType<typeof setTimeout>;
  const freqs = [880, 660];
  let phase = 0;

  const next = () => {
    if (stopped) return;
    osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freqs[phase & 1], ctx.currentTime);
    osc.connect(gain);
    osc.start();
    timer = setTimeout(() => {
      osc?.stop();
      osc?.disconnect();
      phase++;
      next();
    }, 400);
  };

  next();

  return () => {
    stopped = true;
    clearTimeout(timer);
    osc?.stop();
    osc?.disconnect();
    gain.disconnect();
    ctx.close();
  };
}
