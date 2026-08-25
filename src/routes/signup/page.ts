import { SignUpPage } from "@/lib/features/auth/auth-form";
import type { PageProps } from "./$types";

export default function Page({ data }: PageProps) {
	return SignUpPage(data);
}
