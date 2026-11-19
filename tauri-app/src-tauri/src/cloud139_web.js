(() => {
  if (location.origin !== 'https://yun.139.com' || window.top !== window) return;
  const callback = __BOXPLAYER_CALLBACK__;
  let delivered = false;
  function finish(responseUrl, status, authorization) {
    if (delivered || status < 200 || status >= 300 || typeof authorization !== 'string'
        || authorization.length > 16384 || !/^Basic [A-Za-z0-9+/]+=*$/i.test(authorization)) return;
    let target;
    try { target = new URL(responseUrl); } catch { return; }
    if (target.protocol !== 'https:' || (target.hostname !== 'yun.139.com' &&
        !target.hostname.endsWith('.yun.139.com')) || !/\/hcy\/file\/list\/?$/.test(target.pathname)) return;
    delivered = true;
    // The native navigation handler consumes the fragment before the URL is loaded.
    location.replace(callback + '#' + encodeURIComponent(authorization));
  }

  const fetch = window.fetch;
  window.fetch = async function (input, options) {
    const response = await fetch.call(this, input, options);
    try {
      const headers = options?.headers ?? (input instanceof Request ? input.headers : undefined);
      finish(response.url, response.status, new Headers(headers).get('authorization'));
    } catch {}
    return response;
  };

  const authorization = new WeakMap();
  const open = XMLHttpRequest.prototype.open;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    authorization.delete(this);
    return open.apply(this, args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const result = setHeader.call(this, name, value);
    if (name.toLowerCase() === 'authorization') authorization.set(this, value);
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const header = authorization.get(this);
    if (header) this.addEventListener('load', () => finish(this.responseURL, this.status, header), { once: true });
    return send.apply(this, args);
  };
})();
