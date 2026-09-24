// With nodeIntegration the page already has Node's require, which webpack's
// electron-renderer target also uses for built-ins (events, crypto, ...).
// Only fall back to an electron-only shim when no require exists at all.
if (typeof window.require !== 'function') {
  const electron = require('electron');
  window.require = function (moduleName) {
    if (moduleName === 'electron') {
      return electron;
    }
    return null;
  };
}
