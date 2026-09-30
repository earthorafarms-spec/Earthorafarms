import powderImg from '@assets/generated_images/product_powder.jpg';
import powderImg2 from '@assets/generated_images/product_powder_2.jpg';
import tabletsImg from '@assets/generated_images/product_tablets.jpg';
import tabletsImg2 from '@assets/generated_images/product_tablets_2.jpg';
import heroLeavesImg from '@assets/generated_images/hero_leaves.jpg';

/** Placeholder imagery only; published product images always take precedence. */
export function productImageFallback(name: string, slug = ''): { main: string; hover: string } {
  const identity = `${name} ${slug}`.toLowerCase();
  if (/\bamla\b/.test(identity)) return { main: heroLeavesImg, hover: heroLeavesImg };
  if (/\bpowder\b/.test(identity) && !/\btablets?\b/.test(identity)) return { main: powderImg, hover: powderImg2 };
  return { main: tabletsImg, hover: tabletsImg2 };
}
