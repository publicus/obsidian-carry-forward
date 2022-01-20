import {
  App,
  Editor,
  EditorTransaction,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";

interface CarryForwardPluginSettings {
  linkText: string;
  copiedLinkText: string;
  lineFormatFrom: string;
  lineFormatTo: string;
  removeLeadingWhitespace: boolean;
}

const DEFAULT_SETTINGS: CarryForwardPluginSettings = {
  linkText: "",
  copiedLinkText: "(see {{LINK}})",
  lineFormatFrom: "\\s*$",
  lineFormatTo: " (see {{LINK}})",
  removeLeadingWhitespace: true,
};

const genID = (length = 5) => {
  const characters = "abcdefghijklmnopqrstuvwxyz-0123456789";
  let id = "";
  while (id.length < length) {
    id += characters[Math.floor(Math.random() * characters.length)];
  }
  return id.slice(0, length);
};

enum CopyTypes {
  SeparateLines,
  CombinedLines,
  LinkOnly,
  LinkOnlyEmbed,
}

enum Mode {
  LinkTextFromSettings,
  LinkTextFromSelection,
  LinkTextFromClipboard,
}

const blockIDRegex = /(?<=[\s^])\^[a-zA-Z0-9-]+$/u;

const copyForwardLines = async (
  editor: Editor,
  view: MarkdownView,
  settings: CarryForwardPluginSettings,
  copy: CopyTypes = CopyTypes.SeparateLines,
  mode: Mode = Mode.LinkTextFromSettings
) => {
  const regexValidation = validateRegex(settings.lineFormatFrom);
  if (regexValidation.valid !== true) {
    new Notice(
      `Error: 'From' setting is invalid:\n\n${regexValidation.string}\n\nPlease update the Carry-Forward settings and try again.`,
      1000 * 30 // 30 seconds
    );
    return;
  }

  const cursorFrom = editor.getCursor("from");
  const cursorTo = editor.getCursor("to");
  const minLine = cursorFrom.line;
  const maxLine = cursorTo.line;

  const transaction: EditorTransaction = {
    changes: [],
  };

  const file = view.file;

  const updatedLines: string[] = [];
  const copiedLines: string[] = [];
  let newID = "";
  for (let lineNumber = minLine; lineNumber <= maxLine; lineNumber++) {
    let line = editor.getLine(lineNumber);
    let copiedLine = line;
    if (
      settings.removeLeadingWhitespace === true &&
      lineNumber === minLine &&
      cursorFrom.ch === cursorTo.ch
    ) {
      // Remove leading whitespace if the user is copying a full line without
      // having selected a specific part of the line:
      copiedLine = copiedLine.replace(/^\s*/, "");
    }

    if (
      (lineNumber === minLine || lineNumber === maxLine) &&
      !(minLine === maxLine && cursorFrom.ch === cursorTo.ch)
    ) {
      copiedLine = line.slice(
        lineNumber === minLine ? cursorFrom.ch : 0,
        lineNumber === maxLine ? cursorTo.ch : line.length - 1
      );
    }

    if (
      editor.getLine(lineNumber).match(/^\s*$/) &&
      !(lineNumber === minLine && minLine === maxLine)
    ) {
      copiedLines.push(copiedLine);
      updatedLines.push(line);
      continue;
    }

    let linkText = settings.linkText;

    if (mode === Mode.LinkTextFromSelection) {
      linkText = editor.getSelection();
    }
    if (mode === Mode.LinkTextFromClipboard) {
      linkText = await navigator.clipboard.readText();
    }

    if (copy === CopyTypes.SeparateLines || lineNumber === minLine) {
      // Does the line already have a block ID?
      const blockID = line.match(blockIDRegex);
      let link = "";
      if (blockID === null) {
        // There is NOT an existing line ID:
        newID = `^${genID()}`;
        link = view.app.fileManager.generateMarkdownLink(
          file,
          "/",
          `#${newID}`,
          linkText
        );
        line = line.replace(/\s*?$/, ` ${newID}`);
        if (copy === CopyTypes.LinkOnly || copy === CopyTypes.LinkOnlyEmbed) {
          link = (copy === CopyTypes.LinkOnlyEmbed ? "!" : "") + link;
          copiedLine =
            copy === CopyTypes.LinkOnlyEmbed
              ? link
              : settings.copiedLinkText.replace("{{LINK}}", link);
        } else {
          copiedLine = copiedLine.replace(
            new RegExp(settings.lineFormatFrom, "u"),
            settings.lineFormatTo.replace("{{LINK}}", link)
          );
        }
      } else {
        // There IS an existing line ID:
        link = view.app.fileManager.generateMarkdownLink(
          file,
          "/",
          `#${blockID}`,
          linkText
        );
        if (copy === CopyTypes.LinkOnly || copy === CopyTypes.LinkOnlyEmbed) {
          link = (copy === CopyTypes.LinkOnlyEmbed ? "!" : "") + link;
          copiedLine =
            copy === CopyTypes.LinkOnlyEmbed
              ? link
              : settings.copiedLinkText.replace("{{LINK}}", link);
        } else {
          copiedLine = copiedLine
            .replace(blockIDRegex, "")
            .replace(
              new RegExp(settings.lineFormatFrom, "u"),
              settings.lineFormatTo.replace("{{LINK}}", link)
            );
        }
      }
    }

    if (
      !(
        (copy === CopyTypes.LinkOnly || copy === CopyTypes.LinkOnlyEmbed) &&
        lineNumber !== minLine
      )
    ) {
      copiedLines.push(copiedLine);
    }
    updatedLines.push(line);
  }

  navigator.clipboard.writeText(copiedLines.join("\n")).then(() => {
    new Notice("Copied");
  });

  transaction.changes?.push({
    from: { line: minLine, ch: 0 },
    to: { line: maxLine, ch: editor.getLine(maxLine).length },
    text: updatedLines.join("\n"),
  });
  transaction.selection = { from: cursorFrom, to: cursorTo };
  editor.transaction(transaction);
};

export default class CarryForwardPlugin extends Plugin {
  settings: CarryForwardPluginSettings;

  async onload() {
    console.log("loading carry-forward-line plugin");

    await this.loadSettings();

    this.addCommand({
      id: "carry-line-forward-separate-lines",
      name: "Copy selection with each line linked to its copied source (default link text)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.SeparateLines
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-combined-lines",
      name: "Copy selection with first line linked to its copied source (default link text)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.CombinedLines
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-link-only",
      name: "Copy link to line (default link text)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.LinkOnly
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-embed-link-only",
      name: "Copy embed link to line (default link text)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.LinkOnlyEmbed
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-separate-lines-selection",
      name: "Copy selection with each line linked to its copied source (link text from selection)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.SeparateLines,
          Mode.LinkTextFromSelection
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-combined-lines-selection",
      name: "Copy selection with first line linked to its copied source (link text from selection)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.CombinedLines,
          Mode.LinkTextFromSelection
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-link-only-selection",
      name: "Copy link to line (link text from selection)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.LinkOnly,
          Mode.LinkTextFromSelection
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-embed-link-only-selection",
      name: "Copy embed link to line (link text from selection)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.LinkOnlyEmbed,
          Mode.LinkTextFromSelection
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-separate-lines-clipboard",
      name: "Copy selection with each line linked to its copied source (link text from clipboard)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.SeparateLines,
          Mode.LinkTextFromClipboard
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-combined-lines-clipboard",
      name: "Copy selection with first line linked to its copied source (link text from clipboard)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.CombinedLines,
          Mode.LinkTextFromClipboard
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-link-only-clipboard",
      name: "Copy link to line (link text from clipboard)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.LinkOnly,
          Mode.LinkTextFromClipboard
        );
      },
    });

    this.addCommand({
      id: "carry-line-forward-embed-link-only-clipboard",
      name: "Copy embed link to line (link text from clipboard)",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        return await copyForwardLines(
          editor,
          view,
          this.settings,
          CopyTypes.LinkOnlyEmbed,
          Mode.LinkTextFromClipboard
        );
      },
    });

    this.addSettingTab(new CarryForwardSettingTab(this.app, this));
  }

  onunload() {
    console.log("unloading carry-forward-line plugin");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

const validateRegex = (
  regexString: string
): { valid: boolean | null; string: string } => {
  let updatedRegexString = regexString
    // Because the plugin's settings are stored in JSON, characters like
    // \n get double-escaped, and then do not get replaced automatically
    // on use. This was causing To strings not to parse \n, etc.
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r");

  try {
    new RegExp(updatedRegexString, "u");
    return { valid: true, string: updatedRegexString };
  } catch (e) {
    return {
      valid: false,
      string: `"${updatedRegexString}": "${e}"`,
    };
  }
};

class CarryForwardSettingTab extends PluginSettingTab {
  plugin: CarryForwardPlugin;

  constructor(app: App, plugin: CarryForwardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h1", { text: "Carry-forward" });

    new Setting(containerEl)
      .setName("Default link text")
      .setDesc(
        'The default text that "{{LINK}}" in the settings below will be replaced with. Leaving this blank will display the actual text of the link.'
      )
      .addText((text) => {
        const settings = this.plugin.settings;
        text.setValue(settings.linkText).onChange(async (value) => {
          settings.linkText = value;
          await this.plugin.saveSettings();
        });
      });

    const copiedLinksEl = containerEl.createEl("div");
    copiedLinksEl.createEl("h2", { text: "Copied references" });

    copiedLinksEl.createEl("p", {
      text: 'Settings relating to "Copy link to line..." and "Copy embed link to line..." commands.',
      cls: "setting-item-description",
    });

    new Setting(copiedLinksEl)
      .setName("Copied references")
      .setDesc(
        "The full text of copied references. Use {{LINK}} to place the link."
      )
      .addText((text) => {
        const settings = this.plugin.settings;
        text.setValue(settings.copiedLinkText).onChange(async (value) => {
          settings.copiedLinkText = value;
          await this.plugin.saveSettings();
        });
      });

    const copiedLinesEl = containerEl.createEl("div");
    copiedLinesEl.createEl("h2", { text: "Copied lines" });
    copiedLinesEl.createEl("p", {
      text: 'Settings relating to "Copy selection..." commands.',
      cls: "setting-item-description",
    });

    const fromToEl = copiedLinesEl.createEl("div");
    fromToEl.addClass("from-to-rule");

    if (validateRegex(this.plugin.settings.lineFormatFrom).valid !== true) {
      fromToEl.addClass("invalid");
    }

    new Setting(fromToEl)
      .setName("From")
      .setDesc(
        "Find the first match of a Regular Expression in each copied line"
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.lineFormatFrom)
          .setValue(this.plugin.settings.lineFormatFrom)
          .onChange(async (value) => {
            if (value === "") {
              this.plugin.settings.lineFormatFrom =
                DEFAULT_SETTINGS.lineFormatFrom;
            } else {
              if (validateRegex(value).valid !== true) {
                fromToEl.addClass("invalid");
              } else {
                fromToEl.removeClass("invalid");
              }
              this.plugin.settings.lineFormatFrom = value;
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(fromToEl)
      .setName("To")
      .setDesc(
        "Replace the first match in each copied line with text. Use {{LINK}} to place the link."
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.lineFormatTo)
          .setValue(this.plugin.settings.lineFormatTo)
          .onChange(async (value) => {
            if (value === "") {
              this.plugin.settings.lineFormatTo = DEFAULT_SETTINGS.lineFormatTo;
            } else {
              this.plugin.settings.lineFormatTo = value;
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(copiedLinesEl)
      .setName("Remove leading whitespace from first line")
      .setDesc(
        "When copying a line without having selected a specific part of that line, remove any whitespace at the beginning of the copied line."
      )
      .addToggle((toggle) => {
        const settings = this.plugin.settings;
        toggle
          .setValue(settings.removeLeadingWhitespace)
          .onChange(async (value) => {
            settings.removeLeadingWhitespace = value;
            await this.plugin.saveSettings();
          });
      });
  }
}
