import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ServiceLogRedirectPage(props: PageProps) {
  const { id } = await props.params;
  redirect(`/service/record/${id}`);
}
