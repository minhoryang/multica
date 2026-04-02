import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MentionView } from "./mention-view";

/**
 * BaseMentionExtension — shared mention extension for both editing and readonly modes.
 *
 * Includes: NodeView (MentionView), renderHTML, addAttributes, markdownTokenizer,
 * parseMarkdown, renderMarkdown.
 *
 * MentionView renders identically in both modes (issue → inline card, member/agent → span).
 * Only difference: in readonly mode, issue mentions are clickable links.
 *
 * Usage:
 *   Editing:  BaseMentionExtension.configure({ suggestion: createMentionSuggestion() })
 *   Readonly: BaseMentionExtension.configure({})
 */
export const BaseMentionExtension = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionView);
  },
  renderHTML({ node, HTMLAttributes }) {
    const type = node.attrs.type ?? "member";
    const prefix = type === "issue" ? "" : "@";
    return [
      "span",
      mergeAttributes(
        { "data-type": "mention" },
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          "data-mention-type": node.attrs.type ?? "member",
          "data-mention-id": node.attrs.id,
        },
      ),
      `${prefix}${node.attrs.label ?? node.attrs.id}`,
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: "member",
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-mention-type") ?? "member",
        renderHTML: () => ({}),
      },
    };
  },
  // @tiptap/markdown: custom tokenizer to parse [@Label](mention://type/id)
  markdownTokenizer: {
    name: "mention",
    level: "inline" as const,
    start(src: string) {
      return src.search(/\[@?[^\]]+\]\(mention:\/\//);
    },
    tokenize(src: string) {
      // Matches both [@Label](mention://type/id) and [Label](mention://issue/id)
      const match = src.match(
        /^\[@?([^\]]+)\]\(mention:\/\/(\w+)\/([^)]+)\)/,
      );
      if (!match) return undefined;
      return {
        type: "mention",
        raw: match[0],
        attributes: { label: match[1], type: match[2] ?? "member", id: match[3] },
      };
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseMarkdown: (token: any, helpers: any) => {
    return helpers.createNode("mention", token.attributes);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderMarkdown: (node: any) => {
    const { id, label, type = "member" } = node.attrs || {};
    const prefix = type === "issue" ? "" : "@";
    return `[${prefix}${label ?? id}](mention://${type}/${id})`;
  },
});
