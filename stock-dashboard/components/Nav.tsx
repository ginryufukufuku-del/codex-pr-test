"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const p = usePathname();
  const item = (href: string, label: string, on: boolean) => (
    <Link href={href} className={on ? "on" : ""}>{label}</Link>
  );
  return (
    <nav>
      {item("/", "ポートフォリオ", p === "/")}
      {item("/market", "マーケット", p === "/market")}
    </nav>
  );
}
