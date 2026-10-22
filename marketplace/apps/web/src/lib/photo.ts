/** URL of a stored photo; "thumb" is the small copy (falls back to the photo when there's none yet). */
export const photoSrc = (key: string, size: "thumb" | "full" = "thumb") => `/api/files/${key}${size === "thumb" ? "?s=thumb" : ""}`;
