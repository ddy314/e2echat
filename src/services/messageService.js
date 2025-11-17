export const createMessageId =
    crypto?.randomUUID?.bind(crypto) ||
    (() => {
        const buf = crypto.getRandomValues(new Uint8Array(16));
        return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    });

export const hydrateMessage = (raw) => ({
    id: raw.id,
    from: raw.from,
    createdAt: raw.createdAt,
    ciphertext: raw.ciphertext || "",
    keyHint: raw.keyHint || null,
    kind: raw.kind || "text",
    deleted: Boolean(raw.deleted),
    pending: Boolean(raw.pending),
});

export const toDisplayText = (message) => {
    if (message.deleted) return "Message removed";
    return message.ciphertext || "";
};
