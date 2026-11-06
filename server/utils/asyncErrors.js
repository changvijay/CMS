/**
 * Express 4 does not catch rejected promises from async handlers: the request hangs until the client times out.
 * This walks a router (or app) and forwards any rejection to `next(err)`, where `jsonErrorHandler` answers it.
 */
export function catchAsyncErrors(routerOrApp) {
  const stack = routerOrApp?._router?.stack || routerOrApp?.stack || [];
  for (const layer of stack) {
    if (layer.route) {
      for (const inner of layer.route.stack) wrapLayer(inner);
    } else if (layer.handle?.stack) {
      catchAsyncErrors(layer.handle);
    } else {
      wrapLayer(layer);
    }
  }
  return routerOrApp;
}

function wrapLayer(layer) {
  const fn = layer.handle;
  // Error handlers (4 arguments) are told apart by their arity, so they are left alone; never wrap twice.
  if (typeof fn !== 'function' || fn.length > 3 || fn.__asyncSafe) return;
  const wrapped = function (req, res, next) {
    const result = fn.call(this, req, res, next);
    if (result && typeof result.catch === 'function') result.catch(next);
    return result;
  };
  wrapped.__asyncSafe = true;
  layer.handle = wrapped;
}

/** Last middleware: every unhandled error becomes a JSON answer instead of an HTML page or a hung request. */
export function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ error: 'Something went wrong on the server.' });
}
