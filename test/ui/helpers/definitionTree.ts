/**
 * Test helper for the declarative settings API (spec 010): flattens the
 * `SettingDefinitionItem[]` a tab returns from `getSettingDefinitions()` into a
 * list of nodes in render order, so definition-level tests can assert names,
 * order, grouping and search vocabulary without a DOM. `search()` answers
 * which rows a settings search term would list.
 *
 *   const flat = walk(tab.getSettingDefinitions());
 *   expect(flat.slice(0, 4).every(r => r.path.length === 0)).toBe(true);
 */

import type {
	SettingDefinition,
	SettingDefinitionGroup,
	SettingDefinitionItem,
	SettingDefinitionList,
	SettingDefinitionPage,
} from "obsidian";

export type DefinitionNodeType = "control" | "render" | "action" | "empty" | "group" | "list" | "page";

export interface DefinitionNode {
	/** Names of the ancestor pages and headings of the ancestor groups/lists, outermost first. */
	path: string[];
	type: DefinitionNodeType;
	/** Row or page name; the heading for a group or list. */
	name?: string;
	/** Storage key of a control row. */
	key?: string;
	/** Description as text (a fragment is reduced to its text content). */
	desc?: string;
	aliases?: string[];
	/** The definition this node was built from, e.g. to invoke its `render` or `action`. */
	definition: SettingDefinitionItem;
}

type Container = SettingDefinitionGroup | SettingDefinitionList | SettingDefinitionPage;

function isContainer(item: SettingDefinitionItem): item is Container {
	return "type" in item;
}

function rowType(row: SettingDefinition): DefinitionNodeType {
	if (row.control) {
		return "control";
	}
	if (row.render) {
		return "render";
	}
	if (row.action) {
		return "action";
	}
	return "empty";
}

function descText(desc: string | DocumentFragment | undefined): string | undefined {
	if (desc === undefined || typeof desc === "string") {
		return desc;
	}
	return desc.textContent ?? "";
}

/** Builds a node, leaving out the fields the definition does not have. */
function node(
	definition: SettingDefinitionItem,
	path: string[],
	type: DefinitionNodeType,
	fields: Pick<DefinitionNode, "name" | "key" | "desc" | "aliases">,
): DefinitionNode {
	const result: DefinitionNode = { path: [...path], type, definition };
	for (const [field, value] of Object.entries(fields)) {
		if (value !== undefined) {
			Object.assign(result, { [field]: value });
		}
	}
	return result;
}

/**
 * Flattens a definition tree depth-first, in document order. A group, list or
 * page is emitted itself, followed by its items; its heading (or page name) is
 * appended to the `path` of everything inside it. A group without a heading
 * adds nothing to the path.
 */
export function walk(items: readonly SettingDefinitionItem[], path: string[] = []): DefinitionNode[] {
	const flat: DefinitionNode[] = [];
	for (const item of items) {
		if (!isContainer(item)) {
			flat.push(
				node(item, path, rowType(item), {
					name: item.name,
					key: item.control?.key,
					desc: descText(item.desc),
					aliases: item.aliases,
				}),
			);
			continue;
		}
		const isPage = item.type === "page";
		const label = isPage ? item.name : item.heading;
		flat.push(node(item, path, item.type, { name: label, desc: isPage ? descText(item.desc) : undefined }));
		flat.push(...walk(item.items ?? [], label === undefined ? path : [...path, label]));
	}
	return flat;
}

/** The control rows of a flattened tree, in order. */
export function controls(flat: readonly DefinitionNode[]): DefinitionNode[] {
	return flat.filter(entry => entry.type === "control");
}

type Flag = boolean | (() => boolean) | undefined;

/** A `visible` / `searchable` flag counts as set unless it is, or returns, `false`. */
function isOn(flag: Flag): boolean {
	return (typeof flag === "function" ? flag() : flag) !== false;
}

function isSearchable(entry: DefinitionNode): boolean {
	const flags: { visible?: Flag; searchable?: Flag } = entry.definition;
	return isOn(flags.visible) && isOn(flags.searchable);
}

/** The texts Obsidian's settings search indexes for a node; none for a group or list. */
function searchableTexts(entry: DefinitionNode): string[] {
	if (entry.type === "group" || entry.type === "list") {
		return [];
	}
	const texts = entry.type === "page" ? [entry.name] : [entry.name, entry.desc, ...(entry.aliases ?? [])];
	return texts.filter((text): text is string => text !== undefined);
}

/**
 * The names of the rows and pages a settings search for `term` would list, in
 * render order, walking the whole tree.
 *
 * An approximation of Obsidian's search (read from 1.15.1), which may match
 * more loosely than this: a term matches when it is a case-insensitive
 * substring of a row's name, its desc text or one of its aliases. A page is
 * matched by its name only, group and list headings are not matched, and a
 * row with `visible: false` or `searchable: false` is left out.
 */
export function search(items: readonly SettingDefinitionItem[], term: string): string[] {
	const needle = term.toLowerCase();
	return walk(items)
		.filter(isSearchable)
		.filter(entry => searchableTexts(entry).some(text => text.toLowerCase().includes(needle)))
		.map(entry => entry.name ?? "");
}
