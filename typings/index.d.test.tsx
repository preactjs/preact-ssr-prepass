import prepass from "preact-ssr-prepass";
import { createElement, VNode, Component } from "preact";

const vnode = createElement("div", {});
const asyncVisitor = (vnode: VNode, component: Component) => Promise.resolve();
const syncVisitor = (vnode: VNode, component: Component) => undefined;
const emptyContext = {};
const filledContext = { foo: "bar" };

const promise01: Promise<any> = prepass(vnode);
const promise02: Promise<any> = prepass(vnode, asyncVisitor);
const promise03: Promise<any> = prepass(vnode, syncVisitor);
const promise04: Promise<any> = prepass(vnode, syncVisitor, undefined);
const promise05: Promise<any> = prepass(vnode, syncVisitor, emptyContext);
const promise06: Promise<any> = prepass(vnode, syncVisitor, filledContext);
const promise07: Promise<any> = prepass(vnode, syncVisitor, filledContext);
