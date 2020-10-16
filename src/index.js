// @flow
import { assign, getChildren } from "./util";
import { options, Fragment, Component } from "preact";
import { Suspense } from "preact/compat";

function initializeComponent(C, vnode, props, context) {
  vnode.__c = new C(props, context);

  // initialize components in dirty state so setState() doesn't enqueue re-rendering:
  vnode.__c.__d = true;
  vnode.__c.__v = vnode;
  vnode.__c.props = props;
  vnode.__c.context = context;
  /* istanbul ignore else */
  if (vnode.__c.state === undefined) {
    vnode.__c.state = {};
  }

  // options.render was renamed to _render (mangled to __r)
  if (options.render) options.render(vnode);
  if (options.__r) options.__r(vnode);

  return vnode.__c;
}

const createContextDefaultValue = "__p";
const createContextDefaultValueNew = "__";
const _skipEffects = "__s";

/*::
type VNode = {
	type: string | Function,
	props: Object,
	__c: typeof Component,
};

type VNodes = VNode | Array<VNode>;

type Options = {
	render: (vnode: VNode) => void;
};
*/

function createRender(nodeName, vnode, props, cctx, isClassComponent) {
  return function doRender() {
    try {
      const previousSkipEffects = options[_skipEffects];
      options[_skipEffects] = true;

      const renderResult = isClassComponent
        ? Promise.resolve(
            vnode.__c.render(
              vnode.__c.props,
              vnode.__c.state,
              vnode.__c.context
            )
          )
        : Promise.resolve(nodeName.call(vnode.__c, props, cctx));

      options[_skipEffects] = previousSkipEffects;
      return renderResult;
    } catch (e) {
      if (e && e.then) {
        return e.then(doRender, doRender);
      }

      return Promise.reject(e);
    }
  };
}

const visitChild = (vnode, visitor, context, traversalContext) => {
  // null, boolean, text, number "vnodes" need to prepassing...
  if (vnode == null || typeof vnode !== "object") return [];

  let nodeName = vnode.type,
    props = vnode.props,
    children = [];

  if (
    typeof nodeName === "function" &&
    nodeName !== Fragment &&
    nodeName !== Suspense // We're handling Suspense the same way as we do fragments as we do not want something to catch promises during prepass
  ) {
    let doRender /* : () => Promise<void> */;
    let c = initializeComponent(Component, vnode, props, context);
    let cctx;

    let isClassComponent = false;

    if (
      !nodeName.prototype ||
      typeof nodeName.prototype.render !== "function"
    ) {
      // Necessary for createContext api. Setting this property will pass
      // the context value as `this.context` just for this component.
      let cxType = nodeName.contextType;
      let provider = cxType && context[cxType.__c];
      cctx =
        cxType != null
          ? provider
            ? provider.props.value
            : cxType[createContextDefaultValue] ||
              cxType[createContextDefaultValueNew]
          : context;
    } else {
      isClassComponent = true;

      c = initializeComponent(nodeName, vnode, props, context);

      // TODO: does react-ssr-prepass call the visitor before lifecycle hooks?
      if (nodeName.getDerivedStateFromProps)
        c.state = assign(
          assign({}, c.state),
          nodeName.getDerivedStateFromProps(c.props, c.state)
        );
      else if (c.componentWillMount) c.componentWillMount();
    }

    doRender = createRender(nodeName, vnode, props, cctx, isClassComponent);

    let promise;
    if (visitor) {
      const result = visitor(vnode, isClassComponent ? c : undefined);
      if (result && typeof result.then === "function") {
        promise = result.then(doRender);
      } else {
        promise = doRender();
      }
    } else {
      promise = doRender();
    }

    return promise.then((rendered) => {
      if (c.getChildContext) {
        traversalContext.push(assign(assign({}, context), c.getChildContext()));
      }

      if (Array.isArray(rendered)) {
        return rendered;
      }

      return [rendered];
    });
  }

  if (props && getChildren((children = []), props.children).length) {
    return children;
  }

  return [];
};

export default async function prepass(
  vnode /*: VNode */,
  visitor /*: ?(vnode: VNode, component: typeof Component) => ?Promise<any> */,
  context /*: ?Object */
) /*: Promise<any|Array<any>> */ {
  context = context || {};

  const traversalChildren = [[vnode]];
  const traversalContext = [context];
  while (traversalChildren.length > 0) {
    // $FlowFixMe
    const element = traversalChildren[traversalChildren.length - 1].shift();
    if (element !== undefined) {
      const result = visitChild(
        element,
        visitor,
        traversalContext[traversalContext.length - 1] || {},
        traversalContext
      );

      if (result && typeof result.then === "function") {
        traversalChildren.push(await result);
      } else {
        traversalChildren.push(result);
      }
    } else {
      traversalChildren.pop();
      traversalContext.pop();
    }
  }

  return traversalChildren;
}
