import {
  File, Folder, Image as ImageIcon, FileText, FileAudio, FileVideo, FileArchive,
  FileSpreadsheet, Presentation, FileCode, Box, PenTool,
  Terminal as TerminalIcon, Database, Type as TypeIcon, Link,
} from "@/components/icons";

// File types by extension and the icon for each, shared by the Files app
// and the composer's Files picker.

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico", "avif"]);

export function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "xml", "html", "htm", "css", "js", "ts",
  "jsx", "tsx", "py", "rb", "java", "c", "cpp", "h", "hpp", "go", "rs",
  "sh", "bash", "zsh", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
  "log", "csv", "sql", "graphql", "vue", "svelte", "astro", "php", "pl",
  "swift", "kt", "scala", "r", "lua", "vim",
]);

export function isTextFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const baseName = name.toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || ["dockerfile", "makefile", "readme", "license", "changelog"].includes(baseName);
}

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"]);
export function isAudioFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return AUDIO_EXTENSIONS.has(ext);
}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogv", "mov", "avi", "mkv", "m4v"]);
export function isVideoFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return VIDEO_EXTENSIONS.has(ext);
}

const PDF_EXTENSIONS = new Set(["pdf"]);
export function isPdfFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return PDF_EXTENSIONS.has(ext);
}

const VECTOR_EXTENSIONS = new Set(["svg", "ai", "eps", "ps", "sketch", "fig", "xd", "gvdesign"]);
function isVectorFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return VECTOR_EXTENSIONS.has(ext);
}

const THREE_D_EXTENSIONS = new Set([
  "obj", "fbx", "gltf", "glb", "stl", "3mf", "step", "stp", "iges", "igs",
  "blend", "3ds", "dae", "usdz", "usd", "usda", "usdc", "ply", "wrl",
  "c4d", "max", "ma", "mb", "dwg", "dxf",
]);
function is3DFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return THREE_D_EXTENSIONS.has(ext);
}

const EXECUTABLE_EXTENSIONS = new Set([
  "exe", "msi", "dmg", "app", "appimage", "deb", "rpm", "snap", "flatpak",
  "bat", "cmd", "com", "scr", "ps1", "apk", "ipa", "jar", "run",
]);
function isExecutableFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return EXECUTABLE_EXTENSIONS.has(ext);
}

const ARCHIVE_EXTENSIONS = new Set([
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "lz", "lzma",
  "tgz", "tbz2", "txz", "cab", "iso", "img",
]);
function isArchiveFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return ARCHIVE_EXTENSIONS.has(ext);
}

const SPREADSHEET_EXTENSIONS = new Set(["xls", "xlsx", "ods", "numbers", "tsv"]);
function isSpreadsheetFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return SPREADSHEET_EXTENSIONS.has(ext);
}

const PRESENTATION_EXTENSIONS = new Set(["ppt", "pptx", "odp", "key"]);
function isPresentationFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return PRESENTATION_EXTENSIONS.has(ext);
}

const WORD_DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "odt", "rtf"]);
function isWordDocumentFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return WORD_DOCUMENT_EXTENSIONS.has(ext);
}

const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2", "eot"]);
function isFontFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return FONT_EXTENSIONS.has(ext);
}

const DATABASE_EXTENSIONS = new Set(["db", "sqlite", "sqlite3", "mdb", "accdb"]);
function isDatabaseFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return DATABASE_EXTENSIONS.has(ext);
}

export type FileIconSize = "sm" | "md" | "lg" | "xl";

const ICON_SIZE_CLASSES: Record<FileIconSize, string> = {
  sm: "w-5 h-5",
  md: "w-6 h-6",
  lg: "w-10 h-10",
  xl: "w-14 h-14",
};

function fileIconFor(name: string): [typeof File, string] {
  if (isVectorFile(name)) return [PenTool, "text-orange-500"];
  if (is3DFile(name)) return [Box, "text-cyan-500"];
  if (isImageFile(name)) return [ImageIcon, "text-emerald-500"];
  if (isAudioFile(name)) return [FileAudio, "text-purple-500"];
  if (isVideoFile(name)) return [FileVideo, "text-pink-500"];
  if (isArchiveFile(name)) return [FileArchive, "text-amber-600"];
  if (isExecutableFile(name)) return [TerminalIcon, "text-red-500"];
  if (isSpreadsheetFile(name)) return [FileSpreadsheet, "text-green-600"];
  if (isPresentationFile(name)) return [Presentation, "text-orange-600"];
  if (isWordDocumentFile(name)) return [FileText, "text-blue-600"];
  if (isFontFile(name)) return [TypeIcon, "text-indigo-500"];
  if (isDatabaseFile(name)) return [Database, "text-slate-500"];
  if (isPdfFile(name)) return [FileText, "text-red-600"];
  if (isTextFile(name)) return [FileCode, "text-yellow-600"];
  return [File, "text-muted-foreground"];
}

/** The icon for a file name; `colored: false` draws every type in the muted text colour. */
export function getFileIconByName(name: string, size: FileIconSize, colored = true) {
  const [Icon, color] = fileIconFor(name);
  return <Icon className={`${ICON_SIZE_CLASSES[size]} shrink-0 ${colored ? color : "text-muted-foreground"}`} />;
}

/**
 * A symlink's icon, whatever its name suggests: it has no content to open
 * (Stalwart 1.0).
 */
export function getSymlinkIcon(size: FileIconSize, label: string) {
  return (
    <Link className={`${ICON_SIZE_CLASSES[size]} shrink-0 text-muted-foreground`} aria-label={label}>
      <title>{label}</title>
    </Link>
  );
}

export function getFolderIcon(size: FileIconSize, colored = true) {
  return <Folder className={`${ICON_SIZE_CLASSES[size]} shrink-0 ${colored ? "text-blue-500" : "text-muted-foreground"}`} />;
}
