import "server-only";

export function isManagedCloudinaryImageUrl(value: string) {
  return getManagedCloudinaryPublicId(value) !== null;
}

export function getManagedCloudinaryPublicId(value: string) {
  try {
    const url = new URL(value);
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !cloudName) {
      return null;
    }

    const prefix = `/${cloudName}/image/upload/`;
    if (!url.pathname.startsWith(prefix)) return null;

    let assetPath = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!assetPath) return null;

    const segments = assetPath.split("/").filter(Boolean);
    if (segments[0] && /^v\d+$/.test(segments[0])) segments.shift();
    if (segments.length === 0) return null;

    assetPath = segments.join("/");
    const extensionIndex = assetPath.lastIndexOf(".");
    if (extensionIndex > assetPath.lastIndexOf("/")) {
      assetPath = assetPath.slice(0, extensionIndex);
    }

    if (!assetPath.startsWith("chat_images/")) return null;
    return assetPath;
  } catch {
    return null;
  }
}
