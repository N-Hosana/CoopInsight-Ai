import { useEffect, useState, type ReactNode } from "react";

// Picks up any image dropped into src/app/assets/auth — no code change needed to add/remove photos.
const images = Object.values(
  import.meta.glob("../assets/auth/*.{jpg,jpeg,png,webp}", {
    eager: true,
    query: "?url",
    import: "default",
  })
) as string[];

interface AuthBackgroundProps {
  tagline: string;
  subtext: string;
  /** Icon shown in the brand mark on the left panel. */
  icon: ReactNode;
  /** Line under the product name, e.g. "Gasabo District Platform". */
  caption?: string;
  /** Wider card for long forms (registration). */
  wide?: boolean;
  /** The form side of the card. */
  children: ReactNode;
}

/**
 * The frame every sign-in screen sits in.
 *
 * The cooperative photos fill the whole window behind everything, blurred so
 * the form stays readable, and still cross-fade from one to the next. On top
 * sits one card: a see-through brand panel on the left (large screens only)
 * and the form on the right.
 *
 * The page scrolls as a whole rather than inside a fixed-height box, so a form
 * taller than the window — registration, or the login page with its test-account
 * panel — can always be scrolled into view from top to bottom.
 */
export function AuthBackground({ tagline, subtext, icon, caption = "Gasabo District Platform", wide, children }: AuthBackgroundProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (images.length < 2) return;
    const timer = setInterval(() => {
      setActiveIndex((i) => (i + 1) % images.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const dots = images.length > 1 && (
    <div className="flex gap-2">
      {images.map((src, index) => (
        <button
          key={src}
          type="button"
          aria-label={`Show background photo ${index + 1}`}
          onClick={() => setActiveIndex(index)}
          className="h-1.5 rounded-full transition-all"
          style={{
            width: index === activeIndex ? "1.5rem" : "0.5rem",
            backgroundColor: index === activeIndex ? "#FAD201" : "rgba(255,255,255,0.45)",
          }}
        />
      ))}
    </div>
  );

  return (
    <div className="relative min-h-screen bg-[#0d2818]">
      {/* Full-window photo layer. `fixed` keeps it still while the form scrolls;
          scale-110 pushes the blur's soft edge outside the window. */}
      <div className="fixed inset-0 overflow-hidden" aria-hidden>
        {images.map((src, index) => (
          <img
            key={src}
            src={src}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover scale-110 blur-[5px] transition-opacity duration-1000 ${
              index === activeIndex ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        {/* Brand-green wash — fixed (not theme-driven) so it reads the same in light and dark mode. */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(13,40,24,0.55) 0%, rgba(13,40,24,0.70) 100%)" }}
        />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col px-4 py-6 sm:px-8 sm:py-10">
        <div
          className={`m-auto w-full ${wide ? "max-w-6xl" : "max-w-5xl"} grid lg:grid-cols-[5fr_7fr] rounded-3xl overflow-hidden shadow-2xl border border-white/15`}
        >
          {/* Brand panel — see-through so the photo shows behind it. */}
          <div className="relative hidden lg:flex flex-col items-center justify-center text-center p-10 text-white bg-[rgba(13,40,24,0.35)] backdrop-blur-[2px]">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-white/95 shadow-lg mb-6 text-primary">
              {icon}
            </div>
            <h1 className="text-2xl font-bold">CoopInsightAI</h1>
            <p className="text-white/80 italic mt-1">{caption}</p>

            <div className="h-1 w-12 rounded-full my-8" style={{ backgroundColor: "#FAD201" }} />
            <h2 className="text-2xl font-bold leading-tight mb-3">{tagline}</h2>
            <p className="text-white/80 max-w-sm text-sm leading-relaxed">{subtext}</p>

            {dots && <div className="mt-8">{dots}</div>}
          </div>

          {/* Form panel. */}
          <div className="bg-card/90 backdrop-blur-md p-6 sm:p-10">
            {/* On small screens the brand panel is hidden, so the name goes here. */}
            <div className="lg:hidden text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground mb-3">
                {icon}
              </div>
              <h1 className="text-2xl font-bold text-foreground">CoopInsightAI</h1>
              <p className="text-muted-foreground text-sm mt-1">{caption}</p>
            </div>
            {children}
          </div>
        </div>

        <p className="text-center text-white/70 text-sm mt-6">
          © {new Date().getFullYear()} CoopInsightAI • Gasabo District, Rwanda
        </p>
      </div>
    </div>
  );
}
