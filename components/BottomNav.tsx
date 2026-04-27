import Link from "next/link";

type TabKey = "disliked" | "swipe" | "liked";

const TABS: {
  key: TabKey;
  href: string;
  label: string;
  icon: React.ReactNode;
  activeColor: string;
}[] = [
  {
    key: "disliked",
    href: "/disliked",
    label: "Disliked",
    activeColor: "text-dislike",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    ),
  },
  {
    key: "swipe",
    href: "/",
    label: "Swipe",
    activeColor: "text-accent",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="4" width="12" height="14" rx="2" />
        <rect x="3" y="7" width="12" height="14" rx="2" opacity="0.5" />
      </svg>
    ),
  },
  {
    key: "liked",
    href: "/liked",
    label: "Liked",
    activeColor: "text-like",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M12 21s-7-4.534-9.193-9.066C1.62 9.5 2.97 6 6.36 6c1.97 0 3.32 1.16 4.14 2.4.21.32.69.32.9 0C12.22 7.16 13.57 6 15.54 6c3.39 0 4.74 3.5 3.55 5.934C19.0 16.466 12 21 12 21z" />
      </svg>
    ),
  },
];

export function BottomNav({ active }: { active: TabKey }) {
  return (
    <nav className="sticky bottom-0 z-30 flex border-t border-line bg-bg/90 backdrop-blur">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] transition ${
              isActive ? `${t.activeColor} font-semibold` : "text-white/40"
            }`}
            aria-label={t.label}
          >
            {t.icon}
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
