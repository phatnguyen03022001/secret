import "server-only";

export function isManagedCloudinaryImageUrl(value: string) {
  try {
    const url = new URL(value);
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !cloudName) {
      return false;
    }

    const prefix = `/${cloudName}/image/upload/`;
    return url.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}
