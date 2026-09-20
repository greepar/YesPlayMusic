import SvgIcon from '@/components/SvgIcon';

const requireAll = requireContext => requireContext.keys().map(requireContext);
const req = require.context('./', true, /\.svg$/);
requireAll(req);

export function installIcons(app) {
  app.component('SvgIcon', SvgIcon);
}
