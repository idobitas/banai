import { describe, expect, it, vi } from 'vitest';
import { createRecorder, MAX_RECORDING_MS, RecorderError } from '../../../src/voice/recorder.js';
import { createSpeaker } from '../../../src/voice/speaker.js';
import { speak, transcribe } from '../../../src/voice/voiceApi.js';

// --- fakes ---------------------------------------------------------------------------------------

function fakeMedia({ deny = false } = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  class FakeMediaRecorder {
    static isTypeSupported = (type) => type === 'audio/webm;codecs=opus';
    constructor(s, options) {
      this.stream = s;
      this.mimeType = options?.mimeType ?? '';
      this.state = 'inactive';
      this.listeners = {};
      FakeMediaRecorder.last = this;
    }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.listeners.dataavailable?.({ data: new Blob(['abc'], { type: 'audio/webm' }) });
      this.listeners.stop?.();
    }
  }
  const mediaDevices = { getUserMedia: deny ? vi.fn().mockRejectedValue(new Error('NotAllowed')) : vi.fn().mockResolvedValue(stream) };
  return { mediaDevices, MediaRecorderImpl: FakeMediaRecorder, track };
}

const timers = () => {
  const pending = [];
  return { setTimer: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clearTimer: vi.fn(), pending };
};

// --- recorder ------------------------------------------------------------------------------------

describe('recorder', () => {
  it('records until stopped, returns a typed Blob and releases the microphone', async () => {
    const media = fakeMedia();
    const recorder = createRecorder({ ...media, ...timers() });
    const done = recorder.start();
    await vi.waitFor(() => expect(recorder.isRecording()).toBe(true));
    expect(media.MediaRecorderImpl.last.mimeType).toBe('audio/webm;codecs=opus');
    recorder.stop();
    const blob = await done;
    expect(blob.type).toBe('audio/webm');
    expect(await blob.text()).toBe('abc');
    expect(media.track.stop).toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(false);
  });

  it('cancel discards the recording', async () => {
    const recorder = createRecorder({ ...fakeMedia(), ...timers() });
    const done = recorder.start();
    await vi.waitFor(() => expect(recorder.isRecording()).toBe(true));
    recorder.cancel();
    expect(await done).toBeNull();
  });

  it('stops by itself after the maximum length', async () => {
    const clock = timers();
    const recorder = createRecorder({ ...fakeMedia(), ...clock });
    const done = recorder.start();
    await vi.waitFor(() => expect(clock.pending).toHaveLength(1));
    expect(clock.pending[0].ms).toBe(MAX_RECORDING_MS);
    clock.pending[0].fn();
    expect(await done).toBeInstanceOf(Blob);
  });

  it('reports denied permission and unsupported browsers', async () => {
    await expect(createRecorder({ ...fakeMedia({ deny: true }) }).start()).rejects.toMatchObject({ reason: 'denied' });
    const unsupported = createRecorder({ mediaDevices: undefined, MediaRecorderImpl: undefined });
    expect(unsupported.supported()).toBe(false);
    await expect(unsupported.start()).rejects.toBeInstanceOf(RecorderError);
  });
});

// --- speaker -------------------------------------------------------------------------------------

function fakeAudio() {
  const played = [];
  class FakeAudio {
    constructor(src) { this.src = src; this.paused = true; played.push(this); }
    addEventListener(name, fn) { this[`on${name}`] = fn; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  return { AudioImpl: FakeAudio, played };
}
const urls = () => ({ createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
const memoryStorage = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }; };

describe('speaker', () => {
  it('is off by default and remembers the choice', () => {
    const storage = memoryStorage();
    const speaker = createSpeaker({ speak: vi.fn(), storage, urls: urls(), ...fakeAudio() });
    expect(speaker.isEnabled()).toBe(false);
    speaker.setEnabled(true);
    expect(createSpeaker({ speak: vi.fn(), storage, urls: urls(), ...fakeAudio() }).isEnabled()).toBe(true);
  });

  it('speaks only when enabled, and a new reply stops the previous one', async () => {
    const speakApi = vi.fn().mockResolvedValue(new Blob(['mp3']));
    const audio = fakeAudio();
    const speaker = createSpeaker({ speak: speakApi, storage: memoryStorage(), urls: urls(), ...audio });
    await speaker.say('hi', 'en');
    expect(speakApi).not.toHaveBeenCalled();
    speaker.setEnabled(true);
    await speaker.say('first', 'en');
    await speaker.say('second', 'he');
    expect(speakApi).toHaveBeenLastCalledWith('second', 'he');
    expect(audio.played.map((a) => a.paused)).toEqual([true, false]);
  });

  it('turning it off stops playback; failures stay silent', async () => {
    const audio = fakeAudio();
    const links = urls();
    const speaker = createSpeaker({ speak: vi.fn().mockResolvedValue(new Blob(['mp3'])), storage: memoryStorage(), urls: links, ...audio });
    speaker.setEnabled(true);
    await speaker.say('hi', 'en');
    speaker.setEnabled(false);
    expect(audio.played[0].paused).toBe(true);
    expect(links.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    const failing = createSpeaker({ speak: vi.fn().mockRejectedValue(new Error('down')), storage: memoryStorage(), urls: urls(), ...fakeAudio() });
    failing.setEnabled(true);
    await expect(failing.say('hi', 'en')).resolves.toBeUndefined();
  });
});

// --- api -----------------------------------------------------------------------------------------

describe('voice api', () => {
  it('posts the raw recording with its type and returns the transcript', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { text: 'hi', language: 'en' } }) });
    const blob = new Blob(['abc'], { type: 'audio/webm' });
    await expect(transcribe(blob, 'he', fetchImpl)).resolves.toEqual({ text: 'hi', language: 'en' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/voice/transcribe?language=he');
    expect(init.headers['Content-Type']).toBe('audio/webm');
    expect(init.body).toBe(blob);
  });

  it('returns speech as a Blob and surfaces server error codes', async () => {
    const mp3 = new Blob(['mp3'], { type: 'audio/mpeg' });
    await expect(speak('hi', 'en', vi.fn().mockResolvedValue({ ok: true, blob: async () => mp3 }))).resolves.toBe(mp3);
    const failing = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ success: false, error: { code: 'NO_SPEECH', message: 'x' } }) });
    await expect(transcribe(new Blob(['a']), 'en', failing)).rejects.toMatchObject({ status: 422, code: 'NO_SPEECH' });
    await expect(speak('hi', 'en', vi.fn().mockRejectedValue(new TypeError('offline')))).rejects.toMatchObject({ status: 0 });
  });
});
