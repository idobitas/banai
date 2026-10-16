// Microphone recorder: idle -> recording -> idle. Browser APIs are injected, so the state
// machine is unit-tested with fakes. A recording stops by itself after `maxMs`.

export const MAX_RECORDING_MS = 30_000;
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

/** Why recording could not start: 'unsupported' | 'denied'. */
export class RecorderError extends Error {
  constructor(reason) {
    super(`Recording unavailable: ${reason}`);
    this.reason = reason;
  }
}

export function createRecorder({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderImpl = globalThis.MediaRecorder,
  maxMs = MAX_RECORDING_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let session = null; // { recorder, stream, chunks, timer, resolve, discard }
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());

  const supported = () => Boolean(mediaDevices?.getUserMedia && MediaRecorderImpl);

  function finish() {
    const { stream, timer } = session;
    clearTimer(timer);
    stream.getTracks().forEach((track) => track.stop()); // release the microphone right away
    session = null;
    notify();
  }

  const api = {
    supported,
    isRecording: () => session !== null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Starts recording. Resolves to a Blob when stopped, or null when cancelled. */
    async start() {
      if (session) throw new Error('Already recording');
      if (!supported()) throw new RecorderError('unsupported');
      let stream;
      try {
        stream = await mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new RecorderError('denied');
      }
      const mimeType = PREFERRED_TYPES.find((type) => MediaRecorderImpl.isTypeSupported?.(type));
      const recorder = new MediaRecorderImpl(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      return new Promise((resolve) => {
        session = { recorder, stream, chunks, discard: false, timer: null };
        const current = session;
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data?.size) chunks.push(event.data);
        });
        recorder.addEventListener('stop', () => {
          finish();
          const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
          resolve(current.discard || chunks.length === 0 ? null : new Blob(chunks, { type }));
        });
        current.timer = setTimer(() => api.stop(), maxMs);
        recorder.start();
        notify();
      });
    },

    stop() {
      if (session && session.recorder.state !== 'inactive') session.recorder.stop();
    },

    cancel() {
      if (!session) return;
      session.discard = true;
      api.stop();
    },
  };
  return api;
}
