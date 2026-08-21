# Markup

All HTML elements are exported from `@implementjs/core` (or `@implementjs/core/elements`). You call them as functions with props and children to compose an html page.

```ts
import { Div, Span } from "@implementjs/core";

export default function Page() {
	return Div({ "data-test": "hello", class: "" }, Span("Hello, World!"));
}
```

## Props

Props include all event handlers (`on<Event>` ex: `onClick`, `onMouseover`) and attributes like `class` as well as arbitrary attributes like `data-*`.

### Class

`class` (or `className`) takes a clsx-style value. Strings, `{ name: condition }` objects, and arrays of either, nested however you like. Falsy entries are skipped:

```ts
Div({ class: "btn" });
Div({ class: ["btn", { active: isActive }, large && "btn-lg"] });
```

### Style

`style` takes a string or an object keyed by camelCase CSS property. Custom properties use their literal `--name`:

```ts
Div({ style: { color: "red", backgroundColor: "black", "--offset": "4px" } });
```

### Events

If you want your UI to respond to user interactions you will need event handlers. They use `on` + the capitalized event name. `onClick`, `onInput`, `onKeydown`, `onSubmit`, and so on. Handlers are typed per element, so `event.target` and `event.currentTarget` are the element's own type with no casting needed.

```ts
Input({
	onInput(event) {
		console.log(event.target.value); // event.target is HTMLInputElement
	},
});
```

## Children

Children can be any one of the following: numbers and strings (`string | number`), other components (`() => IMountable`), readables (`Readable<T>`). Plain numbers and strings create static text nodes, readables will update the content of their text node when their signal changes.

## Fragment

Fragments are a way to render multiple elements at the same level without grouping them within another element.

```ts
import { Fragment, Div } from "@implementjs/core";

export default function Page() {
	return Fragment(Div("Hello, World!"), Div("Hello, World!"));
}
```

## Html

You can render raw html using the `Html` component.

```ts
import { Html } from "@implementjs/core";

export default function Page() {
	return Html("<div>Hello, World!</div>");
}
```

## Svg

`@implementjs/core` doesn't expose any of the svg elements. No one is writing those anyway. But you can still render svg using the `Svg` component by passing an svg string to it.

```ts
import { Svg } from "@implementjs/core";

export default function Page() {
	return Svg("<svg>Hello, World!</svg>");
}
```

`Implement.Head` renders head-only elements into `document.head`. The tags live there **for as long as the node is mounted**, so lifetime follows tree position. Put one in a route's page and the tags swap on navigation. Put one inside `If(open).Then(...)` and they exist while the branch shows.

```ts
import { Implement } from "@implementjs/core";

function IssuePage(issue: Readable<Issue>) {
	return Article(
		Implement.Head(
			Implement.Head.Title(issue.bind((i) => `${i.name} - Tracker`)),
			Implement.Head.Meta({ name: "description", content: issue.bind("description") }),
		),
		// … page content
	);
}
```

## Implement.Head

Only the branded components under `Implement.Head` may slot into it, and they fit nowhere else, so head elements can't leak into the body. The type system enforces both directions.

### Title

`Implement.Head.Title(text)` sets `document.title` (rather than appending a second `<title>` the browser would ignore). It accepts a string or a `Readable<string>` and tracks changes. On unmount the title is not restored, the next mounted `Title` wins.

### Meta and Link

```ts
Implement.Head.Meta({ name: "description", content: description });
Implement.Head.Meta({ property: "og:title", content: title }); // RDFa via `property`
Implement.Head.Link({ rel: "canonical", href: canonicalUrl });
Implement.Head.Link({ rel: "icon", href: favicon });
```

All attributes are typed and bindable, just like any element props.

### Script and Style

Content is the second argument for `Script` and the first for `Style` (not a child):

```ts
Implement.Head.Script({ src: "https://example.com/widget.js", defer: true });
Implement.Head.Script({ type: "application/ld+json" }, jsonLd);
Implement.Head.Style(`.tooltip { position: fixed; }`);
```

Inline script content executes on mount. A readable content updates the text node, but browsers never re-execute a script, so reactive content is only useful for non-executing types like `application/ld+json`.

## Nesting and precedence

Multiple `Implement.Head`s can be mounted at once (a layout's defaults plus a page's specifics). `Meta`/`Link`/`Script`/`Style` tags simply coexist in the head. For `Title`, the most recently mounted one wins.

The same mount-scoped idea applies to one more global surface: [window and document events](/docs/global-events).
