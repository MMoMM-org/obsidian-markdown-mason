/**
 * Test helper for the declarative settings API (spec 010): flattens the
 * `SettingDefinitionItem[]` a tab returns from `getSettingDefinitions()` into a
 * list of nodes in render order, so definition-level tests can assert names,
 * order, grouping and search vocabulary without a DOM.
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
