/**
 * Must be imported before TensorFlow.js in the transcription worker.
 *
 * tfjs 3's PlatformBrowser.setTimeoutCustom does `if (!window || …)`, which
 * throws "ReferenceError: window is not defined" inside a Web Worker. With the
 * WebGL backend (any machine with a GPU) that rejection stalls transcription
 * at 0%. Declaring `window` as undefined makes `!window` true, so tfjs falls
 * back to plain setTimeout — and `typeof window` stays 'undefined', so its
 * worker / main-thread detection is unchanged.
 */
if (!('window' in self)) {
  self.window = undefined;
}
