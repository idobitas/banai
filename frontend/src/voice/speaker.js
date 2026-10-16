// Reads designer replies aloud when the customer turns it on (off by default, remembered per
// browser). Only one reply plays at a time; a new one stops the previous. Failures are silent:
// the text is always on screen anyway.

const STORAGE_KEY = 'banai.voice.speak';

export function createSpeaker({
  speak,
  AudioImpl = globalThis.Audio,
  urls = globalThis.URL,
  storage = globalThis.localStorage,
} = {}) {
  let enabled = false;
  try {
    enabled = storage?.getItem(STORAGE_KEY) === 'on';
  } catch {
    // blocked storage: stay off
  }
  let current = null; // { audio, url }
  let generation = 0; // ignores replies that arrive after a newer one started or speaking was turned off
  const listeners = new Set();

  function stop() {
    generation += 1;
    if (!current) return;
    current.audio.pause();
    urls.revokeObjectURL(current.url);
    current = null;
  }

  return {
    isEnabled: () => enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(next) {
      enabled = Boolean(next);
      if (!enabled) stop();
      try {
        storage?.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      } catch {
        // not persisted
      }
      listeners.forEach((listener) => listener(enabled));
    },
    stop,

    /** Speaks `text` if enabled. Resolves when playback starts (or is skipped). */
    async say(text, language) {
      if (!enabled || !text) return;
      stop();
      const mine = generation;
      try {
        const blob = await speak(text, language);
        if (mine !== generation || !enabled) return;
        const url = urls.createObjectURL(blob);
        const audio = new AudioImpl(url);
        current = { audio, url };
        audio.addEventListener('ended', () => {
          if (current?.audio === audio) {
            urls.revokeObjectURL(url);
            current = null;
          }
        });
        await audio.play();
      } catch {
        // autoplay blocked, network or provider failure: the reply is still on screen
      }
    },
  };
}
