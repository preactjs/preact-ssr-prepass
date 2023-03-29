// @flow
import { getChildren } from "./util";
import { options, Fragment, Component } from "preact";
import { Suspense } from "preact/compat";

const createContextDefaultValue = "__p";
const createContextDefaultValueNew = "__";
const _skipEffects = "__s";
const _children = "__k"
const _parent = "__"
const _diff = "__b"
const _render = "__r"

const assign = Object.assign;
const isArray = Array.isArray;

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

let onDiff;
let onRender;

function prepass(
	vnode /*: VNode */,
	visitor /*: ?(vnode: VNode, component: typeof Component) => ?Promise<any> */,
) /*: Promise<any|Array<any>> */ {
	const prevVnodeHook = options.vnode;
	const prevSkipEffects = options[_skipEffects];

	onDiff = options[_diff]
	onRender = options[_render]
	options.vnode = undefined;
	options[_skipEffects] = true;

	return _prepass(vnode, {}, visitor).then(result => {
		options[_skipEffects] = prevSkipEffects;
		options.vnode = prevVnodeHook;
		return result;
	});
}

function _prepass(
	vnode /*: VNode */,
	context /*: Object */,
	visitor /*: ?(vnode: VNode, component: typeof Component) => ?Promise<any> */,
	parent /*: ?VNode */,
) /*: Promise<any|Array<any>> */ {
	// null, boolean, text, number "vnodes" need to prepassing...
	if (vnode == null || typeof vnode !== "object") {
		return Promise.resolve();
	}

	let nodeName = vnode.type,
		props = vnode.props;

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
					if (onRender) onRender(vnode);

					return Promise.resolve(
						nodeName.call(vnode.__c, props, cctx)
					);
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
				c.state = assign({}, c.state, nodeName.getDerivedStateFromProps(c.props, c.state));
			else if (c.componentWillMount) c.componentWillMount();

			doRender = () => {
				try {
					if (onRender) onRender(vnode);
					return Promise.resolve(c.render(c.props, c.state, c.context));
				} catch (e) {
					if (e && e.then) {
						return e.then(doRender, doRender);
					}

					return Promise.reject(e);
				}
			};
		}

		if (onDiff) onDiff(vnode)

		return (visitor
			? (
					visitor(vnode, isClassComponent ? c : undefined) || Promise.resolve()
			  ).then(doRender)
			: doRender()
		).then((rendered) => {
			if (c.getChildContext) {
				context = assign({}, context, c.getChildContext());
			}

			if (isArray(rendered)) {
				vnode[_children] = [];
				return Promise.all(
					rendered.map((node) => {
						vnode[_children].push(node);
						return _prepass(node, context, visitor, vnode)
					})
				);
			}

			return _prepass(rendered, context, visitor, vnode);
		});
	} else {
		if (onDiff) onDiff(vnode)
	}

	let children = [];
	if (props && getChildren(children, props.children).length) {
		vnode[_children] = [];
		return Promise.all(
			children.map((child) => {
				vnode[_children].push(child);
				return _prepass(child, context, visitor, vnode)
			})
		);
	}

	return Promise.resolve();
}

export default prepass
