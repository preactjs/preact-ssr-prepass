import { Component, VNode } from 'preact';

type Options = {
    render?: (vnode: VNode) => any;
};

declare function prepass(
    vnode: VNode,
    visitor?: (vnode: VNode, component: Component) => Promise<any> | undefined,
    context?: Object | undefined,
    opts?: Options,
): Promise<void|Array<void>>;

export = prepass;
