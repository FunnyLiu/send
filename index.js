
/**
 * Module dependencies.
 */

var debug = require('debug')('koa-send');
var assert = require('assert');
var path = require('path');
var normalize = path.normalize;
var basename = path.basename;
var extname = path.extname;
var resolve = path.resolve;
var fs = require('fs');
var join = path.join;

/**
 * Expose `send()`.
 */

module.exports = send;

/**
 * Send file at `path` with the
 * given `options` to the koa `ctx`.
 *
 * @param {Context} ctx
 * @param {String} path
 * @param {Object} [opts]
 * @return {Function}
 * @api public
 */

function send(ctx, path, opts) {
  assert(ctx, 'koa context required');
  assert(path, 'path path required');
  opts = opts || {};

  // options
  debug('send "%s" %j', path, opts);
  var root = opts.root ? resolve(opts.root) : '';
  var index = opts.index;
  var maxage = opts.maxage || 0;
  var hidden = opts.hidden || false;

  return function *(){
    var trailingSlash = '/' == path[path.length - 1];

    // normalize path
    path = decode(path);

    if (-1 == path) return ctx.error('failed to decode', 400);

    // null byte(s)
    if (~path.indexOf('\0')) return ctx.error('null bytes', 400);

    // index file support
    if (index && trailingSlash) path += index;

    // malicious path
    if (!root && !isAbsolute(path)) return ctx.error('relative paths require the .root option', 500);
    if (!root && ~path.indexOf('..')) return ctx.error('malicious path', 400);

    // relative to root
    path = normalize(join(root, path));

    // out of bounds
    if (root && 0 != path.indexOf(root)) return ctx.error('malicious path', 400);

    // hidden file support, ignore
    if (!hidden && leadingDot(path)) return;

    // stat
    try {
      var stats = yield stat(path);
    } catch (err) {
      var notfound = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR'];
      if (~notfound.indexOf(err.code)) return;
      err.status = 500;
      throw err;
    }

    // stream
    this.set('Last-Modified', stats.mtime.toUTCString());
    this.type = extname(path);
    var stream = this.body = fs.createReadStream(path);

    var res = this.res;
    var socket = this.socket;
    res.on('finish', cleanup);
    socket.on('error', destroy);

    return path;

    function destroy(){
      stream.destroy();
      cleanup();
    }

    function cleanup(){
      res.removeListener('finish', cleanup);
      socket.removeListener('error', destroy);
    }
  }
}

/**
 * Check if it's hidden.
 */

function leadingDot(path) {
  return '.' == basename(path)[0];
}

/**
 * Stat thunk.
 */

function stat(file) {
  return function(done){
    fs.stat(file, done);
  }
}

/**
 * Decode `path`.
 */

function decode(path) {
  try {
    return decodeURIComponent(path);
  } catch (err) {
    return -1;
  }
}

/**
 * Check if `path` looks absolute.
 *
 * @param {String} path
 * @return {Boolean}
 * @api private
 */

function isAbsolute(path){
  if ('/' == path[0]) return true;
  if (':' == path[1] && '\\' == path[2]) return true;
  if ('\\\\' == path.substring(0, 2)) return true; // Microsoft Azure absolute path
}