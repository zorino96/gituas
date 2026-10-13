import { redirect } from "next/navigation";

/** The root: on gituas.com the proxy already shows /welcome here; on any other host this sends people there too. */
export default function RootPage(): never {
  redirect("/welcome");
}
