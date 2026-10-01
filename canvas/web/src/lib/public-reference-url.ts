function isLocalReferenceHost(hostname: string) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "host.docker.internal" || host === "::" || host === "::1") return true;
    if (host.includes(":")) return host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host);
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export function publicReferenceURL(value?: string) {
    const candidate = value?.trim();
    if (!candidate || !/^https?:\/\//i.test(candidate)) return "";
    try {
        const url = new URL(candidate);
        return url.username || url.password || isLocalReferenceHost(url.hostname) ? "" : url.href;
    } catch {
        return "";
    }
}
