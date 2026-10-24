import type { Product } from "@/lib/catalogue/schema";

/** Small finish swatch: the product thumbnail, its plain colour, or a neutral text tile. */
export default function Swatch({ product, className = "" }: { product?: Product; className?: string }) {
  if (product?.thumbnailUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.thumbnailUrl} alt="" loading="lazy" decoding="async" className={`object-cover ${className}`} />;
  if (product?.colourHex) return <span className={`block ${className}`} style={{ background: product.colourHex }} aria-hidden />;
  return (
    <span className={`grid place-items-center bg-canvas text-[9px] text-muted ${className}`} aria-hidden>
      {product ? "No image" : "—"}
    </span>
  );
}
