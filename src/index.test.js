// @flow
/* eslint-env jest */
// @jsx h
import { createElement as h, Fragment, options, createContext, Component } from 'preact';
import prepass from '.';

function Suspendable_({ getPromise, isDone }) {
    if (!isDone()) {
        throw getPromise();
    }

    return (<div>done!</div>);
}

describe("prepass", () => {
    let Suspendable, createPromise, getPromise, isDone, resolve, resolveAndRethrow, reject, rejectAndRethrow;
    beforeEach(() => {
        getPromise = isDone = resolve = resolveAndRethrow = reject = rejectAndRethrow = null;
        Suspendable = jest.fn(Suspendable_);

        createPromise = () => new Promise((res) => {
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
    })

    it("should work without suspension", async () => {
        const Suspendable = jest.fn(Suspendable_);
        const result = await prepass(<Suspendable isDone={() => true}>Hello</Suspendable>);
        expect(Suspendable.mock.calls.length).toBe(1);
        expect(result).toEqual([undefined]);
    });

    it("should call options.render", async () => {
        const Suspendable = jest.fn(Suspendable_);
        options.render = jest.fn();
        
        const result = await prepass(<Suspendable isDone={() => true}>Hello</Suspendable>);
        expect(options.render.mock.calls.length).toBe(1);
        expect(result).toEqual([undefined]);
        
        delete options.render;
    });

    it("should await suspension", async () => {
        const promise = prepass(
            <div>
                Some text
                <Suspendable isDone={isDone} getPromise={getPromise}>Hello</Suspendable>
            </div>);
        expect(Suspendable.mock.calls.length).toBe(1);

        // $FlowFixMe
        await resolveAndRethrow();
        expect(Suspendable.mock.calls.length).toBe(2);

        // $FlowFixMe
        await resolve();
        expect(Suspendable.mock.calls.length).toBe(3);

        const result = await promise;
        expect(result).toEqual([undefined,[undefined]]);
    });

    it("should await suspension in fragment", async () => {
        const promise = prepass(
            <div>
                <Fragment>
                    <Suspendable isDone={isDone} getPromise={getPromise}>Hello</Suspendable>
                </Fragment>
            </div>
        );
        expect(Suspendable.mock.calls.length).toBe(1);

        // $FlowFixMe
        await resolveAndRethrow();
        expect(Suspendable.mock.calls.length).toBe(2);

        // $FlowFixMe
        await resolve();
        expect(Suspendable.mock.calls.length).toBe(3);

        const result = await promise;
        expect(result).toEqual([[[undefined]]]);
    });

    it("should await throwing suspension", async () => {
        const promise = prepass(<Suspendable isDone={isDone} getPromise={getPromise}>Hello</Suspendable>);
        expect(Suspendable.mock.calls.length).toBe(1);

        // $FlowFixMe
        await rejectAndRethrow();
        expect(Suspendable.mock.calls.length).toBe(2);

        // $FlowFixMe
        await reject();
        expect(Suspendable.mock.calls.length).toBe(3);

        const result = await promise;
        expect(result).toEqual([undefined]);
    });

    it("should pass props to render", async () => {
        const Component = jest.fn(() => (<div />));

        const promise = prepass(
            <Component prop="value" />
        );

        const result = await promise;
        expect(result).toEqual(undefined);

        expect(Component.mock.calls).toEqual([[{prop:'value'},{}]]);
    });

    it("should support legacy context", async () => {
        class ContextProvider extends Component {
            getChildContext() {
                return {
                    foo: 'bar',
                };
            }
            render(props) {
                return props.children;
            }
        }

        const ContextConsumer = jest.fn(() => (<div>With context</div>));

        const promise = prepass(
            <ContextProvider value={123}>
                <ContextConsumer />
            </ContextProvider>
        );

        const result = await promise;
        expect(result).toEqual([undefined]);

        expect(ContextConsumer.mock.calls).toEqual([[{}, {foo:'bar'}]]);
    });

    // TODO: should keep context across suspension
    it("should support createContext", async () => {
        const renderFn = jest.fn(() => (<div>With context</div>));
        const ctx = createContext(null);

        const promise = prepass(
            <ctx.Provider value={123}>
                <ctx.Consumer>{renderFn}</ctx.Consumer>
            </ctx.Provider>
        );

        // $FlowFixMe
        await resolve();
        expect(renderFn.mock.calls).toEqual([[123]]);

        const result = await promise;
        expect(result).toEqual([undefined]);
    });

    it("should support createContext default value", async () => {
        const renderFn = jest.fn(() => (<div>With context</div>));
        const ctx = createContext(123);

        const promise = prepass(
                <ctx.Consumer>{renderFn}</ctx.Consumer>
        );

        // $FlowFixMe
        await resolve();
        expect(renderFn.mock.calls).toEqual([[123]]);

        const result = await promise;
        expect(result).toEqual([undefined]);
    });

    it("should reject when non-promise errors are thrown", async () => {
        const Component = () => { throw new Error('hello'); };
        
        await expect(prepass(
            <Component />
        )).rejects.toEqual(new Error('hello'));
    });
});
