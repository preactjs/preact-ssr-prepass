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
import { useState, useEffect, useLayoutEffect } from "preact/hooks";

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
  describe("rendering", () => {
    it("should pass props to render", async () => {
      const Component = jest.fn(() => <div />);

      const promise = prepass(<Component prop="value" />);

      const result = await promise;
      expect(result).toEqual(undefined);

      expect(Component.mock.calls).toEqual([[{ prop: "value" }, {}]]);
    });
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

  describe("hooks", () => {
    it("it should support useState", async () => {
      let setStateHoisted;
      function MyHookedComponent() {
        const [state, setState] = useState("foo");
        setStateHoisted = setState;

        return <div>{state}</div>;
      }

      await prepass(<MyHookedComponent />);
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

        expect(spy.mock.calls).toEqual([[{ foo: "bar" }, undefined]]);
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
        expect(spyGDSFP.mock.calls).toEqual([[{ foo: "bar" }, undefined]]);
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
  });

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

  // TODO: test the visitor

  describe("suspensions", () => {
    // TODO: create a test to assert what happens with state while suspending...

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
