import net from 'node:net'

// supertest starts a throwaway server per request via a bare `listen(0)`, which
// binds the dual-stack wildcard [::] while the client then dials 127.0.0.1. If
// another local app holds a specific 127.0.0.1 bind on the ephemeral port the
// kernel assigns (WebStorm's aux servers do, among others), the kernel routes
// the request to that app instead of the test server — surfacing as random
// empty 404s, `socket hang up`, or HTTP parse errors, cured by a retry.
// Rewriting the bind to 127.0.0.1 makes the kernel assign only ports actually
// free on IPv4 loopback, so the interception is structurally impossible.
// Details: docs/proposals/backend-testing-strategy.md ("The serial flake").
// Known supertest failure class:
// https://stackoverflow.com/questions/63343123/nodesupertest-flakes-with-client-network-socket-disconnected-before-secure-tls/63343124#63343124
// https://gavv.net/articles/ephemeral-port-reuse/
//
// The bind must stay SYNCHRONOUS: supertest reads `server.address()` right
// after `listen(0)` returns. `listen(0, '127.0.0.1')` binds asynchronously
// (host strings go through dns.lookup), so instead we pre-bind a handle with
// `net._createServerHandle` — the same internal primitive Node's cluster
// module uses — and hand it to `listen(handle)`, which sets up synchronously.
type CreateServerHandle = (address: string, port: number, addressType: number) => object | number

const createServerHandle = (net as unknown as { _createServerHandle: CreateServerHandle })._createServerHandle
if (typeof createServerHandle !== 'function') {
  throw new Error(
    'bind-loopback.setup: net._createServerHandle is gone in this Node version; ' +
      'the supertest loopback-bind shim needs a new synchronous-bind mechanism'
  )
}

const originalListen = net.Server.prototype.listen

const patchedListen = function (this: net.Server, ...args: unknown[]) {
  const isBareEphemeralListen = args[0] === 0 && (args.length === 1 || typeof args[1] === 'function')
  if (isBareEphemeralListen) {
    const handle = createServerHandle('127.0.0.1', 0, 4)
    if (typeof handle === 'number') {
      throw new Error(`bind-loopback.setup: binding 127.0.0.1:0 failed with errno ${handle}`)
    }
    const callback = args[1] as (() => void) | undefined
    const patchedArgs = callback ? [handle, callback] : [handle]
    return Reflect.apply(originalListen, this, patchedArgs) as net.Server
  }
  return Reflect.apply(originalListen, this, args) as net.Server
}

net.Server.prototype.listen = patchedListen as typeof net.Server.prototype.listen
