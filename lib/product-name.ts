// The name the UI uses when it speaks about the app itself ("Open links in
// Bulwark"). A branded deployment (APP_NAME) uses its own name; a stock
// install has the default "Webmail", so it keeps saying Bulwark. (#1160)
export function productName(appName: string | undefined | null): string {
  const name = appName?.trim();
  return name && name !== 'Webmail' ? name : 'Bulwark';
}
