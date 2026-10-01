import type { UserRole } from "@/services/api/auth";

export function resolvePostLoginRedirect(redirect: string, role: UserRole): string {
    const isAdminRoute = redirect === "/admin" || redirect.startsWith("/admin/");
    return isAdminRoute && role !== "admin" ? "/" : redirect;
}
