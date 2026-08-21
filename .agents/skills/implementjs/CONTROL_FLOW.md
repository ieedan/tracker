# Control Flow

Every templating language has their own way of handling control flow. Implement is a little different because you need to be aware of when reactivity is and isn't necessary.

## Non-reactive control flow

You can do all the normal javascript things:

```ts
export default function Page() {
	return Div(
		// ternaries
		true ? "Hello, World!" : "Goodbye, World!",
	);
}

export default function Page() {
	// if statements
	if (condition) {
		return Div("Hello, World!");
	} else {
		return Div("Goodbye, World!");
	}
}

export default function Page() {
	// .map
	return Fragment(...[1, 2, 3].map((item) => Div(item)));
}
```

But none of these are reactive. When the values change the DOM will NOT be updated.

## Reactive control flow

To make these reactive you can use the helper components exported from `@implementjs/core`.

### If

Render a reactive if statement.

```ts
import { If } from "@implementjs/core";

export default function Page() {
	const condition = signal(false);
	const condition2 = signal(false);
	return If(condition)
		.Then(Div("Hello, World!"))
		.Else(Div("Goodbye, World!"))
		.ElseIf(condition2)
		.Then(Div("Hello, World 2!"))
		.Else(Div("Goodbye, World 2!"));
}
```

### Switch

Render a reactive switch statement.

```ts
import { Switch } from "@implementjs/core";

export default function Page() {
	const status = signal<Status>("todo");

	return Switch(status)
		.Case("todo", Icon("circle"))
		.Case("in-progress", Icon("half-circle"))
		.Case("done", Icon("check"))
		.Default(Icon("question"));
}
```

### ForEach

Render a reactive list of items.

```ts
import { ForEach, signal } from "@implementjs/core";

export default function Page() {
	const todos = signal([
		{ id: 1, title: "Ship docs", done: false },
		{ id: 2, title: "Write tests", done: true },
	]);

	return Ul(
		ForEach(
			todos,
			(todo) => todo.id, // a unique key is required for each item
			// todo is two way bindable here, so todo is a signal back to todos[index]
			(todo, index) => Li(todo.bind("title")),
		),
	);
}
```

### Key

For when you need to force re-render a component based on a signal.

```ts
import { Key } from "@implementjs/core";

export default function Page() {
	const counter = signal(0);

	return Key(counter, Div("Hello, World!"));
}
```

or based on multiple signals:

```ts
import { Key } from "@implementjs/core";

export default function Page() {
	const counter = signal(0);
	const counter2 = signal(0);

	return Key([counter, counter2], Div("Hello, World!"));
}
```

### Portal

Render a component somewhere else in the DOM.

```ts
import { Portal } from "@implementjs/core";

export default function Page() {
	return Portal(Div("Hello, World!"), "body");
}
```

#### Targeting the portal

```ts
Portal(Toast(message)).To(toastRoot);

Portal({ to: overlayRoot }, DialogPanel());
```

#### Disabling the portal

```ts
Portal({ to: document.body, disabled: isNested }, Menu());
Portal(Menu()).Disabled(isNested);
```

### Await

Render different markup based on the state of a promise.

```ts
import { Await } from "@implementjs/core";

export default function Page() {
	return Await(fetchUser(id))
		.WhileLoading(Spinner())
		.Then((user) => Profile(user))
		.Catch((error) => P({ class: "error" }, error.message));
}
```

#### Reactive sources: refetching

Pass a `Readable` of a promise and `Await` **re-follows** it whenever a new promise is set. This is the data-fetching pattern. Keep the request in a signal and refetch by swapping the promise:

```ts
const request = signal(api.listIssues());
const refetch = () => request.set(api.listIssues());

Await(request)
	.WhileLoading(Spinner())
	.Then((issues) => IssueList(issues))
	.Catch((error) => RetryCard(error, refetch));
```

With a readable source, `Then` receives a **`Readable<T>`** instead of a raw value. That is what makes refetching seamless. When a new promise resolves while the resolved branch is showing, `Await` patches the readable in place, the branch does **not** remount, and the new data flows through your existing bindings:

```ts
.Then((issues) =>           // issues: Readable<Issue[]>
	ForEach(issues, (i) => i.id, (issue) => IssueRow(issue)),
)
```
