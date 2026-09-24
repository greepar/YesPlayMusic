import Cookies from 'js-cookie';

// Cookie helpers kept free of store/router imports so low-level modules
// (utils/request) can use them without creating an import cycle.

export function setCookies(string) {
  const cookies = string.split(';;');
  cookies.map(cookie => {
    document.cookie = cookie;
    const cookieKeyValue = cookie.split(';')[0].split('=');
    localStorage.setItem(`cookie-${cookieKeyValue[0]}`, cookieKeyValue[1]);
  });
}

export function getCookie(key) {
  return Cookies.get(key) ?? localStorage.getItem(`cookie-${key}`);
}

export function removeCookie(key) {
  Cookies.remove(key);
  localStorage.removeItem(`cookie-${key}`);
}
