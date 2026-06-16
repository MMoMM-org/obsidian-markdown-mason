import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	resolve: {
		// Redirect the types-only 'obsidian' package to our test stub so Vite
		// can resolve it at transform time. Tests that need a real mock use
		// vi.mock("obsidian", factory) to override per-test behaviour.
		alias: {
			obsidian: path.resolve(__dirname, "test/__mocks__/obsidian.ts"),
		},
	},
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
