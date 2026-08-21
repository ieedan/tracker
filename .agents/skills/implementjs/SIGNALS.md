# Signals

Signal is our name for a reactive value in implement. Unlike other frameworks there is no magic. What we basically have is a Svelte-like store object with one of the following types:

```ts
export interface Readable<T> {
	get(): T;
	subscribe(callback: Callback<T>): Unsubscribe;
	/** Subscribe to later updates. Unlike `watch`, this does not run with the current value. */
	onChange(callback: ChangeCallback<T>): Unsubscribe;
	/**
	 * One-way binding of a (possibly dotted) path.
	 * @example
	 * todo.bind("author.name")
	 * // same as: todo.bind((value) => value.author.name)
	 */
	bind<P extends BindableKeys<T>>(path: P): Readable<BindPathValue<T, P>>;
	/**
	 * One-way derived value. A selector result that is itself a readable is
	 * followed and unwrapped, so selecting a nested signal surfaces its value.
	 * @example
	 * todo.bind((value) => value.title.toUpperCase())
	 */
	bind<U>(selector: (value: T) => U): Readable<Unwrapped<U>>;
}

export interface Writable<T> extends Readable<T> {
	set(value: T): void;
	/** Notify subscribers of the current value. Used after in-place mutation. */
	flush(): void;
	/**
	 * Two-way binding of a (possibly dotted) path.
	 * @example
	 * todo.bind("author.name")
	 * // same as:
	 * todo.bind(
	 *   (value) => value.author.name,
	 *   (prev, next) => ({ ...prev, author: { ...prev.author, name: next } }),
	 * )
	 */
	bind<P extends BindableKeys<T>>(path: P): Signal<BindPathValue<T, P>>;
	/**
	 * One-way derived value. A selector result that is itself a readable is
	 * followed and unwrapped, so selecting a nested signal surfaces its value.
	 * @example
	 * todo.bind((value) => value.title.toUpperCase())
	 */
	bind<U>(selector: (value: T) => U): Readable<Unwrapped<U>>;
	/**
	 * Two-way derived value. `update` writes `next` back into `prev`.
	 * Return a new parent, or mutate `prev` in place and return nothing.
	 * @example
	 * todo.bind((value) => value.title, (prev, next) => ({ ...prev, title: next }))
	 * @example
	 * todo.bind((value) => value.title, (prev, next) => { prev.title = next })
	 */
	bind<U>(selector: (value: T) => U, update: BindUpdate<T, U>): Signal<U>;
}
```

These interfaces are what subscribers use as their interfaces to react to. However the `Signal<T>` type has some extra sugar on top of it to make mutating reactive values easier for example: `.increment()/.decrement()`, `.toggle()`, `.push()/.pop()`.

You can create a signal with the `signal` function:

```ts
import { signal } from "@implementjs/core";

const count = signal(0);

signal.get(); // 0
signal.set(1);
signal.get(); // 1
signal.increment();
signal.get(); // 2
```

For the most part Signals should just be POJOs but you will probably find yourself needing Sets and Maps so for that implementjs implements: `Implement.Set` and `Implement.Map`:

```ts
import { Implement } from "@implementjs/core";

Implement.Set; // reactive set
Implement.Map; // reactive map
```

## Binding and Deriving values

If you need to derived one or more signals into one readable value then you can use `derived`:

```ts
import { derived, signal } from "@implementjs/core";

const count = signal(0);
const multiplier = signal(2);
const computed = derived([count, multiplier], ([count, multiplier]) => count * multiplier);

computed.get(); // 0
count.set(1);
computed.get(); // 2
multiplier.set(3);
computed.get(); // 3
```

If you just need to derive a single value from a signal then you probably want to use `.bind()` instead:

```ts
import { signal } from "@implementjs/core";

const count = signal(0);
const doubled = count.bind((value) => value * 2);

doubled.get(); // 0
count.set(1);
doubled.get(); // 2
```

Bind can also be used to expose properties of a reactive object:

```ts
import { signal } from "@implementjs/core";

const person = signal({ name: "John", age: 30 });
const name = person.bind((value) => value.name);

name.get(); // "John"
person.set({ name: "Jane", age: 25 });
name.get(); // "Jane"
```

There is also a shortcut for binding to a single property of an object:

```ts
import { signal } from "@implementjs/core";

const person = signal({ name: "John", age: 30 });
const name = person.bind("name");

name.get(); // "John"
person.set({ name: "Jane", age: 25 });
name.get(); // "Jane"
```

### Two way binding

Bindings aren't just one way. You can also use `bind` to create a two way binding to a signal:

```ts
import { signal } from "@implementjs/core";

const person = signal({ name: "John", age: 30 });
const name = person.bind("name"); // or person.bind((person) => person.name, (prev, next) => { ...prev, name: next })

name.get(); // "John"
person.set({ name: "Jane", age: 25 });
name.get(); // "Jane"
name.set("Jim");
person.get(); // { name: "Jim", age: 25 }
```

### Watching for changes

If you need to react to changes in a signal then you can use either the `.subscribe` or `.onChange` method. This will require you to manually unsubscribe from the signal when you're done.

```ts
import { signal } from "@implementjs/core";

const count = signal(0);
const unsubscribe = count.subscribe((value) => {
	console.log(value);
});
const unsubscribe2 = count.onChange((value, previousValue) => {
	console.log(value, previousValue);
});

// make sure to unsubscribe from the signal when you're done
unsubscribe();
unsubscribe2();
```

Alternatively you can mount the `Implement.Watch` component to watch for changes to one of more signals and automatically unsubscribe when the component is unmounted.

```ts
import { Implement } from "@implementjs/core";

export default function Page() {
	return Implement.Watch([count, multiplier], (count, multiplier) =>
		console.log(count * multiplier),
	);
}
```

### How updates propagate

A binding subscribes to its **source** and only notifies when its own slice actually changed (compared deeply, like `set`). Sibling bindings don't disturb each other. Setting `todo.bind("title")` does not notify subscribers of `todo.bind("author.name")`.

Bindings also chain. `todo.bind("author").bind("name")` behaves like `todo.bind("author.name")`, and everything here composes with `ForEach`, whose rows are themselves signals you can `bind` into.
