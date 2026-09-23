const electron = require('electron');

window.require = function (moduleName) {
  if (moduleName === 'electron') {
    return electron;
  }
  return null;
};
