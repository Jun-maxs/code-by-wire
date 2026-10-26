import { createContext, useContext } from "react";
import {
  productForSession,
  type ProductInfo,
  type ProductsData,
} from "@shared/products";

/** The workbench's product data, provided by ProductsProvider (null until loaded or when no cards). */
export const ProductsContext = createContext<ProductsData | null>(null);

/** The product a session belongs to, or null (no cards, or no match). */
export function useSessionProduct(session: {
  id: string;
  title: string;
}): ProductInfo | null {
  const data = useContext(ProductsContext);
  if (!data) return null;
  const key = productForSession(data, session);
  return key ? data.products[key] : null;
}
