// @flow
/* eslint-env jest */
// @jsx h
import {
	createElement as h,
	Fragment,
	options,
	createContext,
	Component,
} from "preact";
import prepass from ".";
import { useState, useEffect, useLayoutEffect, useId } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import renderToString from "preact-render-to-string";

function Suspendable_({ getPromise, isDone }) {
	if (!isDone()) {
		throw getPromise();
	}

	return <div>done!</div>;
}

// TODO: this is hacky :(
function tick() {
	return new Promise((res) => {
		setTimeout(res, 1);
	});
}

/*::
type ExpectablePromise<T> = Promise<T> & { state: '<pending>' | '<resolved>' | '<rejected>' }
*/
function expectablePromise /*::<T>*/(
	originalPromise /* : Promise<T> */
) /*: ExpectablePromise<T> */ {
	const newPromise /* : ExpectablePromise<T> */ = (new Promise((res, rej) => {
		originalPromise.then(
			(value) => {
				newPromise.state = "<resolved>";
				res(value);
			},
			(value) => {
				newPromise.state = "<rejected>";
				rej(value);
			}
		);
	}) /*: any */);

	newPromise.state = "<pending>";

	return newPromise;
}

function createSuspendingComponent() {
	let _resolve, _reject, _resolveAndRethrow, _rejectAndRethrow, suspension;

	function init() {
		suspension = new Promise((res, rej) => {
			_resolve = () => {
				suspension = null;

				res();
			};
			_resolveAndRethrow = () => {
				resolve();
				init();
			};
			_reject = () => {
				suspension = null;

				rej();
			};
			_rejectAndRethrow = () => {
				resolve();
				init();
			};
		});
	}

	init();

	class SuspendingClazz extends Component {
		render(props) {
			if (suspension) {
				throw suspension;
			}

			return props.children;
		}
	}

	function SuspendingFunctional(props) {
		if (suspension) {
			throw suspension;
		}

		return props.children;
	}

	const resolve = () => _resolve();
	const resolveAndRethrow = () => _resolveAndRethrow();
	const reject = () => _reject();
	const rejectAndRethrow = () => _rejectAndRethrow();

	return [
		SuspendingClazz,
		SuspendingFunctional,
		{ resolve, resolveAndRethrow, reject, rejectAndRethrow },
	];
}

describe("prepass", () => {
	describe("hooks", () => {
		// TODO: this seems to work but sais it's not
		it.skip("should not enqueue components for re-rendering when using setState", async () => {
			let didUpdate = false;

			// a re-render would invoke an array sort on the render queue, thus lets check nothing does so
			const arraySort = jest.spyOn(Array.prototype, "sort");

			function MyHookedComponent() {
				const [state, setState] = useState("foo");

				if (!didUpdate) {
					didUpdate = true;
					throw new Promise((resolve) => {
						setState("bar");
						resolve();
					});
				}

				return <div>{state}</div>;
			}

			const vnode = <MyHookedComponent />;

			await prepass(vnode);
			expect(arraySort).not.toHaveBeenCalled();

			// let's test our test. If something changes in preact and no sort is executed
			// before re-rendering our test would be false-positiv, thus we test that sort is called
			// when c.__dirty is false

			function MyHookedComponent2() {
				const c = this;

				const [state, setState] = useState("foo");

				if (!didUpdate) {
					didUpdate = true;
					throw new Promise((resolve) => {
						setState(() => {
							c.__d = false;
							return "bar";
						});
						resolve();
					});
				}

				return <div>{state}</div>;
			}

			didUpdate = false;
			const vnode2 = <MyHookedComponent2 />;

			await prepass(vnode2);
			expect(arraySort).toHaveBeenCalledTimes(1);
			arraySort.mockRestore();
		});

		it("it should skip useEffect", async () => {
			const spy = jest.fn();
			function MyHookedComponent() {
				useEffect(spy, []);

				return <div />;
			}

			await prepass(<MyHookedComponent />);

			expect(spy).not.toHaveBeenCalled();
		});

		it("it should skip useLayoutEffect", async () => {
			const spy = jest.fn();
			function MyHookedComponent() {
				useLayoutEffect(spy, []);

				return <div />;
			}

			await prepass(<MyHookedComponent />);

			expect(spy).not.toHaveBeenCalled();
		});

		it("it should reset _skipEffects", async () => {
			function MyHookedComponent() {
				useLayoutEffect(() => {}, []);

				return <div />;
			}

			options.__s = "test";
			await prepass(<MyHookedComponent />);
			expect(options.__s).toEqual("test");
		});

		describe("useId", () => {
			it('should generate unique ids', async () => {
				const ids = []
				const Child = () => {
					const id = useId();
					ids.push(id)
					return <input id={id} />
				}

				const App = () => {
					const id = useId();
					ids.push(id)
					return (
						<main id={id}>
							<Child />
						</main>
					)
				}

				await prepass(<App />);

				expect(ids).toEqual([
					"P481",
					"P15361",
				])
			})
		})
	});

	describe("rendering", () => {
		it("should pass props to render", async () => {
			const Component = jest.fn(() => <div />);

			const promise = prepass(<Component prop="value" />);

			const result = await promise;
			expect(result).toEqual(undefined);

			expect(Component.mock.calls).toEqual([[{ prop: "value" }, {}]]);
		});
	});

	it("should call options.render for function components", async () => {
		const render = jest.fn();
		const r = jest.fn();
		options.render = render;
		options.__r = r;
		const Component = jest.fn(() => <div />);

		const promise = prepass(<Component prop="value" />);

		const result = await promise;
		expect(result).toEqual(undefined);

		expect(render).toHaveBeenCalledTimes(1);
		expect(r).toHaveBeenCalledTimes(1);
	});

	it("should call options.render for class components", async () => {
		const render = jest.fn();
		const r = jest.fn();
		options.render = render;
		options.__r = r;

		class Outer extends Component {
			render() {
				return <div />;
			}
		}
		const outerRenderSpy = jest.spyOn(Outer.prototype, "render");

		await prepass(<Outer />);

		expect(outerRenderSpy).toHaveBeenCalled();
		expect(render).toHaveBeenCalledTimes(1);
		expect(r).toHaveBeenCalledTimes(1);
	});

	describe("vnode traversal", () => {
		it("should traverse functional components", async () => {
			const Inner = jest.fn(() => <div />);
			const Outer = jest.fn(() => <Inner />);

			await prepass(<Outer />);

			expect(Outer.mock.calls.length).toEqual(1);
			expect(Inner.mock.calls.length).toEqual(1);
		});

		it("should traverse class components", async () => {
			const Inner = jest.fn(() => <div />);
			class Outer extends Component {
				render() {
					return <Inner />;
				}
			}
			const outerRenderSpy = jest.spyOn(Outer.prototype, "render");

			await prepass(<Outer />);

			expect(outerRenderSpy).toHaveBeenCalled();
			expect(Inner.mock.calls.length).toEqual(1);
		});

		it("should traverse Fragments", async () => {
			const Inner = jest.fn(() => <div />);

			await prepass(
				<Fragment>
					<Inner />
				</Fragment>
			);

			expect(Inner.mock.calls.length).toEqual(1);
		});

		it("should traverse regular DOM elements", async () => {
			const Inner = jest.fn(() => <div />);

			await prepass(
				<div>
					<Inner />
				</div>
			);

			expect(Inner.mock.calls.length).toEqual(1);
		});

		it("should traverse rendered children", async () => {
			const Inner = jest.fn(() => <div />);
			const Outer = jest.fn(({ children }) => children);

			await prepass(
				<Outer>
					<Inner />
				</Outer>
			);

			expect(Inner.mock.calls.length).toEqual(1);
		});

		it("should traverse array of nodes returned by render", async () => {
			const Inner = jest.fn(() => <div />);
			const Outer = jest.fn(() => [<Inner />, <Inner />]);

			await prepass(<Outer />);

			expect(Inner.mock.calls.length).toEqual(2);
		});

		it("should traverse children rendered in nested vnode tree", async () => {
			const Inner = jest.fn(() => <div />);
			const Outer = jest.fn(({ children }) => (
				<div>
					<Fragment>{children}</Fragment>
				</div>
			));

			await prepass(
				<Outer>
					<Inner />
				</Outer>
			);

			expect(Inner.mock.calls.length).toEqual(1);
		});

		it("should not traverse non-rendered children", async () => {
			const Inner = jest.fn(() => <div />);
			const Outer = jest.fn(() => <div />);

			await prepass(
				<Outer>
					<Inner />
				</Outer>
			);

			expect(Inner.mock.calls.length).toEqual(0);
		});

		it("should support text, number, boolean and null vnodes", async () => {
			const Inner = jest.fn(() => <div />);
			const Outer = jest.fn(() => <div />);

			await prepass(
				<div>
					Hello
					{123}
					{true}
					{null}
				</div>
			);

			expect(true).toEqual(true);
		});
	});

	describe("lifecycle hooks", () => {
		describe("getDerivedStateFromProps", () => {
			it("should call getDerivedStateFromProps on class components", async () => {
				class Outer extends Component {
					render() {
						return <div />;
					}

					static getDerivedStateFromProps() {}
				}
				const spy = jest.spyOn(Outer, "getDerivedStateFromProps");

				await prepass(<Outer foo="bar" />);

				expect(spy.mock.calls).toEqual([[{ foo: "bar" }, {}]]);
			});

			it("should call getDerivedStateFromProps on class components with initial state", async () => {
				class Outer extends Component {
					constructor(props) {
						super(props);
						this.state = { hello: "state" };
					}
					render() {
						return <div />;
					}

					static getDerivedStateFromProps() {}
				}
				const spy = jest.spyOn(Outer, "getDerivedStateFromProps");

				await prepass(<Outer foo="bar" />);

				expect(spy.mock.calls).toEqual([[{ foo: "bar" }, { hello: "state" }]]);
			});
		});

		describe("componentWillMount", () => {
			it("should call componentWillMount on class components", async () => {
				class Outer extends Component {
					render() {
						return <div />;
					}

					componentWillMount() {}
				}
				const spy = jest.spyOn(Outer.prototype, "componentWillMount");

				await prepass(<Outer foo="bar" />);

				expect(spy.mock.calls).toEqual([[]]);
			});

			it("should not call componentWillMount when getDerivedStateFromProps is defined", async () => {
				class Outer extends Component {
					render() {
						return <div />;
					}

					static getDerivedStateFromProps() {}

					componentWillMount() {}
				}
				const spyCWM = jest.spyOn(Outer.prototype, "componentWillMount");
				const spyGDSFP = jest.spyOn(Outer, "getDerivedStateFromProps");

				await prepass(<Outer foo="bar" />);

				expect(spyCWM.mock.calls).toEqual([]);
				expect(spyGDSFP.mock.calls).toEqual([[{ foo: "bar" }, {}]]);
			});
		});
	});

	describe("legacy context", () => {
		class ContextProvider extends Component {
			getChildContext() {
				return {
					foo: this.props.value,
				};
			}
			render(props) {
				return props.children;
			}
		}

		it("should support legacy context", async () => {
			const ContextConsumer = jest.fn(() => <div>With context</div>);

			const promise = prepass(
				<ContextProvider value={123}>
					<ContextConsumer />
				</ContextProvider>
			);

			const result = await promise;
			expect(result).toEqual([undefined]);

			expect(ContextConsumer.mock.calls).toEqual([[{}, { foo: 123 }]]);
		});

		it("should support legacy context overriding provider", async () => {
			const ContextConsumer = jest.fn(() => <div>With context</div>);

			const promise = prepass(
				<ContextProvider value={123}>
					<ContextProvider value={456}>
						<ContextConsumer />
					</ContextProvider>
				</ContextProvider>
			);

			const result = await promise;
			expect(result).toEqual([undefined]);

			expect(ContextConsumer.mock.calls).toEqual([[{}, { foo: 456 }]]);
		});

		it("should support legacy context when missing a provider", async () => {
			const ContextConsumer = jest.fn(() => <div>With context</div>);

			const promise = prepass(<ContextConsumer />);

			const result = await promise;
			expect(result).toEqual([undefined]);

			expect(ContextConsumer.mock.calls).toEqual([[{}, {}]]);
		});

		it("should support legacy context when suspending", async () => {
			const ContextConsumer = jest.fn(() => <div>With context</div>);
			const [Suspending, _, { resolve }] = createSuspendingComponent();

			const prom = prepass(
				<ContextProvider value={123}>
					<Suspending>
						<ContextConsumer />
					</Suspending>
				</ContextProvider>
			);

			expect(ContextConsumer.mock.calls).toEqual([]);

			resolve();
			await prom;

			expect(ContextConsumer.mock.calls).toEqual([[{}, { foo: 123 }]]);
		});
	});

	describe("createContext", () => {
		it("should support createContext", async () => {
			const renderFn = jest.fn(() => <div>With context</div>);
			const ctx = createContext(null);

			await prepass(
				<ctx.Provider value={123}>
					<ctx.Consumer>{renderFn}</ctx.Consumer>
				</ctx.Provider>
			);

			expect(renderFn.mock.calls).toEqual([[123]]);
		});

		it("should support createContext default value", async () => {
			const renderFn = jest.fn(() => <div>With context</div>);
			const ctx = createContext(123);

			await prepass(<ctx.Consumer>{renderFn}</ctx.Consumer>);

			expect(renderFn.mock.calls).toEqual([[123]]);
		});

		it("should support createContext when suspending", async () => {
			const renderFn = jest.fn(() => <div>With context</div>);
			const ctx = createContext(null);
			const [Suspending, _, { resolve }] = createSuspendingComponent();

			const prom = prepass(
				<ctx.Provider value={123}>
					<Suspending>
						<ctx.Consumer>{renderFn}</ctx.Consumer>
					</Suspending>
				</ctx.Provider>
			);

			expect(renderFn.mock.calls).toEqual([]);

			resolve();
			await prom;

			expect(renderFn.mock.calls).toEqual([[123]]);
		});

		it("should support createContext default value when suspending", async () => {
			const renderFn = jest.fn(() => <div>With context</div>);
			const ctx = createContext(123);
			const [Suspending, _, { resolve }] = createSuspendingComponent();

			const prom = prepass(
				<Suspending>
					<ctx.Consumer>{renderFn}</ctx.Consumer>
				</Suspending>
			);

			expect(renderFn.mock.calls).toEqual([]);

			resolve();
			await prom;

			expect(renderFn.mock.calls).toEqual([[123]]);
		});

		it("should support createContext this.context inside classes with defaultValue", async () => {
			const ctx = createContext(123);
			let ctxValue;

			class Inner extends Component {
				render() {
					ctxValue = this.context;
					return null;
				}
			}

			Inner.contextType = ctx;

			await prepass(<Inner />);

			expect(ctxValue).toEqual(123);
		});

		it("should support createContext this.context inside classes", async () => {
			const ctx = createContext(123);
			let ctxValue;

			class Inner extends Component {
				render() {
					ctxValue = this.context;
					return null;
				}
			}

			Inner.contextType = ctx;

			await prepass(
				<ctx.Provider value={456}>
					<Inner />
				</ctx.Provider>
			);

			expect(ctxValue).toEqual(456);
		});
	});

	describe("lazy", () => {
		it("should support lazy with renderToString", async () => {
			function LazyComponentImpl() {
				return <div>I'm a bit lazy</div>;
			}
			const LazyComponent = lazy(() => Promise.resolve(LazyComponentImpl));
			function App() {
				return <LazyComponent />;
			}

			const tree = <App />;
			await prepass(tree);
			expect(renderToString(tree)).toEqual("<div>I'm a bit lazy</div>");
		});

		it("should support lazy wrapped in Suspense with renderToString", async () => {
			function LazyComponentImpl() {
				return <div>I'm a bit lazy</div>;
			}
			const LazyComponent = lazy(() => Promise.resolve(LazyComponentImpl));
			function App() {
				return (
					<Suspense fallback={null}>
						<LazyComponent />
					</Suspense>
				);
			}

			const tree = <App />;
			await prepass(tree);
			expect(renderToString(tree)).toEqual("<div>I'm a bit lazy</div>");
		});

		it("should support lazy wrapped in ErrorBoundary with renderToString", async () => {
			function LazyComponentImpl() {
				return <div>I'm a bit lazy</div>;
			}
			const LazyComponent = lazy(() => Promise.resolve(LazyComponentImpl));
			class ErrorBoundary extends Component {
				constructor(props) {
					super(props);
					this.state = {};
				}
				componentDidCatch(e) {
					this.setState({ e });
				}
				render({ children }, { e }) {
					return e ? "error" : children;
				}
			}
			function App() {
				return (
					<ErrorBoundary>
						<LazyComponent />
					</ErrorBoundary>
				);
			}

			const tree = <App />;
			await prepass(tree);
			expect(renderToString(tree)).toEqual("<div>I'm a bit lazy</div>");
		});
	});

	describe("Suspense", () => {
		let Suspendable,
			createPromise,
			getPromise,
			isDone,
			resolve,
			resolveAndRethrow,
			reject,
			rejectAndRethrow;
		beforeEach(() => {
			getPromise = isDone = resolve = resolveAndRethrow = reject = rejectAndRethrow = null;
			Suspendable = jest.fn(Suspendable_);

			createPromise = () =>
				new Promise((res) => {
					resolve = () => {
						let tmp = prom;
						prom = null;
						res();
						return tmp;
					};
					resolveAndRethrow = () => {
						let tmp = prom;
						prom = createPromise();
						res();
						return tmp;
					};
					reject = () => {
						let tmp = prom;
						prom = null;
						res();
						return tmp;
					};
					rejectAndRethrow = () => {
						let tmp = prom;
						prom = createPromise();
						res();
						return tmp;
					};
				});
			let prom = createPromise();
			getPromise = () => {
				return prom;
			};

			isDone = () => !prom;
		});

		it("should work without suspension", async () => {
			const Suspendable = jest.fn(Suspendable_);
			const result = await prepass(
				<Suspendable isDone={() => true}>Hello</Suspendable>
			);
			expect(Suspendable.mock.calls.length).toBe(1);
			expect(result).toEqual([undefined]);
		});

		describe("preact options", () => {
			it("should call options.render (legacy)", async () => {
				const Suspendable = jest.fn(Suspendable_);
				options.render = jest.fn();

				const result = await prepass(
					<Suspendable isDone={() => true}>Hello</Suspendable>
				);
				expect(options.render.mock.calls.length).toBe(1);
				expect(result).toEqual([undefined]);

				delete options.render;
			});

			it("should call options._render (__r)", async () => {
				const Suspendable = jest.fn(Suspendable_);
				options.__r = jest.fn();

				const result = await prepass(
					<Suspendable isDone={() => true}>Hello</Suspendable>
				);
				expect(options.__r.mock.calls.length).toBe(1);
				expect(result).toEqual([undefined]);

				delete options.__r;
			});
		});

		describe("suspensions", () => {
			it("should await suspension of class component", async () => {
				const [
					Suspending,
					_,
					{ resolve, resolveAndRethrow },
				] = createSuspendingComponent();

				const spy = jest.spyOn(Suspending.prototype, "render");

				const promise = expectablePromise(
					prepass(
						<div>
							<Suspending foo="bar" />
						</div>
					)
				);
				expect(spy.mock.calls).toEqual([[{ foo: "bar" }, {}, {}]]);

				await tick();
				expect(promise.state).toEqual("<pending>");

				resolveAndRethrow();
				await tick();
				expect(spy.mock.calls).toEqual([
					[{ foo: "bar" }, {}, {}],
					[{ foo: "bar" }, {}, {}],
				]);

				await tick();
				expect(promise.state).toEqual("<pending>");

				resolve();
				await tick();
				await promise;
				expect(spy.mock.calls).toEqual([
					[{ foo: "bar" }, {}, {}],
					[{ foo: "bar" }, {}, {}],
					[{ foo: "bar" }, {}, {}],
				]);
			});

			it("should await suspension of functional component", async () => {
				const [
					_,
					_Suspending,
					{ resolve, resolveAndRethrow },
				] = createSuspendingComponent();

				const Suspending = jest.fn(_Suspending);

				const promise = expectablePromise(
					prepass(
						<div>
							<Suspending foo="bar" />
						</div>
					)
				);
				expect(Suspending.mock.calls).toEqual([[{ foo: "bar" }, {}]]);

				await tick();
				expect(promise.state).toEqual("<pending>");

				resolveAndRethrow();
				await tick();
				expect(Suspending.mock.calls).toEqual([
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
				]);

				await tick();
				expect(promise.state).toEqual("<pending>");

				resolve();
				await tick();
				await promise;
				expect(Suspending.mock.calls).toEqual([
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
				]);
			});

			it("should await suspension inside Fragment", async () => {
				const [
					_,
					_Suspending,
					{ resolve, resolveAndRethrow },
				] = createSuspendingComponent();

				const Suspending = jest.fn(_Suspending);

				const promise = expectablePromise(
					prepass(
						<Fragment>
							<Suspending foo="bar" />
						</Fragment>
					)
				);
				expect(Suspending.mock.calls).toEqual([[{ foo: "bar" }, {}]]);

				resolveAndRethrow();
				await tick();
				expect(Suspending.mock.calls).toEqual([
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
				]);

				await tick();
				expect(promise.state).toEqual("<pending>");

				resolve();
				await tick();
				await promise;
				expect(Suspending.mock.calls).toEqual([
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
				]);
			});

			it("should await throwing suspension", async () => {
				const [
					_,
					_Suspending,
					{ reject, rejectAndRethrow },
				] = createSuspendingComponent();

				const Suspending = jest.fn(_Suspending);

				const promise = expectablePromise(
					prepass(
						<Fragment>
							<Suspending foo="bar" />
						</Fragment>
					)
				);
				expect(Suspending.mock.calls).toEqual([[{ foo: "bar" }, {}]]);

				await tick();
				expect(promise.state).toEqual("<pending>");

				rejectAndRethrow();
				await tick();
				expect(Suspending.mock.calls).toEqual([
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
				]);

				await tick();
				expect(promise.state).toEqual("<pending>");

				reject();
				await tick();
				await promise;
				expect(Suspending.mock.calls).toEqual([
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
					[{ foo: "bar" }, {}],
				]);
			});
		});
	});

	describe("error handling", () => {
		it("should reject when non-promise errors are thrown from functional components", async () => {
			const MyComp = () => {
				throw new Error("hello");
			};

			await expect(prepass(<MyComp />)).rejects.toEqual(new Error("hello"));
		});
	});

	describe("error handling", () => {
		it("should reject when non-promise errors are thrown from class components", async () => {
			class MyComp extends Component {
				render() {
					throw new Error("hello");
				}
			}

			await expect(prepass(<MyComp />)).rejects.toEqual(new Error("hello"));
		});
	});

	describe("Component", () => {
		it("should default state to empty object", async () => {
			class C1 extends Component {
				render() {
					return this.state.foo;
				}
			}
			class C2 extends Component {
				constructor(props, context) {
					super(props, context);
					this.state = { foo: "bar" };
				}
				render() {
					return this.state.foo;
				}
			}

			const spyC1render = jest.spyOn(C1.prototype, "render");
			const spyC2render = jest.spyOn(C2.prototype, "render");

			await prepass(
				<Fragment>
					<C1 />
					<C2 />
				</Fragment>
			);
			expect(spyC1render).toHaveBeenLastCalledWith({}, {}, {});
			expect(spyC2render).toHaveBeenLastCalledWith({}, { foo: "bar" }, {});
		});

		it("should not enqueue components for re-rendering when using setState", async () => {
			const setDirtyFromPreactCore = jest.fn();
			const setDirtyFromPrepass = jest.fn();

			class MyComponent extends Component {
				constructor(props) {
					super(props);
					this.didUpdate = false;
				}

				render() {
					if (!this.didUpdate) {
						this.didUpdate = true;
						throw new Promise((resolve) => {
							this.setState({ foo: "didUpdate" });
							resolve();
						});
					}

					return <div>{this.state.foo}</div>;
				}

				get __d() {
					return Boolean(this.dirty);
				}

				set __d(dirty) {
					if (
						// this checks whether the call comes from prepass or preact (core)
						new Error().stack
							.split("\n")[2]
							.match(/^\s*at prepass \(.*\/src\/index\.js:[0-9]+:[0-9]+\)$/)
					) {
						// we want to force the failure case here to test that preact
						// didn't change in a way invalidating our shady test method
						if (!this.props.forceNotDirty) {
							this.dirty = dirty;
							setDirtyFromPrepass(dirty);
						}
					} else {
						setDirtyFromPreactCore(dirty);
						this.dirty = dirty;
					}
				}
			}

			await prepass(<MyComponent forceNotDirty={false} />);
			// we expect that preact-ssr-prepass initializes the component as dirty to prevent
			// the component to be added to preacts internal rendering queue
			expect(setDirtyFromPrepass).toHaveBeenCalledTimes(1);
			// we expect preact-core to not mark this component as dirty, as it already was dirty
			expect(setDirtyFromPreactCore).toHaveBeenCalledTimes(0);

			// now we test our test... sind this is quite a shady test method we need to make sure
			// it is not false positive due to internal preact changes
			await prepass(<MyComponent forceNotDirty={true} />);
			// we expect that we successfully ignored the call of prepass to mark the component as dirty
			// thus no additional call is expected here
			expect(setDirtyFromPrepass).toHaveBeenCalledTimes(1);
			// we expect that precat marks the component as dirty and thus adds it to its internal rendering queue
			expect(setDirtyFromPreactCore).toHaveBeenCalledTimes(1);
		});

		it("should not enqueue components for re-rendering when using forceUpdate", async () => {
			const setDirtyFromPreactCore = jest.fn();
			const setDirtyFromPrepass = jest.fn();

			class MyComponent extends Component {
				constructor(props) {
					super(props);
					this.didUpdate = false;
				}

				render() {
					if (!this.didUpdate) {
						this.didUpdate = true;
						throw new Promise((resolve) => {
							this.forceUpdate();
							resolve();
						});
					}

					return <div>{this.state.foo}</div>;
				}

				get __d() {
					return Boolean(this.dirty);
				}

				set __d(dirty) {
					if (
						// this checks whether the call comes from prepass or preact (core)
						new Error().stack
							.split("\n")[2]
							.match(/^\s*at prepass \(.*\/src\/index\.js:[0-9]+:[0-9]+\)$/)
					) {
						// we want to force the failure case here to test that preact
						// didn't change in a way invalidating our shady test method
						if (!this.props.forceNotDirty) {
							this.dirty = dirty;
							setDirtyFromPrepass(dirty);
						}
					} else {
						setDirtyFromPreactCore(dirty);
						this.dirty = dirty;
					}
				}
			}

			await prepass(<MyComponent forceNotDirty={false} />);
			// we expect that preact-ssr-prepass initializes the component as dirty to prevent
			// the component to be added to preacts internal rendering queue
			expect(setDirtyFromPrepass).toHaveBeenCalledTimes(1);
			// we expect preact-core to not mark this component as dirty, as it already was dirty
			expect(setDirtyFromPreactCore).toHaveBeenCalledTimes(0);

			// now we test our test... sind this is quite a shady test method we need to make sure
			// it is not false positive due to internal preact changes
			await prepass(<MyComponent forceNotDirty={true} />);
			// we expect that we successfully ignored the call of prepass to mark the component as dirty
			// thus no additional call is expected here
			expect(setDirtyFromPrepass).toHaveBeenCalledTimes(1);
			// we expect that precat marks the component as dirty and thus adds it to its internal rendering queue
			expect(setDirtyFromPreactCore).toHaveBeenCalledTimes(1);
		});
	});

	describe("visitor", () => {
		class MyClassComp extends Component {
			render(props) {
				return props.children;
			}
		}

		function MyFuncComp(props) {
			return props.children;
		}

		it("should call the visitor for class components", async () => {
			const visitor = jest.fn(() => undefined);
			const myComp = <MyClassComp />;
			await prepass(myComp, visitor);

			expect(visitor.mock.calls).toEqual([[myComp, myComp.__c]]);
		});

		it("should call the visitor for functional components", async () => {
			const visitor = jest.fn(() => undefined);
			const myComp = <MyFuncComp />;
			await prepass(myComp, visitor);

			expect(visitor.mock.calls).toEqual([[myComp, undefined]]);
		});

		it("should call the visitor on nested components", async () => {
			const visitor = jest.fn(() => undefined);
			const myFuncComp = <MyFuncComp />;
			const myClassComp = <MyClassComp>{myFuncComp}</MyClassComp>;
			await prepass(myClassComp, visitor);

			expect(visitor.mock.calls).toEqual([
				[myClassComp, myClassComp.__c],
				[myFuncComp, undefined],
			]);
		});

		it("should not call the visitor for Fragments", async () => {
			const visitor = jest.fn(() => undefined);
			await prepass(<Fragment />, visitor);

			expect(visitor.mock.calls.length).toEqual(0);
		});

		it("should not call the visitor for dom, text, null and boolean elements", async () => {
			const visitor = jest.fn(() => undefined);
			await prepass(<div />, visitor);
			// $FlowFixMe
			await prepass(null, visitor);
			// $FlowFixMe
			await prepass(123, visitor);
			// $FlowFixMe
			await prepass(true, visitor);

			expect(visitor.mock.calls.length).toEqual(0);
		});

		it("should await suspensions of the visitor", async () => {
			let resolve;
			const visitor = jest.fn(
				() =>
					new Promise((res) => {
						resolve = res;
					})
			);
			const myComp = <MyFuncComp />;
			const prom = expectablePromise(prepass(myComp, visitor));

			expect(visitor.mock.calls).toEqual([[myComp, undefined]]);

			await tick();
			expect(prom.state).toEqual("<pending>");

			// $FlowFixMe
			resolve();
			await prom;
		});
	});
});
