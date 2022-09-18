// @flow
import { assign, getChildren } from "./util";
import { options, Fragment, Component } from "preact";
import { Suspense } from "preact/compat";

const createContextDefaultValue = "__p";
const createContextDefaultValueNew = "__";
const _skipEffects = "__s";
const _children = "__k"
const _parent = "__"
const _diff = "__b"

/*::
type VNode = {
	type: string | Function,
	props: Object,
	__c: typeof Component,
	__: any,
	__k: any,
};

type VNodes = VNode | Array<VNode>;

type Options = {
	render: (vnode: VNode) => void;
};
*/

export default function prepass(
	vnode /*: VNode */,
	visitor /*: ?(vnode: VNode, component: typeof Component) => ?Promise<any> */,
	context /*: ?Object */,
	parent /*: ?VNode */,
) /*: Promise<any|Array<any>> */ {
	// null, boolean, text, number "vnodes" need to prepassing...
	if (vnode == null || typeof vnode !== "object") {
		return Promise.resolve();
	}

	let nodeName = vnode.type,
		props = vnode.props,
		children = [];
	context = context || {};

	vnode[_parent] = parent;

	if (
		typeof nodeName === "function" &&
		nodeName !== Fragment &&
		nodeName !== Suspense // We're handling Suspense the same way as we do fragments as we do not want something to catch promises during prepass
	) {
		let doRender /* : () => Promise<void> */;
		let c = (vnode.__c = new Component(props, context));
		// initialize components in dirty state so setState() doesn't enqueue re-rendering:
		c.__d = true;
		c.__v = vnode;
		/* istanbul ignore else */
		if (c.state === undefined) {
			c.state = {};
		}

		let isClassComponent = false;

		// Necessary for createContext api. Setting this property will pass
		// the context value as `this.context` just for this component.
		let cxType = nodeName.contextType;
		let provider = cxType && context[cxType.__c];
		let cctx =
			cxType != null
				? provider
					? provider.props.value
					: cxType[createContextDefaultValue] ||
					  cxType[createContextDefaultValueNew]
				: context;

		vnode[_parent] = parent

		if (
			!nodeName.prototype ||
			typeof nodeName.prototype.render !== "function"
		) {
			// stateless functional components
			doRender = () => {
				try {
					const previousSkipEffects = options[_skipEffects];
					options[_skipEffects] = true;
					// options.render was renamed to _render (mangled to __r)
					if (options.render) options.render(vnode);
					if (options.__r) {
						options.__r(vnode);
					}

					const renderResult = Promise.resolve(
						nodeName.call(vnode.__c, props, cctx)
					);
					options[_skipEffects] = previousSkipEffects;
					return renderResult;

				} catch (e) {
					if (e && e.then) {
						return e.then(doRender, doRender);
					}

					return Promise.reject(e);
				}
			};
		} else {
			isClassComponent = true;

			// class-based components
			// c = new nodeName(props, context);
			c = vnode.__c = new nodeName(props, cctx);
			// initialize components in dirty state so setState() doesn't enqueue re-rendering:
			c.__d = true;
			c.__v = vnode;
			c.props = props;
			c.context = cctx;
			if (c.state === undefined) {
				c.state = {};
			}

			// TODO: does react-ssr-prepass call the visitor before lifecycle hooks?
			if (nodeName.getDerivedStateFromProps)
				c.state = assign(
					assign({}, c.state),
					nodeName.getDerivedStateFromProps(c.props, c.state)
				);
			else if (c.componentWillMount) c.componentWillMount();

			doRender = () => {
				try {
					// options.render was renamed to _render (mangled to __r)
					if (options.render) options.render(vnode);
					if (options.__r) options.__r(vnode);
					return Promise.resolve(c.render(c.props, c.state, c.context));
				} catch (e) {
					if (e && e.then) {
						return e.then(doRender, doRender);
					}

					return Promise.reject(e);
				}
			};
		}

		if (options[_diff]) {
			options[_diff](vnode)
		}

		return (visitor
			? (
					visitor(vnode, isClassComponent ? c : undefined) || Promise.resolve()
			  ).then(doRender)
			: doRender()
		).then((rendered) => {
			if (c.getChildContext) {
				context = assign(assign({}, context), c.getChildContext());
			}

			if (Array.isArray(rendered)) {
				vnode[_children] = [];
				return Promise.all(
					rendered.map((node) => {
						vnode[_children].push(node);
						return prepass(node, visitor, context, vnode)
					})
				);
			}

			return prepass(rendered, visitor, context, vnode);
		});
	} else {
		if (options[_diff]) options[_diff](vnode)
	}

	if (props && getChildren((children = []), props.children).length) {
		vnode[_children] = [];
		return Promise.all(
			children.map((child) => {
				vnode[_children].push(child);
				return prepass(child, visitor, context, vnode)
			})
		);
	}

	return Promise.resolve();
}
