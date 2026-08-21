# Lifecycle

You will inevitabily need to know when a component is mounted, and unmounted. Implement provides `Implement.Lifecycle` to help you with this. Unlike other frameworks, implement doesn't have a way of knowing about the lifecycle without actually hooking into the component tree. So you need to mount `Implement.Lifecycle` into your component tree.

```ts
import { Implement } from "@implementjs/core";

export default function Page() {
	return Implement.Lifecycle(
		{
			onMount: () => {
				console.log("Component mounted");
			},
			onUnmount: () => {
				console.log("Component unmounted");
			},
		},
		Div("Hello, World!"), // mount your children here
	);
}
```

Use onUnmount to clean up any resources you may have allocated like signal subscriptions or event listeners. You can also return a cleanup function from onMount to clean up any resources you may have allocated:

```ts
import { Implement } from "@implementjs/core";

export default function Page() {
	return Implement.Lifecycle(
		{
			onMount: () => {
				console.log("Component mounted");

				return () => {
					console.log("Component unmounted");
				};
			},
		},
		Div("Hello, World!"), // mount your children here
	);
}
```

You can cleanup event listeners here but you probably don't want to clean them up in the first place. So when you are listening to events from the document or window you should use `Implement.Document` or `Implement.Window` instead these will automatically clean up the event listeners when the component is unmounted.

```ts
import { Fragment, Implement } from "@implementjs/core";

export default function Page() {
	return Fragment(
		// the listeners will be cleaned up automatically when the component is unmounted
		Implement.Document({
			onKeydown: (event) => {
				if (event.key === "Escape") {
					console.log("Escape key pressed");
				}
			},
		}),
		Implement.Window({
			onScroll: () => console.log("Scrolled"),
		}),
	);
}
```
