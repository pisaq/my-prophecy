/**
 * Minimal Julia-set backdrop — sparse contour lines, slow drift, quiet.
 */
export class FractalBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.time = 0;
    this.running = false;
    this._raf = 0;
    this._buffer = document.createElement('canvas');
    this._bctx = this._buffer.getContext('2d', { willReadFrequently: true });
    this.res = 140;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this._loop(0);
    window.addEventListener('resize', this._onResize);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
  }

  _onResize = () => this.resize();

  resize() {
    const { canvas, dpr } = this;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._buffer.width = this.res;
    this._buffer.height = Math.max(64, Math.round((this.res * h) / Math.max(w, 1)));
  }

  _loop = (ts) => {
    if (!this.running) return;
    this.time = ts * 0.000045;
    if (Math.floor(ts / 100) !== this._lastFrame) {
      this._lastFrame = Math.floor(ts / 100);
      this.draw();
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  draw() {
    const w = this._buffer.width;
    const h = this._buffer.height;
    if (!w || !h) return;

    const field = new Float32Array(w * h);
    const cx = -0.745 + Math.sin(this.time * 0.55) * 0.045;
    const cy = 0.113 + Math.cos(this.time * 0.42) * 0.04;
    const zoom = 1.55 + Math.sin(this.time * 0.22) * 0.06;
    const maxIter = 48;
    const aspect = w / h;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let zx = ((x / w) * 2 - 1) * zoom * aspect;
        let zy = ((y / h) * 2 - 1) * zoom;
        let i = 0;
        while (zx * zx + zy * zy < 4 && i < maxIter) {
          const tmp = zx * zx - zy * zy + cx;
          zy = 2 * zx * zy + cy;
          zx = tmp;
          i++;
        }
        // Smooth iteration for cleaner contours
        let v = i;
        if (i < maxIter) {
          const logZn = Math.log(zx * zx + zy * zy) / 2;
          const nu = Math.log(logZn / Math.log(2)) / Math.log(2);
          v = i + 1 - nu;
        }
        field[y * w + x] = v / maxIter;
      }
    }

    const img = this._bctx.createImageData(w, h);
    const data = img.data;
    // Contour bands — thin luminous lines on near-black
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const t = field[idx];
        const bands = t * 14;
        const frac = bands - Math.floor(bands);
        // Narrow ridge around each contour
        const edge = Math.exp(-Math.pow((frac - 0.5) * 9, 2));
        const glow = edge * (0.35 + t * 0.65);

        const pix = idx * 4;
        data[pix] = Math.floor(70 + glow * 90);
        data[pix + 1] = Math.floor(95 + glow * 120);
        data[pix + 2] = Math.floor(110 + glow * 130);
        data[pix + 3] = Math.floor(8 + glow * 95);
      }
    }

    this._bctx.putImageData(img, 0, 0);

    const { ctx, canvas } = this;
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    ctx.clearRect(0, 0, cw, ch);

    // Deep base so the window glass has something to show
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, cw, ch);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 1;
    ctx.drawImage(this._buffer, 0, 0, cw, ch);

    // Soft vignette — keep center readable, edges quieter
    const g = ctx.createRadialGradient(
      cw * 0.5,
      ch * 0.48,
      Math.min(cw, ch) * 0.2,
      cw * 0.5,
      ch * 0.5,
      Math.max(cw, ch) * 0.72,
    );
    g.addColorStop(0, 'rgba(9, 9, 11, 0.15)');
    g.addColorStop(0.55, 'rgba(9, 9, 11, 0.35)');
    g.addColorStop(1, 'rgba(9, 9, 11, 0.82)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }
}
