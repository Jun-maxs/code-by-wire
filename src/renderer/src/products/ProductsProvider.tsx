import { useEffect, useState, type ReactNode } from "react";
import type { ProductsData } from "@shared/products";
import { ProductsContext } from "./products-context";

/** Product cards change at most a few times a day (the workbench rewrites them in the background). */
const POLL_MS = 60_000;

/** Polls `products:read` and shares the result with every sidebar row. Renders children unchanged
 *  when no cards are configured — rows then just skip their product tag. */
export function ProductsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProductsData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      window.api
        .readProducts()
        .then((d) => {
          if (alive) setData(d);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <ProductsContext.Provider value={data}>{children}</ProductsContext.Provider>
  );
}
