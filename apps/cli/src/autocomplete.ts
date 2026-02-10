/**
 * Autocomplete Input
 *
 * Real-time dropdown autocomplete for terminal input
 * No external dependencies - uses raw terminal control
 *
 * Falls back to simple readline when terminal doesn't support advanced features
 */

import * as readline from "readline";
import { colors } from "./colors.js";

export interface AutocompleteOption {
  value: string;
  label?: string;
}

export interface AutocompleteConfig {
  /** Function to get suggestions based on current input */
  getSuggestions: (input: string) => AutocompleteOption[];
  /** Prompt string */
  prompt?: string;
  /** Max suggestions to show */
  maxSuggestions?: number;
}

// ANSI escape codes
const ESC = "\x1b";
const CLEAR_LINE = `${ESC}[2K`;
const CURSOR_UP = (n: number) => (n > 0 ? `${ESC}[${n}A` : "");
const CURSOR_TO_COL = (n: number) => `${ESC}[${n}G`;
const RESET = `${ESC}[0m`;
const INVERSE = `${ESC}[7m`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_TO_END = `${ESC}[J`;

// Strip ANSI escape codes to get visual length
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, "");
}

/**
 * Get the visual width of a string in terminal columns
 * Full-width characters (CJK, etc.) take 2 columns
 */
function getStringWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;

    // Check for full-width characters:
    // - CJK Unified Ideographs (Chinese, Japanese Kanji, Korean Hanja)
    // - CJK Symbols and Punctuation
    // - Hiragana, Katakana
    // - Hangul
    // - Full-width ASCII and symbols
    if (
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x9fff) || // CJK
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xfe10 && code <= 0xfe1f) || // Vertical forms
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
      (code >= 0xff00 && code <= 0xff60) || // Full-width ASCII
      (code >= 0xffe0 && code <= 0xffe6) || // Full-width symbols
      (code >= 0x20000 && code <= 0x2ffff) // CJK Extension B and beyond
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Check if terminal supports advanced cursor control
 */
function isTerminalSupported(): boolean {
  // Check TERM environment variable
  const term = process.env.TERM;
  if (!term) {
    return false;
  }

  // Check if running in known unsupported environments
  const unsupportedTerms = ["dumb", "emacs"];
  if (unsupportedTerms.includes(term.toLowerCase())) {
    return false;
  }

  // Check if stdout is a TTY
  if (!process.stdout.isTTY) {
    return false;
  }

  return true;
}

/**
 * Simple readline input (fallback for unsupported terminals)
 */
function simpleInput(config: AutocompleteConfig): Promise<string> {
  return new Promise((resolve) => {
    const { prompt = "> " } = config;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });

    rl.on("close", () => {
      resolve("");
    });
  });
}

/**
 * Read a line with real-time autocomplete dropdown
 * Falls back to simple readline on unsupported terminals
 */
export function autocompleteInput(config: AutocompleteConfig): Promise<string> {
  // Fall back to simple input if terminal doesn't support advanced features
  if (!isTerminalSupported()) {
    return simpleInput(config);
  }

  return new Promise((resolve) => {
    const { getSuggestions, prompt = "> ", maxSuggestions = 5 } = config;

    const stdin = process.stdin;
    const stdout = process.stdout;

    let input = "";
    let cursorPos = 0;
    let suggestions: AutocompleteOption[] = [];
    let selectedIndex = -1;
    let lastRenderedLines = 0; // Track how many lines we rendered (for cleanup)

    // Enable raw mode
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    // Set up keypress events
    readline.emitKeypressEvents(stdin);

    const cleanup = () => {
      stdout.write(SHOW_CURSOR);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      stdin.removeListener("keypress", onKeypress);
    };

    const clearDisplay = () => {
      // Move to beginning of current line
      stdout.write("\r");
      // Clear current line
      stdout.write(CLEAR_LINE);
      // Clear any suggestion lines below
      if (lastRenderedLines > 0) {
        stdout.write(CLEAR_TO_END);
      }
    };

    const render = () => {
      clearDisplay();

      // Write prompt and input
      stdout.write(`${prompt}${input}`);

      // Calculate cursor position accounting for line wrapping and wide characters
      const termWidth = stdout.columns || 80;
      const promptVisualWidth = getStringWidth(stripAnsi(prompt));
      // Calculate visual width of input up to cursor position
      const inputBeforeCursor = input.slice(0, cursorPos);
      const inputVisualWidth = getStringWidth(inputBeforeCursor);
      const cursorOffset = promptVisualWidth + inputVisualWidth;

      // Handle edge case: when cursor is exactly at line boundary,
      // show it at end of current line, not start of next line
      let cursorCol: number;
      if (cursorOffset > 0 && cursorOffset % termWidth === 0) {
        cursorCol = termWidth;
      } else {
        cursorCol = (cursorOffset % termWidth) + 1;
      }

      // Get and display suggestions if input starts with /
      if (input.startsWith("/") && input.length > 1) {
        suggestions = getSuggestions(input).slice(0, maxSuggestions);

        if (suggestions.length > 0) {
          // Ensure selectedIndex is valid
          if (selectedIndex >= suggestions.length) {
            selectedIndex = suggestions.length - 1;
          }

          // Move to new line for suggestions
          stdout.write("\n");

          for (let i = 0; i < suggestions.length; i++) {
            const opt = suggestions[i]!;
            const isSelected = i === selectedIndex;
            const value = isSelected
              ? `${INVERSE}  ${opt.value}${RESET}`
              : `  ${colors.suggestionDim(opt.value)}`;
            const label = opt.label ? ` ${colors.suggestionLabel(opt.label)}` : "";
            const line = `${value}${label}`;

            stdout.write(`${CLEAR_LINE}${line}`);
            if (i < suggestions.length - 1) {
              stdout.write("\n");
            }
          }

          lastRenderedLines = suggestions.length;

          // Move cursor back up to input line
          stdout.write(CURSOR_UP(suggestions.length));
          stdout.write(CURSOR_TO_COL(cursorCol));
        } else {
          lastRenderedLines = 0;
        }
      } else {
        suggestions = [];
        selectedIndex = -1;
        lastRenderedLines = 0;
      }

      // Position cursor correctly within input
      stdout.write(CURSOR_TO_COL(cursorCol));
    };

    const submit = (value: string) => {
      clearDisplay();
      stdout.write(`${prompt}${value}\n`);
      cleanup();
      resolve(value);
    };

    const onKeypress = (_char: string, key: readline.Key) => {
      if (!key) return;

      // Handle Ctrl+C
      if (key.ctrl && key.name === "c") {
        clearDisplay();
        cleanup();
        process.exit(0);
      }

      // Handle Ctrl+D (EOF)
      if (key.ctrl && key.name === "d") {
        clearDisplay();
        cleanup();
        stdout.write("\n");
        resolve("");
        return;
      }

      // Handle Enter
      if (key.name === "return" || key.name === "enter") {
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          // Use selected suggestion
          const selected = suggestions[selectedIndex]!;
          submit(selected.value);
        } else {
          submit(input);
        }
        return;
      }

      // Handle Tab - cycle through suggestions or complete selected one
      if (key.name === "tab") {
        if (suggestions.length > 0) {
          if (selectedIndex >= 0) {
            // Already have a selection - complete it to input
            const selected = suggestions[selectedIndex]!;
            input = selected.value + " ";
            cursorPos = input.length;
            selectedIndex = -1;
            render();
          } else {
            // No selection yet - select first item
            if (key.shift) {
              selectedIndex = suggestions.length - 1;
            } else {
              selectedIndex = 0;
            }
            render();
          }
        }
        return;
      }

      // Handle arrow keys
      if (key.name === "up") {
        if (suggestions.length > 0) {
          selectedIndex = selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1;
          render();
        }
        return;
      }

      if (key.name === "down") {
        if (suggestions.length > 0) {
          selectedIndex = selectedIndex >= suggestions.length - 1 ? 0 : selectedIndex + 1;
          render();
        }
        return;
      }

      // Handle Escape - clear selection
      if (key.name === "escape") {
        selectedIndex = -1;
        render();
        return;
      }

      // Handle backspace
      if (key.name === "backspace") {
        if (cursorPos > 0) {
          input = input.slice(0, cursorPos - 1) + input.slice(cursorPos);
          cursorPos--;
          selectedIndex = -1;
          render();
        }
        return;
      }

      // Handle delete
      if (key.name === "delete") {
        if (cursorPos < input.length) {
          input = input.slice(0, cursorPos) + input.slice(cursorPos + 1);
          selectedIndex = -1;
          render();
        }
        return;
      }

      // Handle left arrow
      if (key.name === "left") {
        if (cursorPos > 0) {
          cursorPos--;
          render();
        }
        return;
      }

      // Handle right arrow
      if (key.name === "right") {
        if (cursorPos < input.length) {
          cursorPos++;
          render();
        }
        return;
      }

      // Handle home
      if (key.name === "home" || (key.ctrl && key.name === "a")) {
        cursorPos = 0;
        render();
        return;
      }

      // Handle end
      if (key.name === "end" || (key.ctrl && key.name === "e")) {
        cursorPos = input.length;
        render();
        return;
      }

      // Handle printable characters
      if (key.sequence && !key.ctrl && !key.meta) {
        const char = key.sequence;
        if (char.length === 1 && char.charCodeAt(0) >= 32) {
          input = input.slice(0, cursorPos) + char + input.slice(cursorPos);
          cursorPos++;
          selectedIndex = -1;
          render();
        }
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}
