# preact-ssr-prepass

[![npm](https://img.shields.io/npm/v/preact-ssr-prepass.svg)](http://npm.im/preact-ssr-prepass)
[![Coverage Status](https://coveralls.io/repos/github/sventschui/preact-ssr-prepass/badge.svg?branch=master&t=G8Cc9D)](https://coveralls.io/github/sventschui/preact-ssr-prepass?branch=master)
[![OpenCollective Backers](https://opencollective.com/preact/backers/badge.svg)](#backers)
[![OpenCollective Sponsors](https://opencollective.com/preact/sponsors/badge.svg)](#sponsors)
[![travis](https://travis-ci.com/sventschui/preact-ssr-prepass.svg?branch=master)](https://travis-ci.com/sventschui/preact-ssr-prepass)


> Drop-in replacement for `react-ssr-prepass`.

Neither Preact nor React support `Suspense` on the server as of now. Heavily inspired by `react-ssr-prepass`, `preact-ssr-prepass` provides a two-pass approach with which `Suspense` can be used on the server. In the first pass, `preact-ssr-prepass` 
will create a VNode tree and await all suspensions, in the second pass `preact-render-to-string`
can be used to render a vnode to a string.

Even if `preact-ssr-prepass` is designed to do as little as possible, it still adds a slight 
overhead since the VNode tree is created twice.

⚠️ Note that this is neither an official Preact nor React API and that the way `Suspense` is handled
on the server might/will change in the future!

# Usage / API

## Awaiting suspensions

`preact-ssr-prepass` needs to be called just before rendering a vnode to a string. See the following
example:

lazy.js:
```js
export default function LazyLoaded() {
    return <div>I shall be loaded and rendered on the server</div>
}
```

index.js:
```js
import { createElement as h } from 'preact';
import { Suspense, lazy } from 'preact/compat';
import renderToString from 'preact-render-to-string';
import prepass from 'preact-ssr-prepass';

const LazyComponent = lazy(() => import('./lazy'));

const vnode = (
    <Suspense fallback={<div>I shall not be rendered on the server</div>}>
        <LazyComponent />
    </Suspense>
);

prepass(vnode)
    .then(() => {
        // <div>I shall be loaded and rendered on the server</div>
        console.log(renderToString(vnode));
    });
```

## Custom suspensions/data fetching using the visitor

`preact-ssr-prepass` accepts a second argument that allows you to suspend on arbitrary elements:

```js
ssrPrepass(<App />, (element, instance) => {
  if (instance !== undefined && typeof instance.fetchData === 'function') {
    return instance.fetchData()
  }
});
```

## API

```js
/**
 * Visitor function to suspend on certain elements.
 * 
 * When this function returns a Promise it is awaited before the vnode will be rendered.
 */
type Visitor = (element: preact.VNode, instance: ?preact.Component) => ?Promise<any>;

/**
 * The default export of preact-ssr-prepass
 *
 * @param{vnode} preact.VNode The vnode to traverse
 * @param{visitor} ?Visitor A function that is called for each vnode and might return a Promise to suspend.
 * @param{context} ?Object Initial context to be used when traversing the vnode tree
 * @return Promise<any> Promise that will complete once the complete vnode tree is traversed. Note that even if
 *         a Suspension throws the returned promise will resolve.
 */
export default function prepass(vnode: preact.VNode, visitor?: Visitor, context:? Object): Promise<any>;
```

## Replace react-ssr-prepass (e.g. next.js)

`react-ssr-prepass` is usually used on the server only and not bundled into your bundles but rather
required through Node.js. To alias `react-ssr-prepass` to `preact-ssr-prepass` we recommend to use
`module-alias`:

Create a file named `alias.js`:
```js
const moduleAlias = require('module-alias')

module.exports = () => {
  moduleAlias.addAlias('react-ssr-prepass', 'preact-ssr-prepass')
}
```

Require and execute the exported function in your applications entrypoint (before require'ing `react-ssr-prepass`):
```js
require('./alias')();
```

# Differences to `react-ssr-prepass`

The visitor passed to `preact-ssr-prepass` gets a Preact element instead of a React one. When you use `preact/compat`'s `createElement` it will make the element/vnode look as similar to a React element as possible.
