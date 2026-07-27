export const publicAsset = (path: string) => {
  const cleanPath = path.replace(/^\/+/, "");

  if (typeof document === "undefined") {
    return `/${cleanPath}`;
  }

  return new URL(cleanPath, document.baseURI).toString();
};
