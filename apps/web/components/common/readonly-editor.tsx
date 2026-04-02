"use client";

import { useEffect, useRef, memo } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { cn } from "@/lib/utils";
import { BaseMentionExtension } from "./mention-extension";
import { CodeBlockView } from "./code-block-view";
import { preprocessLinks } from "@/components/markdown/linkify";
import "./rich-text-editor.css";

const lowlight = createLowlight(common);

// ---------------------------------------------------------------------------
// Module-level extension singletons (prevent useEditor re-creation)
// ---------------------------------------------------------------------------

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
    codeBlock: false,
  }),
  CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
  }).configure({ lowlight }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    HTMLAttributes: {
      class: "text-primary hover:underline cursor-pointer",
    },
  }),
  BaseMentionExtension.configure({
    HTMLAttributes: { class: "mention" },
  }),
  Image.configure({
    inline: false,
    allowBase64: false,
    HTMLAttributes: {
      class: "rounded-md my-2",
      style: "max-width: 100%; height: auto;",
    },
  }),
  Markdown,
];

// ---------------------------------------------------------------------------
// Content preprocessing
// ---------------------------------------------------------------------------

/**
 * Convert legacy mention shortcodes [@ id="UUID" label="LABEL"] to markdown
 * link format [@LABEL](mention://member/UUID).
 */
function preprocessMentionShortcodes(text: string): string {
  if (!text.includes("[@ ")) return text;
  return text.replace(
    /\[@\s+([^\]]*)\]/g,
    (match: string, attrString: string) => {
      const attrs: Record<string, string> = {};
      const re = /(\w+)="([^"]*)"/g;
      let m;
      while ((m = re.exec(attrString)) !== null) {
        if (m[1] && m[2] !== undefined) attrs[m[1]] = m[2];
      }
      const { id, label } = attrs;
      if (!id || !label) return match;
      return `[@${label}](mention://member/${id})`;
    },
  );
}

function preprocess(content: string): string {
  return preprocessLinks(preprocessMentionShortcodes(content));
}

// ---------------------------------------------------------------------------
// ReadonlyEditor
// ---------------------------------------------------------------------------

interface ReadonlyEditorProps {
  content: string;
  className?: string;
}

/**
 * ReadonlyEditor — lightweight Tiptap wrapper for displaying markdown content.
 *
 * Uses the same ProseMirror engine and CSS as the editing RichTextEditor,
 * ensuring visual consistency between edit and display modes.
 *
 * Features:
 * - Issue mentions render as IssueMentionCard (inline card with status icon)
 * - Links are clickable (open in new tab)
 * - Code blocks have syntax highlighting and copy button
 * - Content is preprocessed: raw URL linkification + legacy mention format conversion
 */
const ReadonlyEditor = memo(function ReadonlyEditor({
  content,
  className,
}: ReadonlyEditorProps) {
  const prevContentRef = useRef(content);

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    content: preprocess(content),
    contentType: content ? "markdown" : undefined,
    extensions,
    editorProps: {
      attributes: {
        class: cn("rich-text-editor readonly text-sm", className),
      },
      handleDOMEvents: {
        click(_view, event) {
          const target = event.target as HTMLElement;
          // Skip links inside NodeView wrappers — they handle their own clicks
          // (e.g. IssueMentionCard uses Next.js Link for client-side navigation)
          if (target.closest("[data-node-view-wrapper]")) return false;
          const link = target.closest("a");
          const href = link?.getAttribute("href");
          if (href && !href.startsWith("mention://")) {
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
      },
    },
  });

  // Update content when prop changes (e.g. after editing a comment)
  useEffect(() => {
    if (!editor || content === prevContentRef.current) return;
    prevContentRef.current = content;
    const processed = preprocess(content);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (editor.storage as any).markdown?.parse?.(processed);
    if (parsed) {
      editor.commands.setContent(parsed);
    }
  }, [editor, content]);

  if (!editor) return null;
  return <EditorContent editor={editor} />;
});

export { ReadonlyEditor, type ReadonlyEditorProps };
