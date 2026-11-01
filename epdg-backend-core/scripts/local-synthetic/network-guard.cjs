'use strict';
// Defense in depth for this inspected Node process, not an OS/container sandbox.
// Install before importing application dependencies. No DNS or provider traffic.
const net = require('node:net');
const allowedPorts = new Set([55432, 51025]);
function assertLocal(host, port) {
  if (host !== '127.0.0.1' || !allowedPorts.has(Number(port))) {
    throw new Error('Synthetic outbound network request blocked');
  }
}
function install() {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (typeof first === 'object' && first !== null) {
      assertLocal(first.host, first.port);
    } else {
      assertLocal(typeof args[1] === 'string' ? args[1] : undefined, first);
    }
    return original.apply(this, args);
  };
  globalThis.fetch = async () => { throw new Error('Synthetic outbound HTTP request blocked'); };
}
module.exports = {install,assertLocal};
