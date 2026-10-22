import { describe, expect, it } from "vitest";
import { storageProvider, thumbKey } from "@cm/integrations";

describe("photo thumbnails (fast headshots)", () => {
  it("stores a small copy next to a photo, overwrites in place and removes both together", async () => {
    const st = storageProvider();
    const key = await st.put("photos/test-thumbs", Buffer.from("big photo"), "image/jpeg");
    expect(await st.exists(thumbKey(key))).toBe(false);
    await st.putAt(thumbKey(key), Buffer.from("small"), "image/jpeg");
    expect(await st.exists(thumbKey(key))).toBe(true);
    expect((await st.read(thumbKey(key)))?.data.toString()).toBe("small");
    // The shrink tool replaces the photo under the same key (links keep working).
    await st.putAt(key, Buffer.from("shrunk"), "image/jpeg");
    expect((await st.read(key))?.data.toString()).toBe("shrunk");
    await st.remove(key);
    expect(await st.exists(key)).toBe(false);
    expect(await st.exists(thumbKey(key))).toBe(false);
  });

  it("refuses keys that could leave the storage folder", async () => {
    const st = storageProvider();
    await expect(st.putAt("photos/../../etc/x", Buffer.from("x"), "image/jpeg")).rejects.toThrow();
    expect(await st.exists("photos/../../etc/passwd")).toBe(false);
  });
});
