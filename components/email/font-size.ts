import { Extension } from "@tiptap/core";

// Font-size as an attribute on the TextStyle mark, mirroring how
// @tiptap/extension-color registers `color`: one global attribute on
// "textStyle", a setter and an unsetter. Emitted as an inline
// `style="font-size: …"`, which email clients preserve on round-trip -
// the same property the composer's StyledParagraph/StyledHeading keep
// for pasted content.
export const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => {
              const styleAttr = element.getAttribute("style");
              if (styleAttr) {
                const decls = styleAttr.split(";").map((s) => s.trim()).filter(Boolean);
                for (let i = decls.length - 1; i >= 0; i -= 1) {
                  const parts = decls[i].split(":");
                  if (parts.length >= 2 && parts[0].trim().toLowerCase() === "font-size") {
                    return parts.slice(1).join(":").trim().replace(/['"]+/g, "");
                  }
                }
              }
              return element.style.fontSize?.replace(/['"]+/g, "") || null;
            },
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return {
                style: `font-size: ${attributes.fontSize}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontSize }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
        },
    };
  },
});

// The sizes the toolbar offers. 14/16px read as body text, the rest as
// emphasis - the composer's base font is 14px (text-sm on .tiptap).
export const FONT_SIZES = ["14px", "16px", "18px", "20px", "24px", "32px"] as const;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}
