import { Component, VNode } from "preact";

declare function prepass(
	vnode: VNode,
	visitor?: (
		vnode: VNode,
		component: Component
	) => Promise<any> | undefined | void,
	context?: Object | undefined
): Promise<void | Array<void>>;

export = prepass;
