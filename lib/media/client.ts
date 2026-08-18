"use client";

export interface ChatMediaPayload {
  publicId: string;
  deliveryType: "upload" | "authenticated";
  format: string;
  width: number;
  height: number;
  bytes: number;
}

export interface UploadedChatMedia extends ChatMediaPayload {
  previewUrl: string | null;
}

interface UploadSignature {
  apiKey: string;
  timestamp: number;
  publicId: string;
  overwrite: false;
  signature: string;
  deliveryType: "upload" | "authenticated";
  uploadUrl: string;
  maxBytes: number;
}

async function getUploadSignature(mode: "normal" | "once") {
  const response = await fetch("/api/media/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Không thể chuẩn bị upload");
  return data as UploadSignature;
}

export function toMediaPayload(uploaded: UploadedChatMedia): ChatMediaPayload {
  return {
    publicId: uploaded.publicId,
    deliveryType: uploaded.deliveryType,
    format: uploaded.format,
    width: uploaded.width,
    height: uploaded.height,
    bytes: uploaded.bytes,
  };
}

export async function uploadChatImageDirect(
  file: File,
  mode: "normal" | "once",
  onProgress?: (progress: number) => void,
): Promise<UploadedChatMedia> {
  const signed = await getUploadSignature(mode);
  if (file.size <= 0 || file.size > signed.maxBytes) {
    throw new Error("Ảnh phải nhỏ hơn 8 MB");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", signed.apiKey);
  formData.append("timestamp", String(signed.timestamp));
  formData.append("signature", signed.signature);
  formData.append("public_id", signed.publicId);
  formData.append("overwrite", "false");

  return new Promise<UploadedChatMedia>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", signed.uploadUrl);
    xhr.responseType = "json";
    xhr.timeout = 60_000;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onerror = () => reject(new Error("Kết nối upload bị gián đoạn"));
    xhr.ontimeout = () => reject(new Error("Upload quá thời gian cho phép"));
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data?.error?.message || "Upload thất bại"));
        return;
      }

      const publicId = typeof data?.public_id === "string" ? data.public_id : "";
      const format = typeof data?.format === "string" ? data.format.toLowerCase() : "";
      const width = Number(data?.width || 0);
      const height = Number(data?.height || 0);
      const bytes = Number(data?.bytes || 0);
      const secureUrl = typeof data?.secure_url === "string" ? data.secure_url : null;

      if (publicId !== signed.publicId || !format || width <= 0 || height <= 0 || bytes <= 0) {
        reject(new Error("Cloudinary trả về metadata không hợp lệ"));
        return;
      }

      onProgress?.(100);
      resolve({
        publicId,
        deliveryType: signed.deliveryType,
        format,
        width,
        height,
        bytes,
        previewUrl: mode === "normal" ? secureUrl : null,
      });
    };

    xhr.send(formData);
  });
}
