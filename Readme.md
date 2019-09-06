
# koa-send

[![NPM version][npm-image]][npm-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]
[![Dependency Status][david-image]][david-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]

 Static file serving middleware.

## 源码解读
分析出指向的文件的具体文件路径，然后进行content-encoding压缩。

最后通过fs.createReadStream将文件以可读流的方式，挂载在ctx.body上，交给koa最后去res.end。

核心源码如下：

``` js
/**
 * Module dependencies.
 */

const debug = require('debug')('koa-send')
const resolvePath = require('resolve-path')
const createError = require('http-errors')
const assert = require('assert')
const fs = require('mz/fs')

const {
  normalize,
  basename,
  extname,
  resolve,
  parse,
  sep
} = require('path')

/**
 * Expose `send()`.
 */

module.exports = send

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
// koa-static基于此模块
// await send(ctx, ctx.path, opts)
async function send (ctx, path, opts = {}) {
  // 使用assert模块来判断参数是否传入
  assert(ctx, 'koa context required')
  assert(path, 'pathname required')

  // options
  debug('send "%s" %j', path, opts)
  // 取得绝对路径
  const root = opts.root ? normalize(resolve(opts.root)) : ''
  const trailingSlash = path[path.length - 1] === '/'
  // 取得相对路径
  path = path.substr(parse(path).root.length)
  const index = opts.index
  const maxage = opts.maxage || opts.maxAge || 0
  const immutable = opts.immutable || false
  const hidden = opts.hidden || false
  const format = opts.format !== false
  const extensions = Array.isArray(opts.extensions) ? opts.extensions : false
  const brotli = opts.brotli !== false
  const gzip = opts.gzip !== false
  const setHeaders = opts.setHeaders

  if (setHeaders && typeof setHeaders !== 'function') {
    throw new TypeError('option setHeaders must be function')
  }

  // normalize path
  // 对路径进行URI解码
  path = decode(path)

  if (path === -1) return ctx.throw(400, 'failed to decode')

  // index file support
  if (index && trailingSlash) path += index
  // 通过绝对路径和相关路径，获取到资源的完整路径
  path = resolvePath(root, path)

  // hidden file support, ignore
  if (!hidden && isHidden(root, path)) return

  let encodingExt = ''
  // serve brotli file when possible otherwise gzipped file when possible
  if (ctx.acceptsEncodings('br', 'identity') === 'br' && brotli && (await fs.exists(path + '.br'))) {
    path = path + '.br'
    ctx.set('Content-Encoding', 'br')
    ctx.res.removeHeader('Content-Length')
    encodingExt = '.br'
  } else if (ctx.acceptsEncodings('gzip', 'identity') === 'gzip' && gzip && (await fs.exists(path + '.gz'))) {
    path = path + '.gz'
    ctx.set('Content-Encoding', 'gzip')
    ctx.res.removeHeader('Content-Length')
    encodingExt = '.gz'
  }

  if (extensions && !/\.[^/]*$/.exec(path)) {
    const list = [].concat(extensions)
    for (let i = 0; i < list.length; i++) {
      let ext = list[i]
      if (typeof ext !== 'string') {
        throw new TypeError('option extensions must be array of strings or false')
      }
      if (!/^\./.exec(ext)) ext = '.' + ext
      if (await fs.exists(path + ext)) {
        path = path + ext
        break
      }
    }
  }

  // stat
  let stats
  try {
    // 判断路由中指定的文件是否存在
    stats = await fs.stat(path)

    // Format the path to serve static file servers
    // and not require a trailing slash for directories,
    // so that you can do both `/directory` and `/directory/`
    if (stats.isDirectory()) {
      if (format && index) {
        path += '/' + index
        stats = await fs.stat(path)
      } else {
        return
      }
    }
  } catch (err) {
    const notfound = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR']
    if (notfound.includes(err.code)) {
      throw createError(404, err)
    }
    err.status = 500
    throw err
  }

  if (setHeaders) setHeaders(ctx.res, path, stats)

  // stream
  ctx.set('Content-Length', stats.size)
  if (!ctx.response.get('Last-Modified')) ctx.set('Last-Modified', stats.mtime.toUTCString())
  if (!ctx.response.get('Cache-Control')) {
    const directives = ['max-age=' + (maxage / 1000 | 0)]
    if (immutable) {
      directives.push('immutable')
    }
    ctx.set('Cache-Control', directives.join(','))
  }
  if (!ctx.type) ctx.type = type(path, encodingExt)
  // 通过fs.createReadStream, 将文件内容以可独流的方式挂载在ctx.body上。
  ctx.body = fs.createReadStream(path)

  return path
}

/**
 * Check if it's hidden.
 */

function isHidden (root, path) {
  path = path.substr(root.length).split(sep)
  for (let i = 0; i < path.length; i++) {
    if (path[i][0] === '.') return true
  }
  return false
}

/**
 * File type.
 */

function type (file, ext) {
  return ext !== '' ? extname(basename(file, ext)) : extname(file)
}

/**
 * Decode `path`.
 */

function decode (path) {
  try {
    return decodeURIComponent(path)
  } catch (err) {
    return -1
  }
}

```

## Installation

```js
$ npm install koa-send
```

## Options

 - `maxage` Browser cache max-age in milliseconds. (defaults to `0`)
 - `immutable` Tell the browser the resource is immutable and can be cached indefinitely. (defaults to `false`)
 - `hidden` Allow transfer of hidden files. (defaults to `false`)
 - [`root`](#root-path) Root directory to restrict file access.
 - `index` Name of the index file to serve automatically when visiting the root location. (defaults to none)
 - `gzip` Try to serve the gzipped version of a file automatically when `gzip` is supported by a client and if the requested file with `.gz` extension exists. (defaults to `true`).
 - `brotli` Try to serve the brotli version of a file automatically when `brotli` is supported by a client and if the requested file with `.br` extension exists. (defaults to `true`).
 - `format` If not `false` (defaults to `true`), format the path to serve static file servers and not require a trailing slash for directories, so that you can do both `/directory` and `/directory/`.
 - [`setHeaders`](#setheaders) Function to set custom headers on response.
 - `extensions` Try to match extensions from passed array to search for file when no extension is sufficed in URL. First found is served. (defaults to `false`)

### Root path

  Note that `root` is required, defaults to `''` and will be resolved,
  removing the leading `/` to make the path relative and this
  path must not contain "..", protecting developers from
  concatenating user input. If you plan on serving files based on
  user input supply a `root` directory from which to serve from.

  For example to serve files from `./public`:

```js
app.use(async (ctx) => {
  await send(ctx, ctx.path, { root: __dirname + '/public' });
})
```

  To serve developer specified files:

```js
app.use(async (ctx) => {
  await send(ctx, 'path/to/my.js');
})
```

### setHeaders

The function is called as `fn(res, path, stats)`, where the arguments are:
* `res`: the response object
* `path`: the resolved file path that is being sent
* `stats`: the stats object of the file that is being sent.

You should only use the `setHeaders` option when you wish to edit the `Cache-Control` or `Last-Modified` headers, because doing it before is useless (it's overwritten by `send`), and doing it after is too late because the headers are already sent.

If you want to edit any other header, simply set them before calling `send`.

## Example

```js
const send = require('koa-send');
const Koa = require('koa');
const app = new Koa();

// $ GET /package.json
// $ GET /

app.use(async (ctx) => {
  if ('/' == ctx.path) return ctx.body = 'Try GET /package.json';
  await send(ctx, ctx.path);
})

app.listen(3000);
console.log('listening on port 3000');
```

## License

  MIT

[npm-image]: https://img.shields.io/npm/v/koa-send.svg?style=flat-square
[npm-url]: https://npmjs.org/package/koa-send
[github-tag]: http://img.shields.io/github/tag/koajs/send.svg?style=flat-square
[github-url]: https://github.com/koajs/send/tags
[travis-image]: https://img.shields.io/travis/koajs/send.svg?style=flat-square
[travis-url]: https://travis-ci.org/koajs/send
[coveralls-image]: https://img.shields.io/coveralls/koajs/send.svg?style=flat-square
[coveralls-url]: https://coveralls.io/r/koajs/send?branch=master
[david-image]: http://img.shields.io/david/koajs/send.svg?style=flat-square
[david-url]: https://david-dm.org/koajs/send
[license-image]: http://img.shields.io/npm/l/koa-send.svg?style=flat-square
[license-url]: LICENSE
[downloads-image]: http://img.shields.io/npm/dm/koa-send.svg?style=flat-square
[downloads-url]: https://npmjs.org/package/koa-send
[gittip-image]: https://img.shields.io/gittip/jonathanong.svg?style=flat-square
[gittip-url]: https://www.gittip.com/jonathanong/
