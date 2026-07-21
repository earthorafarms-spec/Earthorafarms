export interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  mrp: number;
  price: number;
  discount: number;
  rating: number;
  reviewCount: number;
  tag: string;
  imageMain: string;
  imageHover: string;
  badge: string;
  stock: string;
  highlights: string[];
  description: string;
}

export interface Review {
  name: string;
  rating: number;
  comment: string;
  date: string;
}

export interface FestiveDeal {
  id: string;
  festival_name: string;
  festival_status: string;
  festival_start_date: string;
  festival_end_date: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  festival_deal_products: { product_id: string }[];
}

export interface DbReview {
  review_product_id: string;
  review_user_id: string;
  review_rating: string;
  review_comment: string;
  review_created_at: string;
}

export interface DbProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  mrp: number;
  status: string;
  tag: string;
  badge: string;
  description: string;
  highlights: string[];
  images: { url: string; is_primary: boolean }[];
  rating: number;
  inventory: { total_stock: number }[];
  created_at: string;
}
