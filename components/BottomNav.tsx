import Link from "next/link";

const tabs = [
  { href: "/", label: "Swipe" },
  { href: "/liked", label: "Liked" },
  { href: "/disliked", label: "Disliked" },
] as const;

export function BottomNav({ active }: { active: "swipe" | "liked" | "disliked" }) {
  const activeHref =
    active === "swipe" ? "/" : active === "liked" ? "/liked" : "/disliked";
  return (
    <nav className="sticky bottom-0 mt-4 flex border-t border-line bg-bg/80 backdrop-blur">
      {tabs.map((t) => {
        const isActive = t.href === activeHref;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex-1 py-3 text-center text-sm ${
              isActive ? "font-medium" : "text-white/60"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
