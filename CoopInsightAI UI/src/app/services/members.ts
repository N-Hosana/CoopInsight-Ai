import { api } from "./api";

export interface RegisterMember {
  id: string;
  full_name: string;
  membership_number: string | null;
  gender: string | null;
  status: string;
  role: string | null;
  phone: string | null;
}

/**
 * Every member on a cooperative's register.
 *
 * The list endpoint caps a page at 100, and a cooperative can be several times
 * that, so this walks the pages rather than silently stopping at the first
 * hundred — a register that drops members drops their attendance with them.
 * A manager's request is scoped to their own cooperative by the backend; an
 * administrator passes the cooperative explicitly.
 */
export async function fetchAllMembers(cooperativeId?: string | null): Promise<RegisterMember[]> {
  const all: RegisterMember[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await api.get<{ data: RegisterMember[]; pagination?: { totalPages: number } }>(
      `/members?page=${page}&limit=100${cooperativeId ? `&cooperativeId=${cooperativeId}` : ""}`
    );
    all.push(...(res.data ?? []));
    if (!res.pagination || page >= res.pagination.totalPages) break;
  }
  return all.sort((a, b) => a.full_name.localeCompare(b.full_name));
}
