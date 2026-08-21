# Context

Context is extremely important for writing reusable components.

In implement you can create a context using the `context` function.

```ts
import { context } from "@implementjs/core";

type Theme = "light" | "dark";

const ThemeContext = context<Signal<Theme>>();
```

Then you need to mount the context provider wrapping your children:

```ts
import { context, type Child } from "@implementjs/core";

type Theme = "light" | "dark";

const ThemeContext = context<Signal<Theme>>();

export default function App(...children: Child[]) {
	const theme = signal("light");
	// <context>.Provide(<value>).To(<children>)
	return ThemeContext.Provide(theme).To(...children);
}
```

Now you can use the context with `<context>.Use((<value>) => <children>)`

```ts
export function ThemeSwitcher() {
	return ThemeContext.Use((theme) => {
		return Div(
			Button(
				{
					onClick: () => theme.set("light"),
				},
				"Light",
			),
			Button(
				{
					onClick: () => theme.set("dark"),
				},
				"Dark",
			),
		);
	});
}
```

> [!IMPORTANT]
> Context values are **not** reactive by default. Transport a signal to be able to react to updates.

A common pattern is to send a class through context and which has reactive properties:

```ts
import { context, type Child } from "@implementjs/core";

type Theme = "light" | "dark";

class ThemeManager {
	private theme = signal<Theme>("light");

	toggle() {
		this.theme.set(this.theme.get() === "light" ? "dark" : "light");
	}
}

const ThemeContext = context<ThemeManager>();

export default function App(...children: Child[]) {
	const themeManager = new ThemeManager();
	return ThemeContext.Provide(themeManager).To(...children);
}

export function ThemeSwitcher() {
	return ThemeContext.Use((manager) => {
		return Div(
			Button(
				{
					onClick: () => manager.toggle(),
				},
				manager.theme.bind((theme) => (theme === "light" ? "Light" : "Dark")),
			),
		);
	});
}
```
