// No obsidian import — pure mapping between settings-tab control keys and MasonSettings.
import { DEFAULT_SETTINGS, type MasonSettings } from "../core/types";
import {
	resolveFormatSelectionRecipe,
	type FormatSelectionRecipe,
} from "../core/formatSelection";

// ---------------------------------------------------------------------------
// settingsControlStore — spec 010
//
// The declarative settings tab addresses each fixed control by a string key.
// Flat keys name a top-level MasonSettings field; "formatSelection.<step>" keys
// name one toggle of the nested Format selection recipe. Reads always return a
// concrete value (defaults applied); writes mutate in memory only — persisting
// is the caller's job.
// ---------------------------------------------------------------------------

const FLAT_KEYS = [
	"resourcesName",
	"showUpdateSplash",
	"numericOnly",
	"pasteListContext",
	"debugLogging",
] as const satisfies readonly (keyof MasonSettings)[];

type FlatKey = (typeof FLAT_KEYS)[number];
type RecipeStep = keyof FormatSelectionRecipe;
type NestedKey = `formatSelection.${RecipeStep}`;

export type FixedKey = FlatKey | NestedKey;

const NESTED_PREFIX = "formatSelection.";

// Derived from the resolver so a new recipe step becomes a fixed key automatically.
const RECIPE_STEPS = Object.keys(resolveFormatSelectionRecipe(DEFAULT_SETTINGS)) as RecipeStep[];

export const FIXED_KEYS: readonly FixedKey[] = [
	...FLAT_KEYS,
	...RECIPE_STEPS.map((step): NestedKey => `${NESTED_PREFIX}${step}`),
];

const FIXED_KEY_SET: ReadonlySet<string> = new Set(FIXED_KEYS);

export function isFixedKey(key: string): key is FixedKey {
	return FIXED_KEY_SET.has(key);
}

function isNestedKey(key: FixedKey): key is NestedKey {
	return key.startsWith(NESTED_PREFIX);
}

function recipeStepOf(key: NestedKey): RecipeStep {
	return key.slice(NESTED_PREFIX.length) as RecipeStep;
}

/** Current value of a control, with the default applied when nothing is stored. */
export function readControl(settings: MasonSettings, key: FixedKey): string | boolean {
	if (isNestedKey(key)) {
		return resolveFormatSelectionRecipe(settings)[recipeStepOf(key)];
	}
	// DEFAULT_SETTINGS defines every flat key, so the fallback is always concrete.
	return (settings[key] ?? DEFAULT_SETTINGS[key]) as string | boolean;
}

/** Stores a control's value in memory. Keys that are not fixed keys are ignored. */
export function writeControl(settings: MasonSettings, key: FixedKey, value: unknown): void {
	if (!isFixedKey(key)) return;
	if (isNestedKey(key)) {
		settings.formatSelection = {
			...(settings.formatSelection ?? {}),
			[recipeStepOf(key)]: value as boolean,
		};
		return;
	}
	(settings as unknown as Record<string, unknown>)[key] = value;
}
