declare global {
	namespace App {
		// what src/hooks.server.ts puts on event.locals, and routes read
		interface Locals {}
	}
}

export {};
