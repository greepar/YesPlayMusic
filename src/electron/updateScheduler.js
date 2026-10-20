function createUpdateCheckScheduler({
  check,
  enabled,
  intervalMs = 6 * 60 * 60 * 1000,
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  let timer;
  const stop = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  const run = () => {
    if (enabled()) return check();
  };
  return {
    stop,
    refresh() {
      stop();
      if (!enabled()) return;
      timer = setTimer(run, intervalMs);
      timer.unref?.();
      return run();
    },
  };
}

module.exports = { createUpdateCheckScheduler };
