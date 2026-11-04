// Blend cover colors inside the small source canvases. Keeping the same SVG
// filter and rotating surfaces avoids a geometry jump or an opacity dip.
export function createFluidCoverTransition(canvases, duration = 1200) {
  const contexts = canvases.map(canvas => canvas.getContext('2d'));
  let frame = null;
  let target = null;
  let initialized = false;

  function buffer() {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    return canvas;
  }

  function cancel() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function finish() {
    cancel();
    if (!target) return;
    contexts.forEach((context, index) => {
      context.clearRect(0, 0, 100, 100);
      context.globalAlpha = 1;
      context.drawImage(target[index], 0, 0);
    });
  }

  return {
    transitionTo(image, animate = true) {
      cancel();
      // Snapshot the current mixed colors, including an interrupted transition.
      const from = canvases.map(canvas => {
        const copy = buffer();
        copy.getContext('2d').drawImage(canvas, 0, 0);
        return copy;
      });
      target = canvases.map((_, index) => {
        const canvas = buffer();
        const context = canvas.getContext('2d');
        context.filter = 'blur(5px)';
        const width = image.naturalWidth / 2;
        const height = image.naturalHeight / 2;
        context.drawImage(
          image,
          (index % 2) * width,
          Math.floor(index / 2) * height,
          width,
          height,
          0,
          0,
          100,
          100
        );
        return canvas;
      });
      if (!initialized || !animate) {
        initialized = true;
        finish();
        return;
      }
      const started = performance.now();
      const step = now => {
        const t = Math.min(1, (now - started) / duration);
        if (t === 1) {
          finish();
          return;
        }
        const amount = t * t * (3 - 2 * t);
        contexts.forEach((context, index) => {
          context.clearRect(0, 0, 100, 100);
          context.globalAlpha = 1;
          context.drawImage(from[index], 0, 0);
          context.globalAlpha = amount;
          context.drawImage(target[index], 0, 0);
          context.globalAlpha = 1;
        });
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
    finish,
    dispose() {
      cancel();
      target = null;
      initialized = false;
    },
  };
}
