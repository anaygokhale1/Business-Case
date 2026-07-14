import { redirect } from "next/navigation";

// The shell lives under the (app) route group. Send the bare root to the
// project list.
export default function RootPage() {
  redirect("/projects");
}
